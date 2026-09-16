#!/usr/bin/env node
/**
 * IPC contract generator (Phase 2 deliverable, extended in Phase 3 into a drift gate).
 *
 * Reads three surfaces and prints a three-way comparison:
 *   1. commands registered in src-tauri/src/main.rs  (tauri::generate_handler! block)
 *   2. command names the frontend invokes            (literal + `invoke(` argument scan)
 *   3. event names emitted by Rust and listened to by TypeScript
 *
 * Usage:
 *   node scripts/harness/gen-ipc-contract.mjs             # markdown contract skeleton
 *   node scripts/harness/gen-ipc-contract.mjs --json      # machine readable
 *   node scripts/harness/gen-ipc-contract.mjs --check     # exit 1 on drift (Phase 3 gate)
 *
 * Determinism: inputs are `git ls-files` results and frozen file paths only, so
 * untracked build output cannot change the result.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ARGS = new Set(process.argv.slice(2))

const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

const read = rel => readFileSync(path.join(ROOT, rel), 'utf8')

/** Commands registered in the generate_handler! macro. */
export function registeredCommands() {
  const src = read('src-tauri/src/main.rs')
  const block = src.match(/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)
  if (!block)
    throw new Error('generate_handler! block not found in src-tauri/src/main.rs')
  return block[1]
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('//'))
    .map(l => l.replace(/,$/, '').split('::').pop())
    .filter(Boolean)
    .sort()
}

/** Top-level `#[tauri::command]` functions defined in Rust, with their file. */
export function definedCommands() {
  const files = git('ls-files', 'src-tauri/src/*.rs', 'src-tauri/src/**/*.rs').filter(
    f => !f.startsWith('src-tauri/libs/')
  )
  const out = new Map()
  // Two equivalent spellings appear in this codebase:
  //   #[tauri::command]                          (fully qualified)
  //   use tauri::command;  +  #[command]         (imported — user_settings_command.rs)
  // Both must be recognised, or the gate reports ten false "registered without definition".
  const re = /#\[(?:tauri::)?command[^\]]*\]\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-z0-9_]+)/g
  for (const f of files) {
    const src = read(f)
    for (const m of src.matchAll(re)) out.set(m[1], f)
  }
  return out
}

/**
 * Command names invoked from the frontend.
 *
 * Two syntaxes exist and both must be covered:
 *   invoke('name', …)          and   invoke()<T>('name')   — literal first arg
 *   invoke(\n  'name',         — literal first arg on the next line
 * plus a computed call (`invoke(command, args)`) that cannot be resolved
 * statically; those files are reported separately so the gate stays honest.
 */
