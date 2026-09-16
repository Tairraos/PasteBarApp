#!/usr/bin/env node
/**
 * TypeScript typecheck ratchet.
 *
 * History: `tsc --noEmit` reported 408 errors when this harness started — 301 of them in
 * vendored react-twitter-embed cypress tests, most of the rest in the 186 unreachable files
 * W4a deleted — so the gate shipped as ADVISORY (DECISIONS D-005) because failing the build
 * on debt unrelated to a change blocks every PR.
 *
 * That changed. The dependency prune deleted the hoisted transitive packages the vendored
 * cypress tests were silently resolving, which forced the vendored tests out of the
 * tsconfig — and with them the noise. The remaining errors are 9, all in vendored library
 * code under `src/components/libs/**` (GOLDEN-RULES R7: vendored code is out of scope for
 * every gate). Project code compiles clean.
 *
 * This gate therefore enforces: the error count may not grow, and no file outside the
 * vendored trees may ever appear in the error list. New type errors in project code fail
 * the PR immediately, which is what D-005's exit condition asked for.
 *
 * `--strict` still exists for CI: it fails on ANY error including vendored ones, as a
 * scheduled reminder that the vendored tail exists.
 *
 * The count may only go DOWN (docs/harness/GOLDEN-RULES.md R9).
 *
 * Usage:
 *   node scripts/harness/typecheck-ratchet.mjs            # enforce
 *   node scripts/harness/typecheck-ratchet.mjs --strict   # any error fails (vendored too)
 *   node scripts/harness/typecheck-ratchet.mjs --report   # list every error
 *   node scripts/harness/typecheck-ratchet.mjs --update   # rewrite the baseline
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BASELINE = path.join(ROOT, 'docs/harness/typecheck-baseline.json')
const ARGS = new Set(process.argv.slice(2))

// Vendored trees: errors here are out of scope (GOLDEN-RULES R7) and cannot be fixed
// without editing third-party copies, which R7 forbids.
const VENDORED = /src\/components\/libs\//

let raw
try {
  raw = execFileSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (e) {
  raw = `${e.stdout ?? ''}${e.stderr ?? ''}`
}

// tsc's pretty output: `<file>(line,col): error TSxxxx: message` per line (with
// --pretty=false this is stable); the default reporter also emits file/line pairs.
const errors = []
for (const m of raw.matchAll(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm)) {
  errors.push({ file: m[1], line: Number(m[2]), code: m[4], message: m[5] })
}

// tsc exits 0 for "no emit" even when there are errors? No: it exits 2. But if tsc itself
// crashed (bad tsconfig), there would be no `error TS` lines at all and a non-zero exit —
// treat a crash as a gate failure rather than a pass.
if (errors.length === 0 && !/error/i.test(raw)) {
  // Clean: zero errors anywhere.
  console.log('typecheck-ratchet: OK — no TypeScript errors')
  process.exit(0)
}

const project = errors.filter(e => !VENDORED.test(e.file))
const vendored = errors.filter(e => VENDORED.test(e.file))

if (ARGS.has('--update')) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        $comment:
          'TypeScript ratchet baseline. Project code must stay at zero errors; the count ' +
          'may only go DOWN (docs/harness/GOLDEN-RULES.md R9). Vendored files ' +
          '(src/components/libs/**) are recorded per-file because R7 forbids editing them. ' +
          'Regenerate: node scripts/harness/typecheck-ratchet.mjs --update',
        updatedFor: new Date().toISOString().slice(0, 10),
        total: errors.length,
        project: project.map(e => `${e.file}:${e.line} ${e.code}`),
        vendored: vendored.map(e => `${e.file} (${e.code})`),
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    `wrote docs/harness/typecheck-baseline.json (total ${errors.length}, ` +
      `project ${project.length}, vendored ${vendored.length})`
  )
  process.exit(0)
}

if (ARGS.has('--report')) {
  console.log(
    `errors: ${errors.length} (project ${project.length}, vendored ${vendored.length})\n`
  )
  for (const e of project)
    console.log(`  PROJECT  ${e.file}:${e.line} ${e.code} ${e.message.slice(0, 80)}`)
  console.log()
  for (const e of vendored) console.log(`  vendored ${e.file}:${e.line} ${e.code}`)
  console.log()
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null

const problems = []
if (!baseline) {
  problems.push('no baseline at docs/harness/typecheck-baseline.json (run with --update)')
} else {
  if (project.length > 0) {
    problems.push(
      `${project.length} type error(s) in PROJECT code — project code must compile clean`
    )
  }
  if (errors.length > baseline.total) {
    problems.push(`total errors ${errors.length} exceed baseline ${baseline.total}`)
  }
  // A vendored file that newly appears is a regression too (it means something new started
  // depending on broken vendored code).
  const baseFiles = new Set((baseline.vendored ?? []).map(s => s.split(' (')[0]))
  for (const e of vendored) {
    if (!baseFiles.has(e.file)) problems.push(`newly failing vendored file: ${e.file}`)
  }
}

if (ARGS.has('--strict') && errors.length > 0) {
  console.error(`TYPECHECK (STRICT): ${errors.length} errors\n`)
  for (const e of errors)
    console.error(`  ${e.file}:${e.line} ${e.code} ${e.message.slice(0, 90)}`)
  process.exit(1)
}

if (problems.length) {
  console.error('TYPECHECK RATCHET FAILED\n')
  for (const p of problems) console.error(`  ${p}`)
  for (const e of project)
    console.error(`  ${e.file}:${e.line} ${e.code} ${e.message.slice(0, 90)}`)
  console.error(
    '\nProject code must compile clean. Fix the errors; do not raise the baseline.\n' +
      'Full list: node scripts/harness/typecheck-ratchet.mjs --report'
  )
  process.exit(1)
}

console.log(
  `typecheck-ratchet: OK — ${errors.length} errors (project 0, vendored ${vendored.length}, ` +
    `baseline ${baseline.total})`
)
