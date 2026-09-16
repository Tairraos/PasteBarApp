# Build and Release

> Last verified: 2026-09-16 · Branch `harnessing`
> Scope: how to install, develop, and produce a production bundle for PasteBar.
> For the migration side of a release, see [`database-migrations.md`](database-migrations.md).

## 1. Prerequisites

| Tool         | Version verified                                      | Notes                                                                                                      |
| ------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Node.js      | v24.18.1 (local)                                      | No `engines` field and no `.nvmrc` in the repo — any modern LTS is assumed. CI uses `node-version: lts/*`. |
| npm          | 11.17.0 (local)                                       | See the install caveat in §7.                                                                              |
| Rust         | rustc 1.96.1 / cargo 1.96.1                           | No `rust-toolchain.toml`; CI uses `dtolnay/rust-toolchain@stable`.                                         |
| Diesel CLI   | required for schema work only                         | `cargo install diesel_cli --no-default-features --features sqlite`                                         |
| Platform SDK | macOS: Xcode CLT · Windows: VS 2022 C++ / Windows SDK | required only for a real `tauri build`, not for frontend work.                                             |

The Diesel CLI is **not** needed to run the app or build the frontend: migrations are
embedded in the binary at compile time ([`database-migrations.md`](database-migrations.md) §2),
so `npm run diesel:migration:run` is a developer convenience, not a build step.

## 2. Dev workflow

```bash
npm install          # or the workaround in §7
npm start            # == npm run dev == tauri dev
```

`npm run dev` and `npm start` are the same script (`package.json:6-7`). Tauri then runs
`beforeDevCommand` from `tauri.conf.json:5` — `cd packages/pastebar-app-ui && npm run dev` —
and loads the webview from `devPath: "http://localhost:4422/"` (`tauri.conf.json:6`).

Frontend-only work (no Rust rebuild) happens inside the workspace package:

```bash
cd packages/pastebar-app-ui
npm run dev       # vite dev server, strict port 4422
npm run build     # vite build → dist-ui/
npm run build:ts  # tsc && vite build
```

Port `4422` is pinned with `strictPort: true` (`packages/pastebar-app-ui/vite.config.mts:51-53`), so a second dev
server fails fast rather than silently moving ports.

| Script                      | Location                                  | Effective command   |
| --------------------------- | ----------------------------------------- | ------------------- |
| `npm start` / `npm run dev` | `package.json:6-7`                        | `tauri dev`         |
| UI `npm run dev`            | `packages/pastebar-app-ui/package.json:6` | `vite`              |
| UI `npm run build`          | `packages/pastebar-app-ui/package.json:8` | `vite build`        |
| UI `npm run build:ts`       | `packages/pastebar-app-ui/package.json:9` | `tsc && vite build` |

## 3. Production builds

All build variants pass `--config src-tauri/tauri.release.conf.json` explicitly
(`package.json:11-15`):

| Script                            | Target                    | Notes                                                               |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `npm run app:build`               | host default target       | also reachable as `npm run build` (`package.json:10`).              |
| `npm run app:build:debug`         | host default target       | adds `--debug`; release _config_, debug _code_.                     |
| `npm run app:build:osx:universal` | `universal-apple-darwin`  | Intel + Apple Silicon in one bundle.                                |
| `npm run app:build:osx:x86_64`    | `x86_64-apple-darwin`     | Intel only.                                                         |
| `npm run app:build:windows:arm`   | `aarch64-pc-windows-msvc` | see [`build-guide-arm64-windows.md`](build-guide-arm64-windows.md). |

There is **no** `app:build:osx:arm64` script, and no Windows x64 script — those rely on the
host default target of `app:build`.

### `tauri.conf.json` vs `tauri.release.conf.json`

`tauri build --config <file>` **merges** the given file over the base `tauri.conf.json`; it
does not replace it. The release file only carries the keys it overrides:

| Key                                  | `tauri.conf.json` (dev/base)          | `tauri.release.conf.json`                                                                                       |
| ------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `build.distDir`                      | `../packages/pastebar-app-ui/dist-ui` | `../packages/pastebar-app-ui/dist-ui/` (trailing slash)                                                         |
| `build.beforeDevCommand` / `devPath` | present                               | absent (dev-only keys)                                                                                          |
| `package.productName` / `version`    | `PasteBar`, `../package.json`         | absent — inherited from the base                                                                                |
| `tauri.allowlist`                    | **present**, full CSP + `"all": true` | absent — inherited from the base                                                                                |
| `tauri.systemTray`                   | present                               | absent — inherited                                                                                              |
| `tauri.bundle.copyright`             | `""`                                  | `"AnotherVision LLC"`                                                                                           |
| `tauri.bundle.shortDescription`      | `""`                                  | `"Limitless Clipboard Manager"`                                                                                 |
| `tauri.bundle.windows`               | `nsis`, `webviewInstallMode` only     | adds `certificateThumbprint`, `digestAlgorithm: "sha256"`, `timestampUrl` — the Windows **code-signing** config |
| `tauri.updater`                      | present                               | present (same endpoint + pubkey)                                                                                |

