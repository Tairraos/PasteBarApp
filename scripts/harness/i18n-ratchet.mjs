#!/usr/bin/env node
/**
 * Ratchet for i18n keys that exist in code but not in the English catalog.
 *
 * Same shape as the other ratchets in this directory: the recorded count may only go DOWN.
 * The 94 keys present when this gate was added are real defects, not a baseline to live
 * with — they are strings a Chinese user sees in English. Encoding them as a number means
 * work on them can proceed incrementally without the gate blocking every unrelated commit,
 * while any NEW instance fails immediately.
 *
 * Usage:
 *   node scripts/harness/i18n-ratchet.mjs            # check against the baseline
 *   node scripts/harness/i18n-ratchet.mjs --report   # list every missing key
 *   node scripts/harness/i18n-ratchet.mjs --update   # record the current count
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BASELINE = path.join(ROOT, 'docs/harness/i18n-baseline.json')
const SCRIPT = path.join(ROOT, 'scripts/i18n-missing-keys.mjs')

const args = process.argv.slice(2)

const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: ROOT })
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`

const countMatch = /i18n-missing-keys:\s*(?:OK.*?)?(\d+)\s+key/.exec(output)
const count = countMatch ? Number(countMatch[1]) : output.includes('OK') ? 0 : -1

if (count < 0) {
  console.error('i18n-ratchet: could not read a count from i18n-missing-keys.mjs')
  console.error(output)
  process.exit(1)
}

if (args.includes('--report')) {
  // The underlying script already prints the full list; this flag exists so the ratchet's
  // interface matches the others.
  process.stdout.write(output)
  process.exit(0)
}

if (args.includes('--update')) {
  writeFileSync(BASELINE, JSON.stringify({ missingKeys: count }, null, 2) + '\n')
  console.log(`i18n-ratchet: baseline updated to ${count}`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(
    `i18n-ratchet: no baseline at ${path.relative(ROOT, BASELINE)} — run --update`
  )
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')).missingKeys

if (count > baseline) {
  console.error('i18n-ratchet: FAILED\n')
  console.error(
    `  ${count} t() key(s) are absent from the English catalog, baseline allows ${baseline}.`
  )
  console.error(
    `  ${count - baseline} new one(s) were introduced. Add the missing entries to\n` +
      `  packages/pastebar-app-ui/src/locales/lang/en/<namespace>.yaml (and a zhCN translation),\n` +
      `  or reword the call to use an existing key.\n`
  )
  console.error('  Run with --report to list them.')
  process.exit(1)
}

if (count < baseline) {
  console.log(
    `i18n-ratchet: OK — ${count} (baseline ${baseline}; DOWN by ${baseline - count}).\n` +
      `  Lower the baseline: node scripts/harness/i18n-ratchet.mjs --update`
  )
  process.exit(0)
}

console.log(`i18n-ratchet: OK — ${count} (baseline ${baseline})`)
