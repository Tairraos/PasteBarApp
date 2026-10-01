#!/usr/bin/env node
/**
 * Dependency-audit ratchet.
 *
 * Not every gate can be "fail on the first finding". This repository has 51 known
 * production vulnerabilities (30 high) that have never been looked at — see ISSUE-032 —
 * and failing every PR on pre-existing advisories would block unrelated work while doing
 * nothing to fix them. The failure mode that actually matters is *silence*: nothing in
 * this repository had ever run an audit, partly because `--no-audit` was passed at every
 * install site.
 *
 * So this gate does two things:
 *
 *   default   Compare against docs/harness/audit-baseline.json and fail if the count GREW.
 *             A new advisory, or a new dependency that introduces known vulnerabilities,
 *             is caught immediately. Pre-existing debt does not block.
 *
 *   --strict  Fail on any high/critical advisory at all. This is what the scheduled CI job
 *             runs, so the debt is visible on a timer without blocking anyone's PR.
 *
 * The baseline may only shrink (docs/harness/GOLDEN-RULES.md R9).
 *
 * Usage:
 *   node scripts/harness/audit-ratchet.mjs             # ratchet check (PR-safe)
 *   node scripts/harness/audit-ratchet.mjs --strict    # any high/critical fails (scheduled)
 *   node scripts/harness/audit-ratchet.mjs --report    # list every advisory
 *   node scripts/harness/audit-ratchet.mjs --update    # rewrite the baseline
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BASELINE = path.join(ROOT, 'docs/harness/audit-baseline.json')
const ARGS = new Set(process.argv.slice(2))

// --prod: only what ships. Dev-only advisories are real but are a different problem
// with a different blast radius, and mixing them makes the number useless as a signal.
// pnpm exits non-zero when advisories exist; the JSON is still emitted.
let completed = false
let raw
try {
  raw = execFileSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  completed = true
} catch (e) {
  raw = e.stdout
  if (!raw) {
    console.error('audit-ratchet: pnpm audit produced no output')
    console.error(e.stderr?.slice(0, 500) ?? e.message)
    process.exit(1)
  }
}

let report
try {
  report = JSON.parse(raw)
} catch {
  console.error('audit-ratchet: could not parse pnpm audit output')
  process.exit(1)
}

// Distinguish "no advisories" from "could not ask": a security gate that reports OK
// because the network was down is worse than no gate — it is a false green that trains
// people to ignore the job.
//
// The signal: `pnpm audit --json` speaks the registry bulk-advisory format, an object
// keyed by advisory id under `advisories`. A completed audit with zero findings prints
// that key (empty) with exit 0; a failed audit either throws with no stdout or emits an
// `error` body. So an empty map is only believed when the command itself exited 0.
if (report.error || (!completed && !report.advisories)) {
  const detail =
    typeof report.error === 'object'
      ? JSON.stringify(report.error)
      : String(report.error ?? '')
  console.error('AUDIT GATE INCONCLUSIVE: the advisory database could not be reached.')
  if (detail) console.error(`  pnpm said: ${detail.slice(0, 300)}`)
  console.error(
    '\nThis is not a pass. Re-run when the registry is reachable:\n' +
      '  node scripts/harness/audit-ratchet.mjs --report'
  )
  process.exit(1)
}

// The bulk format is keyed by advisory, but one module can carry several advisories.
// Counts follow npm's v2 semantics: one entry per vulnerable module, with the module's
// severity set to the worst advisory affecting it.
const SEVERITY_RANK = { low: 1, moderate: 2, high: 3, critical: 4 }
const byModule = new Map()
for (const advisory of Object.values(report.advisories ?? {})) {
  const name = advisory.module_name
  const module = byModule.get(name) ?? { severity: 'low', titles: [], direct: false }
  if ((SEVERITY_RANK[advisory.severity] ?? 0) > SEVERITY_RANK[module.severity]) {
    module.severity = advisory.severity
  }
  if (
    advisory.title &&
    !module.titles.includes(advisory.title) &&
    module.titles.length < 2
  ) {
    module.titles.push(advisory.title)
  }
  for (const finding of advisory.findings ?? []) {
    if (finding.dev) continue
    // paths are dependency chains rooted at the workspace, joined with '>': a direct
    // dependency sits exactly one hop from the root ('.<name>').
    if ((finding.paths ?? []).some(p => p.split('>').length === 2)) module.direct = true
  }
  byModule.set(name, module)
}

const counts = { low: 0, moderate: 0, high: 0, critical: 0 }
for (const module of byModule.values()) counts[module.severity] += 1
const total = byModule.size
const high = counts.high + counts.critical

/** Direct dependencies only — these are the ones a human can act on. */
const actionable = [...byModule.entries()]
  .filter(([, m]) => m.direct && (m.severity === 'high' || m.severity === 'critical'))
  .map(([name, m]) => ({ name, severity: m.severity, titles: m.titles }))
  .sort((a, b) => a.name.localeCompare(b.name))

