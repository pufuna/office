import type { AgentSkill, ToolExecution } from '@genoffice/agent-core'
import { computeDrive, drivePreset, drivePresetNames, vfdCatalog, type DriveInput } from './index'
import { DRIVE_FORMULAS, evalDriveFormula, type FormulaArg } from './formulas'
import { analyzeEsqTrend, isEsqTrendCsv } from './trends'
import { R } from './motor'

export const DRIVE_CALCULATE_TOOL = 'drive_calculate'
export const DRIVE_REFERENCE_TOOL = 'drive_reference'
export const DRIVE_FORMULA_TOOL = 'drive_formula'
export const DRIVE_TREND_TOOL = 'drive_trend_analyze'

export interface DriveAttachment {
  path: string
  name: string
  ext: string
}

export interface DriveCalcSkillDeps {
  /** chat attachments, same list the attachments skill shows (index-aligned) */
  attachments?: () => readonly DriveAttachment[]
  /** whole text of one attachment; omit to hide drive_trend_analyze */
  readAttachmentText?: (path: string) => Promise<string>
}

/** Upper bound on one trend file read through the paged attachment channel. */
const MAX_TREND_CHARS = 64_000_000

/**
 * Adapts the apps' paged attachment read (path, offset, maxChars → slice) into
 * readAttachmentText: keeps reading until the reported total is reached.
 */
export function pagedTextReader(
  read: (
    path: string,
    offset: number,
    maxChars: number,
  ) => Promise<{ ok: boolean; error?: string; text?: string; totalChars?: number }>,
): (path: string) => Promise<string> {
  return async (path) => {
    let text = ''
    for (;;) {
      const page = await read(path, text.length, 1_000_000)
      if (!page.ok) throw new Error(page.error ?? 'read failed')
      const slice = page.text ?? ''
      text += slice
      const total = page.totalChars ?? text.length
      if (slice.length === 0 || text.length >= total) return text
      if (text.length > MAX_TREND_CHARS) throw new Error('trend file is too large')
    }
  }
}

const SYSTEM_PROMPT = `## Variable-frequency drive engineering (ЧРП)
You have a verified engineering calculator for induction/synchronous motor drives 0.4–10 kV (the raschet model: motor equivalent circuit fitted to the nameplate, ESQ VFD catalogue, ГОСТ Р 50571.5.52 / ПУЭ cable tables, ГОСТ 32144-2013 harmonic limits, ESQ manuals for derating and braking).
- For any question that needs drive numbers — VFD selection, motor current/torque, start-up (DOL / soft starter / VFD), cables and voltage drop, reflected wave and filters, breaker/protection settings, harmonics THDi/KU, regenerative braking and resistor, motor heating at low speed, pump operating point, energy saving and payback, cascade start — call ${DRIVE_CALCULATE_TOOL} instead of estimating. Never invent catalogue models, cable sections or check results.
- Fill only what the user gave; omitted fields fall back to typical values. Say which inputs were assumed (the report marks estimated inertia). Use ${DRIVE_REFERENCE_TOOL} to look up the allowed load types, cable laying methods, rectifier topologies, energy-saving modes, example systems and catalogue models.
- For one number (motor current, torque, slip, cable voltage drop, THDi, pump frequency at a flow, braking resistor limit) use ${DRIVE_FORMULA_TOOL}. The same functions exist as spreadsheet formulas in Sheets (e.g. =ДВ.ТОК(75;380;0,86;94,5), =ЧРП.ПОДБОР(75;380;"насос")) — suggest them when the user builds a calculation workbook.
- Report results with units and decimal commas, state the checks with level warn/err first, and remind that the calculation is preliminary: final equipment choice follows the manufacturers' documentation and the project.
- When writing a document or workbook from the results (пояснительная записка, спецификация, кабельный журнал, расчёт энергосбережения), take every figure from the tool output.`

const TREND_PROMPT = `
- ESQ Service trend logs (CSV with a "Дата и время;…" header) can be analysed with ${DRIVE_TREND_TOOL}: start-ups, channel min/mean/max and — given the motor nameplate — identification of the load torque curve Mc(n) and the total inertia J, which can then be fed back into ${DRIVE_CALCULATE_TOOL} (load.J, load.k, load.m0).`

function ok(output: unknown, summary: string): ToolExecution {
  return { output: JSON.stringify(output), mutated: false, summary }
}

function fail(message: string, summary: string): ToolExecution {
  return { output: message, isError: true, summary }
}

