# AGENTS.md

PasteBar is a cross-platform clipboard manager (Tauri 1.8 + Rust backend, React 18 UI)
with unlimited clipboard history, custom clips, collections and multi-window paste.

**This file is a map, not a manual.** Read the linked document before working in an area.

---

## Commands

```bash
npm start                     # dev mode: Vite on :4422 + tauri dev
npm run build                 # production bundle (tauri build, release conf)
npm run app:build:debug       # debug bundle

# Harness gates — run this before claiming any task is done
bash scripts/harness/check-all.sh     # every gate, same set as CI (Phase 3)
npm run lint                  # eslint over the UI package
npm run typecheck             # tsc --noEmit, root + UI package
npm run format:check          # prettier --check + cargo fmt --check
npm test                      # vitest (UI package)
npm run test:rust             # cargo test (src-tauri)

bash scripts/harness/scan.sh           # static metrics; compare against docs/harness/scan-baseline.txt
node scripts/harness/gen-ipc-contract.mjs --check   # IPC drift gate

cd src-tauri && cargo clippy            # Rust lints
npm run diesel:migration:run            # apply migrations
npm run translation-audit               # i18n key audit
```

Frontend-only work (no Rust rebuild):

```bash
cd packages/pastebar-app-ui
npm run dev      # Vite dev server, :4422
npm run build    # → dist-ui/
npm run build:ts # tsc && vite build
```

**Dependency install note.** `npm ci` fails on machines whose global `~/.npmrc` contains an
`allow-scripts` entry, because npm forwards it to the nested install of the two GitHub
dependencies (`tauri-plugin-log-api`, `tauri-plugin-positioner-api`). Work around it with
`npm ci --ignore-scripts --userconfig /dev/null`, or delete the `allow-scripts` line from
`~/.npmrc`. CI is unaffected (no such user config).

---

## Repository map

```
src-tauri/                   Rust backend (Tauri 1.8, Diesel/SQLite)
  src/main.rs                app bootstrap, tray, windows, hotkeys, global commands
  src/commands/              #[tauri::command] handlers — the IPC surface
  src/services/              business logic (history, items, collections, link metadata, …)
  src/models/models.rs       serde structs shared with the frontend
  src/db.rs                  connection pool, migrations, {{base_folder}} path transforms
  src/clipboard/mod.rs       clipboard monitoring plugin
  src/menu.rs                system tray menu construction
  src/cron_jobs.rs           scheduled history retention
  libs/                      VENDORED tao/inputbot forks — do not edit, excluded from all gates

packages/pastebar-app-ui/    React + TypeScript UI (npm workspace package)
  src/main.tsx               main window entry
  src/history-main.tsx       history window entry
  src/quickpaste-main.tsx    QuickPaste window entry
  src/store/                 zustand/jotai stores (settings, clipboardHistory, collection, …)
  src/pages/, src/layout/    screens and shell
  src/lib/commands.ts        IPC helper layer
  src/components/libs/       VENDORED third-party copies — do not edit, excluded from all gates

docs/                        the record system (see docs/README.md)
scripts/harness/             gates and scans — the agent-facing feedback loop
migrations/                  Diesel migrations (embedded at build time)
```

---

## Architecture rules

1. **Backend layering is `commands → services → models/db`.** A command parses input and
   converts errors; it contains no business logic. A service contains logic and never
   imports from `commands`. New code must not add a `services → commands` edge.
2. **`src-tauri/libs/**`and`src/components/libs/**` are vendored.** Never edit them;
   never add them to a lint baseline or a metric.
3. **IPC is a contract.** Every command and event is indexed in
   [`docs/contracts/tauri-ipc.md`](docs/contracts/tauri-ipc.md); the drift gate fails when
   code and contract disagree. Add the contract entry in the same commit as the change.
4. **Image paths are stored relative** with a `{{base_folder}}` placeholder and converted at
   the boundary by `db::to_relative_image_path` / `to_absolute_image_path`. Never persist an
   absolute image path.
5. **Use `get_data_dir()`, `get_clip_images_dir()`, `get_clipboard_images_dir()`** — never
   hard-code an application path; the data directory is user-relocatable.
6. **Frontend state:** server state via React Query, atom state via Jotai, persisted stores
   via zustand. Do not introduce another state library.
7. **Debug logging in Rust uses `debug_output(|| …)`**, which compiles out in release.
   `println!` on the startup path is a defect, not a debug aid.

---

## Golden rules (lint-enforced — see `docs/harness/GOLDEN-RULES.md`)

- New source files ≤ 500 lines; existing > 1000-line files are baselined and must shrink.
- New functions ≤ sonarjs cognitive complexity 40 (ratcheting to 25).
- No `any`, no `@ts-ignore`, no empty `catch {}`, no `console.*` in new code.
- No `unwrap()`/`expect()` in new Rust on a path reachable from user input.
- Every fix cites an ISSUE-ID from `docs/harness/ISSUES.md` and states whether behaviour changed.

---

## Where to look next

| Question                                  | Document                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| What is the whole architecture?           | [`docs/architecture.md`](docs/architecture.md)                                                             |
| Which IPC command/event exists?           | [`docs/contracts/tauri-ipc.md`](docs/contracts/tauri-ipc.md)                                               |
| How does clipboard capture work?          | [`docs/modules/backend-clipboard.md`](docs/modules/backend-clipboard.md)                                   |
| How are history/items/collections stored? | [`docs/modules/backend-services.md`](docs/modules/backend-services.md)                                     |
| What are the backend commands?            | [`docs/modules/backend-commands.md`](docs/modules/backend-commands.md)                                     |
| How does the UI boot and hold state?      | [`docs/modules/frontend-architecture.md`](docs/modules/frontend-architecture.md)                           |
| How do I build/release/migrate?           | [`docs/reference/build-and-release.md`](docs/reference/build-and-release.md)                               |
| What is the security/trust model?         | [`docs/security-model.md`](docs/security-model.md)                                                         |
| How do I write and run tests?             | [`docs/testing.md`](docs/testing.md)                                                                       |
| Which gates run, and what do they block?  | [`docs/harness/gates.md`](docs/harness/gates.md)                                                           |
| What is known broken, and in what order?  | [`docs/harness/ISSUES.md`](docs/harness/ISSUES.md), [`docs/harness/FIX-PLAN.md`](docs/harness/FIX-PLAN.md) |
| Why was a tradeoff made?                  | [`docs/harness/DECISIONS.md`](docs/harness/DECISIONS.md)                                                   |
| What must I manually verify?              | [`docs/harness/smoke-checklist.md`](docs/harness/smoke-checklist.md)                                       |

---

## Known constraints

- **macOS + Windows only.** Tray and accessibility code is platform-gated; Linux is untested.
- **No `main`-branch history to lean on** — harness work lands on `harnessing`.
- **The test suite is new (Phase 5).** Until it lands, rely on the manual smoke checklist
  in `docs/harness/smoke-checklist.md` before merging behaviour changes.
- **`npm run build` needs a full Tauri toolchain** (Rust + platform SDK); frontend-only
  type checks do not.
