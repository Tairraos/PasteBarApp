#!/usr/bin/env node
/**
 * Second entry-seeded reachability: does the BUNDLED module graph contain anything else?
 *
 * This is the same walk `scripts/harness/reachability.mjs` performs, with one difference
 * that matters for deleting dependencies: it also follows imports *into* the vendored trees
 * (`src/components/libs/**`). The main tool excludes vendored code because GOLDEN-RULES R7
 * puts it out of scope for every gate, but "out of scope for editing" is not the same as
 * "not in the bundle": a vendored component that a reachable file imports is compiled into
 * the app, and the packages *it* imports are real dependencies.
 *
 * That distinction is what keeps a dependency prune honest. A package referenced only by
 * vendored code that nothing reaches can be removed with the file; a package referenced by
 * vendored code that IS reached cannot.
 *
 * Usage:
 *   node scripts/harness/vendored-imports.mjs            # summary
 *   node scripts/harness/vendored-imports.mjs --json     # machine-readable
 *   node scripts/harness/vendored-imports.mjs --unused   # declarations with no reference
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const UI = path.join(ROOT, 'packages/pastebar-app-ui')
const SRC = path.join(UI, 'src')
const ARGS = new Set(process.argv.slice(2))

const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.css']
const isDir = f => {
  try {
    return statSync(f).isDirectory()
  } catch {
    return false
  }
}

/**
 * Seeds. Application entries plus the two categories that are live without being imported:
 * the i18n build plugin, and the test suite — vitest discovers test files by glob, so
 * nothing imports them, and reporting them as dead code invites a cleanup that deletes the
 * tests. (The main reachability tool has the same hazard; see its TEST_ROOTS.)
 */
function seeds() {
  const apps = ['main.tsx', 'history-main.tsx', 'quickpaste-main.tsx'].map(f =>
    path.join(SRC, f)
  )
  const toolchain = [path.join(SRC, 'lib/i18n-vite-loaded/loader.ts')]
  const tests = []
  const walk = dir => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e === 'libs') continue
      const f = path.join(dir, e)
      if (isDir(f)) walk(f)
      else if (/\.test\.tsx?$/.test(e) || /src\/test\/.*\.ts$/.test(f)) tests.push(f)
    }
  }
  walk(SRC)
  return [...apps, ...toolchain, ...tests].filter(existsSync)
}

function resolveImport(fromFile, spec) {
  let base = null
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else if (spec === '~' || spec.startsWith('~/')) base = path.join(SRC, spec.slice(1))
  if (base === null) return null
  if (isDir(base)) base = path.join(base, 'index')
  for (const e of EXT) if (existsSync(base + e) && !isDir(base + e)) return base + e
  return null
}

