#!/usr/bin/env node
/**
 * Release build: bump the patch version, build, collect artifacts, clean up.
 *
 * Why a script rather than npm scripts chained together:
 *
 *   1. **The version bump must happen before the build reads it.** `tauri.conf.json` points
 *      its `version` at `package.json`, and Tauri bakes it into the bundle name, the DMG
 *      filename and `Info.plist`. Bumping after the build (or in a separate command that can
 *      be forgotten) ships a binary whose version does not match its filename.
 *
 *   2. **Two files hold the version.** `packages/pastebar-app-ui/package.json` is the source
 *      of truth — `scripts/sync-version.js` copies from it into the root manifest — and
 *      Tauri reads the root one. Bumping only one produces a build labelled with the old
 *      version, which is exactly the failure that is hardest to notice.
 *
 *   3. **`src-tauri/target` grows without bound.** It reached 6.3 GB of incremental state
 *      that nothing ever removed. Each run now prunes it back to the current artifacts.
 *
 * Output layout (project root `target/`):
 *
 *     target/PasteBar.app
 *     target/PasteBar_<version>_<arch>.dmg
 *
 * Usage:
 *   node scripts/build-app.mjs              # bump patch, build, collect, clean
 *   node scripts/build-app.mjs --no-bump    # rebuild the current version
 *   node scripts/build-app.mjs --keep-build-dir   # leave src-tauri/target in place
 *   node scripts/build-app.mjs --version 1.2.3    # set an explicit version
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UI_PKG = path.join(ROOT, 'packages/pastebar-app-ui/package.json')
const ROOT_PKG = path.join(ROOT, 'package.json')
const RUST_TARGET = path.join(ROOT, 'src-tauri/target/release')
const OUT_DIR = path.join(ROOT, 'target')
const BUNDLE_DIR = path.join(RUST_TARGET, 'bundle')

const args = process.argv.slice(2)
const has = flag => args.includes(flag)

function log(msg) {
  console.log(`\n\u001b[1m▸ ${msg}\u001b[0m`)
}

// ---------------------------------------------------------------------------
// 1. Version
// ---------------------------------------------------------------------------

/**
 * Bump the patch component: 0.7.0 -> 0.7.1.
 *
 * A patch bump is the right default for "build me something to test": it signals a build
 * that fixes or adjusts behaviour without changing the feature set, and it keeps successive
 * test builds ordered. Feature releases are a deliberate `--version` invocation.
 */
export function bumpPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) {
    throw new Error(
      `Cannot bump '${version}': expected MAJOR.MINOR.PATCH. ` +
        `Pass --version explicitly for a non-standard version string.`
    )
  }
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

function readVersion() {
  return JSON.parse(readFileSync(UI_PKG, 'utf8')).version
}

/**
 * Write the version to BOTH manifests.
 *
 * The root manifest is kept byte-identical in style to what `scripts/sync-version.js`
 * produces (2-space JSON, trailing newline), so a later `npm run version:sync` is a no-op
 * rather than a reformatting diff.
 */
function writeVersion(version) {
  const ui = JSON.parse(readFileSync(UI_PKG, 'utf8'))
  ui.version = version
  writeFileSync(UI_PKG, JSON.stringify(ui, null, 2) + '\n')

  const root = JSON.parse(readFileSync(ROOT_PKG, 'utf8'))
  root.version = version
  writeFileSync(ROOT_PKG, JSON.stringify(root, null, 2) + '\n')
}

// ---------------------------------------------------------------------------
// 2. Build
// ---------------------------------------------------------------------------

/**
 * Environment for the build.
 *
 * Two machine-specific workarounds, both documented in
 * `docs/reference/build-and-release.md`:
 *
 *   - `CLANG_MODULE_CACHE_PATH`: clang cannot write its module cache under the default
 *     `$TMPDIR` here, and `mac-notification-sys` compiles Objective-C against Cocoa.
 *   - A PATH without the DSH shim directory: `node` on the inherited PATH is a shell script
 *     that execs the DSH helper, so node-based CLIs see the wrong process name and
 *     `tauri build` reports `unrecognized subcommand`.
 *
 * Rather than hard-code an absolute node path, this strips the known-bad directories from
 * the inherited PATH and prepends the real node's directory.
 */
