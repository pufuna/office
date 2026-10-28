/**
 * ESQ Service trend logs (CSV, ';'-separated, "Дата и время;…" header) and
 * what raschet derives from them: start-up detection and identification of
 * the load torque curve Mc(ω) = A + B·(ω/ωn)^k and the total inertia J.
 */
import { R, driveStateMotor } from './motor'
import type { DriveInput } from './index'

/** Canonical channel keys raschet recognises in the CSV header. */
export const TREND_CHANNELS: Record<string, string> = {
  f: 'F вых, Гц',
  fset: 'F зад, Гц',
  ffb: 'F ОС, Гц',
  I: 'I вых, А',
  Iin: 'I вх, А',
  Uin: 'U вх, В',
  U: 'U вых, В',
  Upct: 'U вых, %',
  P: 'P вых, кВт',
  Pin: 'P вх, кВт',
  M: 'M вых, %',
  n: 'n, об/мин',
  Udc: 'Udc, В',
  run: 'Работа',
  fault: 'Авария',
  T: 'T, °C',
}

export interface EsqTrend {
  /** text above the header row (device, address, export time) */
  meta: string
  /** device family recognised from meta, e.g. "ESQ F ME800-R" */
  device: string
  /** original header cells */
  header: string[]
  /** recognised channel keys, see TREND_CHANNELS */
  channels: string[]
  /** absolute time of the first sample, Unix seconds (UTC wall clock of the log) */
  startTime: number
  /** time since the first sample, s */
  t: number[]
  /** channel → samples (NaN where the cell was empty) */
  data: Record<string, number[]>
}

export interface TrendStart {
  startS: number
  endS: number
  finalFrequencyHz: number
  rampHzPerS: number
}

export interface TrendIdentification {
  /** Mc(ω) = A + B·(ω/ωn)^k, N·m */
  torqueCurve: { A: number; B: number; k: number; rmsErrorNm: number; points: number } | null
  /** total inertia referred to the motor shaft, kg·m² */
  inertiaKgm2: number | null
  /** load inertia (total minus the rotor), kg·m² */
  loadInertiaKgm2: number | null
  /** load power at rated speed from the identified curve, kW */
  loadPowerKw: number | null
  /** share of the speed-independent component A/(A+B) */
  m0: number | null
  /** which channel the shaft torque was taken from */
  torqueSource: string
}

export interface TrendAnalysis {
  device: string
  durationS: number
  samples: number
  sampleStepS: number
  channels: string[]
  starts: TrendStart[]
  /** per-channel min / mean / max */
  stats: Record<string, { min: number; mean: number; max: number }>
  identification: TrendIdentification | null
}

/** Parse an ESQ Service trend CSV; throws with a user-facing (Russian) reason when it is not one. */
export function parseEsqTrend(text: string): EsqTrend {
  const tr = R.parseEsqCsv(text)
  const data: Record<string, number[]> = {}
  for (const key of tr.cols as string[]) data[key] = tr.d[key]
  return {
    meta: tr.meta,
    device: tr.device,
    header: tr.head,
    channels: tr.cols,
    startTime: tr.t0,
    t: tr.d.t,
    data,
  }
}

/** Cheap sniff used by file-open paths: true when the text looks like an ESQ Service trend log. */
export function isEsqTrendCsv(text: string): boolean {
  return /^\uFEFF?(?:[^\n]*\n){0,20}"?Дата и время"?;/.test(text.slice(0, 8192))
}

function stats(values: number[]): { min: number; mean: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let n = 0
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    n++
  }
  return n ? { min, mean: sum / n, max } : null
}

const round = (x: number, d = 3): number => Math.round(x * 10 ** d) / 10 ** d

/**
 * Start-ups, channel statistics and — when the motor nameplate is given —
 * identification of Mc(ω) and J from the recorded output torque/power/current.
 */
export function analyzeEsqTrend(
  input: string | EsqTrend,
  motor?: DriveInput['motor'],
): TrendAnalysis {
  const trend = typeof input === 'string' ? parseEsqTrend(input) : input
  const tr = { meta: trend.meta, device: trend.device, d: { t: trend.t, ...trend.data } }
  const n = trend.t.length
  const out: TrendAnalysis = {
    device: trend.device,
    durationS: round(trend.t[n - 1] ?? 0, 2),
    samples: n,
    sampleStepS: n > 1 ? round((trend.t[n - 1]! - trend.t[0]!) / (n - 1), 4) : 0,
    channels: trend.channels,
    starts: (R.findStarts(tr) as any[]).map((s) => ({
      startS: round(s.t0, 2),
      endS: round(s.t1, 2),
      finalFrequencyHz: round(s.fEnd, 2),
      rampHzPerS: round(s.ramp, 3),
    })),
    stats: {},
    identification: null,
  }
  for (const key of trend.channels) {
    const st = stats(trend.data[key]!)
    if (st) out.stats[key] = { min: round(st.min), mean: round(st.mean), max: round(st.max) }
  }
  if (motor && trend.data.f) {
    const { md, mdl } = driveStateMotor(motor)
    const id = R.identify(tr, md, mdl)
    out.identification = {
      torqueCurve: id.fit
        ? {
            A: round(id.fit.A, 2),
            B: round(id.fit.B, 2),
            k: id.fit.k,
            rmsErrorNm: round(id.fit.rms, 2),
            points: id.fit.n,
          }
        : null,
      inertiaKgm2: id.J != null ? round(id.J, 3) : null,
      loadInertiaKgm2: id.Jload != null ? round(id.Jload, 3) : null,
      loadPowerKw: id.Pn != null ? round(id.Pn, 2) : null,
      m0: id.m0 != null ? round(id.m0, 3) : null,
      torqueSource: id.sh.src,
    }
  }
  return out
}