Practical consequence: the release config adds Windows Authenticode signing and real bundle
metadata, while the security posture (allowlist, CSP) comes entirely from
`tauri.conf.json` and is identical in dev and release.

## 4. Frontend build pipeline

Three Vite entries are declared in `packages/pastebar-app-ui/vite.config.mts:77-83`, one per
Tauri webview window:

| Entry (html)            | Rollup input key | Window                   |
| ----------------------- | ---------------- | ------------------------ |
| `index.html`            | `main`           | main window              |
| `history-index.html`    | `history`        | clipboard-history window |
| `quickpaste-index.html` | `quickpaste`     | QuickPaste popup         |

Output goes to `packages/pastebar-app-ui/dist-ui/` (`packages/pastebar-app-ui/vite.config.mts:71`), exactly the
`distDir` Tauri bundles. Tauri triggers the build through `beforeBuildCommand` in **both**
configs (`tauri.conf.json:3`, `tauri.release.conf.json:3`), so `tauri build` always rebuilds
the UI first.

The build runs as `npm run build` → plain `vite build`, **not** `build:ts`. Type checking is
therefore not part of a production bundle; run `npm run build:ts` (or `tsc --noEmit`)
separately.

A `closeBundle` hook (`packages/pastebar-app-ui/vite.config.mts:117-133`) then writes `dist-ui/ui.version.<version>`,
copies `assets/styles` → `dist-ui/assets/styles`, and copies `assets/markdown` →
`dist-ui/assets/markdown` (the markdown wasm). `viteStaticCopy` (`packages/pastebar-app-ui/vite.config.mts:109-116`)
additionally copies `drop-*` into the output root.

Verified output of `npm run build` in the UI package:

```
dist-ui/
├── assets/
├── drop-image.html
├── drop-path.html
├── history-index.html
├── index.html
├── quickpaste-index.html
└── ui.version.0.7.0
```

The build also defines `BUILD_DATE`, `APP_VERSION` (root `package.json`) and
`APP_UI_VERSION` (UI `package.json`) as compile-time constants (`packages/pastebar-app-ui/vite.config.mts:55-59`),
reading the root manifest via `PASTEBAR_APP_PATH` and **exiting non-zero** if it cannot be
found (`packages/pastebar-app-ui/vite.config.mts:23-38`).

## 5. Version management

Versions are managed with changesets plus a hand-written sync script:

```bash
npm run changeset     # add a changeset (.changeset/*.md)
npm run version       # changeset version && npm run version:sync
npm run version:sync  # node scripts/sync-version.js
```

`scripts/sync-version.js` is the source of truth for propagation: it reads
`packages/pastebar-app-ui/package.json` and copies its `version` into the root
`package.json` (`scripts/sync-version.js:19`), then mirrors the UI `CHANGELOG.md` to the root
one if it exists (`scripts/sync-version.js:34-37`). The UI package version is therefore the
one to bump; the root follows.

`.changeset/` currently contains only `config.json` — no pending changeset files. Tauri
takes its version from `package.version: "../package.json"` (`tauri.conf.json:11`), so the
root `package.json` version is what ends up in the bundle.

## 6. CI today

`.github/workflows/build-test.yml` is the only build workflow. It has two jobs:

