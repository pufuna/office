import { R, num } from './vendor/raschet/project.js'

export { R }

/** Motor nameplate → raschet's derived motor (md) and equivalent-circuit model (mdl), with compute()'s defaults. */
export function driveStateMotor(m: Record<string, unknown> = {}): { md: any; mdl: any } {
  const md = R.motorDerive({
    type: m.type === 'sync' ? 'sync' : 'async',
    P: num(m.P, 1),
    U: num(m.U, 380),
    f: num(m.f, 50),
    n: num(m.n, 1450),
    cos: num(m.cos, 0.85),
    eff: num(m.eff, 93),
    I: m.I ?? null,
    kI: m.kI ?? null,
    kMp: m.kMp ?? null,
    kMk: m.kMk ?? null,
    J: m.J ?? null,
  })
  return { md, mdl: R.motorModel(md) }
}