function buildEnv() {
  const badDirs = [/dsh-desktop/, /DSH Desktop Helper/]

  // NOTE: `process.execPath` is NOT usable as "the real node" here. The harness runs this
  // script through a shim, so `execPath` is the shim's own binary — the very process the
  // Tauri CLI chokes on. Prepending its directory would re-introduce the problem.
  const pathParts = (process.env.PATH ?? '')
    .split(':')
    .filter(p => p && !badDirs.some(re => re.test(p)))

  // Find a real node earlier on the stripped PATH. `tauri` is a node program and resolves
  // its own child processes by name, so this is what decides whether the build runs.
  const realNode = pathParts
    .map(dir => path.join(dir, 'node'))
    .find(candidate => existsSync(candidate) && !isShim(candidate))

  if (!realNode) {
    throw new Error(
      'Could not find a real node binary on PATH. The one this script is running under is a ' +
        'shim (it execs another process), and `tauri build` fails when it resolves that shim. ' +
        'Install node via a package manager, or pass one explicitly.'
    )
  }

  return {
    ...process.env,
    PATH: [path.dirname(realNode), ...pathParts].join(':'),
    CLANG_MODULE_CACHE_PATH:
      process.env.CLANG_MODULE_CACHE_PATH ?? path.join(OUT_DIR, '.clang-modcache'),
  }
}

/**
 * Whether a `node` on disk is a wrapper script rather than the real interpreter.
 *
 * A shim is identified by shell-script content: the real node is a Mach-O binary. This is
 * deliberately not a name check — the point is to catch any wrapper, whatever it is called.
 */
function isShim(file) {
  try {
    // FOUR bytes, not two: the Mach-O magic is a 4-byte value (64-bit cffaedfe, 32-bit
    // cefaedfe, universal cafebabe). Comparing only the first two silently rejects every
    // real binary, which is how this check first failed — it reported "no real node on
    // PATH" while `/opt/homebrew/bin/node` was sitting right there.
    const head = readFileSync(file).subarray(0, 4).toString('latin1')
    return ![
      '\u00cf\u00fa\u00ed\u00fe',
      '\u00ce\u00fa\u00ed\u00fe',
      '\u00ca\u00fe\u00ba\u00be',
    ].includes(head)
  } catch {
    return true
  }
}

function runBuild(env) {
  // Invoke the CLI's JS entry point through the real node found above.
  //
  // NOT `node_modules/.bin/tauri`: that file starts with `#!/usr/bin/env node`, which
  // re-resolves `node` from PATH inside the child process — landing back on the shim and
  // failing exactly as if the PATH fix had never been applied. Passing the JS file to a
  // known-good node bypasses the shebang entirely.
  const cli = path.join(ROOT, 'node_modules/@tauri-apps/cli/tauri.js')

  // `env.PATH` was built as [nodeDir, ...rest], so its FIRST entry already IS the node
  // directory. Calling `path.dirname` on it walks one level too high and yields a path
  // like `/opt/homebrew/node`, which does not exist — `spawnSync` then fails instantly and
  // `runBuild` reports a build failure in 0.1s without ever invoking cargo.
  const nodeBin = path.join(env.PATH.split(':')[0], 'node')

  const res = spawnSync(
    nodeBin,
    [cli, 'build', '--config', 'src-tauri/tauri.release.conf.json'],
    { cwd: ROOT, env, stdio: 'inherit' }
  )

  if (res.error) {
    console.error(`Could not start the build: ${res.error.message}`)
    console.error(`  tried: ${nodeBin}`)
  }
  return res.status ?? 1
}

// ---------------------------------------------------------------------------
// 3. Collect
// ---------------------------------------------------------------------------

const MACOS_BUNDLE = path.join(BUNDLE_DIR, 'macos/PasteBar.app')
const DMG_DIR = path.join(BUNDLE_DIR, 'dmg')

/**
 * Build a DMG ourselves instead of relying on Tauri's `bundle_dmg.sh`.
 *
 * Tauri's script runs `bless` and a cosmetic AppleScript, both of which need privileges a
 * sandboxed/CI shell does not have — it fails at the very last step, after the `.app` is
 * already complete. It does ship a `--sandbox-safe` flag for this, but Tauri 1.x has no
 * configuration to pass it through, so the script is unusable here as-is.
 *
 * Doing it directly is also more predictable: the layout below is fixed rather than
 * inherited from the bundler's version-specific defaults.
 *
 * Standard hdiutil sequence: create a read-write image, mount it, populate it, unmount,
 * then convert to a compressed read-only image. The intermediate file must be removed
 * explicitly — leaving it behind is how "cleaned up" build directories stop being clean.
 */
