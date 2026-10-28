import { describe, expect, it } from 'vitest'
import {
  analyzeEsqTrend,
  computeDrive,
  drivePreset,
  drivePresetNames,
  evalDriveFormula,
  isEsqTrendCsv,
  parseEsqTrend,
} from '../src/index'
import { createDriveCalcSkill } from '../src/agent-skill'

describe('computeDrive', () => {
  it('sizes the default 75 kW pump drive end to end', () => {
    const report = computeDrive()
    expect(report.motor.powerKw).toBe(75)
    expect(report.motor.ratedCurrentA).toBeGreaterThan(130)
    expect(report.motor.ratedCurrentA).toBeLessThan(145)
    expect(report.vfd.selected).not.toBeNull()
    expect(report.vfd.selected!.deratedCurrent).toBeGreaterThanOrEqual(report.vfd.requiredCurrentA)
    expect(report.supplyCable?.name).toMatch(/мм²$/)
    expect(report.motorCable?.name).toMatch(/\+3×/)
    expect(report.start?.vfd.stalled).toBe(false)
    expect(report.energy?.savingMwh).toBeGreaterThan(0)
    expect(report.checks.length).toBeGreaterThan(5)
    expect(report.checks.every((c) => ['ok', 'info', 'warn', 'err'].includes(c.level))).toBe(true)
  })

  it('handles a 6 kV fan with HV protection settings', () => {
    const report = computeDrive(drivePreset('Дымосос')!, false)
    expect(report.motor.highVoltage).toBe(true)
    expect(report.protection.kind).toBe('hv')
    expect(report.reflectedWave).toBeNull()
    expect(report.start).toBeNull()
    expect(report.vfd.selected?.model).toMatch(/ME800/)
  })

  it('every bundled example computes without throwing', () => {
    const names = drivePresetNames()
    expect(names.length).toBeGreaterThanOrEqual(5)
    names.forEach((_, i) => {
      expect(() => computeDrive(drivePreset(i)!, false)).not.toThrow()
    })
  })

  it('a larger motor never selects a smaller VFD current', () => {
    const small = computeDrive({ motor: { P: 55, I: null } }, false)
    const large = computeDrive({ motor: { P: 160, I: null }, load: { P: 140 } }, false)
    expect(large.vfd.selected!.ratedCurrent).toBeGreaterThan(small.vfd.selected!.ratedCurrent)
  })
})

describe('drive formulas', () => {
  it('motor current and torque follow the textbook formulas', () => {
    const I = evalDriveFormula('ДВ.ТОК', 75, 380, 0.86, 94.5) as number
    expect(I).toBeCloseTo(75000 / (Math.sqrt(3) * 380 * 0.86 * 0.945), 6)
    expect(evalDriveFormula('MOTOR.TORQUE', 75, 1480)).toBeCloseTo(483.9, 1)
    expect(evalDriveFormula('ДВ.СКОЛЬЖЕНИЕ', 1480)).toBeCloseTo(1.333, 2)
  })

  it('accepts decimal-comma strings and ranges, and reports spreadsheet errors', () => {
    expect(evalDriveFormula('ДВ.ТОК', '75', '380', '0,86', '94,5')).toBeCloseTo(140.2, 1)
    expect(evalDriveFormula('ДВ.ТОК', [[75]], 380, 0.86, 94.5)).toBeCloseTo(140.2, 1)
    expect(evalDriveFormula('ДВ.ТОК', 'abc', 380, 0.86, 94.5)).toBe('#VALUE!')
    expect(evalDriveFormula('ДВ.ТОК', -1, 380, 0.86, 94.5)).toBe('#NUM!')
    expect(evalDriveFormula('НЕТ.ТАКОЙ', 1)).toBe('#NAME?')
  })

  it('selects a catalogue VFD and reads its derated current', () => {
    const model = evalDriveFormula('ЧРП.ПОДБОР', 75, 380, 'насос') as string
    expect(model).toMatch(/^ESQ/)
    const nominal = evalDriveFormula('ЧРП.ТОК', model) as number
    const hot = evalDriveFormula('ЧРП.ТОК', model, '', 50) as number
    expect(nominal).toBeGreaterThan(140)
    expect(hot).toBeCloseTo(nominal * 0.7, 6)
  })

  it('cables, harmonics, braking, pump and energy', () => {
    expect(evalDriveFormula('КАБЕЛЬ.СЕЧЕНИЕ', 140, 0.4, 80, 'cu', 'E', 3)).toMatch(/^4×\d+ мм²$/)
    expect(evalDriveFormula('КАБЕЛЬ.СЕЧЕНИЕ', 900, 0.4, 50)).toMatch(/^\d×\[4×\d+\] мм²$/)
    const drop = evalDriveFormula('КАБЕЛЬ.ПОТЕРЯ', 140, 0.4, 80, 50) as number
    expect(drop).toBeGreaterThan(1)
    expect(drop).toBeLessThan(3)
    expect(evalDriveFormula('ГАРМ.THDI', '6p')).toBeGreaterThan(
      evalDriveFormula('ГАРМ.THDI', '6pL') as number,
    )
    expect(evalDriveFormula('ГАРМ.THDI', '12-p')).toBeLessThan(15)
    expect(evalDriveFormula('ГАРМ.KU', '6pL', 80, 0.4, 20)).toBeGreaterThan(0)
    expect(evalDriveFormula('ТОРМ.ПОРОГ', 380)).toBe(700)
    expect(evalDriveFormula('ТОРМ.RМАКС', 49, 380)).toBeCloseTo(10, 6)
    expect(evalDriveFormula('НАСОС.ЧАСТОТА', 100)).toBeCloseTo(50, 9)
    expect(evalDriveFormula('НАСОС.ЧАСТОТА', 0, 36)).toBeCloseTo(30, 9)
    expect(evalDriveFormula('НАСОС.МОЩНОСТЬ', 100, 50)).toBeCloseTo(12.5, 9)
    const saving = evalDriveFormula('ЭКОНОМИЯ.КВТЧ', 65, [
      [100, 800],
      [80, 2500],
      [60, 1200],
    ]) as number
    expect(saving).toBeGreaterThan(0)
  })
})

