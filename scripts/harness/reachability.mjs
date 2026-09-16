#!/usr/bin/env node
/**
 * Frontend dead-code reachability scan.
 *
 * Walks the import graph from the three Vite rollup entries declared in
 * packages/pastebar-app-ui/vite.config.mts (main / history / quickpaste) and reports
 * every tracked TypeScript source file that no entry can reach.
 *
 * Vendored copies under src/components/libs/** are excluded from the universe, matching
 * every other harness metric.
 *
 * Usage:
 *   node scripts/harness/reachability.mjs            # summary + unreachable list
 *   node scripts/harness/reachability.mjs --json     # machine readable
 *   node scripts/harness/reachability.mjs --count    # just the number (for gating)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const UI = path.join(ROOT, 'packages/pastebar-app-ui')

// Kept in sync with vite.config.mts build.rollupOptions.input.
const ENTRIES = ['src/main.tsx', 'src/history-main.tsx', 'src/quickpaste-main.tsx']
const VENDOR = 'components/libs/'
const RESOLVE_EXT = ['', '.ts', '.tsx', '/index.ts', '/index.tsx', '.js', '.json', '.css']

/**
 * Files that are live without being imported by an application entry, because a *tool*
 * consumes them:
 *
 *   - `src/lib/i18n-vite-loaded/**` is imported by `packages/pastebar-app-ui/vite.config.mts`
 *     as a build-time plugin (vite.config.mts:10); no application module imports it.
 *   - Ambient declaration files (`.d.ts`) are pulled into the TypeScript program by
 *     `tsconfig.json`'s `include` (tsconfig.json:24), never by an `import` statement.
 *
 * Without this, the scan reports them as dead and a delete wave would remove live build
 * tooling. Both were verified by reading the referencing config before being listed here.
 */
const TOOLCHAIN_ROOTS = ['src/lib/i18n-vite-loaded/loader.ts']

/**
 * Test files are entry points too: vitest discovers them by glob (`include` in
 * vitest.config.mts), so nothing imports them. Without this, the scan reports the test
 * suite as dead code and a future delete wave removes it — a self-inflicted footgun that
 * only appears *after* tests exist, which is why it is called out here.
 */
const TEST_ROOTS = (() => {
  const out = []
  // Paths are UI-relative, matching ENTRIES and the universe() walk.
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(path.join(UI, dir), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'libs') continue
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.test\.tsx?$/.test(e.name) || /^src\/test\/.*\.ts$/.test(rel))
        out.push(rel)
    }
  }
  walk('src')
  return out
})()

const AMBIENT_RE = /(^|\/)vite-env\.d\.ts$|\.d\.ts$/

function resolveSpecifier(fromRel, spec) {
  let base
  if (spec.startsWith('~/')) base = path.join(UI, 'src', spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(UI, path.dirname(fromRel), spec)
  else return null // bare package specifier
  for (const ext of RESOLVE_EXT) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return path.relative(UI, p)
  }
  return null
}

function universe() {
  const out = new Set()
  const walk = dir => {
    for (const e of readdirSync(path.join(UI, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (/\.(ts|tsx)$/.test(e.name) && !rel.includes(VENDOR)) out.add(rel)
    }
  }
  walk('src')
  return out
}

export function reachability() {
  const seen = new Set()
  // Seed with the toolchain roots so a build-time-consumed module is not reported as dead.
  const queue = [...ENTRIES, ...TOOLCHAIN_ROOTS, ...TEST_ROOTS]
  while (queue.length) {
    const rel = queue.pop()
    if (seen.has(rel)) continue
    const abs = path.join(UI, rel)
    if (!existsSync(abs)) continue
    seen.add(rel)
    const src = readFileSync(abs, 'utf8')
    const re = /from\s+'([^']+)'|import\s*\(\s*'([^']+)'|import\s+'([^']+)'/g
    for (const m of src.matchAll(re)) {
      const spec = m[1] ?? m[2] ?? m[3]
      if (!spec) continue
      const r = resolveSpecifier(rel, spec)
      if (r && !seen.has(r)) queue.push(r)
    }
  }
  const all = universe()
  // Ambient .d.ts files are part of the TypeScript program via tsconfig `include`, not via
  // an import, so they can never appear in `seen`.
  const unreachable = [...all].filter(f => !seen.has(f) && !AMBIENT_RE.test(f)).sort()
  return {
    reachable: [...seen].filter(f => all.has(f)).length,
    total: all.size,
    unreachableCount: unreachable.length,
    unreachable,
  }
}

const data = reachability()

if (process.argv.includes('--check')) {
  // Gate mode: any unreachable file fails. Reachability is a design property, not a
  // stylistic one — a file nothing can reach is either a leftover or a bug in the import
  // graph, and both are worth stopping at the PR.
  if (data.unreachableCount > 0) {
    console.error(`REACHABILITY FAILED: ${data.unreachableCount} unreachable file(s)\n`)
    for (const f of data.unreachable) console.error(`  ${f}`)
    console.error(
      '\nDelete the file, import it from an entry, or — if it is live without being\n' +
        'imported (a test suite, a build plugin) — add it to TEST_ROOTS or TOOLCHAIN_ROOTS\n' +
        'in this script with the reason. Do not silence it without one of those.'
    )
    process.exit(1)
  }
  console.log(
    `reachability: OK — ${data.reachable}/${data.total} sources reachable, 0 dead`
  )
  process.exit(0)
}

if (process.argv.includes('--count')) {
  console.log(data.unreachableCount)
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify(data, null, 2))
} else {
  console.log(`reachable ${data.reachable} / ${data.total} tracked TS sources`)
  console.log(`unreachable (dead) ${data.unreachableCount}`)
  console.log('')
  for (const f of data.unreachable) console.log(f)
}
