// Generated from pufuna/raschet js/app.js (calculation part) @ 6d44ec6 by scripts/sync-raschet.mjs — do not edit.
import engine from './engine.js';
import extra from './extra.js';
import CATALOG from './catalog.js';
import esqExtra from './esq-extra.js';

  var R = Object.assign({}, engine, extra, { CATALOG: CATALOG, BRAKE: esqExtra.BRAKE, PERIPH: esqExtra.PERIPH });
  var CAT = R.CATALOG;
  var state = null;

  var DEFAULT_SHARED = {
    project: { name: 'Насосная станция', author: '', customer: '' },
    net: { mode: 'sk', Sk: 20, trS: 1000, trUk: 5.5, bg: 2, tk: 0.1, Ief: 5, tef: 0.5, Qc: 0, detune: 0, genS: 0, genXd2: 14, genXd1: 25 },
    prices: {},
    kp: { vat: 20, discount: 0, note: 'Срок поставки — по согласованию. Цены указаны с учётом доставки до объекта.' }
  };
  var DEFAULT_DRIVE = {
    name: 'Насос Н-1',
    motor: { type: 'async', P: 75, U: 380, f: 50, n: 1480, cos: 0.86, eff: 94.5, I: null, kI: 7, kMp: 2.0, kMk: 2.6, J: null },
    load: { type: 'pump', P: 65, brk: null, k: 2, m0: 0.1, J: null, ovlPct: 110, ovlTime: 60, startPct: null },
    vfd: { series: '*', nMotors: 1, margin: 1.05, amb: 35, alt: 200, control: 'vector', topo: '6pL', pick: null },
    sim: { show: 'vfd', tAcc: 15, tDec: 20, tHold: 3, fSet: 50, boost: 2, softU0: 35, softT: 15, softI: 3.5 },
    cin: { mat: 'cu', insul: 'xlpe', method: 'E', tAmb: 30, nGroup: 1, L: 40, dUmax: 2, norm: 'gost', rho: 1.2, depth: 0.7, flat: 'no' },
    cout: { mat: 'cu', insul: 'xlpe', method: 'E', tAmb: 30, nGroup: 1, L: 80, dUmax: 3, screened: 'yes', ins: 'std', tr: 0.1, norm: 'gost', rho: 1.2, depth: 0.7, flat: 'no' },
    prot: { device: 'mccb', kInst: 10, cover: 'yes', precharge: 'no' },
    brake: { n2: 0, tDec: 20, cycle: 600 },
    duty: { cool: 'self', fmin: 25, fmax: 50, rows: [[60, 100, 100], [240, 80, 100]] },
    pump: { on: 'no', Qd: 400, Hd: 46, Hst: 20, rho: 1000, npsha: 8, pts: [[0, 60, 0, null], [200, 56, 65, 2.5], [400, 46, 80, 4], [600, 30, 72, 7]] },
    casc: { N: 3, sync: 'yes', pause: 10 },
    energy: { mode: 'pump-throttle', hs: 20, tariff: 7.5, price: 900000, rows: [[100, 800], [90, 1500], [80, 2500], [70, 2000], [60, 1200], [50, 500]] }
  };
  var SHARED_KEYS = ['project', 'net', 'prices', 'kp'];

  var PRESETS = [
    { name: 'Насос 75 кВт, 0,4 кВ', data: { project: { name: 'Насосная станция' }, drives: [{ name: 'Насос Н-1' }] } },
    {
      name: 'Винтовой компрессор 132 кВт, 0,4 кВ',
      data: {
        project: { name: 'Компрессорная' }, name: 'Компрессор ВК-2',
        motor: { P: 132, U: 380, n: 2975, cos: 0.89, eff: 95.6, kI: 7.5, kMp: 2.2, kMk: 2.8 },
        load: { type: 'screw', P: 125, ovlPct: 120, ovlTime: 60 },
        vfd: { amb: 40 },
        cout: { L: 60 }, cin: { L: 30 },
        sim: { tAcc: 10, tDec: 10 },
        brake: { tDec: 10, cycle: 300 },
        energy: { mode: 'bypass', hs: 100 }
      }
    },
    {
      name: 'Конвейер 200 кВт, 0,69 кВ',
      data: {
        project: { name: 'Конвейерная галерея' }, name: 'Конвейер ЛК-3',
        net: { Sk: 25 },
        motor: { P: 200, U: 690, n: 1485, cos: 0.87, eff: 95.5, kI: 7, kMp: 2.1, kMk: 2.7 },
        load: { type: 'conveyor', P: 180, ovlPct: 150, ovlTime: 60 },
        cout: { L: 150, ins: 'inv' }, cin: { L: 60 },
        sim: { tAcc: 25, tDec: 25 },
        brake: { tDec: 15, cycle: 900 }
      }
    },
    {
      name: 'Дымосос 1250 кВт, 6 кВ',
      data: {
        project: { name: 'Котельная' }, name: 'Дымосос ДС-1',
        net: { Sk: 150, tk: 0.5, Ief: 3, tef: 0.5 },
        motor: { P: 1250, U: 6000, n: 992, cos: 0.85, eff: 95.8, kI: 5.5, kMp: 0.8, kMk: 2.2 },
        load: { type: 'fan', P: 1100, ovlPct: 110, ovlTime: 60 },
        cin: { mat: 'al', method: 'ground', tAmb: 15, L: 350, dUmax: 2 },
        cout: { mat: 'al', method: 'air', tAmb: 25, L: 120, dUmax: 2 },
        sim: { tAcc: 60, tDec: 120 },
        brake: { tDec: 120, cycle: 3600 },
        energy: { mode: 'fan-vanes', hs: 0, price: 18000000, rows: [[100, 500], [90, 1500], [80, 3000], [70, 2000], [60, 1000]] }
      }
    },
    {
      name: 'Шаровая мельница 2500 кВт, 10 кВ',
      data: {
        project: { name: 'Обогатительная фабрика' }, name: 'Мельница МШЦ-1',
        net: { Sk: 300, tk: 0.5, Ief: 5, tef: 0.5 },
        motor: { P: 2500, U: 10000, n: 745, cos: 0.86, eff: 96.5, kI: 5.5, kMp: 0.9, kMk: 2.2 },
        load: { type: 'mill', P: 2300, ovlPct: 150, ovlTime: 60 },
        cin: { mat: 'cu', method: 'air', tAmb: 25, L: 200, dUmax: 2 },
        cout: { mat: 'cu', method: 'air', tAmb: 25, L: 80, dUmax: 2 },
        sim: { tAcc: 40, tDec: 60 },
        brake: { tDec: 60, cycle: 7200 }
      }
    },
    {
      name: 'Насосная станция 10 кВ: 3 СД 2000 кВт, каскадный пуск',
      data: {
        project: { name: 'Насосная станция 2-го подъёма' }, name: 'Насосы Н-1…Н-3',
        net: { Sk: 250, tk: 0.5, Ief: 5, tef: 0.5, Qc: 1500, detune: 7 },
        motor: { type: 'sync', P: 2000, U: 10000, n: 1000, cos: 0.9, eff: 96.5, kI: 6, kMp: 1.1, kMk: 2.0 },
        load: { type: 'pump', P: 1750, ovlPct: 110, ovlTime: 60 },
        cin: { mat: 'al', method: 'ground', tAmb: 15, L: 500, dUmax: 2, rho: 1.5, depth: 0.7 },
        cout: { mat: 'cu', method: 'air', tAmb: 25, L: 150, dUmax: 2 },
        sim: { tAcc: 30, tDec: 60 },
        duty: { fmin: 35, fmax: 50 },
        pump: { on: 'yes', Qd: 5000, Hd: 100, Hst: 55, rho: 1000, npsha: 12, pts: [[0, 125, 0, null], [2500, 120, 70, 4], [5000, 100, 86, 6.5], [6500, 82, 82, 9]] },
        casc: { N: 3, sync: 'yes', pause: 30 },
        brake: { tDec: 60, cycle: 7200 },
        energy: { mode: 'pump-curve', price: 45000000, rows: [[100, 2000], [90, 3000], [80, 2500], [70, 1000]] }
      }
    }
  ];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(dst, src) {
    Object.keys(src || {}).forEach(function (k) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) { dst[k] = dst[k] || {}; merge(dst[k], src[k]); }
      else dst[k] = src[k];
    });
    return dst;
  }

  function f(x, d) {
    if (x == null || !isFinite(x)) return '—';
    d = d == null ? 1 : d;
    return Number(x).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fa(x) {
    if (x == null || !isFinite(x)) return '—';
    var a = Math.abs(x);
    return f(x, a >= 100 ? 0 : a >= 10 ? 1 : 2);
  }
  function secName(s) { return String(s).replace('.', ','); }

  function num(v, d) { return v == null || v === '' || !isFinite(v) ? d : Number(v); }

  // light — без моделирования (для сводных таблиц по всем приводам объекта).
  function compute(s, light) {
    s = s || state;
    var c = { s: s };
    var m = s.motor;
    c.md = R.motorDerive({ type: m.type, P: num(m.P, 1), U: num(m.U, 380), f: num(m.f, 50), n: num(m.n, 1450), cos: num(m.cos, 0.85), eff: num(m.eff, 93), I: m.I, kI: m.kI, kMp: m.kMp, kMk: m.kMk, J: m.J });
    c.mdl = R.motorModel(c.md);
    c.hv = c.md.hv;
    c.UkV = c.md.U / 1000;
    var lt = R.LOAD_TYPES[s.load.type] || R.LOAD_TYPES.custom;
    c.L = R.loadDerive({ type: s.load.type, P: num(s.load.P, c.md.P * 0.85), brk: s.load.brk, k: num(s.load.k, 2), m0: num(s.load.m0, 0.1), J: s.load.J }, c.md);
    c.Sk = s.net.mode === 'tr' ? num(s.net.trS, 1000) / 1000 / (num(s.net.trUk, 5.5) / 100) : num(s.net.Sk, 20);
    c.Ik = c.Sk / (R.SQ3 * c.UkV);
    c.startPctAuto = c.L.brk * c.L.Mn / c.md.Mn * 100;
    c.startPct = s.load.startPct != null ? s.load.startPct : c.startPctAuto;
    c.nM = Math.max(1, Math.round(num(s.vfd.nMotors, 1)));

    c.sel = R.selectVFD({
      md: c.md, mdl: c.mdl, load: c.L, nMotors: c.nM, ovlPct: num(s.load.ovlPct, lt.ovl), ovlTime: num(s.load.ovlTime, lt.tovl),
      startPct: c.startPct, margin: num(s.vfd.margin, 1), amb: num(s.vfd.amb, 30), alt: num(s.vfd.alt, 0), catalog: CAT, series: s.vfd.series
    });
    c.vfd = c.sel.best.filter(function (b) { return vkey(b) === s.vfd.pick; })[0] ||
      c.sel.items.filter(function (b) { return vkey(b) === s.vfd.pick && b.ok; })[0] || c.sel.best[0] || null;
    c.etaV = c.hv ? 0.965 : 0.975;
    c.topo = c.hv ? ({ 3: 'hv18', 6: 'hv30', 10: 'hv48' }[c.sel.cls] || 'hv30') : s.vfd.topo;
    c.Pin = c.md.P * c.nM / (c.md.eta * c.etaV);
    c.harm = R.harmonics({ topo: c.topo, P: c.Pin, U: c.UkV, Sk: c.Sk, bg: num(s.net.bg, 0) });

    var ci = s.cin, co = s.cout;
    function cabOpt(o, extra) {
      return Object.assign({ U: c.UkV, hv: c.hv, mat: o.mat, insul: o.insul, method: o.method, tAmb: num(o.tAmb, 30), nGroup: num(o.nGroup, 1), L: num(o.L, 0), dUmax: num(o.dUmax, 5), norm: o.norm, rho: num(o.rho, 1.2), depth: num(o.depth, 0.7), flat: o.flat === 'yes' }, extra);
    }
    c.Zs = Math.pow(c.md.U, 2) / (c.Sk * 1e6);
    if (!c.hv) {
      c.periph = c.vfd && R.PERIPH ? R.PERIPH[c.vfd.model] || null : null;
      var protIn = { U: c.md.U, Iin: c.harm.Irms, QF: c.periph && c.nM === 1 ? c.periph.QF : null, device: s.prot.device, kInst: num(s.prot.kInst, 10), Zs: c.Zs };
      var p0 = R.protectLV(Object.assign({ cable: null }, protIn));
      c.cin = R.selectCable(cabOpt(ci, { I: c.harm.Irms, cos: c.harm.topo.dpf, Ik: c.Ik, tk: num(s.net.tk, 0.1), cores4: true, Imin: s.prot.cover === 'yes' && p0.In ? p0.In : 0 }));
      var b0 = c.cin.best;
      c.prot = R.protectLV(Object.assign({ cable: b0 ? { s: b0.s, np: b0.np, mat: ci.mat, L: num(ci.L, 0), theta: ci.norm === 'pue' ? 65 : ci.insul === 'pvc' ? 70 : 90 } : null }, protIn));
    } else {
      c.cin = R.selectCable(cabOpt(ci, { I: c.harm.Irms, cos: c.harm.topo.dpf, Ik: c.Ik, tk: num(s.net.tk, 0.1) }));
      var bh = c.cin.best;
      c.prot = R.protectHV({ U: c.UkV, Sk: c.Sk, Str: c.vfd && c.vfd.S ? c.vfd.S : c.Pin / 0.95, Iin: c.harm.Irms, precharge: s.prot.precharge === 'yes', cableR: bh ? bh.R * num(ci.L, 0) / 1000 / bh.np : 0, cableX: bh ? bh.X * num(ci.L, 0) / 1000 / bh.np : 0 });
    }
    c.cout = R.selectCable(cabOpt(co, { I: c.md.In, cos: c.md.cos, Ik: 0, tk: 0 }));
    if (!c.hv) {
      var lim = co.ins === 'inv' ? (c.md.U <= 500 ? 1600 : 2150) : (c.md.U <= 500 ? 1000 : 1300);
      c.insLimit = lim;
      c.rw = R.reflectedWave({ U: c.md.U, L: num(co.L, 0), tr: num(co.tr, 0.1), v: 165, gamma: c.md.P <= 10 ? 0.95 : c.md.P <= 100 ? 0.9 : 0.8, limit: lim });
      c.maxL = R.maxMotorCable(c.md.P, co.screened === 'yes');
    } else {
      c.scr = R.screenSection(num(s.net.Ief, 5), num(s.net.tef, 0.5));
      c.casc = R.cascadeInfo(c.sel.cls || 6);
    }

    var sm = s.sim;
    var base = { control: s.vfd.control, Sk: c.Sk };
    c.Ilim = c.vfd ? Math.min(c.vfd.Imax, c.vfd.Ider * 1.5) / c.nM : 1.5 * c.md.In;
    if (!light) {
      c.sims = {
        dol: R.simulate(c.mdl, c.L, Object.assign({ mode: 'dol' }, base)),
        soft: R.simulate(c.mdl, c.L, Object.assign({ mode: 'soft', soft: { U0: num(sm.softU0, 35) / 100, tRamp: num(sm.softT, 15), Ilim: num(sm.softI, 3.5) * c.md.In } }, base)),
        vfd: R.simulate(c.mdl, c.L, Object.assign({ mode: 'vfd', fSet: num(sm.fSet, 50), tAcc: num(sm.tAcc, 10), tDec: num(sm.tDec, 10), tHold: num(sm.tHold, 2), boost: num(sm.boost, 2) / 100, Ilim: c.Ilim }, base))
      };
      c.cascade = R.cascade({ mdl: c.mdl, L: c.L, cfg: { control: s.vfd.control, tAcc: num(sm.tAcc, 10), Ilim: c.Ilim, boost: num(sm.boost, 2) / 100 }, N: Math.max(1, Math.round(num(s.casc.N, 2))), sync: s.casc.sync === 'yes', pause: num(s.casc.pause, 10), Sk: c.Sk });
    }
    c.brake = R.braking({ md: c.md, L: c.L, n1: c.md.n, n2: num(s.brake.n2, 0), tDec: Math.max(0.1, num(s.brake.tDec, 10)), cycle: Math.max(1, num(s.brake.cycle, 600)), etaV: c.etaV });
    c.brakeData = c.vfd && R.BRAKE ? R.BRAKE[c.vfd.model] || null : null;
    c.range = R.speedRange({ md: c.md, mdl: c.mdl, L: c.L, cool: s.duty.cool, fmin: Math.max(0.5, num(s.duty.fmin, 10)), fmax: Math.max(num(s.duty.fmin, 10) + 1, num(s.duty.fmax, 50)) });
    c.duty = R.dutyCycle({ md: c.md, mdl: c.mdl, rows: s.duty.rows.map(function (r) { return { t: num(r[0], 0), m: num(r[1], 0), n: num(r[2], 100) }; }), vfd: c.vfd ? { Ider: c.vfd.Ider / c.nM, Imax: c.vfd.Imax / c.nM, ovl: c.vfd.ovl } : null });
    c.res = R.resonance({ Sk: c.Sk, Qc: num(s.net.Qc, 0), p: num(s.net.detune, 0), harm: c.harm });
    c.gen = num(s.net.genS, 0) > 0 ? R.generator({ S: num(s.net.genS, 0), xd2: num(s.net.genXd2, 14), xd1: num(s.net.genXd1, 25), U: c.UkV, topo: c.topo, Pin: c.Pin, Ip: c.md.kI * c.md.In }) : null;
    if (s.pump.on === 'yes') {
      c.pump = R.pump({ pts: s.pump.pts.map(function (r) { return { Q: num(r[0], -1), H: num(r[1], 0), eta: num(r[2], 0), npsh: num(r[3], 0) }; }), Hst: num(s.pump.Hst, 0), Hd: num(s.pump.Hd, 0), Qd: num(s.pump.Qd, 0), rho: num(s.pump.rho, 1000), npsha: num(s.pump.npsha, 0) });
    }
    var erows = s.energy.rows.map(function (r) { return { q: num(r[0], 0), h: num(r[1], 0) }; });
    if (s.energy.mode === 'pump-curve' && c.pump) c.energy = energyPump(c, erows, s);
    else c.energy = R.energy({
      P100: c.L.P, mode: s.energy.mode === 'pump-curve' ? 'pump-throttle' : s.energy.mode, hs: num(s.energy.hs, 0) / 100, etaM: c.md.eta, etaV: c.etaV,
      rows: erows, tariff: num(s.energy.tariff, 0), price: num(s.energy.price, 0)
    });
    c.checks = checks(c);
    return c;
  }

  // Энергосбережение по кривым насоса: Q в % от расчётной подачи.
  function energyPump(c, rows, s) {
    var P = c.pump, Qd = num(s.pump.Qd, P.Q1), tariff = num(s.energy.tariff, 0), price = num(s.energy.price, 0);
    var tot = { h: 0, Eth: 0, Ev: 0 };
    var out = rows.filter(function (r) { return r.h > 0; }).map(function (r) {
      var pt = P.point(Math.min(P.Q1, Qd * r.q / 100));
      var Pth = pt.Pt / c.md.eta, Pv = pt.Pv != null ? pt.Pv / c.md.eta / c.etaV : Pth;
      tot.h += r.h; tot.Eth += Pth * r.h; tot.Ev += Pv * r.h;
      return { q: r.q, h: r.h, Pth: Pth, Pv: Pv, n: (pt.r || 1) * 100, save: Pth - Pv };
    });
    var dE = tot.Eth - tot.Ev, money = dE * tariff;
    return { rows: out, Eth: tot.Eth, Ev: tot.Ev, dE: dE, pct: tot.Eth > 0 ? dE / tot.Eth * 100 : 0, money: money, payback: money > 0 ? price / money : null, hours: tot.h, thr: { name: 'Насос: дросселирование (по кривым Q–H)' }, co2: dE * 0.4 / 1000, pumpCurve: true };
  }

  function vkey(c) { return c.model + '|' + c.duty; }

  function checks(c) {
    var out = [], md = c.md;
    function add(page, level, text) { out.push({ page: page, level: level, text: text }); }

    if (md.I > 0 && Math.abs(md.I / md.InCalc - 1) > 0.12) add('obj', 'warn', 'Паспортный ток ' + fa(md.I) + ' А отличается от расчётного ' + fa(md.InCalc) + ' А более чем на 12 % — проверьте cos φ и КПД.');
    if (c.L.P > md.P) add('obj', 'err', 'Мощность механизма ' + fa(c.L.P) + ' кВт больше мощности двигателя ' + fa(md.P) + ' кВт.');
    else add('obj', 'ok', 'Загрузка двигателя механизмом ' + f(c.L.P / md.P * 100, 0) + ' %.');
    if (md.Jest || c.L.Jest) add('obj', 'info', 'Момент инерции ' + (md.Jest ? 'двигателя' : '') + (md.Jest && c.L.Jest ? ' и ' : '') + (c.L.Jest ? 'механизма' : '') + ' оценён по типовым данным — для точного расчёта времени пуска введите паспортные значения.');

    if (!c.vfd) add('vfd', 'err', 'ПЧ из каталога не подобран.');
    else add('vfd', 'ok', 'Выбран ' + c.vfd.model + (c.vfd.duty !== 'HV' ? ' (режим ' + c.vfd.duty + ')' : '') + ': запас по длительному току ' + f(c.vfd.reserve * 100, 0) + ' %, по перегрузке ' + f(c.vfd.reserveO * 100, 0) + ' %.');
    c.sel.notes.forEach(function (n) { add('vfd', 'info', n); });

    if (c.sims) {
    var d = c.sims.dol, so = c.sims.soft, v = c.sims.vfd;
    if (d.stalled) add('sim', 'err', 'Прямой пуск невозможен: момент двигателя недостаточен для разгона механизма.');
    else {
      if (d.Umin < 0.85) add('sim', 'warn', 'Прямой пуск: провал напряжения на шинах до ' + f(d.Umin * 100, 0) + ' % Uн (норма — не ниже 85 %).');
      var tlim = md.hv ? 20 : 10;
      if (d.tReach > tlim) add('sim', 'warn', 'Прямой пуск длится ' + f(d.tReach, 1) + ' с — проверьте допустимое время пуска двигателя по нагреву ротора.');
    }
    if (so.stalled) add('sim', 'warn', 'УПП с ограничением тока ' + f(c.s.sim.softI, 1) + '·Iн не разгоняет механизм — увеличьте ограничение тока.');
    if (v.stalled) add('sim', 'err', 'ПЧ не разгоняет механизм до заданной скорости: не хватает тока/момента.');
    else if (v.tReach > num(c.s.sim.tAcc, 10) * num(c.s.sim.fSet, 50) / md.f * 1.3 + 1) add('sim', 'warn', 'Разгон от ПЧ затянут ограничением тока до ' + f(v.tReach, 1) + ' с — увеличьте время разгона или ПЧ.');
    else add('sim', 'ok', 'ПЧ разгоняет механизм за ' + f(v.tReach, 1) + ' с, пиковый ток ' + f(v.Ipk / md.In * 100, 0) + ' % Iн.');
    if (md.sync) {
      if (d.syncFail) add('sim', 'err', 'СД при прямом пуске не входит в синхронизм: асинхронный момент при s = 5 % меньше момента механизма.');
      if (so.syncFail) add('sim', 'warn', 'СД при пуске от УПП не входит в синхронизм.');
    }
    }

    if (!c.cin.best) add('cab', 'err', 'Питающий кабель не подобран — увеличьте допустимую потерю напряжения или число параллельных кабелей.');
    else add('cab', 'ok', 'Питающий кабель: ' + cableName(c.cin.best, c.s.cin, c.hv, false) + ', ΔU = ' + f(c.cin.best.dU, 2) + ' %.');
    if (!c.cout.best) add('cab', 'err', 'Кабель к двигателю не подобран.');
    else add('cab', 'ok', 'Кабель к двигателю: ' + cableName(c.cout.best, c.s.cout, c.hv, true) + ', ΔU = ' + f(c.cout.best.dU, 2) + ' %.');
    if (!c.hv) {
      var L = num(c.s.cout.L, 0);
      if (c.rw.rec === 'dvdt') add('cab', 'warn', 'Пик напряжения на зажимах двигателя ' + f(c.rw.raw.Upk, 0) + ' В > ' + c.insLimit + ' В — нужен du/dt-фильтр или двигатель с усиленной изоляцией.');
      else if (c.rw.rec === 'sine') add('cab', 'warn', 'Пик напряжения ' + f(c.rw.raw.Upk, 0) + ' В, длина ' + L + ' м — рекомендуется синус-фильтр.');
      else add('cab', 'ok', 'Пик напряжения на двигателе ' + f(c.rw.raw.Upk, 0) + ' В в пределах ' + c.insLimit + ' В.');
      if (L > c.maxL.none) add('cab', 'warn', 'Длина ' + L + ' м больше типовой без выходного фильтра (' + c.maxL.none + ' м): выходной дроссель — до ' + c.maxL.reactor + ' м, синус-фильтр — до ' + c.maxL.sine + ' м. Уточните по РЭ ПЧ.');
      if (md.P >= 100) add('cab', 'info', 'P ≥ 100 кВт: изолированный подшипник на стороне N (ГОСТ IEC/TS 60034-25)' + (md.P >= 350 ? ', а также синфазный (ферритовый) фильтр на выходе ПЧ' : '') + '.');
      if (c.s.cout.screened !== 'yes') add('cab', 'warn', 'Неэкранированный моторный кабель: только в металлическом лотке/трубе с заземлением, возможны помехи для КИП.');
    } else if (c.scr) {
      add('cab', 'info', 'Экран ВВ кабеля по току КЗ на землю: не менее ' + f(c.scr.Smin, 1) + ' мм² → ' + (c.scr.pick ? c.scr.pick + ' мм²' : 'больше 120 мм², уточнить') + '.');
    }

    var h = c.harm;
    if (h.ok) add('harm', 'ok', 'KU в точке подключения ' + f(h.thdU, 2) + ' % ≤ ' + h.lim.thd + ' % (ГОСТ 32144-2013).');
    else add('harm', 'warn', 'Искажения напряжения выше норм ГОСТ 32144-2013 (KU = ' + f(h.thdU, 2) + ' %, норма ' + h.lim.thd + ' %) — нужен дроссель/фильтр или многопульсный/AFE ПЧ.');
    if (!c.hv && h.RSCE < 20 && (c.s.vfd.topo === '6p')) add('harm', 'warn', 'Слабая сеть (Sк/S = ' + f(h.RSCE, 0) + '): без сетевого дросселя возможны перегрев и отказ выпрямителя.');

    var b = c.brake;
    if (b.Pk <= 0.001) add('brake', 'ok', 'При заданном времени торможения рекуперации нет — нагрузка сама тормозит механизм.');
    else if (!c.hv) add('brake', 'warn', 'Торможение за ' + f(num(c.s.brake.tDec, 10), 1) + ' с требует тормозного резистора: R ≤ ' + f(b.Rmax, 1) + ' Ом, Pпик = ' + fa(b.Pk) + ' кВт.');
    else if (num(c.s.brake.tDec, 10) < b.tMin) add('brake', 'warn', 'ВВ ПЧ не рекуперирует: время торможения меньше ' + f(b.tMin, 0) + ' с приведёт к перенапряжению в ячейках. Увеличьте время или остановите выбегом.');
    else add('brake', 'ok', 'Торможение без резистора возможно (время ≥ ' + f(b.tMin, 0) + ' с).');

    if (c.L.quad) {
      var e = c.energy;
      add('energy', e.dE > 0 ? 'ok' : 'info', 'Экономия ' + fa(e.dE / 1000) + ' МВт·ч/год (' + f(e.pct, 0) + ' %)' + (e.payback ? ', окупаемость ' + f(e.payback, 1) + ' года' : '') + '.');
    }
    // защита
    var pr = c.prot;
    if (!c.hv) {
      if (!pr.In) add('prot', 'err', 'Ток аппарата защиты вне ряда выбранного типа — выберите другой аппарат.');
      else {
        add('prot', pr.ok ? 'ok' : 'err', 'Однофазное КЗ на вводах ПЧ: Iк(1) = ' + f(pr.Ik1, 2) + ' кА, требуется ≥ ' + f(pr.need, 2) + ' кА (' + pr.rule + ')' + (pr.ok ? '.' : ' — защита не отключит КЗ за нормируемое время: увеличьте сечение, уменьшите Ii или примените УЗО/защиту от замыкания на землю.'));
        if (c.cin.best && c.s.prot.cover !== 'yes' && c.cin.best.IzTotal < pr.In) add('prot', 'warn', 'Iдоп кабеля ' + fa(c.cin.best.IzTotal) + ' А меньше номинального тока аппарата ' + pr.In + ' А — кабель защищён только от КЗ.');
        add('prot', 'info', 'Отключающая способность аппарата не менее ' + f(pr.Ik3 * 1.1, 1) + ' кА (Iк(3) на шинах с запасом 10 %).');
      }
    } else {
      add('prot', pr.kSo >= 2 ? 'ok' : 'warn', 'Токовая отсечка ' + fa(pr.Iso) + ' А: kч = ' + f(pr.kSo, 2) + (pr.kSo >= 2 ? ' ≥ 2.' : ' < 2 — используйте отсечку с выдержкой 0,1 с или пусковой шкаф.'));
      add('prot', pr.kMtz >= 1.5 ? 'ok' : 'warn', 'МТЗ ' + fa(pr.Imtz) + ' А, t = ' + f(pr.tMtz, 1) + ' с: kч = ' + f(pr.kMtz, 1) + '.');
    }

    // режимы работы
    var rg = c.range;
    if (rg.ok) add('modes', 'ok', 'Двигатель в диапазоне ' + f(c.s.duty.fmin, 0) + '–' + f(c.s.duty.fmax, 0) + ' Гц не перегревается: максимальная загрузка ' + f(rg.worst.util * 100, 0) + ' % допустимого момента.');
    else add('modes', 'err', 'На ' + f(rg.worst.f, 1) + ' Гц момент механизма ' + f(rg.worst.util * 100, 0) + ' % допустимого (' + rg.cool.name.toLowerCase() + ') — нужна независимая вентиляция, двигатель большей мощности или повышение fмин.');
    var du = c.duty;
    if (du.T > 0) {
      if (!du.okMotor) add('modes', 'warn', 'Эквивалентный момент цикла ' + f(du.Mrms, 0) + ' % Mн > 100 % — двигатель перегревается.');
      if (c.vfd && du.okRms === false) add('modes', 'err', 'Среднеквадратичный ток цикла ' + fa(du.Irms) + ' А больше тока ПЧ с учётом условий.');
      if (c.vfd && du.okPk === false) add('modes', 'err', 'Пиковый ток цикла ' + fa(du.Ipk) + ' А не обеспечивается перегрузочной способностью ПЧ.');
      if (c.vfd && du.okPeriod === false) add('modes', 'warn', 'Перегрузка ПЧ повторяется чаще одного раза в 10 мин — проверьте по РЭ или выберите ПЧ на ступень больше.');
      if (du.okMotor && du.okRms !== false && du.okPk !== false) add('modes', 'ok', 'Цикл нагрузки: Iэкв = ' + fa(du.Irms) + ' А, Iпик = ' + fa(du.Ipk) + ' А — ПЧ и двигатель проходят.');
    }

    // сеть: КРМ и ДГУ
    if (c.res.hr) {
      if (c.res.danger) add('harm', 'err', 'Резонанс КРМ с сетью на гармонике ' + f(c.res.hr, 1) + ' — близко к гармоникам ПЧ: KU возрастает до ' + f(c.res.thdU, 1) + ' %. Применяйте КРМ с антирезонансными дросселями (p = 7 % или 14 %).');
      else if (c.res.ht) add('harm', 'ok', 'КРМ с дросселями, настройка на ' + f(c.res.ht, 2) + '-ю гармонику — резонанс с гармониками ПЧ исключён.');
      else add('harm', 'info', 'Собственная частота контура «сеть – КРМ»: h = ' + f(c.res.hr, 1) + '.');
    }
    if (c.gen) {
      add('harm', c.gen.okSize ? 'ok' : 'warn', 'ДГУ ' + fa(c.s.net.genS) + ' кВА: для ПЧ с выпрямителем «' + c.harm.topo.name + '» нужно ≥ ' + fa(c.gen.Sreq) + ' кВА (' + f(c.gen.ratio, 2) + '·Pвх).');
      add('harm', c.gen.okThd ? 'ok' : 'warn', 'KU при питании от ДГУ ' + f(c.gen.thdU, 1) + ' % (рекомендуется ≤ 5 % для работы регулятора генератора).');
    }

    // торможение по данным ESQ
    var bd = c.brakeData;
    if (bd && !c.hv && c.brake.Pk > 0.001) {
      var rmin = bd.Rmin || bd.Rrec;
      if (rmin && rmin > c.brake.Rmax) add('brake', 'err', 'Требуемое сопротивление ≤ ' + f(c.brake.Rmax, 1) + ' Ом меньше допустимого для ' + c.vfd.model + ' (' + f(rmin, 1) + ' Ом): увеличьте время торможения или выберите ПЧ/тормозной модуль большей мощности.');
      else if (rmin) add('brake', 'ok', 'Резистор ' + f(rmin, 1) + '…' + f(c.brake.Rmax, 1) + ' Ом совместим с тормозным прерывателем ' + c.vfd.model + ' (' + bd.chopper + ').');
    }

    // насос
    if (c.pump) {
      var P = c.pump;
      add('pump', 'info', 'Рабочая точка на 50 Гц: Q = ' + fa(P.Q1) + ' м³/ч, H = ' + fa(P.H1) + ' м; минимальная частота подачи ' + f(P.rmin * c.md.f, 1) + ' Гц.');
      if (P.npOk === false) add('pump', 'err', 'NPSHa ' + f(c.s.pump.npsha, 1) + ' м недостаточно — кавитация в части режимов (требуется NPSHr + 0,5 м).');
      if (num(c.s.duty.fmin, 0) < P.rmin * c.md.f * 1.05) add('pump', 'warn', 'Минимальная частота ' + f(c.s.duty.fmin, 1) + ' Гц ниже частоты нулевой подачи ' + f(P.rmin * c.md.f, 1) + ' Гц — насос будет работать на закрытую задвижку.');
      if (P.op.Pt > c.md.P * c.md.eta * 1.0001) add('pump', 'warn', 'Мощность насоса в рабочей точке ' + fa(P.op.Pt) + ' кВт больше мощности двигателя на валу.');
    }

    // каскад
    if (c.cascade && !c.cascade.stalled && num(c.s.casc.N, 1) > 1) {
      add('casc', c.s.casc.sync === 'yes' ? 'ok' : 'warn', 'Каскадный пуск ' + c.s.casc.N + ' двигателей: ' + f(c.cascade.total, 0) + ' с, бросок тока при переводе на сеть ' + fa(c.cascade.Isurge) + ' А' + (c.s.casc.sync === 'yes' ? '.' : ' — без синхронизации бросок близок к пусковому, нужна выдержка на гашение остаточного напряжения.'));
    }
    return out;
  }

  function cableName(b, o, hv, motor) {
    var al = o.mat === 'al' ? 'А' : '';
    var core;
    if (hv) core = '3×(1×' + secName(b.s) + ')';
    else if (motor) core = '3×' + secName(b.s) + '+3×' + secName(stdUp(peSection(b.s) / 3));
    else core = (b.s <= 16 ? '5×' : '4×') + secName(b.s);
    return (b.np > 1 ? b.np + '×[' : '') + al + core + (b.np > 1 ? ']' : '') + ' мм²';
  }

  // PE-проводник (ГОСТ Р 50571.5.54): S ≤ 16 → S; ≤ 35 → 16; иначе S/2.
  function peSection(s) { return stdUp(s <= 16 ? s : s <= 35 ? 16 : s / 2); }
  function stdUp(x) {
    var std = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150];
    return std.filter(function (v) { return v >= x - 1e-9; })[0] || 150;
  }

  function cableMark(o, hv, motor, screened) {
    var al = o.mat === 'al' ? 'А' : '';
    if (hv) {
      if (o.method === 'ground') return al + 'ПвП(у)2г / ' + al + 'ПвПу2г 1×S/Sэ — 10 кВ (U0 = 6 кВ)';
      return al + 'ПвВнг(А)-LS / ' + al + 'ПвПнг(А)-HF 1×S/Sэ — 10 кВ';
    }
    var xl = o.insul === 'xlpe';
    if (motor && screened) return (xl ? 'ПвВГЭнг(А)-LS' : 'ВВГЭнг(А)-LS') + ' или специализированный кабель для ПЧ (симметричный 3+3PE, медный экран/оплётка ≥ 80 %)';
    return al + (xl ? 'ПвВГнг(А)-LS' : 'ВВГнг(А)-LS') + (o.method === 'D1' ? ' (в земле — ' + al + (xl ? 'ПвБбШп' : 'ВБбШв') + ')' : '');
  }


  export {
    R, DEFAULT_SHARED, DEFAULT_DRIVE, SHARED_KEYS, PRESETS, clone, merge, f, fa, num,
    compute, checks, cableName, cableMark, peSection, vkey
  };
