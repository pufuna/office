/**
 * Variable-frequency drive engineering calculations (0.4–10 kV), ported from
 * pufuna/raschet: motor equivalent circuit, VFD selection from the ESQ
 * catalogue, start-up simulation, cables, protection, harmonics, braking,
 * pump curves, energy saving and cascade start.
 *
 * The calculation core lives verbatim in ./vendor/raschet (regenerate it with
 * scripts/sync-raschet.mjs); this module is the typed boundary the office apps
 * and the AI agent call. Inputs use raschet's own field names so a project
 * saved by raschet's web app can be passed straight in.
 */
import {
  R,
  DEFAULT_DRIVE,
  DEFAULT_SHARED,
  PRESETS,
  cableMark,
  cableName,
  clone,
  compute,
  merge,
  num,
} from './vendor/raschet/project.js'

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** Input groups of one drive; every field is optional and falls back to raschet's defaults. */
export interface DriveInput {
  name?: string
  project?: { name?: string; author?: string; customer?: string }
  /** supply network: mode 'sk' (short-circuit power Sk, MVA) or 'tr' (transformer trS kVA, trUk %) */
  net?: Record<string, number | string>
  /** motor: type 'async'|'sync', P kW, U V (line), f Hz, n rpm, cos, eff %, I A, kI, kMp, kMk, J kg·m² */
  motor?: Record<string, number | string | null>
  /** load: type (pump, fan, screw, piston, conveyor, mill, crusher, hoist, extruder, custom), P kW, ovlPct, ovlTime s, startPct, J */
  load?: Record<string, number | string | null>
  /** vfd: series ('*' = any), nMotors, margin, amb °C, alt m, control 'vf'|'vector', topo (6p, 6pL, 12p, 18p, afe) */
  vfd?: Record<string, number | string | null>
  sim?: Record<string, number | string>
  /** supply cable: mat 'cu'|'al', insul 'xlpe'|'pvc', method (C, E, D1, air, ground), tAmb, nGroup, L m, dUmax %, norm 'gost'|'pue' */
  cin?: Record<string, number | string>
  /** motor cable: as cin plus screened 'yes'|'no', ins 'std'|'inv', tr µs */
  cout?: Record<string, number | string>
  prot?: Record<string, number | string>
  brake?: Record<string, number | string>
  /** duty: cool 'self'|'forced', fmin, fmax Hz, rows [[t s, M %, n %], …] */
  duty?: { cool?: string; fmin?: number; fmax?: number; rows?: number[][] }
  /** pump: on 'yes'|'no', Qd m³/h, Hd m, Hst m, rho, npsha, pts [[Q, H, eta %, NPSHr], …] */
  pump?: { on?: string; pts?: (number | null)[][]; [key: string]: unknown }
  casc?: Record<string, number | string>
  /** energy: mode (pump-throttle, fan-damper, fan-vanes, bypass, pump-curve), hs %, tariff ₽/kWh, price ₽, rows [[Q %, h/year], …] */
  energy?: { mode?: string; hs?: number; tariff?: number; price?: number; rows?: number[][] }
}

export type CheckLevel = 'ok' | 'info' | 'warn' | 'err'

export interface DriveCheck {
  /** raschet page the finding belongs to (obj, vfd, sim, cab, prot, harm, brake, modes, pump, energy, casc) */
  section: string
  level: CheckLevel
  text: string
}

export interface VfdOption {
  series: string
  model: string
  /** G (constant torque), P (fan/pump) or HV */
  duty: string
  /** catalogue rated current, A */
  ratedCurrent: number
  /** rated current after ambient/altitude derating, A */
  deratedCurrent: number
  /** overload current available for the requested overload time, A */
  overloadCurrent: number
  powerKw: number | null
  /** continuous-current reserve, % */
  reservePct: number
  /** overload-current reserve, % */
  overloadReservePct: number
}

export interface CableChoice {
  /** conductor build-up, e.g. "2×[4×185] мм²" */
  name: string
  /** suggested cable brand(s) */
  mark: string
  sectionMm2: number
  parallel: number
  ampacityA: number
  voltageDropPct: number
  lossKw: number
}