function buildDmg(appPath, version, arch, outFile) {
  const staging = path.join(OUT_DIR, '.dmg-staging')
  const rwImage = path.join(OUT_DIR, `.PasteBar-${version}-rw.dmg`)
  const volumeName = 'PasteBar'

  // Clear EVERY path this function writes, including the final output. `hdiutil convert`
  // refuses to overwrite an existing file, so a leftover DMG from a previous run makes the
  // next run fail with "file already exists" — which reads as a bundling problem rather
  // than the stale-file problem it is.
  rmSync(staging, { recursive: true, force: true })
  rmSync(rwImage, { force: true })
  rmSync(outFile, { force: true })
  mkdirSync(staging, { recursive: true })

  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8' })
    if (r.status !== 0) {
      throw new Error(`${cmd} ${args[0]} failed: ${(r.stderr || r.stdout || '').trim()}`)
    }
    return r.stdout ?? ''
  }

  try {
    cpSync(appPath, path.join(staging, 'PasteBar.app'), { recursive: true })
    // The familiar drag-to-install affordance.
    spawnSync('ln', ['-s', '/Applications', path.join(staging, 'Applications')])

    run('hdiutil', [
      'create',
      '-srcfolder',
      staging,
      '-volname',
      volumeName,
      '-fs',
      'HFS+',
      '-format',
      'UDRW',
      rwImage,
    ])

    const attach = run('hdiutil', [
      'attach',
      rwImage,
      '-nobrowse',
      '-readwrite',
      '-plist',
    ])
    // The mount point is the last entry in the plist's system-entities mount-point chain.
    const mountMatch = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(attach)
    if (!mountMatch) throw new Error('could not determine the mounted volume path')
    const mountPoint = mountMatch[1]

    try {
      // `bless` is what makes the volume auto-open in Finder; it needs privileges the
      // sandbox lacks, and a DMG works without it, so a failure here is not fatal.
      spawnSync('bless', ['--folder', mountPoint])
    } finally {
      run('hdiutil', ['detach', mountPoint, '-force'])
    }

    run('hdiutil', [
      'convert',
      rwImage,
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=9',
      '-o',
      outFile,
    ])
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(rwImage, { force: true })
  }
}

function collectArtifacts() {
  mkdirSync(OUT_DIR, { recursive: true })

  const collected = { app: null, dmg: null }

  if (existsSync(MACOS_BUNDLE)) {
    const dest = path.join(OUT_DIR, 'PasteBar.app')
    rmSync(dest, { recursive: true, force: true })
    cpSync(MACOS_BUNDLE, dest, { recursive: true })
    // Clear the provenance/quarantine attributes macOS attaches to a copied bundle, which
    // otherwise make a locally built app refuse to launch on some systems.
    spawnSync('xattr', ['-cr', dest])
    collected.app = dest
  }

  // Prefer Tauri's DMG when the bundler managed to produce one (it does on a normal
  // machine). Otherwise build it here, so a build is never left without the artifact the
  // user asked for just because the bundler's bless/AppleScript step was not permitted.
  const fromTauri = existsSync(DMG_DIR)
    ? readdirSync(DMG_DIR).find(f => f.endsWith('.dmg'))
    : undefined

  if (fromTauri) {
    const dest = path.join(OUT_DIR, fromTauri)
    cpSync(path.join(DMG_DIR, fromTauri), dest)
    collected.dmg = dest
  }

  return collected
}

// ---------------------------------------------------------------------------
// 4. Clean
// ---------------------------------------------------------------------------

/**
 * Remove build intermediates, keeping only the collected artifacts in `target/`.
 *
 * `src-tauri/target` is Cargo's own directory and holds `release/` (the binary), `debug/`,
 * `bundle/` (already copied out) and incremental state. Deleting the whole thing also
 * discards the compiled dependencies, so the next build recompiles everything from scratch
 * — which is the expensive part of a 2.5-minute build and would make every test build
 * slower than the last.
 *
 * The rule applied here: keep what makes the NEXT build fast, remove what is only useful to
 * an already-finished one. `debug/` (never used by a release build) and the intermediate
 * `bundle/` output go; `release/` stays as Cargo's cache.
 *
 * `--keep-build-dir` skips this entirely for debugging a build.
 */
