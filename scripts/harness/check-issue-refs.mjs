#!/usr/bin/env node
/**
 * ISSUE-REFERENCE GATE.
 *
 * `docs/harness/ISSUES.md` is the spine of this repository's record system: every fix
 * cites an ISSUE-ID, and every ISSUE-ID is supposed to point at a real place in the code.
 * Two ways that rots, both silent:
 *
 *   1. **Dangling reference.** `db.rs:191-196` is edited and the row now describes a line
 *      that no longer exists, or a file that was renamed or deleted. A reader follows it
 *      and finds unrelated code — confidently wrong documentation, which is worse than none.
 *   2. **Duplicate ID.** Two rows share an ISSUE-ID, so a commit message citing it is
 *      ambiguous.
 *
 * This gate catches both mechanically, for the same reason docs-lint.sh exists rather than
 * relying on review: a human cannot re-verify 30 file:line references on every commit.
 *
 * Usage:
 *   node scripts/harness/check-issue-refs.mjs            # gate
 *   node scripts/harness/check-issue-refs.mjs --report    # list every reference checked
 *   node scripts/harness/check-issue-refs.mjs --json
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ISSUES = path.join(ROOT, 'docs/harness/ISSUES.md')
const ARGS = new Set(process.argv.slice(2))

const source = readFileSync(ISSUES, 'utf8')

// --- collect tracked files once, for suffix resolution ------------------------------
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean)

/**
 * Resolve a reference path the way a reader would: a full path from the repo root, or a
 * suffix of one (docs consistently write `services/utils.rs` for
 * `src-tauri/src/services/utils.rs`). Returns every match so ambiguity can be reported.
 */
function resolve(refPath) {
  const direct = path.join(ROOT, refPath)
  if (existsSync(direct)) return [refPath]

  const escaped = refPath.replace(/[.[*^$\\]/g, '\\$&')
  const suffix = new RegExp(`(^|/)${escaped}$`)
  return tracked.filter(f => suffix.test(f))
}

const problems = []
const checked = []

// --- 1. duplicate ISSUE-IDs ----------------------------------------------------------
const idPattern = /^`ID \| (ISSUE-\d+)`$/gm
const ids = [...source.matchAll(idPattern)].map(m => m[1])
const seen = new Set()
for (const id of ids) {
  if (seen.has(id)) problems.push(`duplicate ISSUE id: ${id}`)
  seen.add(id)
}
if (ids.length === 0) {
  problems.push('no ISSUE ids found — the heading format may have changed')
}

// An issue can be withdrawn and folded into another (ISSUE-026 was merged into ISSUE-005).
// Such an entry keeps its heading as a tombstone so that a commit message citing the old
// id still resolves to an explanation, but it carries no `ID |` row and therefore no
// reference block. Numbers are never reused — reusing one would silently repoint every
// historical citation at a different defect.
const withdrawn = new Set()
for (const m of source.matchAll(/^### (ISSUE-\d+) · \(withdrawn[^)]*\)/gm)) {
  withdrawn.add(m[1])
}

// --- 2. file:line references ---------------------------------------------------------
// Matches `path.ext:NN` or `path.ext:NN-MM` inside backticks. Both the start and the end
// of a range must be within the file.
const refPattern =
  /`([A-Za-z0-9_./-]+\.(?:rs|ts|tsx|js|mjs|json|toml|yml|yaml|sh|html|mts)):(\d+)(?:-(\d+))?`/g

for (const match of source.matchAll(refPattern)) {
  const [full, refPath, startStr, endStr] = match
  const startLine = Number(startStr)
  const endLine = endStr ? Number(endStr) : startLine

  const matches = resolve(refPath)
  if (matches.length === 0) {
    problems.push(`dangling reference ${full}: no tracked file matches '${refPath}'`)
    continue
  }
  if (matches.length > 1) {
    problems.push(
      `ambiguous reference ${full}: '${refPath}' matches ${matches.length} files ` +
        `(${matches.slice(0, 3).join(', ')}${
          matches.length > 3 ? ', …' : ''
        }) — qualify it`
    )
    continue
  }

  const file = matches[0]
  const lineCount = readFileSync(path.join(ROOT, file), 'utf8').split('\n').length
  if (startLine > lineCount || endLine > lineCount) {
    problems.push(`reference ${full} points past the end of ${file} (${lineCount} lines)`)
    continue
  }
  if (endLine < startLine) {
    problems.push(`reference ${full} has a reversed range`)
    continue
  }

  checked.push({ ref: full, file, startLine, endLine, lineCount })
}

// --- 3. issue ids cited by fix records exist -----------------------------------------
// A `状态` row may cite the wave that fixed it; a fix citing an id that is not defined
// above is how a typo becomes an unfindable record.
for (const match of source.matchAll(/ISSUE-(\d+)/g)) {
  const id = `ISSUE-${match[1]}`
  if (!seen.has(id) && !withdrawn.has(id)) {
    problems.push(`text cites ${id}, which has no 'ID | ${id}' row`)
  }
}

// --- report --------------------------------------------------------------------------
if (ARGS.has('--json')) {
  console.log(JSON.stringify({ ids: ids.length, checked, problems }, null, 2))
  process.exit(problems.length ? 1 : 0)
}

if (ARGS.has('--report')) {
  console.log(
    `${ids.length} issue ids, ${checked.length} file:line references verified\n`
  )
  for (const c of checked) {
    console.log(
      `  ${c.ref.padEnd(46)} -> ${c.file} (${c.lineCount} lines, ` +
        `refers to ${c.startLine}${c.endLine !== c.startLine ? `-${c.endLine}` : ''})`
    )
  }
  console.log()
}

if (problems.length) {
  console.error(`ISSUE-REFS FAILED (${problems.length} problems)\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    '\nFix the reference in docs/harness/ISSUES.md, or — if the code moved — update the\n' +
      'line numbers to the new location. A reference that cannot be followed is worse than\n' +
      'no reference, because it is confidently wrong.'
  )
  process.exit(1)
}

console.log(
  `issue-refs: OK — ${ids.length} unique issue ids` +
    `${withdrawn.size ? ` (+${withdrawn.size} withdrawn)` : ''}, ` +
    `${checked.length} file:line references verified`
)
