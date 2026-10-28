// Generated from pufuna/raschet js/extra.js @ 6d44ec6 by scripts/sync-raschet.mjs — do not edit.
import engine from './engine.js';
// Дополнительные расчёты: защита питающей линии (НВ/ВВ), нагрев двигателя на низкой
// скорости, циклическая нагрузка, резонанс с КРМ, питание от ДГУ, насос по кривым Q–H,
// каскадный пуск от одного ПЧ, разбор трендов ESQ Service.
  'use strict';

  var E = engine;
  var SQ3 = Math.sqrt(3), TWO_PI = 2 * Math.PI;
  var clamp = E.clamp, interp = E.interp;

  // Стандартный ряд номинальных токов аппаратов защиты, А.
  var STD_IN = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 320, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300];
  function stdIn(x) { return STD_IN.filter(function (v) { return v >= x - 1e-9; })[0] || null; }

  var DEVICES = {
    'mccb': { name: 'Автоматический выключатель с электронным/термомагнитным расцепителем', kInst: 10, fuse: false },
    'mcb-C': { name: 'Модульный автомат, характеристика C', kInst: 10, fuse: false, max: 125 },
    'mcb-D': { name: 'Модульный автомат, характеристика D', kInst: 20, fuse: false, max: 125 },
    'fuse-gG': { name: 'Предохранители gG', kInst: 0, fuse: true },
    'fuse-aR': { name: 'Быстродействующие предохранители aR (защита выпрямителя ПЧ)', kInst: 0, fuse: true }
  };

  // =====================================================================
  // ЗАЩИТА ПИТАЮЩЕЙ ЛИНИИ 0,4–0,69 кВ
  // =====================================================================

  // o: { U В, Iin А (действующий входной ток ПЧ), QF А (рекомендация изготовителя, необяз.),
  //      device, kInst, Zs Ом (сопротивление питающей сети/трансформатора, прямая посл.),
  //      cable: { s, np, mat, L м, theta °C }, tDisc с (допустимое время отключения) }
  function protectLV(o) {
    var dev = DEVICES[o.device] || DEVICES.mccb;
    var In = o.QF || stdIn((dev.fuse ? 1.6 : 1.3) * o.Iin);
    if (dev.max && In > dev.max) In = null;
    var Uph = o.U / SQ3;
    var c = o.cable;
    var Rk = 0, Xk = 0;
    if (c && c.s) {
      var R = E.R20[c.mat][c.s] * (1 + E.ALPHA[c.mat] * ((c.theta || 70) - 20));
      // петля фаза–PE: в 4/5-жильном кабеле сечение PE принято равным фазному (до 16 мм²)
      // или по ГОСТ Р 50571.5.54 (S/2) — консервативно
      var spe = c.s <= 16 ? c.s : c.s <= 35 ? 16 : c.s / 2;
      var Rpe = (E.R20[c.mat][spe] || E.R20[c.mat][c.s] * c.s / spe) * (1 + E.ALPHA[c.mat] * ((c.theta || 70) - 20));
      Rk = (R + Rpe) * c.L / 1000 / c.np;
      Xk = 0.15 * c.L / 1000 / c.np;
    }
    var Ik3 = o.U / (SQ3 * o.Zs) / 1000;            // кА, на шинах (место установки аппарата)
    var Zloop = Math.hypot(Rk, o.Zs + Xk);           // сопротивление сети принято индуктивным
    var Ik1 = Uph / Zloop / 1000;                    // кА, в конце линии (вводы ПЧ)
    var need, ok, rule;
    if (!In) { need = null; ok = false; rule = 'ток аппарата вне ряда'; }
    else if (dev.fuse) { need = 3 * In / 1000; rule = 'Iк(1) ≥ 3·Iн.пл (ПУЭ 1.7.79, 3.1.8)'; ok = Ik1 >= need; }
    else {
      var kInst = o.kInst || dev.kInst;
      need = 1.25 * kInst * In / 1000; rule = 'Iк(1) ≥ 1,25·Iэм, Iэм = ' + kInst + '·Iн (разброс срабатывания)'; ok = Ik1 >= need;
    }
    return { dev: dev, In: In, Ik3: Ik3, Ik1: Ik1, need: need, ok: ok, rule: rule, Zloop: Zloop, Rk: Rk };
  }

  // =====================================================================
  // ЗАЩИТА ВВ ПРИСОЕДИНЕНИЯ ПЧ (вакуумный выключатель + РЗА)
  // =====================================================================

  // o: { U кВ, Sk МВА, Str кВА (трансформатор ПЧ), Iin А (номинальный входной ток),
  //      precharge (пусковой шкаф ограничения броска), cableZ Ом }
  function protectHV(o) {
    var Itr = o.Str / (SQ3 * o.U);
    var kInr = o.precharge ? 2 : 8;                   // амплитуда броска намагничивания, о.е.
    var Iinr = kInr * Itr;
    var Zs = o.U * o.U / o.Sk;                        // Ом
    var Ik3 = o.U / (SQ3 * Math.hypot(o.cableR || 0, Zs + (o.cableX || 0)));  // кА
    var Ik2 = 0.87 * Ik3;
    // Токовая отсечка без выдержки отстраивается от действующего значения броска
    // (≈ 0,6 амплитуды в первый период) с kотс = 1,3; при выдержке 0,1 с — от 0,35.
    var Iso = Math.max(1.3 * 0.6 * Iinr, 4 * Itr);
    var IsoDelay = Math.max(1.3 * 0.35 * Iinr, 3 * Itr);
    var Irab = 1.2 * Math.max(o.Iin, Itr);          // перегрузка ПЧ 120 % — 60 с
    var Imtz = 1.2 / 0.95 * Irab;
    return {
      Itr: Itr, kInr: kInr, Iinr: Iinr, Ik3: Ik3, Ik2: Ik2,
      Iso: Iso, kSo: Ik2 * 1000 / Iso, IsoDelay: IsoDelay, kSoD: Ik2 * 1000 / IsoDelay,
      Imtz: Imtz, kMtz: Ik2 * 1000 / Imtz, tMtz: 0.5
    };
  }

  // =====================================================================
  // НАГРЕВ ДВИГАТЕЛЯ ПРИ РЕГУЛИРОВАНИИ СКОРОСТИ
  // =====================================================================

  // Допустимый длительный момент, о.е. от Mн, в функции f/fн.
  // Самовентиляция (IC411): охлаждение ухудшается при снижении скорости;
  // независимая вентиляция (IC416): почти постоянный момент.
  var COOLING = {
    self: { name: 'Самовентиляция (IC411)', x: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], y: [0.45, 0.55, 0.64, 0.72, 0.79, 0.85, 0.89, 0.93, 0.96, 0.98, 1] },
    forced: { name: 'Независимая вентиляция (IC416)', x: [0, 0.05, 1], y: [0.9, 1, 1] }
  };

  function allowTorque(md, cool, a) {
    var C = COOLING[cool] || COOLING.self;
    if (a <= 1) return interp(C.x, C.y, a);
    // выше fн — постоянная мощность; ограничение по опрокидыванию Mк·(fн/f)² с запасом 30 %
    return Math.min(1 / a, 0.7 * md.kMk / (a * a));
  }

  // o: { md, mdl, L, cool, fmin, fmax }
  function speedRange(o) {
    var md = o.md, pts = [], worst = null;
    for (var i = 0; i <= 60; i++) {
      var f = o.fmin + (o.fmax - o.fmin) * i / 60;
      var a = f / md.f;
      var Ma = allowTorque(md, o.cool, a) * md.Mn;
      var slipW = md.sync ? 0 : md.sn * TWO_PI * md.f / md.p;
      var w = Math.max(0, TWO_PI * f / md.p - slipW);
      var Ml = E.loadTorque(o.L, w);
      var m = Ml / Ma;
      var pt = { f: f, n: w * 60 / TWO_PI, Ma: Ma, Ml: Ml, util: m, P: Ml * w / 1000 };
      pts.push(pt);
      if (!worst || m > worst.util) worst = pt;
    }
    return { pts: pts, worst: worst, ok: worst.util <= 1, cool: COOLING[o.cool] || COOLING.self };
  }

  // Циклическая нагрузка. rows: [{ t с, m % Mн, n % nн }]
  function dutyCycle(o) {
    var md = o.md, mdl = o.mdl, T = 0, I2 = 0, M2 = 0, Ipk = 0, rows = [];
    o.rows.forEach(function (r) {
      if (!(r.t > 0)) return;
      var m = r.m / 100;
      var I = md.sync ? md.In * Math.hypot(md.cos * m, 0.05) : Math.sqrt(mdl.I0 * mdl.I0 + Math.pow(mdl.Iq * m, 2));
      if (Math.abs(m) < 1e-6) I = md.sync ? 0.05 * md.In : mdl.I0;
      var P = m * md.Mn * md.wn * (r.n / 100) / 1000;
      T += r.t; I2 += I * I * r.t; M2 += m * m * r.t;
      Ipk = Math.max(Ipk, I);
      rows.push({ t: r.t, m: r.m, n: r.n, I: I, P: P });
    });
    var Irms = T > 0 ? Math.sqrt(I2 / T) : 0;
    var Mrms = T > 0 ? Math.sqrt(M2 / T) : 0;
    var res = { rows: rows, T: T, Irms: Irms, Mrms: Mrms * 100, Ipk: Ipk };
    if (o.vfd) {
      var v = o.vfd, ovlT = (v.ovl || [150, 60])[1];
      res.okRms = Irms <= v.Ider;
      res.okPk = rows.every(function (r) { return r.I <= v.Imax && (r.I <= v.Ider || r.t <= ovlT); });
      // перегрузка ПЧ допускается не чаще 1 раза в 10 мин (типовое условие)
      res.okPeriod = !rows.some(function (r) { return r.I > v.Ider; }) || T >= 600 || Irms <= 0.9 * v.Ider;
    }
    res.okMotor = Mrms <= 1.0001;
    return res;
  }

  // =====================================================================
  // РЕЗОНАНС С КОНДЕНСАТОРНЫМИ УСТАНОВКАМИ, ПИТАНИЕ ОТ ДГУ
  // =====================================================================

  // o: { Sk МВА (на шинах), Qc квар, p % (расстройка: 0, 5,67, 7, 14), harm (результат E.harmonics) }
  function resonance(o) {
    var hr = o.Qc > 0 ? Math.sqrt(o.Sk * 1000 / o.Qc) : null;
    var ht = o.p > 0 ? 1 / Math.sqrt(o.p / 100) : null;
    var Q = 5;     // добротность параллельного контура (типично 3–8)
    var rows = (o.harm ? o.harm.rows : []).map(function (r) {
      var A = 1;
      if (hr && !ht) { var x = r.h / hr; A = 1 / Math.sqrt(Math.pow(1 - x * x, 2) + Math.pow(x / Q, 2)); }
      return { h: r.h, U0: r.Upct, A: Math.max(1, A), U: r.Upct * Math.max(1, A) };
    });
    var thdU = Math.sqrt(rows.reduce(function (s, r) { return s + r.U * r.U; }, 0));
    var danger = !ht && hr && rows.some(function (r) { return Math.abs(r.h - hr) / r.h < 0.15 && r.U0 > 0.05; });
    return { hr: hr, ht: ht, rows: rows, thdU: thdU, danger: !!danger };
  }

  // o: { S кВА, xd2 % (сверхпереходное), xd1 % (переходное), U кВ, topo, Pin кВт, md, Ip А (пусковой ток при прямом пуске) }
  var GEN_RATIO = { '6p': 2.5, '6pL': 2.0, '12p': 1.6, '18p': 1.4, 'afe': 1.25, hv18: 1.4, hv30: 1.25, hv48: 1.25 };
  function generator(o) {
    var Skg = o.S / (o.xd2 / 100) / 1000;            // МВА
    var h = E.harmonics({ topo: o.topo, P: o.Pin, U: o.U, Sk: Skg, bg: 0 });
    var Sst = SQ3 * o.U * o.Ip;                       // кВА
    var dipDol = Sst / (Sst + o.S / (o.xd1 / 100));
    var Sreq = (GEN_RATIO[o.topo] || 2) * o.Pin;
    return { Skg: Skg, harm: h, thdU: h.thdU, dipDol: dipDol, Sreq: Sreq, ratio: GEN_RATIO[o.topo] || 2, okSize: o.S >= Sreq, okThd: h.thdU <= 5 };
  }

  // =====================================================================
  // НАСОС ПО КРИВЫМ Q–H
  // =====================================================================

  function solve3(A, b) {
    var M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < 3; c++) {
      var p = c;
      for (var r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (var r2 = 0; r2 < 3; r2++) {
        if (r2 === c) continue;
        var k = M[r2][c] / M[c][c];
        for (var j = c; j < 4; j++) M[r2][j] -= k * M[c][j];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  // Квадратичная аппроксимация y = a + b·x + c·x² методом наименьших квадратов.
  function fitQuad(xs, ys) {
    var S = [0, 0, 0, 0, 0], T = [0, 0, 0];
    for (var i = 0; i < xs.length; i++) {
      var x = xs[i], y = ys[i], p = 1;
      for (var k = 0; k <= 4; k++) { S[k] += p; if (k <= 2) T[k] += y * p; p *= x; }
    }
    if (xs.length < 3) {
      // две точки — парабола без линейного члена
      if (xs.length === 2) { var c2 = (ys[1] - ys[0]) / (xs[1] * xs[1] - xs[0] * xs[0]); return [ys[0] - c2 * xs[0] * xs[0], 0, c2]; }
      return null;
    }
    return solve3([[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]], T);
  }
  function quad(c, x) { return c[0] + c[1] * x + c[2] * x * x; }

  // o: { pts: [{ Q м³/ч, H м, eta %, npsh м }], Hst м, Hd м (напор сети при Qd), Qd м³/ч,
  //      rho кг/м³, npsha м }
  function pump(o) {
    var pts = o.pts.filter(function (p) { return p.Q >= 0 && p.H > 0; });
    if (pts.length < 2) return null;
    var cH = fitQuad(pts.map(function (p) { return p.Q; }), pts.map(function (p) { return p.H; }));
    var ep = pts.filter(function (p) { return p.eta > 0; });
    var cE = ep.length >= 3 ? fitQuad(ep.map(function (p) { return p.Q; }), ep.map(function (p) { return p.eta; })) : null;
    var np = pts.filter(function (p) { return p.npsh > 0; });
    var cN = np.length >= 2 ? fitQuad(np.map(function (p) { return p.Q; }), np.map(function (p) { return p.npsh; })) : null;
    if (!cH) return null;
    var ks = o.Qd > 0 ? (o.Hd - o.Hst) / (o.Qd * o.Qd) : 0;
    var g = 9.81, rho = o.rho || 1000;
    function eta(Q) { return cE ? clamp(quad(cE, Q), 5, 95) / 100 : 0.75; }
    // рабочая точка на полной скорости: Hн(Q) = Hст + kс·Q²
    var A = cH[2] - ks, B = cH[1], C = cH[0] - o.Hst;
    var Q1 = Math.abs(A) < 1e-12 ? -C / B : (-B - Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
    if (!(Q1 > 0)) Q1 = (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A);
    var rmin = o.Hst > 0 ? Math.sqrt(o.Hst / cH[0]) : 0;
    // частота вращения (о.е.) для расхода Q при регулировании: a·r² + b·Q·r + c·Q² = Hст + kс·Q²
    function speedFor(Q) {
      var a = cH[0], b = cH[1] * Q, c = cH[2] * Q * Q - o.Hst - ks * Q * Q;
      var d = b * b - 4 * a * c;
      return d < 0 ? null : (-b + Math.sqrt(d)) / (2 * a);
    }
    function point(Q) {
      var r = speedFor(Q);
      var Hs = o.Hst + ks * Q * Q;
      var Qe = r > 0 ? Q / r : Q;
      var Pv = r > 0 ? rho * g * (Q / 3600) * Hs / eta(Qe) / 1000 : null;
      var Ht = quad(cH, Q);
      var Pt = rho * g * (Q / 3600) * Ht / eta(Q) / 1000;
      var NPr = cN && r > 0 ? quad(cN, Qe) * r * r : null;
      return { Q: Q, r: r, n: r, Hs: Hs, Ht: Ht, Pv: Pv, Pt: Pt, etaV: eta(Qe), etaT: eta(Q), NPr: NPr, NPrT: cN ? quad(cN, Q) : null };
    }
    var curve = [];
    for (var i = 0; i <= 40; i++) { var Q = Q1 * (0.2 + 0.8 * i / 40); curve.push(point(Q)); }
    var op = point(Q1);
    var npOk = o.npsha > 0 && cN ? curve.every(function (p) { return p.NPr == null || o.npsha >= p.NPr + 0.5; }) : null;
    return { cH: cH, cE: cE, cN: cN, ks: ks, Q1: Q1, H1: quad(cH, Q1), op: op, rmin: rmin, curve: curve, point: point, speedFor: speedFor, npOk: npOk, eta: eta, Hpump: function (Q, r) { return cH[0] * r * r + cH[1] * Q * r + cH[2] * Q * Q; } };
  }

  // =====================================================================
  // КАСКАДНЫЙ ПУСК НЕСКОЛЬКИХ ДВИГАТЕЛЕЙ ОТ ОДНОГО ПЧ
  // =====================================================================

  // o: { mdl, L, cfg (как для simulate, режим ПЧ), N, sync (синхронизация с сетью), pause с, Sk МВА }
  function cascade(o) {
    var md = o.mdl.md;
    var acc = E.simulate(o.mdl, o.L, Object.assign({}, o.cfg, { mode: 'vfd', fSet: md.f, accOnly: true }));
    var tA = acc.stalled ? null : acc.data[acc.data.length - 1].t;
    // установившийся ток двигателя от сети при нагрузке механизма
    var Iload;
    if (md.sync) Iload = md.In * Math.hypot(md.cos * o.L.Mn / md.Mn, Math.sqrt(1 - md.cos * md.cos));
    else {
      var s = md.sn * o.L.Mn / md.Mn;
      Iload = E.motorPoint(o.mdl, md.f, md.U, Math.max(s, 1e-4), false).I;
    }
    var tTr = o.sync ? 0.5 : 0.3;
    var Isurge = o.sync ? 1.3 * Iload : md.kI * md.In * 0.9;
    var Xs = o.Sk > 0 ? md.U * md.U / (o.Sk * 1e6) : 0;
    var t = [], Ig = [], Iv = [], events = [];
    if (tA == null) return { stalled: true };
    var T0 = 0;
    for (var k = 0; k < o.N; k++) {
      var on = k;   // двигателей уже на сети
      acc.data.forEach(function (p) { t.push(T0 + p.t); Iv.push(p.I); Ig.push(on * Iload + Math.max(p.P, 0) * 1000 / (SQ3 * md.U * 0.96)); });
      var tt = T0 + tA;
      // перевод на сеть
      t.push(tt + 0.01); Iv.push(0); Ig.push(on * Iload + Isurge);
      t.push(tt + tTr); Iv.push(0); Ig.push((on + 1) * Iload);
      events.push({ k: k + 1, t: tt, Isurge: Isurge, dU: Xs ? SQ3 * Isurge * Xs * 0.9 / md.U : 0 });
      T0 = tt + tTr + (o.pause || 5);
      if (k < o.N - 1) { t.push(T0 - 0.01); Iv.push(0); Ig.push((on + 1) * Iload); }
    }
    return { stalled: false, tA: tA, Iload: Iload, Isurge: Isurge, total: T0 - (o.pause || 5), t: t, Ig: Ig, Iv: Iv, events: events, IpkVfd: acc.Ipk };
  }

  // =====================================================================
  // ТРЕНДЫ ESQ SERVICE (CSV)
  // =====================================================================

  var CSV_KEYS = [
    [/^F вых/, 'f'], [/^F зад/, 'fset'], [/^F ОС/, 'ffb'], [/^I вых/, 'I'], [/^I вх/, 'Iin'], [/^U вх/, 'Uin'],
    [/^U вых, В/, 'U'], [/^U вых, %/, 'Upct'], [/^P вых/, 'P'], [/^P вх/, 'Pin'], [/^M вых/, 'M'], [/^n,/, 'n'],
    [/^Udc( ср)?,/, 'Udc'], [/^Работа$/, 'run'], [/^Авария$/, 'fault'], [/^T (IGBT макс|макс|инв)/, 'T']
  ];

  function parseEsqCsv(text) {
    var lines = text.replace(/^﻿/, '').split(/\r?\n/);
    var hi = lines.findIndex(function (l) { return /^"?Дата и время"?;/.test(l); });
    if (hi < 0) throw new Error('нет строки заголовка «Дата и время;…» — это не файл трендов ESQ Service');
    var meta = lines.slice(0, hi).join(' ').replace(/;/g, ' ').trim();
    var head = lines[hi].split(';').map(function (x) { return x.replace(/"/g, '').trim(); });
    var cols = {};
    head.forEach(function (h, i) { for (var k = 0; k < CSV_KEYS.length; k++) if (CSV_KEYS[k][0].test(h) && cols[CSV_KEYS[k][1]] == null) { cols[CSV_KEYS[k][1]] = i; break; } });
    var d = { t: [] };
    Object.keys(cols).forEach(function (k) { d[k] = []; });
    for (var i = hi + 1; i < lines.length; i++) {
      var l = lines[i];
      if (!l.trim()) continue;
      var c = l.split(';'), d0 = c[0].replace(/"/g, '');
      var m = d0.match(/(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:[.,](\d+))?/);
      var m2 = m ? null : d0.match(/(\d\d)\.(\d\d)\.(\d{4})[ ,]+(\d\d):(\d\d):(\d\d)(?:[.,](\d+))?/);
      if (!m && !m2) continue;
      var ms = (m || m2)[7] ? +String((m || m2)[7]).padEnd(3, '0').slice(0, 3) : 0;
      var tm = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms) : Date.UTC(+m2[3], +m2[2] - 1, +m2[1], +m2[4], +m2[5], +m2[6], ms);
      d.t.push(tm / 1000);
      Object.keys(cols).forEach(function (k) {
        var x = parseFloat(String(c[cols[k]] || '').replace(',', '.'));
        d[k].push(isFinite(x) ? x : NaN);
      });
    }
    if (d.t.length < 5) throw new Error('в файле мало данных трендов');
    var t0 = d.t[0];
    d.t = d.t.map(function (x) { return x - t0; });
    var dev = /ME800-R/.test(meta) ? 'ESQ F ME800-R' : /ME800|ВВ ПЧ/.test(meta) ? 'ESQ F ME800' : /F790/.test(meta) ? 'ESQ F 790' : /770/.test(meta) ? 'ESQ-770' : /500\/600|ESQ500/.test(meta) ? 'ESQ-500/600' : /УПП|HVS/.test(meta) ? 'ESQ F HVS' : (meta || 'не указано');
    return { meta: meta, device: dev, cols: Object.keys(cols), head: head, d: d, t0: t0 };
  }

  // Скорость и момент на валу по трендам ПЧ (без датчика скорости).
  function shaftFromTrend(tr, md, mdl) {
    var d = tr.d, n = d.t.length;
    var out = { w: [], M: [], src: d.M ? 'M вых' : d.P ? 'P вых' : d.I ? 'I вых' : '' };
    var slipN = md.sync ? 0 : md.sn * md.f;      // Гц при Mн
    for (var i = 0; i < n; i++) {
      var f = d.f ? d.f[i] : NaN, M = NaN;
      if (d.M && isFinite(d.M[i])) M = d.M[i] / 100 * md.Mn;
      else if (d.P && isFinite(d.P[i]) && f > 0.05 * md.f) {
        var wsyn = TWO_PI * f / md.p;
        // электромагнитный момент = мощность в зазоре / синхронная скорость;
        // потери в статоре приняты равными половине суммарных потерь двигателя
        M = d.P[i] * 1000 * (1 - (1 - md.eta) / 2) / Math.max(wsyn, 1e-3);
      } else if (!d.P && d.I && isFinite(d.I[i])) {
        var Iq = Math.sqrt(Math.max(0, d.I[i] * d.I[i] - mdl.I0 * mdl.I0));
        M = md.Mn * Iq / mdl.Iq;
      }
      var w;
      if (d.n && isFinite(d.n[i])) w = d.n[i] * TWO_PI / 60;
      else w = Math.max(0, TWO_PI * (f - (isFinite(M) ? slipN * M / md.Mn : 0)) / md.p);
      out.w.push(w); out.M.push(M);
    }
    // сглаживание и производная dω/dt (скользящее окно ~1 с)
    var dw = [];
    for (var j = 0; j < n; j++) {
      var a = j, b = j;
      while (a > 0 && d.t[j] - d.t[a - 1] <= 0.6) a--;
      while (b < n - 1 && d.t[b + 1] - d.t[j] <= 0.6) b++;
      dw.push(b > a ? (out.w[b] - out.w[a]) / (d.t[b] - d.t[a]) : 0);
    }
    out.dw = dw;
    return out;
  }

  // Пуски: рост частоты от < 2 Гц до установившегося значения.
  function findStarts(tr) {
    var d = tr.d, n = d.t.length, starts = [];
    if (!d.f) return starts;
    var i = 1;
    while (i < n) {
      if (d.f[i - 1] < 2 && d.f[i] >= d.f[i - 1] && (d.run ? d.run[i] > 0 : true)) {
        var j = i, last = i;
        while (j < n - 1) {
          j++;
          if (d.f[j] > d.f[last] + 0.05) last = j;
          if (d.t[j] - d.t[last] > 3 || d.f[j] < d.f[last] - 1) break;
        }
        if (d.f[last] >= 10 && d.t[last] - d.t[i - 1] >= 0.5) {
          starts.push({ i0: i - 1, i1: last, t0: d.t[i - 1], t1: d.t[last], fEnd: d.f[last], ramp: d.f[last] / Math.max(0.1, d.t[last] - d.t[i - 1]) });
        }
        i = Math.max(j, i + 1);
      } else i++;
    }
    return starts;
  }

  // Идентификация характеристики механизма Mс(ω) = A + B·(ω/ωн)^k и момента инерции J.
  function identify(tr, md, mdl) {
    var sh = shaftFromTrend(tr, md, mdl);
    var d = tr.d, n = d.t.length;
    var steady = [], dyn = [];
    for (var i = 0; i < n; i++) {
      if (!isFinite(sh.M[i]) || sh.w[i] < 0.08 * md.wn) continue;
      var alpha = sh.dw[i];
      var x = { w: sh.w[i], M: sh.M[i], a: alpha };
      if (Math.abs(alpha) < 0.004 * md.wn) steady.push(x);
      else if (Math.abs(alpha) > 0.01 * md.wn) dyn.push(x);
    }
    var fit = null;
    if (steady.length >= 3) {
      var spread = Math.max.apply(null, steady.map(function (p) { return p.w; })) - Math.min.apply(null, steady.map(function (p) { return p.w; }));
      var ks = spread > 0.15 * md.wn ? [0, 0.5, 1, 1.5, 2, 2.5, 3] : [2];
      ks.forEach(function (k) {
        var Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, N = steady.length;
        steady.forEach(function (p) { var X = Math.pow(p.w / md.wn, k); Sx += X; Sy += p.M; Sxx += X * X; Sxy += X * p.M; });
        var den = N * Sxx - Sx * Sx, A, B;
        if (k === 0 || Math.abs(den) < 1e-9) { A = Sy / N; B = 0; } else { B = (N * Sxy - Sx * Sy) / den; A = (Sy - B * Sx) / N; }
        if (spread <= 0.15 * md.wn) { A = 0.05 * Sy / N; B = (Sy / N - A) / (Sx / N); }
        var err = 0;
        steady.forEach(function (p) { var e = p.M - (A + B * Math.pow(p.w / md.wn, k)); err += e * e; });
        if (!fit || err < fit.err) fit = { k: k, A: A, B: B, err: err, n: N, rms: Math.sqrt(err / N) };
      });
    }
    var ML = fit ? function (w) { return fit.A + fit.B * Math.pow(w / md.wn, fit.k); } : null;
    var J = null;
    if (ML && dyn.length >= 5) {
      var num = 0, den2 = 0;
      dyn.forEach(function (p) { var Md = p.M - ML(p.w); num += Md * p.a; den2 += p.a * p.a; });
      if (den2 > 0) J = num / den2;
      if (!(J > 0)) J = null;
    }
    var Pn = ML ? ML(md.wn) * md.wn / 1000 : null;
    return {
      sh: sh, steady: steady, dyn: dyn, fit: fit, ML: ML, J: J, Jload: J ? Math.max(0, J - md.J) : null,
      Pn: Pn, m0: fit && (fit.A + fit.B) > 0 ? clamp(fit.A / (fit.A + fit.B), 0, 1) : null
    };
  }

  var api = {
    STD_IN: STD_IN, stdIn: stdIn, DEVICES: DEVICES, protectLV: protectLV, protectHV: protectHV,
    COOLING: COOLING, allowTorque: allowTorque, speedRange: speedRange, dutyCycle: dutyCycle,
    resonance: resonance, generator: generator, GEN_RATIO: GEN_RATIO,
    fitQuad: fitQuad, pump: pump, cascade: cascade,
    parseEsqCsv: parseEsqCsv, shaftFromTrend: shaftFromTrend, findStarts: findStarts, identify: identify
  };
  export default api;