| Job            | Runner          | What it does                                                                                                                                                         |
| -------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version-bump` | `ubuntu-latest` | checks for `.changeset/*.md`; if any exist, branches, runs `npm run version`, commits and opens a PR against `main`. Skips entirely when there are none.             |
| `test-tauri`   | `macos-latest`  | `needs: version-bump`; installs Rust stable + `aarch64-apple-darwin`, runs `npm install`, then `tauri-action@v0` with `--target aarch64-apple-darwin --bundles app`. |

Trigger: `workflow_dispatch` **only**. The `push` trigger on `main` is commented out at
`.github/workflows/build-test.yml:4-5`, so nothing runs automatically — the workflow must be
started by hand. This is tracked as ISSUE-009 in
[`../harness/ISSUES.md`](../harness/ISSUES.md).

**Explicitly, the workflow does NOT:** run lint, run typecheck (`tsc`), run any test suite,
run `cargo clippy` or `cargo fmt --check`, run the harness gates
(`scripts/harness/check-all.sh`), or check IPC drift. It only proves that the app still
compiles and bundles for Apple Silicon. No quality gate exists on any trigger.

## 7. Dependency install caveat (verified)

On a machine whose **user-level** `~/.npmrc` contains an `allow-scripts` entry, `npm ci`
fails. Reproduced here:

```
$ npm config get allow-scripts
esbuild,esbuild,esbuild,esbuild

$ npm ci
npm error code 1
npm error git dep preparation failed
npm error command … npm-cli.js install --force … --no-save …
npm error npm error code EALLOWSCRIPTS
npm error npm error --allow-scripts is not allowed in project-scoped installs.
npm error npm error Add the entries to the "allowScripts" field in package.json, or to .npmrc, instead.
```

**Root cause.** `package.json:135-136` (mirrored in
`packages/pastebar-app-ui/package.json:135-136`) declares two **git** dependencies:

```json
"tauri-plugin-log-api": "github:tauri-apps/tauri-plugin-log",
"tauri-plugin-positioner-api": "github:tauri-apps/tauri-plugin-positioner"
```

npm satisfies a git dependency by running a **nested `npm install` inside the cloned
checkout**. npm 11.17 forwards the user-level `allow-scripts` config into that nested
install, which is treated as project-scoped, so the nested install aborts with
`EALLOWSCRIPTS`. The error is attributed to "git dep preparation", which is why it does not
look like a config problem.

**Workaround** (verified to succeed — `added 1302 packages`):

```bash
npm ci --ignore-scripts --userconfig /dev/null
```

`--userconfig /dev/null` drops the user config so the `allow-scripts` value is never
forwarded; `--ignore-scripts` keeps lifecycle scripts off for the top-level install. The
alternative is deleting the `allow-scripts` line from `~/.npmrc`.

**CI runners are unaffected** — `actions/setup-node` provides no such user config, which is
why the pipeline uses plain `npm install` / `npm i` and never hits this.

---

See also: [`build-guide-arm64-windows.md`](build-guide-arm64-windows.md) ·
[`database-migrations.md`](database-migrations.md) · [`../harness/ISSUES.md`](../harness/ISSUES.md)

---

## Building on this machine: two environment traps

Both of these are properties of the machine, not of the repository. Neither affects CI.

### 1. `node` on `PATH` is a shim that renames the process

`/Users/xiaole/Library/Application Support/dsh-desktop/harness/.desktop-bin/node` is a shell
script that `exec`s `DSH Desktop Helper`. Node-based CLIs that read `process.argv[0]` or rely
on their own process name therefore see `DSH Desktop Helper` instead of the script — and
`tauri build` fails with:

```
error: unrecognized subcommand '/Applications/DSH Desktop.app/.../DSH Desktop Helper'
```

**Fix:** put a real Node earlier on `PATH` for the build:

```bash
env -i PATH="/opt/homebrew/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    HOME="$HOME" CLANG_MODULE_CACHE_PATH=/tmp/pb-modcache \
    ./node_modules/.bin/tauri build --config src-tauri/tauri.release.conf.json
```

### 2. clang cannot write its module cache under the default `$TMPDIR`

`mac-notification-sys` compiles Objective-C against `Cocoa`, and clang fails with
`unable to open output file '…/ModuleCache/…/Cocoa-*.pcm': 'Operation not permitted'`,
which surfaces as `failed to run custom build command for mac-notification-sys`. Redirecting
the cache is enough:

```bash
export CLANG_MODULE_CACHE_PATH=/tmp/pb-modcache
```

### Producing a bundle without the DMG step

`tauri build` finishes the `.app` and then fails at `bundle_dmg.sh`, which mounts a disk
image — not permitted in a restricted environment. **The `.app` is already complete at that
point**, so a failed DMG step is not a failed build:

```bash
cp -R src-tauri/target/release/bundle/macos/PasteBar.app dist-app/
xattr -cr dist-app/PasteBar.app          # clear provenance/quarantine
open dist-app/PasteBar.app
```

The bundle is ad-hoc signed (`Signature=adhoc`), which is expected for a local build and
sufficient for local testing. It is not distributable — that needs a Developer ID identity.

**Note on first launch:** the app writes to `~/Library/Application Support/app.anothervision.pasteBar`
(database, clip images) and `~/Library/Caches/app.anothervision.pasteBar` (WebKit). If either
is read-only, startup fails with `Failed to save window state` / `Operation not permitted`.