export function cleanBuildDir({ keepReleaseBinary = false } = {}) {
  const removed = []

  const candidates = [
    path.join(ROOT, 'src-tauri/target/debug'),
    path.join(ROOT, 'src-tauri/target/release/bundle'),
    BUNDLE_DIR,
  ]

  if (!keepReleaseBinary) {
    // The bare (non-bundled) release binary is ~50 MB and superseded by the .app.
    candidates.push(path.join(RUST_TARGET, 'pastebar-app'))
  }

  for (const dir of candidates) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
      removed.push(path.relative(ROOT, dir))
    }
  }

  return removed
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const before = readVersion()
  let version = before

  if (has('--version')) {
    version = args[args.indexOf('--version') + 1]
    if (!version) throw new Error('--version needs a value')
  } else if (!has('--no-bump')) {
    version = bumpPatch(before)
  }

  if (version !== before) {
    log(`Version ${before} -> ${version}`)
    writeVersion(version)
  } else {
    log(`Version ${version} (unchanged)`)
  }

  // Remove any previous bundle output BEFORE building.
  //
  // Without this, a build that fails at the bundling step leaves the previous run's
  // `bundle/macos/PasteBar.app` in place, and `collectArtifacts` happily copies it to
  // `target/` as if it were this run's output. The result is a build labelled with the new
  // version that is actually the old binary — the failure mode this whole script exists to
  // prevent, and one that is invisible until the app misbehaves.
  rmSync(BUNDLE_DIR, { recursive: true, force: true })

  log('Building (frontend + Rust release + bundle)')
  const code = runBuild(buildEnv())
  if (code !== 0) {
    // The DMG step commonly fails in restricted environments (it mounts a disk image) while
    // the .app has already been produced. Report what was collected instead of implying
    // nothing is usable.
    const partial = collectArtifacts()
    console.error(`\nBuild exited ${code}.`)
    if (!partial.app) {
      console.error(
        'No .app was produced by this run. (The previous bundle output is removed before ' +
          'each build, so a stale app cannot be mistaken for a fresh one.)'
      )
    }
    if (partial.app) {
      console.error(`The .app WAS produced and collected: ${partial.app}`)
      console.error(
        'A failure at the bundling/DMG step means the DMG is missing, not the app.'
      )
      // Same recovery as the success path: the .app is complete and usable, so finish the
      // job the user actually asked for rather than handing back a half-delivered build.
      if (!partial.dmg) {
        try {
          const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
          const dest = path.join(OUT_DIR, `PasteBar_${version}_${arch}.dmg`)
          buildDmg(partial.app, version, arch, dest)
          console.error(`Built the DMG directly: ${dest}`)
        } catch (err) {
          console.error(`  DMG could not be built either: ${err.message}`)
        }
      }
    } else {
      console.error('No .app was produced — the build failed before bundling.')
    }
    process.exit(code)
  }

  log('Collecting artifacts')
  const collected = collectArtifacts()

  if (!collected.dmg && collected.app) {
    log('Bundler produced no DMG; building one directly')
    try {
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x64'
      const dest = path.join(OUT_DIR, `PasteBar_${version}_${arch}.dmg`)
      buildDmg(collected.app, version, arch, dest)
      collected.dmg = dest
    } catch (err) {
      console.error(`  DMG could not be built: ${err.message}`)
    }
  }

  const { app, dmg } = collected

  if (!has('--keep-build-dir')) {
    log('Cleaning build intermediates')
    const removed = cleanBuildDir()
    for (const r of removed) console.log(`  removed ${r}`)
  }

  log('Done')
  console.log(`  version: ${version}`)
  if (app) console.log(`  app:     ${path.relative(ROOT, app)}`)
  else console.error('  app:     MISSING')
  if (dmg) console.log(`  dmg:     ${path.relative(ROOT, dmg)}`)
  else console.error('  dmg:     MISSING')

  if (!app || !dmg) process.exit(1)
}

// Only run when invoked directly, so a test can import `bumpPatch` without building.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  main().catch(err => {
    console.error(`\nbuild-app: ${err.message}`)
    process.exit(1)
  })
}