export interface StartResult {
  timeToSpeedS: number | null
  peakCurrentA: number
  peakCurrentPctIn: number
  minBusVoltagePct: number
  stalled: boolean
}

export interface DriveReport {
  name: string
  motor: {
    powerKw: number
    voltageV: number
    ratedCurrentA: number
    ratedTorqueNm: number
    speedRpm: number
    poles: number
    inertiaKgm2: number
    inertiaEstimated: boolean
    synchronous: boolean
    highVoltage: boolean
  }
  load: {
    type: string
    name: string
    powerKw: number
    torqueNm: number
    inertiaKgm2: number
    inertiaEstimated: boolean
    quadratic: boolean
  }
  network: { shortCircuitMva: number; shortCircuitKa: number }
  vfd: {
    voltageClassKv: number | null
    requiredCurrentA: number
    requiredOverloadCurrentA: number
    deratingFactor: number
    selected: VfdOption | null
    alternatives: VfdOption[]
    notes: string[]
    /** ESQ-770 manufacturer's breaker/contactor/cable recommendation, when known */
    peripherals: { breakerA: number; contactorA: number; cableMm2: string } | null
  }
  harmonics: {
    topology: string
    thdIPct: number
    thdUPct: number
    limitThdUPct: number
    withinGost: boolean
    inputCurrentRmsA: number
    powerFactor: number
    shortCircuitRatio: number
    orders: { h: number; currentPct: number; voltagePct: number; limitPct: number | null }[]
  }
  supplyCable: CableChoice | null
  motorCable: CableChoice | null
  /** low-voltage drives only: peak voltage at the motor terminals and the filter recommendation */
  reflectedWave: {
    peakVoltageV: number
    insulationLimitV: number
    recommendation: string
    maxCableLengthM: { none: number; reactor: number; sine: number }
  } | null
  protection: Record<string, number | string | boolean | null>
  start: { directOnLine: StartResult; softStarter: StartResult; vfd: StartResult } | null
  braking: {
    peakPowerKw: number
    energyKj: number
    averagePowerKw: number
    chopperThresholdV: number
    maxResistanceOhm: number | null
    dutyPct: number
    coastTimeS: number | null
    minTimeWithoutResistorS: number
    esqChopper: {
      chopper: string
      minResistanceOhm: number | null
      powerW10: number | null
      powerW50: number | null
    } | null
  }
  speedRange: {
    ok: boolean
    worstFrequencyHz: number
    worstUtilisationPct: number
    cooling: string
  }
  energy: {
    method: string
    throttlingMwh: number
    vfdMwh: number
    savingMwh: number
    savingPct: number
    savingMoney: number
    paybackYears: number | null
    rows: {
      flowPct: number
      hours: number
      throttlingKw: number
      vfdKw: number
      speedPct: number
    }[]
  } | null
  pump: {
    flowM3h: number
    headM: number
    zeroFlowFrequencyHz: number
    npshOk: boolean | null
  } | null
  checks: DriveCheck[]
}

const round = (x: number | null | undefined, digits = 2): number | null => {
  if (x == null || !Number.isFinite(x)) return null
  const k = 10 ** digits
  return Math.round(x * k) / k
}
const r = (x: number | null | undefined, digits = 2): number => round(x, digits) ?? 0

/** Names of the bundled example systems, in raschet's order. */
export function drivePresetNames(): string[] {
  return PRESETS.map((p) => p.name)
}

/** Resolve a preset by index or (case-insensitive) name fragment into a DriveInput. */
export function drivePreset(key: number | string): DriveInput | null {
  const preset =
    typeof key === 'number'
      ? PRESETS[key]
      : PRESETS.find((p) => p.name.toLowerCase().includes(String(key).toLowerCase()))
  if (!preset) return null
  const data = clone(preset.data)
  return Array.isArray(data.drives) ? { ...data, ...data.drives[0], drives: undefined } : data
}

/** Defaults merged with the input, in the shape raschet's compute() reads. */
export function driveState(input: DriveInput = {}): any {
  const state = merge(clone(DEFAULT_DRIVE), input)
  for (const key of ['project', 'net', 'prices', 'kp']) {
    state[key] = merge(clone(DEFAULT_SHARED[key]), (input as any)[key] ?? {})
  }
  return state
}

