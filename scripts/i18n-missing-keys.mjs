#!/usr/bin/env node
/**
 * Find `t('...')` calls in the UI whose text is missing from the English catalog.
 *
 * The English YAML files double as the key set: `t()` is called with the English sentence,
 * and the locale files map that sentence to a translation. So a `t()` argument that does not
 * appear in `lang/en/<namespace>.yaml` cannot be translated at all — i18next falls back to
 * echoing the argument, and the user sees English in an otherwise translated UI.
 *
 * This is the failure the existing `translation-audit.ts` does NOT catch: it compares the
 * other locales against English, so it only finds translations missing from a catalog. When
 * the CODE and the catalog disagree about the key text, every file still looks consistent
 * with every other file, and the audit is silent.
 *
 * A real instance: the settings screen calls
 *   t('Set system OS hotkeys ... and quick paste window. Supports up to 3-key combinations.')
 * while zhCN defined the same sentence WITHOUT the trailing clause. The translation existed,
 * was correct, and was never looked up.
 *
 * Usage:
 *   node scripts/i18n-missing-keys.mjs           # report missing keys
 *   node scripts/i18n-missing-keys.mjs --strict  # exit 1 if any are found
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UI_SRC = path.join(ROOT, 'packages/pastebar-app-ui/src')
const EN_DIR = path.join(UI_SRC, 'locales/lang/en')

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      // Vendored third-party code is excluded from every gate (GOLDEN-RULES R7) and is not
      // translated by this project.
      if (entry === 'libs' || entry === 'node_modules') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\./.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Parse a locale YAML into the set of lookup keys i18next will resolve.
 *
 * These files are shallow `key: value` maps, BUT some are nested one or two levels under a
 * section name (`navbar.yaml` has `Window:` with indented children), and i18next addresses
 * those as `Window:::Minimize Window`. A check that only collected column-0 keys reported
 * every nested entry as missing — 228 false positives on the first run, which is worse than
 * no check at all because it hides the real ones.
 *
 * So indentation is tracked: a line's leading spaces determine the prefix it inherits, and
 * each key is emitted both as written (`Minimize Window`) and in the flattened forms i18next
 * accepts (`Window:::Minimize Window`, `Window.Minimize Window`).
 *
 * Still not a YAML parser: only the FIRST `: ` separates key from value, because the keys
 * are English sentences that may themselves contain colons.
 */
/**
 * Index of the `: ` separating key from value, ignoring colons inside a quoted key.
 *
 * Returns -1 when the line has no inline value (a section header or block scalar).
 */
function findSeparator(line) {
  const quote = line[0] === '"' || line[0] === "'" ? line[0] : null
  if (quote) {
    const close = line.indexOf(quote, 1)
    if (close === -1) return -1
    // The separator must follow the closing quote directly.
    const after = line.slice(close + 1)
    // Return the index WHERE THE SEPARATOR STARTS, not where it ends: callers slice
    // `line.slice(0, idx)` to get the key, so including the `: ` keeps it in the key.
    return after.startsWith(': ') ? close + 1 : -1
  }
  return line.indexOf(': ')
}

function stripQuotes(text) {
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      return text.slice(1, -1)
    }
  }
  return text
}