export function invokedCommands() {
  const files = git(
    'ls-files',
    'packages/pastebar-app-ui/src/*.ts',
    'packages/pastebar-app-ui/src/*.tsx',
    'packages/pastebar-app-ui/src/**/*.ts',
    'packages/pastebar-app-ui/src/**/*.tsx'
  ).filter(f => !f.includes('/components/libs/'))

  const names = new Set()
  const dynamic = new Set()
  for (const f of files) {
    const src = read(f)
    for (const m of src.matchAll(/invoke(?:\(\))?(?:<[^>]*>)?\(\s*'([a-z_0-9]+)'/g))
      names.add(m[1])
    for (const m of src.matchAll(
      /invoke(?:\(\))?(?:<[^>]*>)?\(\s*([A-Za-z_$][\w$]*)\s*,/g
    ))
      dynamic.add(f)
  }
  return { names: [...names].sort(), dynamic: [...dynamic].sort(), files }
}

/** Event names emitted in Rust, with their source file. */
export function emittedEvents() {
  const files = git('ls-files', 'src-tauri/src/*.rs', 'src-tauri/src/**/*.rs').filter(
    f => !f.startsWith('src-tauri/libs/')
  )
  const out = new Map()
  for (const f of files) {
    for (const m of read(f).matchAll(/\bemit(?:_all|_to)?\(\s*"([^"]+)"/g)) {
      if (!out.has(m[1])) out.set(m[1], f)
    }
  }
  return out
}

/** Event names the frontend listens for, plus events it emits (multi-window sync). */
export function frontendEvents() {
  const files = git(
    'ls-files',
    'packages/pastebar-app-ui/src/*.ts',
    'packages/pastebar-app-ui/src/*.tsx',
    'packages/pastebar-app-ui/src/**/*.ts',
    'packages/pastebar-app-ui/src/**/*.tsx'
  ).filter(f => !f.includes('/components/libs/'))

  const listened = new Map()
  const emitted = new Map()
  for (const f of files) {
    const src = read(f)
    for (const m of src.matchAll(/\blisten(?:Once)?(?:<[^>]*>)?\(\s*'([^']+)'/g))
      listened.set(m[1], f)
    for (const m of src.matchAll(/\bemit\(\s*'([^']+)'/g)) emitted.set(m[1], f)
  }
  return { listened, emitted }
}

function build() {
  const registered = registeredCommands()
  const defined = definedCommands()
  const invoked = invokedCommands()
  const emitted = emittedEvents()
  const fe = frontendEvents()

  const invokedSet = new Set(invoked.names)
  const registeredSet = new Set(registered)

  return {
    registered,
    invoked: invoked.names,
    dynamicInvokeFiles: invoked.dynamic,
    uncalled: registered.filter(c => !invokedSet.has(c)),
    // A frontend name with no registered command fails at run time only.
    ghost: invoked.names.filter(c => !registeredSet.has(c)),
    // Registered but not defined by any #[tauri::command] — catches typos in the handler list.
    registeredWithoutDefinition: registered.filter(c => !defined.has(c)),
    definedNotRegistered: [...defined.keys()].filter(c => !registeredSet.has(c)).sort(),
    commandSources: Object.fromEntries(
      registered.map(c => [c, defined.get(c) ?? '(main.rs or re-export)'])
    ),
    events: {
      emitted: [...emitted.keys()].sort(),
      emittedSources: Object.fromEntries([...emitted.entries()].sort()),
      listened: [...fe.listened.keys()].sort(),
      listenedSources: Object.fromEntries([...fe.listened.entries()].sort()),
      feEmitted: [...fe.emitted.keys()].sort(),
      // Emitted by Rust with no frontend listener: a signal nobody consumes.
      unlistened: [...emitted.keys()].filter(e => !fe.listened.has(e)).sort(),
      // Listened for but never emitted by Rust (frontend-to-frontend events are legitimate).
      neverEmitted: [...fe.listened.keys()].filter(e => !emitted.has(e)).sort(),
    },
  }
}

function markdown(d) {
  const L = []
  L.push('# Tauri IPC contract')
  L.push('')
  L.push('> **Generated.** Regenerate with `node scripts/harness/gen-ipc-contract.mjs`.')
  L.push(
    '> Do not hand-edit the command/event index; add prose in the sections at the end.'
  )
  L.push('')
  L.push('## Summary')
  L.push('')
  L.push('| Surface | Count |')
  L.push('|---|---|')
  L.push(`| Commands registered in \`generate_handler!\` | ${d.registered.length} |`)
  L.push(`| Commands invoked by the frontend | ${d.invoked.length} |`)
  L.push(`| Registered but never invoked (\`uncalled\`) | ${d.uncalled.length} |`)
  L.push(`| Invoked but not registered (\`ghost\`) | ${d.ghost.length} |`)
  L.push(`| Events emitted by Rust | ${d.events.emitted.length} |`)
  L.push(`| Events listened for by TS | ${d.events.listened.length} |`)
  L.push(`| Events emitted by Rust with no TS listener | ${d.events.unlistened.length} |`)
  L.push('')
  L.push('## Commands')
  L.push('')
  L.push('| Command | Defined in | Invoked by frontend |')
  L.push('|---|---|---|')
  const invokedSet = new Set(d.invoked)
  for (const c of d.registered) {
    const src = d.commandSources[c] ?? ''
    L.push(`| \`${c}\` | \`${src}\` | ${invokedSet.has(c) ? 'yes' : '**no**'} |`)
  }
  L.push('')
  L.push('## Events')
  L.push('')
  L.push('| Event | Emitted by (Rust) | Listened by (TS) |')
  L.push('|---|---|---|')
  const all = [...new Set([...d.events.emitted, ...d.events.listened])].sort()
  for (const e of all) {
    L.push(
      `| \`${e}\` | ${
        d.events.emittedSources[e] ? `\`${d.events.emittedSources[e]}\`` : '—'
      } | ${d.events.listenedSources[e] ? `\`${d.events.listenedSources[e]}\`` : '—'} |`
    )
  }
  L.push('')
  L.push('## Drift findings')
  L.push('')
  if (d.ghost.length) {
    L.push('**Ghost commands** (invoked, not registered — runtime failure):')
    for (const c of d.ghost) L.push(`- \`${c}\``)
  } else {
    L.push('No ghost commands: every frontend-invoked command is registered.')
  }
  L.push('')
  L.push(`**Uncalled commands** (${d.uncalled.length}) — registered, no frontend caller:`)
  L.push('')
  for (const c of d.uncalled) L.push(`- \`${c}\``)
  L.push('')
  if (d.events.unlistened.length) {
    L.push('**Events with no frontend listener:**')
    for (const e of d.events.unlistened)
      L.push(`- \`${e}\` (emitted in \`${d.events.emittedSources[e]}\`)`)
    L.push('')
  }
  if (d.dynamicInvokeFiles.length) {
    L.push('**Files with a computed `invoke()` argument** (not statically checkable):')
    for (const f of d.dynamicInvokeFiles) L.push(`- \`${f}\``)
    L.push('')
  }
  return L.join('\n') + '\n'
}

const data = build()

if (ARGS.has('--json')) {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n')
} else if (ARGS.has('--check')) {
  const problems = []
  if (data.ghost.length) problems.push(`ghost commands: ${data.ghost.join(', ')}`)
  if (data.registeredWithoutDefinition.length)
    problems.push(
      `registered without definition: ${data.registeredWithoutDefinition.join(', ')}`
    )
  if (problems.length) {
    console.error('IPC DRIFT:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  console.log('IPC drift check: OK')
} else {
  process.stdout.write(markdown(data))
}