if (ARGS.has('--report')) {
  console.log(`production advisories: ${total} (high/critical: ${high})`)
  console.log(
    `  low ${counts.low ?? 0}  moderate ${counts.moderate ?? 0}  ` +
      `high ${counts.high ?? 0}  critical ${counts.critical ?? 0}`
  )
  console.log('\ndirect high/critical dependencies:')
  for (const d of actionable) {
    console.log(`  ${d.severity.padEnd(8)} ${d.name}`)
    for (const t of d.titles) console.log(`           ${t}`)
  }
  console.log()
}

if (ARGS.has('--update')) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        $comment:
          'Production dependency advisory baseline (pnpm audit --prod). Counts may only ' +
          'go DOWN (docs/harness/GOLDEN-RULES.md R9). A PR fails if the count grows; the ' +
          'scheduled CI job fails on any high/critical. See ISSUE-032 in docs/harness/ISSUES.md. ' +
          'Regenerate: node scripts/harness/audit-ratchet.mjs --update',
        updatedFor: new Date().toISOString().slice(0, 10),
        total,
        bySeverity: {
          low: counts.low ?? 0,
          moderate: counts.moderate ?? 0,
          high: counts.high ?? 0,
          critical: counts.critical ?? 0,
        },
        directHighCritical: actionable.map(d => d.name),
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    `wrote ${path.relative(ROOT, BASELINE)} (total ${total}, high/critical ${high})`
  )
  process.exit(0)
}

if (ARGS.has('--strict')) {
  if (high > 0) {
    console.error(`AUDIT (STRICT): ${high} high/critical production advisories\n`)
    for (const d of actionable) {
      console.error(`  ${d.severity.padEnd(8)} ${d.name}`)
      for (const t of d.titles) console.error(`           ${t}`)
    }
    console.error(
      `\n${total} total. Tracked as ISSUE-032. Fix by upgrading the direct dependencies; ` +
        `do not raise the baseline.`
    )
    process.exit(1)
  }
  console.log('audit-ratchet (strict): OK — no high/critical production advisories')
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(
    'audit-ratchet: no baseline at docs/harness/audit-baseline.json\n' +
      '  create one with: node scripts/harness/audit-ratchet.mjs --update'
  )
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
const problems = []

if (total > baseline.total) {
  problems.push(`production advisories ${total} exceeds baseline ${baseline.total}`)
}
for (const key of ['high', 'critical']) {
  const now = counts[key] ?? 0
  const allowed = baseline.bySeverity?.[key] ?? 0
  if (now > allowed) problems.push(`${key} advisories ${now} exceeds baseline ${allowed}`)
}

// A dependency that becomes newly vulnerable while the total stays flat is still a
// regression, so the set of direct high/critical packages is compared too.
const baselineDirect = new Set(baseline.directHighCritical ?? [])
const newlyDirect = actionable.map(d => d.name).filter(n => !baselineDirect.has(n))
if (newlyDirect.length) {
  problems.push(`newly vulnerable direct dependencies: ${newlyDirect.join(', ')}`)
}

if (problems.length) {
  console.error('AUDIT RATCHET FAILED\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    '\nRun `node scripts/harness/audit-ratchet.mjs --report` for the full list.\n' +
      'Fix the dependency, or — if the advisory genuinely does not apply — say why in the\n' +
      'PR description and update the baseline in its own commit.'
  )
  process.exit(1)
}

const improved = baseline.total - total
console.log(
  `audit-ratchet: OK — ${total} production advisories (${high} high/critical, ` +
    `baseline ${baseline.total})` +
    (improved > 0 ? ` — improved by ${improved}` : '')
)
if (improved > 0) {
  console.log('  Tighten the ratchet: node scripts/harness/audit-ratchet.mjs --update')
}
