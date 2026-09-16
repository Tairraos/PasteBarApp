#!/usr/bin/env node
/**
 * Backend layering check (ISSUE-017).
 *
 * The three-tier shape (`commands → services → models/db`) exists on disk, but until this
 * script nothing rejected a new edge in the wrong direction. A rule that lives only in a
 * document is a rule that survives exactly until the first agent in a hurry, and this
 * repository is worked on by agents by design — so the rule is enforced instead.
 *
 * What is checked, and why each direction is the one that matters:
 *
 *   1. `services/**` must not import `commands/**`. This is the real inversion: a service
 *      that knows about a command has absorbed presentation concerns, and the dependency
 *      becomes a cycle the moment the command calls it back. It is also the easiest
 *      mistake to make, because the compiler happily accepts it.
 *
 *   2. `models/**` must not import `services/**` or `commands/**`. Models are the bottom
 *      of the stack and are serialised across the IPC boundary; letting them reach upward
 *      gives them behaviour and makes the boundary untestable.
 *
 *   3. `db.rs` must not import `commands/**` or `services/**`. It is infrastructure, not a
 *      consumer of business logic.
 *
 * Deliberately NOT checked: `services → services` edges. Those exist and several are
 * legitimate (a service composing another's public function). A blanket ban would fail on
 * correct code, and a gate that fails on correct code gets disabled. The specific bad
 * shape — a *utility* module importing a *business* service — was found and fixed by hand
 * (see ISSUE-017's fix note) rather than encoded as a rule, because it needs judgement.
 *
 * `main.rs` is exempt on purpose: it is the composition root, and wiring every layer
 * together is exactly its job.
 *
 * Usage:
 *   node scripts/harness/check-layering.mjs           # enforce
 *   node scripts/harness/check-layering.mjs --report  # list every import edge
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = path.join(ROOT, 'src-tauri/src')
const ARGS = new Set(process.argv.slice(2))

/** Layer names, ordered from top (commands) to bottom (models/db). */
const LAYERS = ['commands', 'services', 'models']

/** Files that are infrastructure rather than a layer. */
const INFRA = ['db.rs']

/**
 * The rules, as data: for each source layer, which target layers it may not reach.
 * Anything not listed here is allowed.
 */
const FORBIDDEN = {
  services: ['commands'],
  models: ['commands', 'services'],
  db: ['commands', 'services'],
}

/** Classify a path relative to src-tauri/src into a layer name. */
function layerOf(rel) {
  if (rel.startsWith('commands/')) return 'commands'
  if (rel.startsWith('services/')) return 'services'
  if (rel.startsWith('models/')) return 'models'
  if (rel === 'db.rs') return 'db'
  return null
}

/** Every .rs file under src, excluding the vendored trees. */
function sources() {
  const out = []
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'libs' || e.name === 'target') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.rs')) out.push(path.relative(SRC, full))
    }
  }
  walk(SRC)
  return out.sort()
}

// `use crate::commands::…`, `use crate::services::…`, and the `super::`/`crate::` forms.
// Matching the full brace-group syntax matters: `use crate::services::{a, b}` is the common
// shape, and a regex that only handles single-segment paths would miss most real edges.
const USE_RE = /^\s*use\s+(?:crate|super|self)?(?:::)?([A-Za-z_][A-Za-z0-9_:{} ,\n]*);/gm

const files = sources()
const violations = []
const edges = []

for (const rel of files) {
  const from = layerOf(rel)
  if (!from) continue
  const forbidden = FORBIDDEN[from]
  if (!forbidden) continue

  const text = readFileSync(path.join(SRC, rel), 'utf8')
  // Strip `#[cfg(test)]` modules: a test asserting on a higher layer is not a production
  // dependency, and failing on it would push tests toward weaker assertions.
  const lines = text.split('\n')
  let inTests = false
  let depth = 0

  lines.forEach((line, i) => {
    if (/^\s*#\[cfg\(test\)\]/.test(line)) {
      inTests = true
      depth = 0
    }
    if (inTests) {
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
      if (depth <= 0 && line.includes('}')) inTests = false
      return
    }
    if (!/^\s*use\s/.test(line)) return
    // A use statement can span lines; join until the semicolon.
    let stmt = line
    let j = i
    while (!stmt.includes(';') && j + 1 < lines.length) {
      j += 1
      stmt += ' ' + lines[j]
    }
    const m = stmt.match(/use\s+(?:crate|super|self)?(?:::)?([A-Za-z_][A-Za-z0-9_]*)/)
    if (!m) return
    const target = m[1]
    if (target === 'commands' || target === 'services' || target === 'models') {
      edges.push({ from: rel, fromLayer: from, to: target })
      if (forbidden.includes(target)) {
        violations.push({ file: rel, line: i + 1, from, to: target, text: stmt.trim() })
      }
    }
  })
}

if (ARGS.has('--report')) {
  console.log(`${edges.length} cross-layer import edges across ${files.length} sources\n`)
  for (const e of edges) {
    const bad = (FORBIDDEN[e.fromLayer] ?? []).includes(e.to)
    console.log(`  ${bad ? 'VIOLATION' : 'ok       '} ${e.from}  ->  ${e.to}`)
  }
  console.log()
}

if (violations.length > 0) {
  console.error(`LAYERING FAILED: ${violations.length} forbidden import edge(s)\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.from} → ${v.to}`)
    console.error(`      ${v.text}`)
  }
  console.error(
    '\nThe backend layering is commands → services → models/db (AGENTS.md rule 1).\n' +
      'A lower layer must not import a higher one. Move the shared logic DOWN into the\n' +
      'lower layer, or have the higher layer pass what is needed as an argument.\n' +
      'Full edge list: node scripts/harness/check-layering.mjs --report'
  )
  process.exit(1)
}

const checked = files.filter(f => FORBIDDEN[layerOf(f)]).length
console.log(`layering: OK — ${checked} sources checked, 0 forbidden import edges`)
