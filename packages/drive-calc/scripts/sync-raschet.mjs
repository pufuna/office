#!/usr/bin/env node
// Regenerates src/vendor/raschet/ from a checkout of pufuna/raschet.
//
//   node packages/drive-calc/scripts/sync-raschet.mjs <path-to-raschet>
//
// raschet ships browser globals wrapped in UMD IIFEs (window.Raschet). The
// calculation core is copied verbatim and only its wrapper is rewritten into an
// ES module; the DOM-free part of the UI (default inputs, presets, compute(),
// checks(), cable naming) is cut out of js/app.js between stable markers. Every
// marker must match exactly once, so an upstream restructure fails loudly here
// instead of producing a silently broken module.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const src = process.argv[2]
if (!src) {
  console.error('Usage: node sync-raschet.mjs <path-to-raschet-checkout>')
  process.exit(2)
}
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'vendor', 'raschet')
mkdirSync(outDir, { recursive: true })

let revision = 'unknown'
try {
  revision = execFileSync('git', ['-C', src, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
} catch {}

const read = (rel) => readFileSync(join(src, rel), 'utf8').replace(/^\uFEFF/, '')
const header = (rel) =>
  `// Generated from pufuna/raschet ${rel} @ ${revision} by scripts/sync-raschet.mjs — do not edit.\n`

function replaceOnce(text, pattern, replacement, what) {
  const matches = text.match(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'))
  if (!matches || matches.length !== 1) {
    throw new Error(
      `${what}: expected exactly one match for ${pattern}, got ${matches?.length ?? 0}`,
    )
  }
  return text.replace(pattern, replacement)
}

function unwrapUmd(text, rel, tailPattern, exportLine) {
  let out = replaceOnce(text, /^\(function \(root\) \{\n/m, '', `${rel} head`)
  out = replaceOnce(out, tailPattern, exportLine, `${rel} tail`)
  return header(rel) + out
}

const write = (name, text) => writeFileSync(join(outDir, name), text)

write(
  'engine.js',
  unwrapUmd(
    read('js/engine.js'),
    'js/engine.js',
    /\n {2}if \(typeof module[^\n]*\n {2}else \{ root\.Raschet[^\n]*\n\}\)\(this\);\n?$/,
    '\n  export default api;\n',
  ),
)

let extra = unwrapUmd(
  read('js/extra.js'),
  'js/extra.js',
  /\n {2}if \(typeof module[^\n]*\n {2}else Object\.assign\(root\.Raschet, api\);\n\}\)\(this\);\n?$/,
  '\n  export default api;\n',
)
extra = replaceOnce(
  extra,
  /var E = typeof module !== 'undefined' && module\.exports \? require\('\.\/engine\.js'\) : root\.Raschet;/,
  'var E = engine;',
  'js/extra.js engine import',
)
write('extra.js', extra.replace(/\n/, "\nimport engine from './engine.js';\n"))

write(
  'catalog.js',
  unwrapUmd(
    read('js/data/catalog.js'),
    'js/data/catalog.js',
    /\n {2}if \(typeof module[^\n]*\n\}\)\(this\);\n?$/,
    '\n  export default CATALOG;\n',
  ),
)

write(
  'esq-extra.js',
  unwrapUmd(
    read('js/data/esq_extra.js'),
    'js/data/esq_extra.js',
    /\n {2}if \(typeof module[^\n]*\n {2}else \{ root\.Raschet[^\n]*\n\}\)\(this\);\n?$/,
    '\n  export default { BRAKE: BRAKE, PERIPH: PERIPH };\n',
  ),
)

// ---- DOM-free slices of js/app.js ----
const app = read('js/app.js').split('\n')
function lineOf(pattern, from = 0) {
  const hits = []
  app.forEach((line, i) => {
    if (i >= from && pattern.test(line)) hits.push(i)
  })
  if (hits.length === 0) throw new Error(`js/app.js: marker ${pattern} not found`)
  return hits[0]
}
/** lines [start, end] inclusive, where end is the first line matching endPattern after start */
function slice(startPattern, endPattern) {
  const start = lineOf(startPattern)
  const end = lineOf(endPattern, start + 1)
  return app.slice(start, end + 1).join('\n')
}

const defaults = slice(/^ {2}var DEFAULT_SHARED = \{/, /^ {2}\];$/)
const cloneFn = app[lineOf(/^ {2}function clone\(o\)/)]
const mergeFn = slice(/^ {2}function merge\(dst, src\)/, /^ {2}\}$/)
const fmtF = slice(/^ {2}function f\(x, d\) \{/, /^ {2}\}$/)
const fmtFa = slice(/^ {2}function fa\(x\) \{/, /^ {2}\}$/)
const secName = app[lineOf(/^ {2}function secName\(s\)/)]
// compute() … cableMark(): from num() up to the banner that opens the page list
const numStart = lineOf(/^ {2}function num\(v, d\)/)
const pagesBanner = lineOf(/^ {2}\/\/ Страницы$/, numStart) - 1
const calc = app.slice(numStart, pagesBanner).join('\n')

const project = `${header('js/app.js (calculation part)')}import engine from './engine.js';
import extra from './extra.js';
import CATALOG from './catalog.js';
import esqExtra from './esq-extra.js';

  var R = Object.assign({}, engine, extra, { CATALOG: CATALOG, BRAKE: esqExtra.BRAKE, PERIPH: esqExtra.PERIPH });
  var CAT = R.CATALOG;
  var state = null;

${defaults}

${cloneFn}
${mergeFn}

${fmtF}
${fmtFa}
${secName}

${calc}

  export {
    R, DEFAULT_SHARED, DEFAULT_DRIVE, SHARED_KEYS, PRESETS, clone, merge, f, fa, num,
    compute, checks, cableName, cableMark, peSection, vkey
  };
`
write('project.js', project)

// The vendored code is untyped ES5; src/index.ts is the typed boundary.
write(
  'project.d.ts',
  `${header('js/app.js (calculation part)')}/* eslint-disable */
export declare const R: any
export declare const DEFAULT_SHARED: any
export declare const DEFAULT_DRIVE: any
export declare const SHARED_KEYS: string[]
export declare const PRESETS: { name: string; data: any }[]
export declare function clone<T>(o: T): T
export declare function merge(dst: any, src: any): any
export declare function f(x: number | null | undefined, d?: number): string
export declare function fa(x: number | null | undefined): string
export declare function num(v: unknown, d: number): number
export declare function compute(s: any, light?: boolean): any
export declare function checks(c: any): { page: string; level: string; text: string }[]
export declare function cableName(b: any, o: any, hv: boolean, motor: boolean): string
export declare function cableMark(o: any, hv: boolean, motor: boolean, screened?: boolean): string
export declare function peSection(s: number): number
export declare function vkey(c: any): string
`,
)

console.log(`raschet @ ${revision} → ${outDir}`)
