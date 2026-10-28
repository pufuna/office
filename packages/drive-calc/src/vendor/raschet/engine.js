// Generated from pufuna/raschet js/engine.js @ 6d44ec6 by scripts/sync-raschet.mjs — do not edit.
// Расчётное ядро: двигатель, механизм, динамика пуска, подбор ПЧ, кабели,
// гармоники, торможение, энергосбережение. Без зависимостей; работает в
// браузере (window.Raschet) и в Node (module.exports) для тестов.
  'use strict';

  var SQ3 = Math.sqrt(3);
  var TWO_PI = 2 * Math.PI;

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  function interp(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    for (var i = 1; i < xs.length; i++) {
      if (x <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
    }
    return ys[ys.length - 1];
  }

  // --- комплексные числа (только то, что нужно для схемы замещения) ---
  function cx(re, im) { return { re: re, im: im || 0 }; }
  function cadd(a, b) { return cx(a.re + b.re, a.im + b.im); }
  function cdiv(a, b) {
    var d = b.re * b.re + b.im * b.im;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function cabs(a) { return Math.hypot(a.re, a.im); }

  // =====================================================================
  // ДВИГАТЕЛЬ
  // =====================================================================

  // Типовые кратности для асинхронных двигателей с к.з. ротором.
  var MOTOR_DEFAULTS = {
    lv: { kI: 7.0, kMp: 2.0, kMk: 2.6 },
    hv: { kI: 5.5, kMp: 0.9, kMk: 2.2 },
    sync: { kI: 6.0, kMp: 1.1, kMk: 2.0 }
  };

  // Дополняет паспортные данные расчётными величинами.
  // m: { P кВт, U В (линейное), f Гц, n об/мин, cos, eff %, I А (необяз.),
  //      kI, kMp, kMk, J кг·м² (необяз.) }
  // m.type === 'sync' — синхронный двигатель с пусковой (демпферной) обмоткой и
  // обмоткой возбуждения: kI, kMp, kMk описывают асинхронный пуск.
  function motorDerive(m) {
    var r = Object.assign({}, m);
    r.hv = r.U > 1000;
    r.sync = m.type === 'sync';
    var d = r.sync ? MOTOR_DEFAULTS.sync : r.hv ? MOTOR_DEFAULTS.hv : MOTOR_DEFAULTS.lv;
    r.kI = r.kI || d.kI;
    r.kMp = r.kMp || d.kMp;
    r.kMk = r.kMk || d.kMk;
    r.p = Math.max(1, Math.floor(60 * r.f / r.n + 1e-9));
    r.ns = 60 * r.f / r.p;
    r.sn = Math.max(0.003, (r.ns - r.n) / r.ns);
    // для СД: скольжение демпферной обмотки, по которому строится асинхронная характеристика
    if (r.sync) { r.n = r.ns; r.sn = 0.02; }
    r.eta = r.eff / 100;
    r.InCalc = r.P * 1000 / (SQ3 * r.U * r.cos * r.eta);
    r.In = r.I > 0 ? r.I : r.InCalc;
    r.wn = TWO_PI * r.n / 60;
    r.Mn = r.P * 1000 / r.wn;
    // Оценка момента инерции ротора, если не задан (аппроксимация каталогов
    // 4-полюсных двигателей, пересчёт на число пар полюсов).
    r.Jest = !(r.J > 0);
    if (r.Jest) r.J = 0.00244 * Math.pow(r.P, 1.37) * Math.pow(r.p / 2, 1.0);
    r.Pin = r.P / r.eta;
    r.S = SQ3 * r.U * r.In / 1000;
    return r;
  }

  // Г-образная схема замещения, параметры которой подобраны так, чтобы
  // проходить через паспортные точки: номинал (sн, Mн, cosφ), критический
  // момент Mк и пусковую точку (Iп, Mп). Вытеснение тока в роторе и
  // насыщение путей рассеяния учтены линейной зависимостью Rr, Xk от
  // частоты тока ротора.
  function motorModel(md) {
    var Uph = md.U / SQ3;
    var ws = TWO_PI * md.f / md.p;
    var Pag = md.Mn * ws;
    var In = md.In;
    var Rs = Math.max(1e-6, md.sn * Pag / (3 * In * In));
    var Ip = md.kI * In, Mp = md.kMp * md.Mn, Mk = md.kMk * md.Mn;

    var RrS = Mp * ws / (3 * Ip * Ip);
    var ZS = Uph / Ip;
    var XkS = Math.sqrt(Math.max(ZS * ZS - Math.pow(Rs + RrS, 2), Math.pow(0.1 * ZS, 2)));

    var A = 3 * Uph * Uph / (2 * Mk * ws) - Rs;
    var Xk0 = A > Rs ? Math.sqrt(A * A - Rs * Rs) : XkS;

    var b = 3 * Uph * Uph - 2 * Pag * Rs;
    var disc = Math.max(0, b * b - 4 * Pag * Pag * (Rs * Rs + Xk0 * Xk0));
    var Rr0 = md.sn * (b + Math.sqrt(disc)) / (2 * Pag);
    if (RrS < Rr0) RrS = Rr0;

    var Zr = Math.hypot(Rs + Rr0 / md.sn, Xk0);
    var Ir = Uph / Zr;
    var Pph = md.P * 1000 / md.eta / 3;
    var Qtot = Pph * Math.tan(Math.acos(clamp(md.cos, 0.3, 0.999)));
    var Qm = Qtot - Ir * Ir * Xk0;
    var Xm = Qm > 0 ? Uph * Uph / Qm : Uph / (0.3 * In);
    Xm = Math.max(Xm, Uph / (0.7 * In));

    var mdl = { md: md, Rs: Rs, Rr0: Rr0, RrS: RrS, Xk0: Xk0, XkS: XkS, Xm: Xm, kM: 1 };
    var nom = motorPoint(mdl, md.f, md.U, md.sn, false);
    mdl.kM = md.Mn / nom.M;
    mdl.I0 = Uph / Xm;
    mdl.Iq = Math.sqrt(Math.max(In * In - mdl.I0 * mdl.I0, 0.25 * In * In));
    return mdl;
  }

  // Рабочая точка при частоте f, линейном напряжении U и скольжении s.
  // irComp — идеальная компенсация падения на Rs (векторное управление).
  function motorPoint(mdl, f, U, s, irComp) {
    var md = mdl.md;
    f = Math.max(f, 0.05);
    var a = f / md.f;
    var Uph = U / SQ3;
    var g = clamp(Math.abs(s) * a, 0, 1);
    var Rr = mdl.Rr0 + (mdl.RrS - mdl.Rr0) * g;
    var Xk = (mdl.Xk0 + (mdl.XkS - mdl.Xk0) * g) * a;
    var Rs = irComp ? 0 : mdl.Rs;
    var ws = TWO_PI * f / md.p;
    var Im = cdiv(cx(Uph), cx(0, mdl.Xm * a));
    if (Math.abs(s) < 1e-7) {
      return { M: 0, I: cabs(Im), Ir: 0, P: 0, cos: 0 };
    }
    var Ir = cdiv(cx(Uph), cx(Rs + Rr / s, Xk));
    var I = cadd(Ir, Im);
    var IrA = cabs(Ir);
    var M = (mdl.kM || 1) * 3 * IrA * IrA * (Rr / s) / ws;
    var Ia = cabs(I);
    var P = 3 * Uph * I.re;
    return { M: M, I: Ia, Ir: IrA, P: P, cos: Ia > 0 ? I.re / Ia : 0 };
  }

  // Механическая характеристика при прямом пуске: массивы по скорости.
  function motorCurve(mdl, Ufrac, points) {
    var md = mdl.md, out = [];
    points = points || 200;
    for (var i = 0; i <= points; i++) {
      var s = 1 - i / points * (1 - md.sn * 0.2);
      var op = motorPoint(mdl, md.f, md.U * (Ufrac || 1), s, false);
      out.push({ n: md.ns * (1 - s), s: s, M: op.M, I: op.I });
    }
    return out;
  }

  // =====================================================================
  // МЕХАНИЗМ (НАГРУЗКА)
  // =====================================================================

  // k — показатель степени M(ω) (2 — вентиляторный, 0 — постоянный момент),
  // m0 — доля момента трения при нулевой скорости (для k>0),
  // brk — момент трогания в долях Mс.ном, ovl/tovl — типовая перегрузка.
  var LOAD_TYPES = {
    pump: { name: 'Центробежный насос', k: 2, m0: 0.05, brk: 0.15, quad: true, ovl: 110, tovl: 60, Jk: 0.15 },
    fan: { name: 'Вентилятор, дымосос', k: 2, m0: 0.03, brk: 0.1, quad: true, ovl: 110, tovl: 60, Jk: 12 },
    screw: { name: 'Винтовой компрессор', k: 0, m0: 1, brk: 0.4, quad: false, ovl: 120, tovl: 60, Jk: 0.3 },
    piston: { name: 'Поршневой компрессор / насос', k: 0, m0: 1, brk: 1.2, quad: false, ovl: 150, tovl: 60, Jk: 0.8 },
    conveyor: { name: 'Конвейер', k: 0, m0: 1, brk: 1.5, quad: false, ovl: 150, tovl: 60, Jk: 1.0 },
    mill: { name: 'Мельница', k: 0, m0: 1, brk: 1.8, quad: false, ovl: 150, tovl: 60, Jk: 8 },
    crusher: { name: 'Дробилка', k: 0, m0: 1, brk: 1.5, quad: false, ovl: 180, tovl: 10, Jk: 3.0 },
    hoist: { name: 'Подъёмный механизм', k: 0, m0: 1, brk: 1.3, quad: false, ovl: 160, tovl: 10, Jk: 0.5 },
    extruder: { name: 'Экструдер, мешалка', k: 1, m0: 0.4, brk: 1.4, quad: false, ovl: 150, tovl: 60, Jk: 0.5 },
    custom: { name: 'Пользовательская', k: 2, m0: 0.1, brk: 0.3, quad: false, ovl: 150, tovl: 60, Jk: 1.0 }
  };

  // L: { type, P кВт на валу при номинальной скорости, k, m0, brk, J кг·м²
  //      (приведённый к валу двигателя) }
  function loadDerive(L, md) {
    var t = LOAD_TYPES[L.type] || LOAD_TYPES.custom;
    var r = Object.assign({}, L);
    if (L.type !== 'custom') { r.k = t.k; r.m0 = t.m0; r.brk = L.brk > 0 ? L.brk : t.brk; }
    r.quad = t.quad;
    r.name = t.name;
    r.wn = md.wn;
    r.Mn = r.P * 1000 / md.wn;
    r.Jest = !(r.J >= 0 && r.J !== '' && r.J !== null && r.J !== undefined);
    if (r.Jest) r.J = md.J * t.Jk;
    return r;
  }

  function loadTorque(L, w) {
    var x = Math.abs(w) / L.wn;
    var Mrun = L.k > 0 ? L.Mn * (L.m0 + (1 - L.m0) * Math.pow(x, L.k)) : L.Mn;
    var Mb = L.brk * L.Mn;
    if (x < 0.03 && Mb > Mrun) Mrun += (Mb - Mrun) * (1 - x / 0.03);
    return Mrun;
  }

  // =====================================================================
  // ДИНАМИКА ПУСКА / ОСТАНОВА
  // =====================================================================

  // cfg: { mode: 'dol' | 'soft' | 'vfd', control: 'vf' | 'vector',
  //        tAcc, tDec, tHold, fSet, boost (о.е.), Ilim (А),
  //        soft: { U0 о.е., tRamp, Ilim А }, Sk МВА (мощность КЗ сети для
  //        оценки провала напряжения при прямом пуске/УПП), tMax }
  function simulate(mdl, L, cfg) {
    var md = mdl.md;
    var J = md.J + L.J;
    var Tm = J * md.wn / md.Mn;
    var dt = clamp(0.15 * Tm * md.sn, 2e-5, 4e-3);
    var mode = cfg.mode;
    var vector = cfg.control === 'vector';
    var fSet = cfg.fSet || md.f;
    var tAcc = Math.max(0.1, cfg.tAcc || 10) * fSet / md.f;
    var tDec = Math.max(0.1, cfg.tDec || 10) * fSet / md.f;
    var tHold = cfg.tHold != null ? cfg.tHold : 2;
    var tMax = cfg.tMax || 600;
    var Xs = cfg.Sk > 0 ? Math.pow(md.U, 2) / (cfg.Sk * 1e6) : 0;

    var w = 0, t = 0, f = mode === 'vfd' ? (md.sync ? 0 : 0.5) : md.f;
    var syncLocked = false, tSync = null;
    var wsGrid = TWO_PI * md.f / md.p;
    // ток СД: активная составляющая пропорциональна моменту; реактивная — от возбуждения
    // (при работе от сети — номинальная, от ПЧ — cos φ ≈ 1).
    function syncI(M, grid) {
      var a = md.cos * M / md.Mn;
      return md.In * Math.hypot(a, grid ? Math.sqrt(1 - md.cos * md.cos) : 0.05);
    }
    var uSoft = cfg.soft ? cfg.soft.U0 : 0.35;
    var phase = 'acc', tPhase = 0, tReach = null, wPrev = 0, settle = 0;
    var Ilim = cfg.Ilim || 1.5 * md.In;
    var out = [], stride = 1, step = 0;
    var Ipk = 0, I2t = 0, Umin = 1, marginMin = Infinity, Ppeak = 0, Pregen = 0, Eregen = 0;
    var est = mode === 'vfd' ? tAcc + tHold + tDec : mode === 'soft' ? Math.max(4 * Tm, 2 * ((cfg.soft && cfg.soft.tRamp) || 15)) : Math.max(1, 4 * Tm);
    stride = Math.max(1, Math.round(est / dt / 1500));

    function supplyU(op, U) {
      if (!Xs || mode === 'vfd') return U;
      // Напряжение на зажимах с учётом индуктивного сопротивления сети.
      var Zm = (U / SQ3) / Math.max(op.I, 1e-6);
      var Rm = Zm * op.cos, Xm = Zm * Math.sqrt(Math.max(0, 1 - op.cos * op.cos));
      return U * Zm / Math.hypot(Rm, Xm + Xs);
    }

    function evalAt(fq, Ucmd, wcur) {
      var ws = TWO_PI * fq / md.p;
      var s = (ws - wcur) / ws;
      var op = motorPoint(mdl, fq, Ucmd, s, vector);
      var Ut = supplyU(op, Ucmd);
      if (Ut !== Ucmd) { op = motorPoint(mdl, fq, Ut, s, vector); }
      op.U = Ut; op.s = s;
      return op;
    }

    function vfdU(fq) {
      var a = fq / md.f;
      if (a >= 1) return md.U;
      var bst = vector ? 0 : (cfg.boost != null ? cfg.boost : 0.02);
      return md.U * (bst + (1 - bst) * a);
    }

    var op;
    while (t < tMax) {
      var Ucmd = md.U;
      var rigid = false, MLr = loadTorque(L, w);
      if (md.sync && mode === 'vfd') {
        // СД от ПЧ: ротор следует за частотой, пока требуемый момент не превышает
        // момента при токоограничении; иначе частота подстраивается под ротор.
        rigid = true;
        var rate = phase === 'acc' ? fSet / tAcc : phase === 'dec' ? -fSet / tDec : 0;
        var fNx = clamp(f + rate * dt, 0, fSet);
        var wT = TWO_PI * fNx / md.p;
        var Mlim = md.Mn * Ilim / (md.In * md.cos);
        var Mreq = MLr + J * (wT - w) / dt, Mm;
        if (Math.abs(Mreq) <= Mlim) { Mm = Mreq; w = wT; f = fNx; }
        else { Mm = Mreq > 0 ? Mlim : -Mlim; w = Math.max(0, w + (Mm - MLr) / J * dt); f = w * md.p / TWO_PI; }
        if (phase === 'acc' && f >= fSet - 1e-9) { phase = 'hold'; tPhase = 0; }
        else if (phase === 'hold') { tPhase += dt; if (tPhase >= tHold) phase = 'dec'; }
        else if (phase === 'dec' && f <= 1e-3 && w < 0.005 * md.wn) break;
        Ucmd = vfdU(Math.max(f, 0.05));
        op = { M: Mm, I: syncI(Math.abs(Mm), false), P: Mm * w, U: Ucmd, cos: 1 };
      } else if (md.sync && syncLocked) {
        rigid = true;
        w = wsGrid;
        op = { M: MLr, I: syncI(MLr, true), P: MLr * w, U: md.U, cos: md.cos };
      } else if (mode === 'vfd') {
        if (phase === 'acc') {
          var fn = Math.min(fSet, f + fSet / tAcc * dt);
          op = evalAt(fn, vfdU(fn), w);
          if (op.I > Ilim) {
            var fr = w * md.p / TWO_PI;
            fn = op.I > 1.08 * Ilim ? Math.max(fr + 0.05, f - 0.5 * fSet / tAcc * dt) : f;
            op = evalAt(fn, vfdU(fn), w);
          }
          f = fn;
          if (f >= fSet - 1e-9) { phase = 'hold'; tPhase = 0; }
        } else if (phase === 'hold') {
          op = evalAt(f, vfdU(f), w);
          tPhase += dt;
          if (tPhase >= tHold) { phase = 'dec'; }
        } else {
          f = Math.max(0.05, f - fSet / tDec * dt);
          op = evalAt(f, vfdU(f), w);
          if (f <= 0.05 + 1e-9 && w < 0.005 * md.wn) break;
        }
        Ucmd = vfdU(f);
      } else if (mode === 'soft') {
        var sc = cfg.soft || {};
        var Ul = sc.Ilim || 3.5 * md.In;
        var un = Math.min(1, uSoft + (1 - (sc.U0 || 0.35)) / Math.max(0.5, sc.tRamp || 15) * dt);
        op = evalAt(md.f, md.U * un, w);
        if (op.I > Ul && un < 1) {
          un = uSoft;
          op = evalAt(md.f, md.U * un, w);
          if (op.I > 1.05 * Ul) { un = Math.max(0.1, uSoft * 0.998); op = evalAt(md.f, md.U * un, w); }
        }
        uSoft = un;
        Ucmd = md.U * un;
      } else {
        op = evalAt(md.f, md.U, w);
      }

      var ML = rigid ? MLr : loadTorque(L, w);
      if (!rigid) {
        var Mdyn = op.M - (w > 1e-6 ? ML : Math.min(ML, Math.max(op.M, 0)));
        if (w <= 1e-6 && op.M < ML) Mdyn = 0;
        w = Math.max(0, w + Mdyn / J * dt);
        // вход СД в синхронизм при подаче возбуждения на подсинхронной скорости (s ≤ 5 %)
        if (md.sync && w >= 0.95 * wsGrid && op.M >= ML) { syncLocked = true; tSync = t; w = wsGrid; }
      }
      t += dt;

      Ipk = Math.max(Ipk, op.I);
      I2t += op.I * op.I * dt;
      // Провал напряжения на шинах питания (для ПЧ — по активному току входа).
      var Ubus = op.U / md.U;
      if (Xs && mode !== 'dol') {
        var Iin = mode === 'vfd' ? Math.max(op.P, 0) / (SQ3 * md.U * 0.96) : op.I;
        var sphi = mode === 'vfd' ? 0.28 : Math.sqrt(Math.max(0, 1 - op.cos * op.cos));
        Ubus = 1 - SQ3 * Iin * Xs * sphi / md.U;
      } else if (mode === 'vfd') Ubus = 1;
      Umin = Math.min(Umin, Ubus);
      if (op.P > Ppeak) Ppeak = op.P;
      if (op.P < Pregen) Pregen = op.P;
      if (op.P < 0) Eregen += -op.P * dt;
      if (phase === 'acc' && w > 0.02 * md.wn && w < 0.9 * md.wn) marginMin = Math.min(marginMin, op.M / ML);

      if (tReach == null) {
        var target = mode === 'vfd' ? TWO_PI * fSet / md.p * (md.sync ? 1 : 1 - md.sn) : md.wn * (md.sync ? 0.999 : 1);
        if (w >= 0.95 * target) tReach = t;
      }
      if (step % stride === 0) {
        out.push({ t: t, n: w * 60 / TWO_PI, f: mode === 'vfd' ? f : md.f, M: op.M, ML: ML, I: op.I, U: op.U, Ubus: Ubus, P: op.P / 1000 });
      }
      step++;
      if (cfg.accOnly && phase !== 'acc') break;
      if (mode !== 'vfd') {
        if (tReach != null && Math.abs(w - wPrev) < 1e-7 * md.wn) settle += dt; else settle = 0;
        if (tReach != null && (settle > 0.5 || t > tReach * 1.5 + 1)) break;
        if (t > 3 && w < 1e-6) break;
      }
      wPrev = w;
    }
    return {
      data: out, tReach: tReach, Ipk: Ipk, I2t: I2t, Umin: Umin,
      marginMin: isFinite(marginMin) ? marginMin : null, Pregen: -Pregen / 1000, Eregen: Eregen / 1000,
      stalled: tReach == null, J: J, dt: dt, tSync: tSync, syncFail: md.sync && mode !== 'vfd' && !syncLocked
    };
  }

  // =====================================================================
  // ПОДБОР ПЧ
  // =====================================================================

  function voltageClass(UkV) {
    if (UkV <= 0.25) return 0.22;
    if (UkV <= 0.42) return 0.38;
    if (UkV <= 0.53) return 0.48;
    if (UkV <= 0.75) return 0.69;
    if (UkV <= 3.5) return 3;
    if (UkV <= 6.6) return 6;
    if (UkV <= 11) return 10;
    return null;
  }

  // Каскадный (многоуровневый) ВВ ПЧ на ячейках 690 В.
  function cascadeInfo(UkV) {
    var cellUdc = 1.35 * 690;
    var n = UkV === 6 ? 5 : UkV === 10 ? 8 : Math.ceil(UkV * 1000 * Math.SQRT2 / SQ3 / (cellUdc * 1.15));
    return { cells: n, pulses: 6 * n, levelsPhase: 2 * n + 1, levelsLine: 4 * n + 1, cellUdc: cellUdc, step: cellUdc };
  }

  // Снижение тока по условиям, по руководствам ESQ: НВ ПЧ — 3 % на 1 °C свыше 40 °C
  // (не выше 50 °C), 10 % на каждые 1000 м свыше 1000 м; ВВ ESQ F ME800 — 0…+40 °C,
  // до 1000 м (выше — по согласованию с изготовителем, принято 1 % на 100 м).
  var SERIES_RULES = {
    lv: { kT: 0.03, tMax: 50, kH: 0.10 / 1000, src: 'РЭ ESQ-770 / F790 / 500-600' },
    hv: { kT: 0.03, tMax: 40, kH: 0.01 / 100, src: 'РЭ ESQ F ME800' }
  };

  function derating(amb, alt, hv) {
    var r = hv ? SERIES_RULES.hv : SERIES_RULES.lv;
    var kT = 1, kH = 1, notes = [];
    if (amb > 40) {
      kT = 1 - r.kT * (amb - 40);
      notes.push('Температура ' + amb + ' °C > 40 °C: снижение тока ' + ((1 - kT) * 100).toFixed(0) + ' % (3 %/°C по ' + r.src + ').');
      if (amb > r.tMax) notes.push('Температура выше допустимой для ' + (hv ? 'ВВ ПЧ ESQ F ME800 (0…+40 °C)' : 'НВ ПЧ ESQ (до +50 °C)') + ' — нужен кондиционер или приточно-вытяжная вентиляция помещения.');
    }
    if (alt > 1000) {
      kH = 1 - r.kH * (alt - 1000);
      notes.push('Высота ' + alt + ' м > 1000 м: снижение тока ' + ((1 - kH) * 100).toFixed(1) + ' %' + (hv ? '; для ВВ ПЧ выше 1000 м — согласовать с изготовителем (электрическая прочность изоляции).' : ' (10 % на 1000 м).'));
    }
    return { k: Math.max(0.3, kT * kH), kT: kT, kH: kH, notes: notes, rule: r };
  }

  // req: { md, mdl, load (derived), nMotors, ovlPct, ovlTime, startPct,
  //        margin, amb, alt, catalog, series ('*' или имя) }
  function selectVFD(req) {
    var md = req.md, mdl = req.mdl;
    var cls = voltageClass(md.U / 1000);
    var der = derating(req.amb, req.alt, md.hv);
    var nM = req.nMotors || 1;
    var Icont = md.In * nM * (req.margin || 1);
    var torqueRatio = Math.max(req.ovlPct || 100, req.startPct || 0) / 100;
    var Iovl = Math.sqrt(mdl.I0 * mdl.I0 + Math.pow(mdl.Iq * torqueRatio, 2)) * nM;
    var notes = der.notes.slice();
    var items = (req.catalog || []).filter(function (c) {
      if (cls == null || Math.abs(c.U - cls) > 1e-6) return false;
      if (req.series && req.series !== '*' && c.series !== req.series) return false;
      if (c.duty === 'P' && !(req.load && req.load.quad)) return false;
      return true;
    }).map(function (c) {
      var Ir = c.I * der.k;
      var ovl = c.ovl || [150, 60];
      var Imax;
      if ((req.ovlTime || 60) <= ovl[1]) Imax = Ir * ovl[0] / 100; else Imax = Ir;
      if (c.ovl2 && (req.ovlTime || 60) <= c.ovl2[1]) Imax = Math.max(Imax, Ir * c.ovl2[0] / 100);
      var okI = Ir >= Icont, okO = Imax >= Iovl;
      return Object.assign({}, c, {
        Ider: Ir, Imax: Imax, okI: okI, okO: okO, ok: okI && okO,
        reserve: Ir / Icont - 1, reserveO: Imax / Iovl - 1
      });
    }).sort(function (a, b) { return a.I - b.I || a.series.localeCompare(b.series); });

    var bySeries = {};
    items.forEach(function (c) {
      var key = c.series + '|' + c.duty;
      if (c.ok && !bySeries[key]) bySeries[key] = c;
    });
    var best = Object.keys(bySeries).map(function (k) { return bySeries[k]; })
      .sort(function (a, b) { return a.I - b.I; });

    if (cls == null) notes.push('Нет серии ПЧ на напряжение ' + md.U + ' В.');
    else if (!items.length) notes.push('В каталоге нет ПЧ класса ' + cls + ' кВ для выбранного фильтра серии.');
    else if (!best.length) notes.push('Ни один ПЧ каталога не проходит по току — рассмотрите параллельную работу/иной класс напряжения.');
    if (nM > 1) notes.push('Групповой привод: ' + nM + ' двигателя от одного ПЧ — только U/f, тепловая защита каждого двигателя отдельно, без коммутации двигателей на работающем ПЧ.');
    if (req.load && !req.load.quad && torqueRatio > 1.5) notes.push('Требуемый момент ' + Math.round(torqueRatio * 100) + ' % — рекомендуется векторное управление (с датчиком скорости при пуске под нагрузкой).');
    if (md.hv && cls) {
      var ci = cascadeInfo(cls);
      notes.push('Каскадный ПЧ ' + cls + ' кВ: ' + ci.cells + ' ячеек 690 В в фазе, выпрямление ' + ci.pulses + '-пульсное, ' + ci.levelsLine + ' уровней линейного напряжения — выход близок к синусоиде, стандартный ВВ двигатель без фильтров.');
    }
    return { cls: cls, der: der, Icont: Icont, Iovl: Iovl, torqueRatio: torqueRatio, items: items, best: best, notes: notes };
  }

  // =====================================================================
  // ГАРМОНИКИ
  // =====================================================================

  // Типовые спектры тока (% от I1), DPF — коэффициент сдвига по 1-й гармонике.
  var TOPOLOGIES = {
    '6p': { name: '6-пульсный, без дросселя', dpf: 0.97, h: { 5: 63, 7: 54, 11: 10, 13: 6.1, 17: 6.7, 19: 4.8, 23: 3.6, 25: 3.4 } },
    '6pL': { name: '6-пульсный + дроссель 3–4 % (сетевой или в звене ПТ)', dpf: 0.98, h: { 5: 30, 7: 12, 11: 7, 13: 5, 17: 3.5, 19: 3, 23: 2, 25: 1.8 } },
    '12p': { name: '12-пульсный', dpf: 0.98, h: { 5: 2.6, 7: 1.6, 11: 7.5, 13: 5, 17: 0.6, 19: 0.4, 23: 2.5, 25: 2 } },
    '18p': { name: '18-пульсный', dpf: 0.98, h: { 5: 1.5, 7: 1, 11: 1, 13: 0.8, 17: 3.5, 19: 3, 23: 0.5, 25: 0.4, 35: 1.5, 37: 1.4 } },
    'afe': { name: 'Активный выпрямитель (AFE)', dpf: 1.0, h: { 5: 2, 7: 1.5, 11: 1, 13: 0.8, 17: 0.5, 19: 0.5, 23: 0.4, 25: 0.4 } },
    'hv30': { name: 'ВВ каскадный, 30-пульсный (6 кВ)', dpf: 0.96, h: { 5: 0.5, 7: 0.4, 11: 0.4, 13: 0.3, 29: 1.8, 31: 1.6, 59: 0.6, 61: 0.5 } },
    'hv48': { name: 'ВВ каскадный, 48-пульсный (10 кВ)', dpf: 0.96, h: { 5: 0.4, 7: 0.3, 11: 0.3, 13: 0.2, 47: 1.1, 49: 1.0 } },
    'hv18': { name: 'ВВ каскадный, 18-пульсный (3 кВ)', dpf: 0.96, h: { 5: 1.5, 7: 1, 11: 1, 13: 0.8, 17: 3.5, 19: 3, 35: 1.5, 37: 1.4 } }
  };

  // ГОСТ 32144-2013: суммарный KU и отдельные гармоники (нормально допустимые, 95 %).
  var GOST_THD = [[0.38, 8, 12], [25, 5, 8], [35, 4, 6], [220, 2, 3]];
  var GOST_H = {
    0.38: { 5: 6, 7: 5, 11: 3.5, 13: 3, 17: 2, 19: 1.5, 23: 1.5, 25: 1.5 },
    25: { 5: 4, 7: 3, 11: 2, 13: 2, 17: 1.5, 19: 1, 23: 1, 25: 1 }
  };

  function gostLimit(UkV) {
    for (var i = 0; i < GOST_THD.length; i++) if (UkV <= GOST_THD[i][0] + 1e-9) return { thd: GOST_THD[i][1], thd100: GOST_THD[i][2], h: GOST_H[UkV <= 1 ? 0.38 : 25] };
    return { thd: 2, thd100: 3, h: {} };
  }

  // p: { topo, P кВт (активная мощность из сети), U кВ, Sk МВА, bg % (фон), other кВА линейной нагрузки — не влияет }
  function harmonics(p) {
    var T = TOPOLOGIES[p.topo] || TOPOLOGIES['6pL'];
    var I1 = p.P / (SQ3 * p.U * T.dpf);
    var S1 = SQ3 * p.U * I1;
    var thdI = 0, thdU2 = 0, rows = [];
    var lim = gostLimit(p.U);
    Object.keys(T.h).map(Number).sort(function (a, b) { return a - b; }).forEach(function (h) {
      var ih = T.h[h];
      thdI += ih * ih;
      var uh = h * ih / 100 * S1 / (p.Sk * 1000) * 100;
      thdU2 += uh * uh;
      rows.push({ h: h, Ipct: ih, I: I1 * ih / 100, Upct: uh, lim: lim.h[h] || null, ok: !lim.h[h] || uh <= lim.h[h] });
    });
    thdI = Math.sqrt(thdI);
    var thdU = Math.sqrt(thdU2 + Math.pow(p.bg || 0, 2));
    var Irms = I1 * Math.sqrt(1 + Math.pow(thdI / 100, 2));
    return {
      topo: T, I1: I1, Irms: Irms, S1: S1, thdI: thdI, thdU: thdU, rows: rows, lim: lim,
      ok: thdU <= lim.thd && rows.every(function (r) { return r.ok; }),
      PF: T.dpf / Math.sqrt(1 + Math.pow(thdI / 100, 2)), RSCE: p.Sk * 1000 / S1
    };
  }

  // =====================================================================
  // КАБЕЛИ
  // =====================================================================

  var SEC_LV = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300];
  var SEC_HV = [35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800];

  // ГОСТ Р 50571.5.52-2011 (МЭК 60364-5-52), медь, 3 нагруженных жилы.
  // C — открыто на стене; E — многожильный кабель на перфолотке/в воздухе;
  // D1 — в трубе/блоке в земле. Базовая температура: воздух 30 °C, земля 20 °C.
  var AMP_LV = {
    pvc: {
      C: [17.5, 24, 32, 41, 57, 76, 96, 119, 144, 184, 223, 259, 299, 341, 403, 464],
      E: [18.5, 25, 34, 43, 60, 80, 101, 126, 153, 196, 238, 276, 319, 364, 430, 497],
      D1: [18, 24, 30, 38, 50, 64, 82, 98, 116, 143, 169, 192, 217, 243, 280, 316]
    },
    xlpe: {
      C: [22, 30, 40, 51, 70, 94, 119, 148, 180, 232, 282, 328, 379, 434, 514, 593],
      E: [23, 32, 42, 54, 75, 100, 127, 158, 192, 246, 298, 346, 399, 456, 538, 621],
      D1: [21, 27, 35, 44, 58, 75, 96, 115, 135, 167, 197, 223, 251, 281, 324, 365]
    }
  };
  // Одножильные XLPE 6–10 кВ, треугольником вплотную, медь; θж = 90 °C;
  // воздух 25 °C, земля 15 °C, ρт = 1,2 К·м/Вт (типовые данные изготовителей,
  // ГОСТ Р 55025-2012). Алюминий — отдельной строкой.
  var AMP_HV = {
    cu: { air: [200, 246, 305, 370, 425, 478, 545, 636, 723, 827, 943, 1069, 1185], ground: [170, 206, 251, 300, 341, 382, 431, 497, 558, 626, 700, 776, 845] },
    al: { air: [154, 191, 237, 288, 332, 374, 427, 501, 573, 665, 770, 886, 1000], ground: [132, 160, 195, 233, 265, 298, 337, 390, 441, 502, 570, 642, 710] }
  };
  // Максимальное сопротивление жил постоянному току при 20 °C, Ом/км (ГОСТ 22483, кл. 2).
  var R20 = {
    cu: { 1.5: 12.1, 2.5: 7.41, 4: 4.61, 6: 3.08, 10: 1.83, 16: 1.15, 25: 0.727, 35: 0.524, 50: 0.387, 70: 0.268, 95: 0.193, 120: 0.153, 150: 0.124, 185: 0.0991, 240: 0.0754, 300: 0.0601, 400: 0.047, 500: 0.0366, 630: 0.0283, 800: 0.0221 },
    al: { 16: 1.91, 25: 1.2, 35: 0.868, 50: 0.641, 70: 0.443, 95: 0.32, 120: 0.253, 150: 0.206, 185: 0.164, 240: 0.125, 300: 0.1, 400: 0.0778, 500: 0.0605, 630: 0.0469, 800: 0.0367 }
  };
  var ALPHA = { cu: 0.00393, al: 0.00403 };
  // Коэффициент k для проверки на термическую стойкость S ≥ Iк·√t / k.
  var K_THERM = { cu: { pvc: 115, xlpe: 143 }, al: { pvc: 76, xlpe: 94 } };
  // Снижающие коэффициенты при групповой прокладке (кол-во цепей).
  var GROUP = { n: [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 20], air: [1, 0.88, 0.82, 0.77, 0.75, 0.73, 0.73, 0.72, 0.72, 0.72, 0.72, 0.72], tray: [1, 0.8, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.5, 0.45, 0.41, 0.38], ground: [1, 0.85, 0.75, 0.7, 0.65, 0.6, 0.57, 0.54, 0.52, 0.48, 0.45, 0.42] };

  var INSTALL = {
    C: { name: 'Открыто по стене / скобы (C)', lv: true, ground: false, group: 'air' },
    E: { name: 'На перфорированном лотке, в воздухе (E)', lv: true, ground: false, group: 'tray' },
    D1: { name: 'В трубах / блоках в земле (D1)', lv: true, ground: true, group: 'ground' },
    air: { name: 'В воздухе (кабельное сооружение, эстакада)', lv: false, ground: false, group: 'tray' },
    ground: { name: 'В земле (траншея)', lv: false, ground: true, group: 'ground' }
  };

  function thetaMax(insul) { return insul === 'pvc' ? 70 : 90; }

  // ПУЭ (7-е изд.), табл. 1.3.6 (медь) и 1.3.7 (алюминий): кабели с резиновой или
  // пластмассовой изоляцией до 1 кВ, трёхжильные; воздух 25 °C, земля 15 °C, θж = 65 °C.
  var SEC_PUE = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185];
  var AMP_PUE = {
    cu: { air: [19, 25, 35, 42, 55, 75, 95, 120, 145, 180, 220, 260, 305, 350], ground: [27, 38, 49, 60, 90, 115, 150, 180, 225, 275, 330, 385, 435, 500] },
    al: { air: [null, 19, 27, 32, 42, 60, 75, 90, 110, 140, 170, 200, 235, 270], ground: [null, 29, 38, 46, 70, 90, 115, 140, 175, 210, 255, 295, 335, 385] }
  };
  // Отношение Iдоп Al/Cu по таблицам МЭК 60364-5-52 (одинаковые способ и изоляция).
  function alRatio(s) { return s <= 35 ? 0.77 : s <= 150 ? 0.78 : 0.79; }
  // ВВ кабели в земле: удельное тепловое сопротивление грунта (база 1,2 К·м/Вт, ПУЭ табл. 1.3.23)
  // и глубина прокладки (база 0,7 м, по МЭК 60502-2 табл. B.11).
  function kSoil(rho) { return interp([0.8, 1.2, 2.0, 3.0], [1.05, 1.0, 0.87, 0.75], rho || 1.2); }
  function kDepth(h) { return interp([0.5, 0.7, 1.0, 1.25, 1.5, 2.0, 3.0], [1.03, 1.0, 0.97, 0.95, 0.94, 0.92, 0.89], h || 0.7); }

  function ampacityTable(o) {
    if (!o.hv && o.norm === 'pue') {
      var col = INSTALL[o.method].ground ? 'ground' : 'air';
      var k4 = o.cores4 ? 0.92 : 1;
      return SEC_PUE.map(function (s, i) { var v = AMP_PUE[o.mat][col][i]; return { s: s, I: v ? v * k4 : null }; })
        .filter(function (r) { return r.I && R20[o.mat][r.s]; });
    }
    var secs = o.hv ? SEC_HV : SEC_LV;
    var base;
    if (o.hv) base = AMP_HV[o.mat][o.method === 'ground' ? 'ground' : 'air'];
    else base = AMP_LV[o.insul][o.method].map(function (v, i) { return o.mat === 'al' ? v * alRatio(secs[i]) : v; });
    return secs.map(function (s, i) { return { s: s, I: base[i] }; })
      .filter(function (r) { return r.I && R20[o.mat][r.s] && (o.mat === 'cu' || r.s >= 16); });
  }

  // Индуктивное сопротивление, Ом/км.
  function cableX(s, hv) {
    if (!hv) return s <= 16 ? 0.09 : s <= 95 ? 0.08 : 0.075;
    return interp([35, 95, 240, 800], [0.135, 0.12, 0.105, 0.09], s);
  }

  // o: { I А, U кВ, hv, mat, insul, method, tAmb, nGroup, L м, cos, dUmax %, Ik кА, tk с, npMax, purpose }
  // o: … norm ('gost' | 'pue'), cores4 (4–5-жильный кабель, ПУЭ: ×0,92), Imin (ток аппарата
  //    защиты, которому должен соответствовать кабель), rho, depth, flat (ВВ: плоская раскладка).
  function selectCable(o) {
    var inst = INSTALL[o.method];
    var ground = inst.ground;
    var pue = !o.hv && o.norm === 'pue';
    var tRef = pue ? (ground ? 15 : 25) : o.hv ? (ground ? 15 : 25) : (ground ? 20 : 30);
    var tm = pue ? 65 : thetaMax(o.hv ? 'xlpe' : o.insul);
    var kT = o.tAmb >= tm ? 0 : Math.sqrt((tm - o.tAmb) / (tm - tRef));
    var kX = 1;
    if (o.hv && ground) kX = kSoil(o.rho) * kDepth(o.depth) * (o.flat ? 1.04 : 1);
    else if (o.hv) kX = o.flat ? 1.08 : 1;
    kT *= kX;
    var nG = Math.max(1, o.nGroup || 1);
    var Ireq = Math.max(o.I, o.Imin || 0);
    var kTherm = K_THERM[o.mat][o.hv ? 'xlpe' : o.insul];
    var sinf = Math.sqrt(Math.max(0, 1 - o.cos * o.cos));
    var table = ampacityTable(o);
    var npMax = o.npMax || (o.hv ? 4 : 8);
    var maxSec = o.hv ? 800 : pue ? 185 : 240;
    var rows = [], best = null;

    for (var np = 1; np <= npMax && !best; np++) {
      var kG = interp(GROUP.n, GROUP[inst.group], nG * np);
      for (var i = 0; i < table.length; i++) {
        var s = table[i].s;
        if (s > maxSec) break;
        var Iz = table[i].I * kT * kG;
        var Ic = o.I / np;
        var load = Ic / Iz;
        var okP = Iz * np >= Ireq;
        var theta = o.tAmb + (tm - o.tAmb) * Math.min(1.5, load * load);
        var R = R20[o.mat][s] * (1 + ALPHA[o.mat] * (Math.min(theta, tm) - 20));
        var X = cableX(s, o.hv);
        var dU = SQ3 * o.I * (o.L / 1000) * (R * o.cos + X * sinf) / np / (o.U * 1000) * 100;
        var Smin = o.Ik > 0 ? (o.Ik * 1000 / np) * Math.sqrt(o.tk || 0.1) / kTherm : 0;
        var okI = Iz >= Ic && okP, okU = dU <= o.dUmax, okK = s >= Smin;
        var row = {
          np: np, s: s, Iz: Iz, IzTotal: Iz * np, load: load, theta: theta, R: R, X: X, dU: dU,
          Smin: Smin, okI: okI, okU: okU, okK: okK, ok: okI && okU && okK, okP: okP,
          loss: 3 * Ic * Ic * R * o.L / 1000 * np / 1000
        };
        if (np === 1 || row.ok) rows.push(row);
        if (row.ok) { best = row; break; }
      }
    }
    return { best: best, rows: rows, kT: kT, kX: kX, kTherm: kTherm, tRef: tRef, tm: tm, inst: inst, pue: pue, Ireq: Ireq };
  }

  // Отражённая волна на зажимах двигателя (НВ ПЧ с IGBT, двухуровневый).
  // o: { U В, L м, tr мкс, v м/мкс, gamma, limit В (допустимый пик на изоляции) }
  function reflectedWave(o) {
    var Udc = 1.35 * o.U * 1.05;
    function peak(tr) {
      var lc = o.v * tr / 2;
      var k = Math.min(1, o.L / lc);
      var Upk = Udc * (1 + o.gamma * k);
      return { lc: lc, Upk: Upk, dvdt: 0.8 * Upk / tr / 1000 };
    }
    var raw = peak(o.tr);
    var dvdtF = peak(Math.max(o.tr, 1.0));
    dvdtF.Upk = Math.min(dvdtF.Upk, Udc * (1 + 0.5 * o.gamma));
    var sine = { Upk: o.U * Math.SQRT2 / SQ3 * 1.1 * SQ3, dvdt: 0.05 };
    var rec;
    if (raw.Upk <= o.limit) rec = 'none';
    else if (dvdtF.Upk <= o.limit && o.L <= 300) rec = 'dvdt';
    else rec = 'sine';
    return { Udc: Udc, raw: raw, dvdt: dvdtF, sine: sine, rec: rec };
  }

  // Типовые максимальные длины моторного кабеля НВ ПЧ без выходных фильтров, м.
  function maxMotorCable(PkW, screened) {
    var base = PkW <= 4 ? 50 : PkW <= 22 ? 100 : PkW <= 90 ? 150 : 200;
    return { none: screened ? base : Math.round(base * 1.5), reactor: screened ? base * 2 : base * 3, sine: screened ? 500 : 1000 };
  }

  // Экран одножильного ВВ кабеля по току замыкания на землю (адиабатический
  // режим, медный экран, 80→250 °C).
  function screenSection(Ief, t) {
    var k = 148;
    var Smin = Ief * 1000 * Math.sqrt(t) / k;
    var std = [16, 25, 35, 50, 70, 95, 120];
    var pick = std.filter(function (s) { return s >= Smin; })[0] || null;
    return { Smin: Smin, pick: pick, k: k };
  }

  // =====================================================================
  // ТОРМОЖЕНИЕ
  // =====================================================================

  function brakeUdc(UV) {
    if (UV <= 250) return 390;
    if (UV <= 420) return 700;
    if (UV <= 530) return 820;
    return 1150;
  }

  // o: { md, L (derived load), n1, n2 об/мин, tDec с, cycle с, etaV }
  function braking(o) {
    var md = o.md, L = o.L;
    var J = md.J + L.J;
    var w1 = TWO_PI * o.n1 / 60, w2 = TWO_PI * o.n2 / 60;
    var eta = md.eta * (o.etaV || 0.97);
    var dt = o.tDec / 400, w = w1, Pk = 0, E = 0;
    var eps = (w1 - w2) / o.tDec;
    for (var i = 0; i < 400; i++) {
      var Pm = (J * eps - loadTorque(L, w)) * w;
      var Pe = Math.max(0, Pm) * eta;
      Pk = Math.max(Pk, Pe);
      E += Pe * dt;
      w -= eps * dt;
    }
    // Выбег без торможения
    var tc = 0; w = w1;
    var h = Math.max(0.001, J * w1 / Math.max(loadTorque(L, w1), 1e-3) / 2000);
    while (w > w2 && tc < 3600) { w -= loadTorque(L, w) / J * h; tc += h; }
    // Минимальное время торможения без резистора: рекуперация не превышает потерь.
    var Ploss = md.P * 1000 * ((1 - md.eta) + (1 - (o.etaV || 0.97))) * 0.5;
    var tMin = J * w1 * (w1 - w2) / (Ploss / eta + loadTorque(L, w1) * w1);
    var Ubr = brakeUdc(md.U);
    return {
      J: J, Pk: Pk / 1000, E: E / 1000, Pavg: E / o.cycle / 1000, Ubr: Ubr,
      Rmax: Pk > 0 ? Ubr * Ubr / Pk : Infinity, Ibr: Pk > 0 ? Pk / Ubr : 0,
      ED: Math.min(100, o.tDec / o.cycle * 100), tCoast: tc >= 3600 ? null : tc, tMin: Math.max(0, tMin)
    };
  }

  // =====================================================================
  // ЭНЕРГОСБЕРЕЖЕНИЕ
  // =====================================================================

  var THROTTLE = {
    'pump-throttle': { name: 'Насос: дросселирование задвижкой', f: function (q) { return 0.45 + 0.55 * q; } },
    'fan-damper': { name: 'Вентилятор: шибер на выходе', f: function (q) { return 0.6 + 0.4 * q; } },
    'fan-vanes': { name: 'Вентилятор: направляющий аппарат', f: function (q) { return 0.3 + 0.2 * q + 0.5 * q * q; } },
    'bypass': { name: 'Перепуск (байпас)', f: function () { return 1; } }
  };

  // o: { P100 кВт на валу при 100 % расхода, mode, hs (доля статического напора),
  //      etaM, etaV, rows: [{q %, h ч/год}], tariff руб/кВт·ч, price руб }
  function energy(o) {
    var thr = THROTTLE[o.mode] || THROTTLE['pump-throttle'];
    var tot = { h: 0, Eth: 0, Ev: 0 };
    var rows = o.rows.filter(function (r) { return r.h > 0; }).map(function (r) {
      var q = r.q / 100;
      var Pth = o.P100 * thr.f(q) / o.etaM;
      var H = o.hs + (1 - o.hs) * q * q;
      var nrel = Math.sqrt(H);
      var Pv = o.P100 * q * H / o.etaM / o.etaV;
      tot.h += r.h; tot.Eth += Pth * r.h; tot.Ev += Pv * r.h;
      return { q: r.q, h: r.h, Pth: Pth, Pv: Pv, n: nrel * 100, save: Pth - Pv };
    });
    var dE = tot.Eth - tot.Ev;
    var money = dE * (o.tariff || 0);
    return {
      rows: rows, Eth: tot.Eth, Ev: tot.Ev, dE: dE, pct: tot.Eth > 0 ? dE / tot.Eth * 100 : 0,
      money: money, payback: money > 0 ? (o.price || 0) / money : null, hours: tot.h, thr: thr,
      co2: dE * 0.4 / 1000
    };
  }

  var api = {
    SQ3: SQ3, clamp: clamp, interp: interp,
    MOTOR_DEFAULTS: MOTOR_DEFAULTS, motorDerive: motorDerive, motorModel: motorModel, motorPoint: motorPoint, motorCurve: motorCurve,
    LOAD_TYPES: LOAD_TYPES, loadDerive: loadDerive, loadTorque: loadTorque,
    simulate: simulate,
    voltageClass: voltageClass, cascadeInfo: cascadeInfo, derating: derating, selectVFD: selectVFD,
    TOPOLOGIES: TOPOLOGIES, gostLimit: gostLimit, harmonics: harmonics,
    INSTALL: INSTALL, SEC_LV: SEC_LV, SEC_HV: SEC_HV, ampacityTable: ampacityTable, selectCable: selectCable, R20: R20, ALPHA: ALPHA, cableX: cableX, kSoil: kSoil, kDepth: kDepth,
    reflectedWave: reflectedWave, maxMotorCable: maxMotorCable, screenSection: screenSection,
    braking: braking, brakeUdc: brakeUdc,
    THROTTLE: THROTTLE, energy: energy
  };

  export default api;