function reference(topic: string): unknown {
  switch (topic) {
    case 'load_types':
      return Object.entries(R.LOAD_TYPES).map(([key, t]: [string, any]) => ({
        key,
        name: t.name,
        quadratic: t.quad,
        typicalOverloadPct: t.ovl,
        overloadTimeS: t.tovl,
      }))
    case 'cable_methods':
      return Object.entries(R.INSTALL).map(([key, m]: [string, any]) => ({
        key,
        name: m.name,
        lowVoltage: m.lv,
        inGround: m.ground,
      }))
    case 'topologies':
      return Object.entries(R.TOPOLOGIES).map(([key, t]: [string, any]) => ({ key, name: t.name }))
    case 'energy_modes':
      return [
        ...Object.entries(R.THROTTLE).map(([key, t]: [string, any]) => ({ key, name: t.name })),
        { key: 'pump-curve', name: 'Насос по паспортным кривым Q–H (нужен блок pump)' },
      ]
    case 'protection_devices':
      return Object.entries(R.DEVICES).map(([key, d]: [string, any]) => ({ key, name: d.name }))
    case 'presets':
      return drivePresetNames().map((name, index) => ({ index, name }))
    case 'formulas':
      return DRIVE_FORMULAS.map((f) => ({
        name: f.name,
        alias: f.alias,
        description: f.description,
        args: f.args.map(
          (a) => `${a.optional ? '[' : ''}${a.name}${a.optional ? ']' : ''}: ${a.detail}`,
        ),
        example: f.example,
      }))
    default:
      return null
  }
}

function catalog(voltage: unknown, series: unknown): unknown {
  const U = Number(voltage)
  const items = vfdCatalog().filter(
    (c) =>
      (!Number.isFinite(U) || U <= 0 || Math.abs(c.U - R.voltageClass(U / 1000)) < 1e-6) &&
      (!series || String(c.series).toLowerCase().includes(String(series).toLowerCase())),
  )
  return {
    series: [...new Set(vfdCatalog().map((c) => c.series))],
    models: items.slice(0, 120).map((c) => ({
      series: c.series,
      model: c.model,
      voltageKv: c.U,
      duty: c.duty,
      currentA: c.I,
      powerKw: c.P,
    })),
    truncated: items.length > 120,
  }
}

