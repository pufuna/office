/**
 * Engineering worksheet functions on top of the raschet core. Each entry is a
 * plain function of scalars (ranges arrive as 2-D arrays) so the Sheets app
 * can register it with the formula engine and tests can call it directly.
 *
 * Names are Russian (as in a Russian-locale Excel) with an English alias, so a
 * workbook stays readable when it is opened by someone on another UI language.
 */
import { R, driveStateMotor } from './motor'

export type FormulaArg = number | string | boolean | null | undefined | FormulaArg[][]
export type FormulaResult = number | string

export interface DriveFormula {
  /** Russian name, e.g. "ДВ.ТОК" */
  name: string
  /** English alias, e.g. "MOTOR.CURRENT" */
  alias: string
  /** one-line Russian description shown in the function list */
  description: string
  /** argument names and meanings; optional arguments are listed in [brackets] */
  args: { name: string; detail: string; optional?: boolean }[]
  /** example call, e.g. "=ДВ.ТОК(75;380;0,86;94,5)" */
  example: string
  fn: (...args: FormulaArg[]) => FormulaResult
}

/** Thrown inside a formula to surface a spreadsheet error value instead of a number. */
export class FormulaError extends Error {
  constructor(readonly code: '#VALUE!' | '#NUM!' | '#N/A') {
    super(code)
  }
}

function scalar(v: FormulaArg): FormulaArg {
  return Array.isArray(v) ? (v[0]?.[0] ?? null) : v
}

function n(v: FormulaArg, fallback?: number): number {
  const x = scalar(v)
  if (x === null || x === undefined || x === '') {
    if (fallback === undefined) throw new FormulaError('#VALUE!')
    return fallback
  }
  const value = typeof x === 'number' ? x : Number(String(x).replace(/\s/g, '').replace(',', '.'))
  if (!Number.isFinite(value)) throw new FormulaError('#VALUE!')
  return value
}

function s(v: FormulaArg, fallback: string): string {
  const x = scalar(v)
  return x === null || x === undefined || x === '' ? fallback : String(x).trim()
}

function positive(x: number): number {
  if (!(x > 0)) throw new FormulaError('#NUM!')
  return x
}

/** Flatten a 2-column range ([[Q %, hours], …]) into rows, skipping blanks. */
function pairs(v: FormulaArg): [number, number][] {
  if (!Array.isArray(v)) throw new FormulaError('#VALUE!')
  const out: [number, number][] = []
  for (const row of v) {
    const a = Number(scalar([[row[0] ?? null]]))
    const b = Number(scalar([[row[1] ?? null]]))
    if (Number.isFinite(a) && Number.isFinite(b) && row[0] !== '' && row[1] !== '') out.push([a, b])
  }
  if (out.length === 0) throw new FormulaError('#VALUE!')
  return out
}

const SQ3 = Math.sqrt(3)

/** Load types accepted by ЧРП.ПОДБОР, Russian word → raschet key. */
const LOAD_ALIASES: Record<string, string> = {
  насос: 'pump',
  вентилятор: 'fan',
  дымосос: 'fan',
  компрессор: 'screw',
  винтовой: 'screw',
  поршневой: 'piston',
  конвейер: 'conveyor',
  мельница: 'mill',
  дробилка: 'crusher',
  подъём: 'hoist',
  подъем: 'hoist',
  кран: 'hoist',
  экструдер: 'extruder',
  мешалка: 'extruder',
}

function loadType(v: FormulaArg): string {
  const raw = s(v, 'pump').toLowerCase()
  if (R.LOAD_TYPES[raw]) return raw
  for (const [word, key] of Object.entries(LOAD_ALIASES)) if (raw.includes(word)) return key
  throw new FormulaError('#VALUE!')
}

const TOPOLOGY_ALIASES: Record<string, string> = {
  '6': '6p',
  '6д': '6pL',
  '6l': '6pL',
  '12': '12p',
  '18': '18p',
  afe: 'afe',
  ав: 'afe',
}