/** Raw raschet result (internal shape) — for callers that need the time series. */
export function computeDriveRaw(input: DriveInput = {}, simulate = true): any {
  return compute(driveState(input), !simulate)
}

function vfdOption(c: any): VfdOption {
  return {
    series: c.series,
    model: c.model,
    duty: c.duty,
    ratedCurrent: r(c.I, 1),
    deratedCurrent: r(c.Ider, 1),
    overloadCurrent: r(c.Imax, 1),
    powerKw: round(c.P, 1),
    reservePct: r(c.reserve * 100, 1),
    overloadReservePct: r(c.reserveO * 100, 1),
  }
}

function cableChoice(best: any, o: any, hv: boolean, motor: boolean): CableChoice | null {
  if (!best) return null
  return {
    name: cableName(best, o, hv, motor),
    mark: cableMark(o, hv, motor, o.screened === 'yes'),
    sectionMm2: best.s,
    parallel: best.np,
    ampacityA: r(best.IzTotal, 1),
    voltageDropPct: r(best.dU, 2),
    lossKw: r(best.loss, 2),
  }
}

function startResult(sim: any, inA: number): StartResult {
  return {
    timeToSpeedS: round(sim.tReach, 2),
    peakCurrentA: r(sim.Ipk, 1),
    peakCurrentPctIn: r((sim.Ipk / inA) * 100, 0),
    minBusVoltagePct: r(sim.Umin * 100, 1),
    stalled: !!sim.stalled,
  }
}

/**
 * Full engineering calculation of one drive. simulate=false skips the start-up
 * time-domain models (≈10× faster), as raschet does for multi-drive summaries.
 */