function readCatalogKeys(file) {
  const keys = new Set()
  // Stack of { indent, key } for the enclosing sections.
  const stack = []
  // Set by a `? key` line, consumed by the `: value` line that must follow it.
  let pendingExplicitKey = null

  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue

    // YAML's explicit-key syntax: `? <key>` on one line, `: <value>` on the next. It is
    // used here for keys containing a colon (`Permission Check Failed: ...`), which cannot
    // be written as a plain `key: value` pair. Parsing it as ordinary text yields the key
    // `? 'Permission Check Failed` — a false positive that hid the real entry.
    const explicit = /^(\s*)\?\s+(.*)$/.exec(raw)
    if (explicit) {
      pendingExplicitKey = {
        indent: explicit[1].length,
        text: stripQuotes(explicit[2].trim()),
      }
      continue
    }

    // Find the separator OUTSIDE any quoted key. A key like
    // `'Update: Permission Denied'` contains `: ` inside its own quotes, so a plain
    // `indexOf(': ')` splits mid-key and the real entry is never registered.
    const idx = pendingExplicitKey ? raw.indexOf(':') : findSeparator(raw)
    let indent = raw.length - raw.trimStart().length

    if (idx <= 0) {
      // A section header (`Window:`) or a block scalar start: it has no inline value.
      const headerMatch = /^(\s*)([^:]+):\s*$/.exec(raw)
      if (headerMatch) {
        const key = stripQuotes(headerMatch[2])
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
        stack.push({ indent, key })
      }
      continue
    }

    // `trimStart` matters: `slice(0, idx)` keeps the indentation, which would emit
    // `Window:::  Attach Window` (two spaces) and never match the lookup key.
    //
    // Quotes are stripped because YAML allows a quoted key (`'Update: Permission Denied'`)
    // and i18next is called with the unquoted text; comparing the raw line would report
    // every quoted key as missing.
    const key = pendingExplicitKey
      ? pendingExplicitKey.text
      : stripQuotes(raw.slice(0, idx).trim())
    if (pendingExplicitKey) {
      indent = pendingExplicitKey.indent
      pendingExplicitKey = null
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()

    keys.add(key)
    if (stack.length) {
      const pathParts = [...stack.map(s => s.key), key]
      keys.add(pathParts.join(':::'))
      keys.add(pathParts.join('.'))
    }
  }
  return keys
}

function main() {
  const catalogs = new Map()
  for (const f of readdirSync(EN_DIR).filter(f => f.endsWith('.yaml'))) {
    catalogs.set(f.replace(/\.yaml$/, ''), readCatalogKeys(path.join(EN_DIR, f)))
  }

  const allowed = new Set(catalogs.keys())
  const missing = []

  // Match `t('...')` / `t("...")` optionally followed by options, across lines.
  const callRe = /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g

  for (const file of walk(UI_SRC)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(callRe)) {
      const text = m[2]
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n')
        .replace(/\\\\/g, '\\')

      // Skip non-keys: interpolation-only, single words, and anything without a space or
      // sentence punctuation is far more likely a variable than a catalog key.
      if (!text || !/[ .]/.test(text)) continue
      // Template literals and interpolated values cannot be checked statically.
      if (text.includes('${')) continue

      // Which namespace? Look for `ns: 'x'` shortly after the call.
      const after = src.slice(m.index, m.index + 400)
      const nsMatch = /ns:\s*['"]([\w-]+)['"]/.exec(after)
      const ns = nsMatch ? nsMatch[1] : null

      if (ns && !allowed.has(ns)) continue // unknown namespace is a different bug

      const candidates = ns ? [catalogs.get(ns)] : [...catalogs.values()]
      if (!candidates.some(c => c && c.has(text))) {
        const line = src.slice(0, m.index).split('\n').length
        missing.push({ file: path.relative(ROOT, file), line, ns: ns ?? '(none)', text })
      }
    }
  }

  if (missing.length === 0) {
    console.log('i18n-missing-keys: OK — every t() key exists in the English catalog')
    return
  }

  console.error(
    `i18n-missing-keys: ${missing.length} key(s) used in code but absent from en/\n`
  )
  for (const m of missing) {
    console.error(`  ${m.file}:${m.line}  [ns: ${m.ns}]`)
    console.error(`    ${m.text}`)
    console.error('')
  }
  console.error(
    'Add each key to packages/pastebar-app-ui/src/locales/lang/en/<ns>.yaml, and to the\n' +
      'zhCN catalog with a translation. Without an English entry i18next echoes the argument\n' +
      'and the string appears untranslated.'
  )

  if (process.argv.includes('--strict')) process.exit(1)
}

main()