function topology(v: FormulaArg): string {
  const raw = s(v, '6pL')
  if (R.TOPOLOGIES[raw]) return raw
  const key = TOPOLOGY_ALIASES[raw.toLowerCase().replace(/[\s-]/g, '').replace(/p$/, '')]
  if (key) return key
  throw new FormulaError('#VALUE!')
}

function selectVfd(
  P: number,
  U: number,
  type: string,
  ovlPct: number | undefined,
  amb: number,
  alt: number,
): any {
  const { md, mdl } = driveStateMotor({ P, U })
  const lt = R.LOAD_TYPES[type]
  const L = R.loadDerive({ type, P: P * 0.9 }, md)
  const sel = R.selectVFD({
    md,
    mdl,
    load: L,
    nMotors: 1,
    ovlPct: ovlPct ?? lt.ovl,
    ovlTime: lt.tovl,
    startPct: ((L.brk * L.Mn) / md.Mn) * 100,
    margin: 1,
    amb,
    alt,
    catalog: R.CATALOG,
    series: '*',
  })
  return sel.best[0] ?? null
}

export const DRIVE_FORMULAS: readonly DriveFormula[] = [
  {
    name: 'ДВ.ТОК',
    alias: 'MOTOR.CURRENT',
    description: 'Номинальный ток асинхронного двигателя, А',
    args: [
      { name: 'P', detail: 'мощность на валу, кВт' },
      { name: 'U', detail: 'линейное напряжение, В' },
      { name: 'cos', detail: 'коэффициент мощности' },
      { name: 'КПД', detail: 'КПД, %' },
    ],
    example: '=ДВ.ТОК(75;380;0,86;94,5)',
    fn: (P, U, cos, eff) =>
      (positive(n(P)) * 1000) /
      (SQ3 * positive(n(U)) * positive(n(cos)) * (positive(n(eff)) / 100)),
  },
  {
    name: 'ДВ.МОМЕНТ',
    alias: 'MOTOR.TORQUE',
    description: 'Номинальный момент на валу, Н·м (M = 9550·P/n)',
    args: [
      { name: 'P', detail: 'мощность, кВт' },
      { name: 'n', detail: 'частота вращения, об/мин' },
    ],
    example: '=ДВ.МОМЕНТ(75;1480)',
    fn: (P, rpm) => (n(P) * 1000) / ((2 * Math.PI * positive(n(rpm))) / 60),
  },
  {
    name: 'ДВ.СКОЛЬЖЕНИЕ',
    alias: 'MOTOR.SLIP',
    description: 'Номинальное скольжение, % (число пар полюсов определяется по n и f)',
    args: [
      { name: 'n', detail: 'номинальная частота вращения, об/мин' },
      { name: 'f', detail: 'частота сети, Гц', optional: true },
    ],
    example: '=ДВ.СКОЛЬЖЕНИЕ(1480)',
    fn: (rpm, f) => {
      const md = R.motorDerive({
        P: 1,
        U: 380,
        f: n(f, 50),
        n: positive(n(rpm)),
        cos: 0.85,
        eff: 90,
      })
      return md.sn * 100
    },
  },
  {
    name: 'ЧРП.ПОДБОР',
    alias: 'VFD.SELECT',
    description:
      'Наименьшая модель ПЧ ESQ из каталога, проходящая по длительному току и перегрузке',
    args: [
      { name: 'P', detail: 'мощность двигателя, кВт' },
      { name: 'U', detail: 'напряжение двигателя, В (380…10000)' },
      {
        name: 'нагрузка',
        detail:
          'насос, вентилятор, компрессор, поршневой, конвейер, мельница, дробилка, подъём, экструдер',
        optional: true,
      },
      {
        name: 'перегрузка',
        detail: 'требуемая перегрузка, % (по умолчанию — по типу нагрузки)',
        optional: true,
      },
      { name: 't', detail: 'температура окружающей среды, °C (40)', optional: true },
      { name: 'H', detail: 'высота над уровнем моря, м (0)', optional: true },
    ],
    example: '=ЧРП.ПОДБОР(75;380;"насос")',
    fn: (P, U, type, ovl, amb, alt) => {
      const best = selectVfd(
        positive(n(P)),
        positive(n(U)),
        loadType(type),
        scalar(ovl) === null || scalar(ovl) === undefined || scalar(ovl) === ''
          ? undefined
          : n(ovl),
        n(amb, 40),
        n(alt, 0),
      )
      if (!best) throw new FormulaError('#N/A')
      return best.model + (best.duty === 'HV' ? '' : ` (${best.duty})`)
    },
  },
  {
    name: 'ЧРП.ТОК',
    alias: 'VFD.CURRENT',
    description: 'Номинальный ток модели ПЧ по каталогу с учётом температуры и высоты, А',
    args: [
      { name: 'модель', detail: 'обозначение, как в каталоге (например, ESQ-770-4T-0750G)' },
      { name: 'режим', detail: 'G — постоянный момент, P — насос/вентилятор (G)', optional: true },
      { name: 't', detail: 'температура окружающей среды, °C (40)', optional: true },
      { name: 'H', detail: 'высота, м (0)', optional: true },
    ],
    example: '=ЧРП.ТОК("ESQ F 790-4T0750";"G";45)',
    fn: (model, duty, amb, alt) => {
      const key = s(model, '').replace(/\s*\((G|P)\)$/i, '')
      const d = s(duty, 'G').toUpperCase()
      const rows = R.CATALOG.filter((c: any) => c.model === key)
      const row = rows.find((c: any) => c.duty === d) ?? rows[0]
      if (!row) throw new FormulaError('#N/A')
      return row.I * R.derating(n(amb, 40), n(alt, 0), row.U > 1).k
    },
  },
  {
    name: 'КАБЕЛЬ.СЕЧЕНИЕ',
    alias: 'CABLE.SIZE',
    description:
      'Сечение кабеля по допустимому току (ГОСТ Р 50571.5.52 / ПУЭ) и потере напряжения, например «2×[4×185] мм²»',
    args: [
      { name: 'I', detail: 'расчётный ток, А' },
      { name: 'U', detail: 'напряжение, кВ' },
      { name: 'L', detail: 'длина линии, м' },
      { name: 'материал', detail: '"cu" — медь, "al" — алюминий (cu)', optional: true },
      {
        name: 'способ',
        detail: 'C, E, D1 (до 1 кВ), air, ground (6–10 кВ); E/air по умолчанию',
        optional: true,
      },
      { name: 'ΔU', detail: 'допустимая потеря напряжения, % (5)', optional: true },
      { name: 'cos', detail: 'коэффициент мощности (0,85)', optional: true },
      { name: 't', detail: 'температура среды, °C (30, в земле — 20)', optional: true },
    ],
    example: '=КАБЕЛЬ.СЕЧЕНИЕ(140;0,4;80;"cu";"E";3)',
    fn: (I, U, L, mat, method, dU, cos, tAmb) => {
      const UkV = positive(n(U))
      const hv = UkV > 1
      const m = s(mat, 'cu').toLowerCase().startsWith('a') ? 'al' : 'cu'
      const how = s(method, hv ? 'air' : 'E')
      if (!R.INSTALL[how]) throw new FormulaError('#VALUE!')
      const ground = R.INSTALL[how].ground
      const o = {
        I: positive(n(I)),
        U: UkV,
        hv,
        mat: m,
        insul: 'xlpe',
        method: how,
        tAmb: n(tAmb, ground ? 20 : 30),
        nGroup: 1,
        L: n(L),
        cos: n(cos, 0.85),
        dUmax: n(dU, 5),
        Ik: 0,
        tk: 0,
        norm: 'gost',
        rho: 1.2,
        depth: 0.7,
      }
      const best = R.selectCable(o).best
      if (!best) throw new FormulaError('#N/A')
      const sec = String(best.s).replace('.', ',')
      const core = hv ? `3×(1×${sec})` : `${best.s <= 16 ? '5' : '4'}×${sec}`
      return `${best.np > 1 ? `${best.np}×[` : ''}${m === 'al' ? 'А' : ''}${core}${best.np > 1 ? ']' : ''} мм²`
    },
  },
  {
    name: 'КАБЕЛЬ.ПОТЕРЯ',
    alias: 'CABLE.DROP',
    description: 'Потеря напряжения в трёхфазной линии, % (жила нагрета до 70 °C)',
    args: [
      { name: 'I', detail: 'ток, А' },
      { name: 'U', detail: 'напряжение, кВ' },
      { name: 'L', detail: 'длина, м' },
      { name: 'S', detail: 'сечение жилы, мм²' },
      { name: 'материал', detail: '"cu" или "al" (cu)', optional: true },
      { name: 'cos', detail: 'коэффициент мощности (0,85)', optional: true },
      { name: 'n', detail: 'число параллельных кабелей (1)', optional: true },
    ],
    example: '=КАБЕЛЬ.ПОТЕРЯ(140;0,4;80;50)',
    fn: (I, U, L, S, mat, cos, np) => {
      const m = s(mat, 'cu').toLowerCase().startsWith('a') ? 'al' : 'cu'
      const sec = n(S)
      const r20 = R.R20[m][sec]
      if (r20 === undefined) throw new FormulaError('#N/A')
      const UkV = positive(n(U))
      const r = r20 * (1 + R.ALPHA[m] * 50)
      const x = R.cableX(sec, UkV > 1)
      const c = n(cos, 0.85)
      return (
        ((SQ3 * n(I) * (n(L) / 1000) * (r * c + x * Math.sqrt(1 - c * c))) /
          positive(n(np, 1)) /
          (UkV * 1000)) *
        100
      )
    },
  },
  {
    name: 'ГАРМ.THDI',
    alias: 'HARM.THDI',
    description: 'Типовой коэффициент искажения входного тока ПЧ, %',
    args: [
      {
        name: 'схема',
        detail:
          '6p — без дросселя, 6pL — с дросселем, 12p, 18p, afe, hv18/hv30/hv48 — ВВ каскадные',
        optional: true,
      },
    ],
    example: '=ГАРМ.THDI("6pL")',
    fn: (topo) => {
      const T = R.TOPOLOGIES[topology(topo)]
      return Math.sqrt(Object.values(T.h as Record<string, number>).reduce((a, x) => a + x * x, 0))
    },
  },
  {
    name: 'ГАРМ.KU',
    alias: 'HARM.THDU',
    description:
      'Коэффициент искажения напряжения KU в точке подключения ПЧ, % (сравнить с ГОСТ 32144-2013)',
    args: [
      { name: 'схема', detail: 'как в ГАРМ.THDI' },
      { name: 'P', detail: 'активная мощность, потребляемая ПЧ из сети, кВт' },
      { name: 'U', detail: 'напряжение сети, кВ' },
      { name: 'Sк', detail: 'мощность КЗ сети, МВА' },
      { name: 'фон', detail: 'фоновый KU сети, % (0)', optional: true },
    ],
    example: '=ГАРМ.KU("6pL";80;0,4;20)',
    fn: (topo, P, U, Sk, bg) =>
      R.harmonics({
        topo: topology(topo),
        P: positive(n(P)),
        U: positive(n(U)),
        Sk: positive(n(Sk)),
        bg: n(bg, 0),
      }).thdU,
  },
  {
    name: 'ТОРМ.ПОРОГ',
    alias: 'BRAKE.UDC',
    description: 'Напряжение включения тормозного прерывателя по звену постоянного тока, В',
    args: [{ name: 'U', detail: 'напряжение сети, В' }],
    example: '=ТОРМ.ПОРОГ(380)',
    fn: (U) => R.brakeUdc(positive(n(U))),
  },
  {
    name: 'ТОРМ.RМАКС',
    alias: 'BRAKE.RMAX',
    description:
      'Наибольшее сопротивление тормозного резистора, обеспечивающее пиковую мощность торможения, Ом',
    args: [
      { name: 'Pпик', detail: 'пиковая мощность торможения, кВт' },
      { name: 'U', detail: 'напряжение сети, В' },
    ],
    example: '=ТОРМ.RМАКС(45;380)',
    fn: (Pk, U) => {
      const ubr = R.brakeUdc(positive(n(U)))
      return (ubr * ubr) / (positive(n(Pk)) * 1000)
    },
  },
  {
    name: 'НАСОС.ЧАСТОТА',
    alias: 'PUMP.FREQ',
    description:
      'Частота ПЧ для заданной подачи по законам подобия с учётом статического напора, Гц',
    args: [
      { name: 'Q', detail: 'подача, % от номинальной' },
      { name: 'hст', detail: 'доля статического напора, % (0)', optional: true },
      { name: 'fн', detail: 'номинальная частота, Гц (50)', optional: true },
    ],
    example: '=НАСОС.ЧАСТОТА(70;20)',
    fn: (Q, hs, fn) => {
      const q = n(Q) / 100
      const h = n(hs, 0) / 100
      return Math.sqrt(h + (1 - h) * q * q) * n(fn, 50)
    },
  },
  {
    name: 'НАСОС.МОЩНОСТЬ',
    alias: 'PUMP.POWER',
    description: 'Мощность на валу при регулировании частотой для заданной подачи, кВт',
    args: [
      { name: 'P100', detail: 'мощность на валу при номинальной подаче, кВт' },
      { name: 'Q', detail: 'подача, %' },
      { name: 'hст', detail: 'доля статического напора, % (0)', optional: true },
    ],
    example: '=НАСОС.МОЩНОСТЬ(65;70;20)',
    fn: (P100, Q, hs) => {
      const q = n(Q) / 100
      const h = n(hs, 0) / 100
      return n(P100) * q * (h + (1 - h) * q * q)
    },
  },
  {
    name: 'ЭКОНОМИЯ.КВТЧ',
    alias: 'ENERGY.SAVING',
    description:
      'Годовая экономия электроэнергии от ЧРП по графику работы (диапазон «подача %, часов в год»), кВт·ч',
    args: [
      { name: 'P100', detail: 'мощность на валу при номинальной подаче, кВт' },
      { name: 'график', detail: 'диапазон из двух столбцов: подача, %; часов в год' },
      {
        name: 'способ',
        detail: 'pump-throttle (задвижка), fan-damper (шибер), fan-vanes (ВНА), bypass (перепуск)',
        optional: true,
      },
      { name: 'hст', detail: 'доля статического напора, % (0)', optional: true },
      { name: 'КПДдв', detail: 'КПД двигателя, % (95)', optional: true },
      { name: 'КПДпч', detail: 'КПД ПЧ, % (97,5)', optional: true },
    ],
    example: '=ЭКОНОМИЯ.КВТЧ(65;A2:B7;"pump-throttle";20)',
    fn: (P100, schedule, mode, hs, etaM, etaV) => {
      const key = s(mode, 'pump-throttle')
      if (!R.THROTTLE[key]) throw new FormulaError('#VALUE!')
      return R.energy({
        P100: positive(n(P100)),
        mode: key,
        hs: n(hs, 0) / 100,
        etaM: n(etaM, 95) / 100,
        etaV: n(etaV, 97.5) / 100,
        rows: pairs(schedule).map(([q, h]) => ({ q, h })),
        tariff: 0,
        price: 0,
      }).dE
    },
  },
]

/** Evaluate a drive formula by Russian name or alias (case-insensitive); errors come back as "#VALUE!" etc. */
export function evalDriveFormula(name: string, ...args: FormulaArg[]): FormulaResult {
  const key = name.toUpperCase()
  const formula = DRIVE_FORMULAS.find((f) => f.name === key || f.alias === key)
  if (!formula) return '#NAME?'
  try {
    const result = formula.fn(...args)
    if (typeof result === 'number' && !Number.isFinite(result)) return '#NUM!'
    return result
  } catch (error) {
    if (error instanceof FormulaError) return error.code
    return '#VALUE!'
  }
}