function trendCsv(): string {
  const lines = ['\uFEFFНВ ПЧ ESQ F790;адрес 1', 'Дата и время;F вых, Гц;I вых, А;M вых, %;Работа']
  const t0 = Date.UTC(2026, 9, 1, 10, 0, 0)
  for (let i = 0; i < 400; i++) {
    const t = i * 0.1
    const f = t < 1 ? 0 : Math.min(50, (t - 1) * 5)
    const accel = t >= 1 && f < 50 ? 30 : 0
    const torque = 0.9 * (f / 50) ** 2 * 100 + accel
    const stamp = new Date(t0 + t * 1000).toISOString().replace('T', ' ').replace('Z', '')
    lines.push(
      `${stamp};${f.toFixed(2).replace('.', ',')};${(60 + torque).toFixed(1)};${torque.toFixed(1)};${t >= 1 ? 1 : 0}`,
    )
  }
  return lines.join('\r\n')
}

describe('ESQ Service trends', () => {
  it('parses the CSV and finds the start-up', () => {
    const csv = trendCsv()
    expect(isEsqTrendCsv(csv)).toBe(true)
    expect(isEsqTrendCsv('a;b\n1;2')).toBe(false)
    const trend = parseEsqTrend(csv)
    expect(trend.device).toBe('ESQ F 790')
    expect(trend.channels).toEqual(expect.arrayContaining(['f', 'I', 'M', 'run']))
    const analysis = analyzeEsqTrend(trend)
    expect(analysis.samples).toBe(400)
    expect(analysis.sampleStepS).toBeCloseTo(0.1, 3)
    expect(analysis.starts).toHaveLength(1)
    expect(analysis.starts[0]!.finalFrequencyHz).toBeCloseTo(50, 1)
    expect(analysis.stats.f!.max).toBeCloseTo(50, 1)
    expect(analysis.identification).toBeNull()
  })

  it('identifies the load curve when the motor is given', () => {
    const analysis = analyzeEsqTrend(trendCsv(), { P: 75, U: 380, n: 1480, cos: 0.86, eff: 94.5 })
    expect(analysis.identification?.torqueSource).toBe('M вых')
    expect(analysis.identification?.torqueCurve).not.toBeNull()
  })

  it('rejects a CSV that is not a trend log', () => {
    expect(() => parseEsqTrend('x;y\n1;2')).toThrow(/ESQ Service/)
  })
})

describe('agent skill', () => {
  it('exposes calculator tools and runs them', async () => {
    const skill = createDriveCalcSkill()
    expect(skill.tools.map((t) => t.name)).toEqual([
      'drive_calculate',
      'drive_reference',
      'drive_formula',
    ])
    const calc = await skill.executeTool({
      id: '1',
      name: 'drive_calculate',
      input: { motor: { P: 110, U: 380, n: 1485 }, load: { type: 'fan', P: 100 }, simulate: false },
    })
    expect(calc.isError).toBeFalsy()
    const report = JSON.parse(calc.output)
    expect(report.vfd.selected.model).toMatch(/^ESQ/)
    expect(calc.summary).toContain('110 кВт')

    const ref = await skill.executeTool({
      id: '2',
      name: 'drive_reference',
      input: { topic: 'catalog', voltage: 6000 },
    })
    expect(JSON.parse(ref.output).models.every((m: any) => m.voltageKv === 6)).toBe(true)

    const formula = await skill.executeTool({
      id: '3',
      name: 'drive_formula',
      input: { function: 'ДВ.МОМЕНТ', args: [75, 1480] },
    })
    expect(JSON.parse(formula.output).value).toBeCloseTo(483.9, 1)

    const preset = await skill.executeTool({
      id: '4',
      name: 'drive_calculate',
      input: { preset: 'нет такого' },
    })
    expect(preset.isError).toBe(true)
  })

  it('analyses an attached trend log', async () => {
    const skill = createDriveCalcSkill({
      attachments: () => [{ path: '/tmp/t.csv', name: 't.csv', ext: 'csv' }],
      readAttachmentText: async () => trendCsv(),
    })
    expect(skill.tools.map((t) => t.name)).toContain('drive_trend_analyze')
    const res = await skill.executeTool({
      id: '1',
      name: 'drive_trend_analyze',
      input: { index: 0 },
    })
    expect(res.isError).toBeFalsy()
    expect(JSON.parse(res.output).starts).toHaveLength(1)
    const bad = await skill.executeTool({
      id: '2',
      name: 'drive_trend_analyze',
      input: { index: 5 },
    })
    expect(bad.isError).toBe(true)
  })
})