const IMPORT_RE =
  /(?:import\s+[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g
const CSS_IMPORT_RE = /@import\s+['"]([^'"]+)['"]/g

const seen = new Set()
const queue = seeds()
const pkgFiles = new Map()

while (queue.length) {
  const file = queue.pop()
  if (seen.has(file)) continue
  seen.add(file)
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const specs = new Set()
  for (const m of text.matchAll(IMPORT_RE)) specs.add(m[1])
  for (const m of text.matchAll(CSS_IMPORT_RE)) specs.add(m[1])
  for (const spec of specs) {
    const resolved = resolveImport(file, spec)
    if (resolved) {
      queue.push(resolved)
      continue
    }
    // A relative or alias specifier that did not resolve is a missing file or a path shape
    // this resolver does not model — not a package. Treating `'../..'` as a package name is
    // how a scanner invents a dependency called "..".
    if (spec.startsWith('.') || spec === '~' || spec.startsWith('~/')) continue
    const pkg = spec.startsWith('@')
      ? spec.split('/').slice(0, 2).join('/')
      : spec.split('/')[0]
    if (!pkg || pkg === '.' || pkg === '..') continue
    if (!pkgFiles.has(pkg)) pkgFiles.set(pkg, [])
    pkgFiles.get(pkg).push(path.relative(UI, file))
  }
}

// Config files are outside the runtime graph but load packages at build/tool time.
const CONFIG_FILES = [
  'packages/pastebar-app-ui/vite.config.mts',
  'packages/pastebar-app-ui/vitest.config.mts',
  'packages/pastebar-app-ui/tailwind.config.js',
  'packages/pastebar-app-ui/postcss.config.js',
  'packages/pastebar-app-ui/prettier.config.js',
  'prettier.config.js',
  '.eslintrc.js',
  'packages/pastebar-app-ui/.eslintrc.js',
]
const configUsed = new Set()
for (const rel of CONFIG_FILES) {
  const f = path.join(ROOT, rel)
  if (!existsSync(f)) continue
  const text = readFileSync(f, 'utf8')
  for (const m of text.matchAll(
    /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
  )) {
    const spec = m[1]
    if (spec.startsWith('.') || spec.startsWith('~')) continue
    configUsed.add(
      spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    )
  }
}

if (ARGS.has('--json')) {
  console.log(
    JSON.stringify(
      {
        reachableFiles: seen.size,
        packages: [...pkgFiles.keys()].sort(),
        configOnly: [...configUsed].sort(),
        unreachableFilesReferencing: Object.fromEntries(
          [...pkgFiles.entries()]
            .map(([p, files]) => [
              p,
              [...new Set(files)].filter(f => !seen.has(path.join(UI, f))),
            ])
            .filter(([, files]) => files.length > 0)
        ),
      },
      null,
      2
    )
  )
  process.exit(0)
}

const pkgUi = JSON.parse(readFileSync(path.join(UI, 'package.json'), 'utf8'))
const pkgRoot = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const used = new Set([...pkgFiles.keys(), ...configUsed])

if (ARGS.has('--unused')) {
  // Build tooling is consumed by name, never imported; classify rather than report it.
  const TOOLING = [
    /^@types\//,
    /^eslint(-|$)/,
    /^@typescript-eslint\//,
    /^prettier(-plugin)?-/,
    /^@trivago\//,
    /^@ianvs\//,
    /^@tauri-apps\/cli$/,
    /^@vitejs\//,
    /^vite-plugin-/,
    /^@rollup\//,
    /^rollup$/,
    /^autoprefixer$/,
    /^postcss$/,
    /^tailwindcss$/,
    /^@tailwindcss\//,
    /^typescript$/,
    /^rimraf$/,
    /^taze$/,
    /^@changesets\//,
    /^jsdom$/,
    /^@vitest\//,
    /^vitest$/,
    /^@testing-library\//,
    /^react-compiler-runtime$/,
    /^babel-plugin-/,
    /^@preact\//,
  ]
  const report = (label, pkg) => {
    const unused = Object.keys(pkg.dependencies || {})
      .filter(n => !used.has(n) && !TOOLING.some(re => re.test(n)))
      .sort()
    console.log(
      `\n${label}: ${unused.length} unused of ${
        Object.keys(pkg.dependencies || {}).length
      }`
    )
    for (const n of unused) console.log(`  ${n}`)
  }
  report('root', pkgRoot)
  report('ui', pkgUi)
  process.exit(0)
}

console.log(`reachable files (including vendored that are imported): ${seen.size}`)
console.log(`packages imported by reachable files: ${pkgFiles.size}`)

const vendoredImporters = [...pkgFiles.entries()]
  .map(([p, files]) => [
    p,
    [...new Set(files)].filter(f => f.includes('components/libs')),
  ])
  .filter(([, files]) => files.length > 0)
console.log(`packages whose ONLY importers are vendored: ${vendoredImporters.length}`)
for (const [pkg, files] of vendoredImporters) {
  console.log(
    `  ${pkg}  <- ${files.slice(0, 2).join(', ')}${
      files.length > 2 ? ` +${files.length - 2}` : ''
    }`
  )
}