export function computeDrive(input: DriveInput = {}, simulate = true): DriveReport {
  const s = driveState(input)
  const c = compute(s, !simulate)
  const md = c.md
  const L = c.L
  const h = c.harm
  const pr = c.prot
  const protection: DriveReport['protection'] = c.hv
    ? {
        kind: 'hv',
        transformerCurrentA: round(pr.Itr, 1),
        inrushCurrentA: round(pr.Iinr, 0),
        shortCircuit3Ka: round(pr.Ik3, 2),
        instantaneousA: round(pr.Iso, 0),
        instantaneousSensitivity: round(pr.kSo, 2),
        delayedInstantaneousA: round(pr.IsoDelay, 0),
        overcurrentA: round(pr.Imtz, 0),
        overcurrentSensitivity: round(pr.kMtz, 2),
        overcurrentDelayS: pr.tMtz,
      }
    : {
        kind: 'lv',
        device: pr.dev?.name ?? null,
        ratedCurrentA: pr.In ?? null,
        shortCircuit3Ka: round(pr.Ik3, 2),
        shortCircuit1Ka: round(pr.Ik1, 2),
        requiredKa: round(pr.need, 2),
        disconnectsInTime: !!pr.ok,
        rule: pr.rule,
      }
  const bd = c.brakeData
  const e = c.energy
  return {
    name: s.name,
    motor: {
      powerKw: md.P,
      voltageV: md.U,
      ratedCurrentA: r(md.In, 1),
      ratedTorqueNm: r(md.Mn, 0),
      speedRpm: md.n,
      poles: md.p * 2,
      inertiaKgm2: r(md.J, 2),
      inertiaEstimated: !!md.Jest,
      synchronous: !!md.sync,
      highVoltage: !!md.hv,
    },
    load: {
      type: s.load.type,
      name: L.name,
      powerKw: r(L.P, 1),
      torqueNm: r(L.Mn, 0),
      inertiaKgm2: r(L.J, 2),
      inertiaEstimated: !!L.Jest,
      quadratic: !!L.quad,
    },
    network: { shortCircuitMva: r(c.Sk, 1), shortCircuitKa: r(c.Ik, 2) },
    vfd: {
      voltageClassKv: c.sel.cls ?? null,
      requiredCurrentA: r(c.sel.Icont, 1),
      requiredOverloadCurrentA: r(c.sel.Iovl, 1),
      deratingFactor: r(c.sel.der.k, 3),
      selected: c.vfd ? vfdOption(c.vfd) : null,
      alternatives: c.sel.best.slice(0, 8).map(vfdOption),
      notes: c.sel.notes,
      peripherals: c.periph
        ? { breakerA: c.periph.QF, contactorA: c.periph.KM, cableMm2: c.periph.cable }
        : null,
    },
    harmonics: {
      topology: h.topo.name,
      thdIPct: r(h.thdI, 1),
      thdUPct: r(h.thdU, 2),
      limitThdUPct: h.lim.thd,
      withinGost: !!h.ok,
      inputCurrentRmsA: r(h.Irms, 1),
      powerFactor: r(h.PF, 3),
      shortCircuitRatio: r(h.RSCE, 0),
      orders: h.rows.map((row: any) => ({
        h: row.h,
        currentPct: r(row.Ipct, 2),
        voltagePct: r(row.Upct, 3),
        limitPct: row.lim,
      })),
    },
    supplyCable: cableChoice(c.cin.best, s.cin, c.hv, false),
    motorCable: cableChoice(c.cout.best, s.cout, c.hv, true),
    reflectedWave: c.rw
      ? {
          peakVoltageV: r(c.rw.raw.Upk, 0),
          insulationLimitV: c.insLimit,
          recommendation: c.rw.rec,
          maxCableLengthM: c.maxL,
        }
      : null,
    protection,
    start: c.sims
      ? {
          directOnLine: startResult(c.sims.dol, md.In),
          softStarter: startResult(c.sims.soft, md.In),
          vfd: startResult(c.sims.vfd, md.In),
        }
      : null,
    braking: {
      peakPowerKw: r(c.brake.Pk, 2),
      energyKj: r(c.brake.E, 1),
      averagePowerKw: r(c.brake.Pavg, 3),
      chopperThresholdV: c.brake.Ubr,
      maxResistanceOhm: round(c.brake.Rmax, 1),
      dutyPct: r(c.brake.ED, 1),
      coastTimeS: round(c.brake.tCoast, 1),
      minTimeWithoutResistorS: r(c.brake.tMin, 1),
      esqChopper: bd
        ? {
            chopper: bd.chopper,
            minResistanceOhm: bd.Rmin ?? bd.Rrec ?? null,
            powerW10: bd.P10 ?? null,
            powerW50: bd.P50 ?? null,
          }
        : null,
    },
    speedRange: {
      ok: !!c.range.ok,
      worstFrequencyHz: r(c.range.worst.f, 1),
      worstUtilisationPct: r(c.range.worst.util * 100, 0),
      cooling: c.range.cool.name,
    },
    energy:
      e && L.quad
        ? {
            method: e.thr.name,
            throttlingMwh: r(e.Eth / 1000, 1),
            vfdMwh: r(e.Ev / 1000, 1),
            savingMwh: r(e.dE / 1000, 1),
            savingPct: r(e.pct, 1),
            savingMoney: r(e.money, 0),
            paybackYears: round(e.payback, 2),
            rows: e.rows.map((row: any) => ({
              flowPct: row.q,
              hours: row.h,
              throttlingKw: r(row.Pth, 1),
              vfdKw: r(row.Pv, 1),
              speedPct: r(row.n, 1),
            })),
          }
        : null,
    pump: c.pump
      ? {
          flowM3h: r(c.pump.Q1, 1),
          headM: r(c.pump.H1, 1),
          zeroFlowFrequencyHz: r(c.pump.rmin * md.f, 1),
          npshOk: c.pump.npOk ?? null,
        }
      : null,
    checks: c.checks.map((ch: any) => ({ section: ch.page, level: ch.level, text: ch.text })),
  }
}

/** Catalogue of VFD models the selection draws from (ESQ series, from the manufacturer's manuals). */
export function vfdCatalog(): readonly {
  series: string
  model: string
  U: number
  duty: string
  I: number
  P: number
}[] {
  return R.CATALOG
}

export { num as toNumber }
export * from './formulas'
export * from './trends'