export function createDriveCalcSkill(deps: DriveCalcSkillDeps = {}): AgentSkill {
  const trendsEnabled = !!(deps.attachments && deps.readAttachmentText)
  const tools: AgentSkill['tools'] = [
    {
      name: DRIVE_CALCULATE_TOOL,
      description:
        'Full engineering calculation of one variable-frequency drive: VFD selection from the ESQ catalogue, start-up simulation (DOL, soft starter, VFD), supply and motor cables, reflected wave, protection, harmonics, braking, speed range, duty cycle, pump, energy saving, cascade start, plus a list of checks (ok/info/warn/err). Input groups use raschet field names; every field is optional.',
      inputSchema: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            description:
              'start from an example system (index or name fragment, see drive_reference presets), then apply the groups below on top',
          },
          name: { type: 'string', description: 'drive name, e.g. "Насос Н-1"' },
          motor: {
            type: 'object',
            description:
              'type "async"|"sync", P kW, U V line voltage (380, 660, 690, 6000, 10000), f Hz, n rpm, cos, eff %, I A, kI (Iп/Iн), kMp (Mп/Mн), kMk (Mк/Mн), J kg·m²',
          },
          load: {
            type: 'object',
            description:
              'type (pump, fan, screw, piston, conveyor, mill, crusher, hoist, extruder, custom), P kW at rated speed, ovlPct %, ovlTime s, startPct % of motor Mn, brk breakaway p.u., k exponent and m0 share (custom), J kg·m² referred to the motor shaft',
          },
          net: {
            type: 'object',
            description:
              'mode "sk" with Sk MVA, or mode "tr" with trS kVA and trUk %; bg background KU %; tk s fault clearing; Qc kvar capacitor bank and detune % (resonance check); genS kVA diesel generator',
          },
          vfd: {
            type: 'object',
            description:
              'series ("*" any, or e.g. "ESQ-770", "ESQ F 790", "ESQ F ME800"), nMotors, margin (1.05 = 5 % reserve), amb °C, alt m, control "vf"|"vector", topo LV rectifier (6p, 6pL, 12p, 18p, afe)',
          },
          sim: {
            type: 'object',
            description:
              'tAcc s, tDec s, tHold s, fSet Hz, boost %, softU0 %, softT s, softI (×In) for the soft starter',
          },
          cin: {
            type: 'object',
            description:
              'supply cable: mat "cu"|"al", insul "xlpe"|"pvc", method (C, E, D1 for ≤1 kV; air, ground for 6–10 kV), tAmb °C, nGroup, L m, dUmax %, norm "gost"|"pue", rho K·m/W, depth m',
          },
          cout: {
            type: 'object',
            description:
              'motor cable: same fields as cin plus screened "yes"|"no", ins "std"|"inv" (inverter-duty winding), tr µs',
          },
          prot: {
            type: 'object',
            description:
              'device (mccb, mcb-C, mcb-D, fuse-gG, fuse-aR), kInst, cover "yes"|"no", precharge "yes"|"no" (HV)',
          },
          brake: { type: 'object', description: 'n2 rpm final speed, tDec s, cycle s' },
          duty: {
            type: 'object',
            description: 'cool "self"|"forced", fmin Hz, fmax Hz, rows [[t s, M % Mn, n % nn], …]',
          },
          pump: {
            type: 'object',
            description:
              'on "yes", Qd m³/h and Hd m design point, Hst m static head, rho, npsha m, pts [[Q m³/h, H m, eta %, NPSHr m], …] (≥2 points)',
          },
          casc: { type: 'object', description: 'N motors, sync "yes"|"no", pause s' },
          energy: {
            type: 'object',
            description:
              'mode (pump-throttle, fan-damper, fan-vanes, bypass, pump-curve), hs % static head, tariff ₽/kWh, price ₽ of the drive, rows [[flow %, hours/year], …]',
          },
          simulate: {
            type: 'boolean',
            description: 'run the start-up simulations (default true; false is faster)',
          },
        },
      },
    },
    {
      name: DRIVE_REFERENCE_TOOL,
      description:
        'Reference lists for drive_calculate and the spreadsheet formulas: load types, cable laying methods, rectifier topologies, energy-saving modes, protection devices, example systems, formula list, or the ESQ VFD catalogue for a voltage/series.',
      inputSchema: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: [
              'load_types',
              'cable_methods',
              'topologies',
              'energy_modes',
              'protection_devices',
              'presets',
              'formulas',
              'catalog',
            ],
          },
          voltage: { type: 'number', description: 'catalog: motor voltage, V' },
          series: { type: 'string', description: 'catalog: series name fragment' },
        },
        required: ['topic'],
      },
    },
    {
      name: DRIVE_FORMULA_TOOL,
      description:
        'Evaluate one engineering function (the same as the Sheets formulas), e.g. {"function":"ДВ.ТОК","args":[75,380,0.86,94.5]}. Ranges are passed as arrays of rows. See drive_reference formulas for the list.',
      inputSchema: {
        type: 'object',
        properties: {
          function: { type: 'string', description: 'Russian name or English alias' },
          args: { type: 'array', description: 'arguments in order', items: {} },
        },
        required: ['function', 'args'],
      },
    },
  ]
  if (trendsEnabled) {
    tools.push({
      name: DRIVE_TREND_TOOL,
      description:
        'Analyse an attached ESQ Service trend log (CSV): start-ups, channel statistics, and with the motor nameplate the load torque curve Mc(ω) = A + B·(ω/ωn)^k and the total inertia J.',
      inputSchema: {
        type: 'object',
        properties: {
          index: {
            type: 'integer',
            description: 'attachment index (0-based, see the attachment list)',
          },
          motor: {
            type: 'object',
            description: 'motor nameplate, same fields as drive_calculate motor',
          },
        },
        required: ['index'],
      },
    })
  }

  return {
    id: 'drive-calc',
    systemPrompt: SYSTEM_PROMPT + (trendsEnabled ? TREND_PROMPT : ''),
    tools,
    executeTool: async (call) => {
      const input = call.input
      try {
        switch (call.name) {
          case DRIVE_CALCULATE_TOOL: {
            const { preset, simulate, ...groups } = input as Record<string, any>
            let base: DriveInput = {}
            if (preset !== undefined && preset !== '') {
              const found = drivePreset(
                /^\d+$/.test(String(preset)) ? Number(preset) : String(preset),
              )
              if (!found)
                return fail(`Unknown preset "${preset}" (see drive_reference presets)`, 'ЧРП')
              base = found
            }
            const merged: any = { ...base }
            for (const [key, value] of Object.entries(groups)) {
              merged[key] =
                value && typeof value === 'object' && !Array.isArray(value)
                  ? { ...(merged[key] ?? {}), ...value }
                  : value
            }
            const report = computeDrive(merged, simulate !== false)
            const label = report.vfd.selected
              ? `${report.motor.powerKw} кВт → ${report.vfd.selected.model}`
              : `${report.motor.powerKw} кВт`
            return ok(report, `Расчёт ЧРП: ${label}`)
          }
          case DRIVE_REFERENCE_TOOL: {
            const topic = String(input.topic ?? '')
            const data =
              topic === 'catalog' ? catalog(input.voltage, input.series) : reference(topic)
            if (data === null) return fail(`Unknown topic "${topic}"`, 'Справочник ЧРП')
            return ok(data, `Справочник ЧРП: ${topic}`)
          }
          case DRIVE_FORMULA_TOOL: {
            const name = String(input.function ?? '')
            const args = Array.isArray(input.args) ? (input.args as FormulaArg[]) : []
            const value = evalDriveFormula(name, ...args)
            return ok({ function: name, value }, `${name} = ${value}`)
          }
          case DRIVE_TREND_TOOL: {
            const list = deps.attachments?.() ?? []
            const att = list[Number(input.index)]
            if (!att || !deps.readAttachmentText) {
              return fail('invalid attachment index (see the attachment list)', 'Тренды ESQ')
            }
            const text = await deps.readAttachmentText(att.path)
            if (!isEsqTrendCsv(text)) {
              return fail(
                `${att.name} is not an ESQ Service trend log (no "Дата и время;…" header row)`,
                'Тренды ESQ',
              )
            }
            const motor =
              input.motor && typeof input.motor === 'object' ? (input.motor as any) : undefined
            return ok(analyzeEsqTrend(text, motor), `Тренды ESQ: ${att.name}`)
          }
          default:
            return fail(`unknown tool: ${call.name}`, call.name)
        }
      } catch (error) {
        return fail(error instanceof Error ? error.message : String(error), call.name)
      }
    },
  }
}
