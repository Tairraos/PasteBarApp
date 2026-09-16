#!/usr/bin/env node
/**
 * Clippy ratchet gate.
 *
 * `cargo clippy -- -D warnings` cannot be enforced yet: the crate emits hundreds of
 * warnings, most of them rustc lints rather than clippy lints, and many come from
 * vendored dependencies. Failing the build on all of them would mean either a blanket
 * `#[allow]` or a refactor of the entire backend in one wave.
 *
 * This gate therefore counts ONLY `clippy::*` lints in this crate's own targets — the
 * things a human can actually act on — and compares the total against the baseline in
 * `docs/harness/clippy-baseline.json`. Rustc lints (`unexpected_cfgs`, `deprecated`,
 * `dead_code`, …) are excluded because they are dominated by dependency code and are
 * better handled by the toolchain than by us.
 *
 * The count may only go DOWN (docs/harness/GOLDEN-RULES.md R9).
 *
 * Usage:
 *   node scripts/harness/clippy-ratchet.mjs            # enforce
 *   node scripts/harness/clippy-ratchet.mjs --report   # show the distribution
 *   node scripts/harness/clippy-ratchet.mjs --update   # rewrite the baseline
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BASELINE = path.join(ROOT, 'docs/harness/clippy-baseline.json')
const ARGS = new Set(process.argv.slice(2))

// `cargo clippy --message-format=json` streams one JSON object per line; the compiler
// message is nested under `message` and carries `code.code` like "clippy::needless_return".
const res = spawnSync(
  'cargo',
  ['clippy', '--all-targets', '--message-format=json', '--', '-A', 'unexpected_cfgs'],
  { cwd: path.join(ROOT, 'src-tauri'), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
)
if (res.error) {
  console.error(`clippy-ratchet: could not run cargo (${res.error.message})`)
  process.exit(1)
}

const byRule = {}
const byFile = {}
let total = 0

for (const line of (res.stdout ?? '').split('\n')) {
  if (!line.trim()) continue
  let obj
  try {
    obj = JSON.parse(line)
  } catch {
    continue
  }
  if (obj.reason !== 'compiler-message') continue
  const msg = obj.message
  if (!msg || msg.level !== 'warning') continue
  const code = msg.code?.code ?? ''
  // Only this crate's own clippy lints; rustc lints and dependency noise are out of scope.
  if (!code.startsWith('clippy::')) continue
  const targets = (msg.spans ?? []).filter(s => s.is_primary)
  const file = targets[0]?.file_name
  if (file && file.includes('/libs/')) continue // vendored — GOLDEN-RULES R7
  byRule[code] = (byRule[code] ?? 0) + 1
  if (file) byFile[file] = (byFile[file] ?? 0) + 1
  total++
}

const sorted = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]))

if (ARGS.has('--report') || ARGS.has('--update')) {
  console.log(`clippy (this crate, excluding vendored): ${total}`)
  console.log('\nby rule:')
  for (const [k, v] of Object.entries(sorted(byRule)))
    console.log(`  ${String(v).padStart(4)}  ${k}`)
  console.log('\nby file:')
  for (const [k, v] of Object.entries(sorted(byFile)))
    console.log(`  ${String(v).padStart(4)}  ${k}`)
}

if (ARGS.has('--update')) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        $comment:
          'Clippy ratchet baseline — clippy::* lints only, this crate, vendored paths excluded. ' +
          'May only go DOWN (docs/harness/GOLDEN-RULES.md R9). ' +
          'Regenerate: node scripts/harness/clippy-ratchet.mjs --update',
        total,
        byRule: sorted(byRule),
        byFile: sorted(byFile),
      },
      null,
      2
    ) + '\n'
  )
  console.log(`\nwrote ${path.relative(ROOT, BASELINE)}`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(
    'clippy-ratchet: no baseline. Generate one with:\n' +
      '  node scripts/harness/clippy-ratchet.mjs --update'
  )
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
if (total > baseline.total) {
  console.error('CLIPPY RATCHET FAILED\n')
  console.error(`clippy warnings ${total} exceeds baseline ${baseline.total}\n`)
  console.error('New or increased rules:')
  for (const [rule, count] of Object.entries(byRule)) {
    const allowed = baseline.byRule[rule] ?? 0
    if (count > allowed) console.error(`  ${rule}: ${count}, baseline allows ${allowed}`)
  }
  console.error(
    '\nMany are auto-fixable:  cd src-tauri && cargo clippy --fix --allow-dirty --all-targets'
  )
  process.exit(1)
}

const improved = baseline.total - total
console.log(
  `clippy-ratchet: OK — ${total} clippy lints (baseline ${baseline.total}` +
    `${improved > 0 ? `, improved by ${improved}` : ''})`
)
if (improved > 0)
  console.log('  Tighten the ratchet: node scripts/harness/clippy-ratchet.mjs --update')
