# PasteBar Harness — Issue Inventory (Phase 1)

> **Status:** complete (Phase 1 deliverable, v1)
> **Scope:** static scan + manual deep-read of critical paths, on branch `harnessing` > **Baseline artifact:** `docs/harness/scan-baseline.txt` (regenerate with `bash scripts/harness/scan.sh --save`)
> **Severity legend:** P0 data-loss/crash/security · P1 iteration-blocking · P2 maintenance risk · P3 hygiene
> **Type legend:** `BUG` (behaviour change allowed) · `DEBT` · `RISK` · `HYGIENE`
>
> Every row below was verified against the working tree, not inferred. The references were
> written against commit `066142f`; `scripts/harness/check-issue-refs.mjs` is now a live
> gate (gate 4b) that fails when a `file:line` reference no longer resolves, points past the
> end of its file, or when an ISSUE-ID is duplicated or cited without a definition. Run it
> with `node scripts/harness/check-issue-refs.mjs --report` to see every reference checked.
>
> **Line numbers in the `位置` rows were captured at Phase 1 and have since moved** — wave
> W1 edited `db.rs`, `user_settings_command.rs`, `history_commands.rs`, `settings_service.rs`
> and `tabs_service.rs`, and W4a deleted 186 files. Each fixed issue carries a
> `状态`/`修复说明` row describing what actually changed; trust that over the line numbers.

---

## 0. Scan baseline (excluded from metrics: vendored libs + generated files)

| Metric                                                | Value                |
| ----------------------------------------------------- | -------------------- |
| Rust source files / lines                             | 41 / 12 586          |
| TS/TSX source files / lines                           | 428 / 80 895         |
| `unwrap()`/`expect()` (Rust)                          | **199** (main.rs 96) |
| `println!`/`eprintln!` (Rust)                         | 152                  |
| `panic!`/`todo!`/`unimplemented!`                     | 2                    |
| `#[cfg(test)]`/`#[test]` markers                      | **0**                |
| `console.*` (TS)                                      | 167                  |
| `: any` / `as any` (TS)                               | 30                   |
| `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`         | **76**               |
| Empty `catch {}` / silent `.catch()`                  | 6                    |
| Source files > 1000 lines                             | **22**               |
| Source files > 500 lines                              | 55                   |
| Frontend-invoked IPC commands / backend-registered    | 58 / 115             |
| Tracked `.env` / build artifacts / generated safelist | 1 / 1 / 2            |

---

## 1. P0 — data loss, crash, or security

### ISSUE-001 · Custom data path breaks config lookup → app must be force-quit after relocation

`ID | ISSUE-001`
`位置 | src-tauri/src/db.rs:231-238 (get_data_dir), src-tauri/src/db.rs:343-390 (get_config_file_path), src-tauri/src/services/user_settings_service.rs:30-45 (load_user_config), src-tauri/src/commands/user_settings_command.rs:208-227`
`类型 | BUG`
`风险等级 | P0`
`影响范围 | Data-location feature (0.7.0 headline feature): every write path, every image path transform, every auto-clear job`
`现象与依据 |` `get_config_file_path()` returns a path derived from `APP_CONSTANTS.app_data_dir` / `app_dev_data_dir` — it can only ever be the **default** directory. `load_user_config()` reads that fixed path. `get_data_dir()` (db.rs:231) _itself_ calls `load_user_config()` and then returns `custom_db_path` from it. Consequence: the config file that records the custom location is never found inside the new location, so `custom_db_path` is only ever read from the _default_ directory — the design relies on the user never moving that file. `cmd_set_and_relocate_data` moves only `["pastebar-db.data", "clip-images", "clipboard-images"]` (user*settings_command.rs:157) and then re-initialises the pool, returning "Please restart the application." Because `get_config_file_path()` ignores the custom path entirely, this is fragile by construction and the flow's own message documents that a restart is mandatory. Any environment where the default-dir config is lost (fresh install on a machine pointed at a pre-existing data dir, restored backup) silently falls back to a **new empty database**, which the user perceives as total data loss.
`建议方案 |` Make the config location itself bootstrap-independent: resolve `pastebar_settings.yaml` from a fixed OS-standard location (or take a `--data-dir` / env override), and treat `custom_db_path` as an \_input* to `get_data_dir()` rather than a value read through it. Add a startup consistency check that refuses to silently create a fresh DB when a relocated DB is detected but the config is missing. Phase 4 W1 + regression tests in Phase 5.
`行为变更 | BUG（允许）`
`所属阶段 | 1 记录 → 4 (W1) → 5.4`

`状态 | ✅ 已修复 (W1) — 实现方式与原建议不同，见下`
`修复说明 |` 原建议是"把配置放到固定的 OS 标准位置（或加 env / --data-dir 覆盖）"。实际采用了更小、更贴合现有架构的改动：`get_config_file_path()` 改为**先看默认目录的配置；若其中 `custom_db_path` 指向的目录里也存在一份配置，则优先使用后者**。于是配置跟随数据目录一起走，函数保持"只依赖 `APP_CONSTANTS` + 文件系统"的纯函数性质，不再反向调用 `get_data_dir()`，环被打破。新增私有 `read_custom_db_path_from()` 直接解析 YAML 以避免递归，并在 `APP_CONSTANTS` 尚未初始化时返回空路径而非 panic。**未采用** env / `--data-dir` 覆盖：那会新增一条未经测试的配置来源并扩大改动面；若将来需要，`config_search_root()` 已是唯一接入点。**行为变更：允许（BUG）。**

### ISSUE-002 · Clipboard monitor can run before `db::init`, panicking on first copy

`ID | ISSUE-002`
`位置 | src-tauri/src/clipboard/mod.rs:512-531 (plugin setup), src-tauri/src/clipboard/mod.rs:57-71 (on_clipboard_change), src-tauri/src/main.rs:1060-1061 (.setup), src-tauri/src/main.rs:1401 (.plugin(clipboard::init()))`
`类型 | BUG`
`风险等级 | P0`
`影响范围 | App startup on every platform; clipboard capture thread`
`现象与依据 |` `tauri::Builder` runs plugin `.setup` closures _before_ the app `.setup` closure. `clipboard::init()`'s plugin setup immediately spawns `Master::new(ClipboardMonitor…).run()` on the async runtime (mod.rs:520-527), and that thread's `on_clipboard_change` calls `history_service::increment_history_insert_count()` → `establish_pool_db_connection()` (mod.rs:72-92) → `DB_POOL_CONNECTION.read().unwrap().get().unwrap_or_else(|_| panic!("Error connecting to db pool"))` (db.rs:191-196). `db::init(app)` — which creates the DB file and runs migrations (db.rs:166-170) — only runs later, in the app `.setup` at main.rs:1061. The pool is a `lazy_static` initialised at first touch (db.rs:43); Tauri plugins are registered after `.setup()` in the builder chain (main.rs:1060 vs 1401), so the monitor thread starts first. A copy performed in the startup window therefore hits a `panic!` inside the clipboard thread.
`建议方案 |` Gate the monitor start on a "db ready" signal (e.g. start the clipboard thread at the end of the app `.setup`, after `db::init`), and make `establish_pool_db_connection` return `Result` instead of panicking so transient failures degrade to a logged drop rather than a thread panic. Phase 4 W1.
`行为变更 | BUG（允许）`
`所属阶段 | 1 → 4 (W1) → 5.4`

`状态 | ✅ 已修复 (W1)`
`修复说明 |` 在 `on_clipboard_change` 开头加入 `db::is_pool_ready()` 守卫：池未就绪时写调试日志并返回 `CallbackResult::Next`，不再走到 `establish_pool_db_connection()` 的 `panic!`。**未采用**原建议中"把监控线程推迟到 app `.setup` 之后启动"的方案：那会让插件失去自包含性，并把正确性建立在 Tauri 插件 / setup 的执行顺序这一框架细节上——而该细节正是本 bug 的成因，依赖它更脆弱。同时新增两个非 panic 入口 `is_pool_ready()` 与 `try_pool_db_connection()`，供后续需要优雅降级的路径复用。代价是启动窗口内（毫秒级）的**那一次**复制被丢弃：剪贴板内容仍在，用户可再复制一次；换来的是监控线程不会静默死亡、整段会话不再失去剪贴板捕获。**行为变更：允许（BUG）。**

### ISSUE-003 · Custom data path is never validated before relocation

`ID | ISSUE-003`
`位置 | src-tauri/src/commands/user_settings_command.rs:150-215 (cmd_set_and_relocate_data) vs src-tauri/src/commands/user_settings_command.rs:107-140 (cmd_validate_custom_db_path)`
`类型 | RISK`
`风险等级 | P0`
`影响范围 | Data-location feature; user data integrity`
`现象与依据 |` `cmd_validate_custom_db_path` implements the guards — rejects `..` traversal, canonicalises, checks directory-ness, probes writability. `cmd_set_and_relocate_data` (the command the UI actually calls to commit the change) calls **none** of it: it goes straight to `fs::create_dir_all(&new_data_dir)` and starts moving files. A path that is a file, read-only, or on a full/unmounted volume is only discovered mid-move. There is a `rollback_moves` helper (user_settings_command.rs:18), but per-item copy failures abort the loop before the settings write, leaving a partially relocated data directory with no user-visible recovery.
`建议方案 |` Call the existing validator first and fail fast; verify free space before a `move`/`copy`; make the relocation transactional (stage into a temp dir, then swap) or at minimum report exactly which items failed. Phase 4 W1.
`行为变更 | BUG（允许）`
`所属阶段 | 1 → 4 (W1) → 5.4`

`状态 | ✅ 已修复 (W1)`
`修复说明 |` `cmd_set_and_relocate_data` 现在**最先**调用已有的 `cmd_validate_custom_db_path`，在任何文件被触碰之前完成路径穿越检查、目录性检查与可写性探测；校验刻意放在 `create_dir_all` 之前，因此被拒绝的路径不会因副作用而被创建。另补了两个原建议未列出、但同属"数据丢失"类的守卫：(1) 目标与当前数据目录相同——`move` 分支会"复制到目标再删除源"，二者相同时等于自我删除；(2) 目标位于当前数据目录**内部**——移动后删除源目录会把刚复制过去的数据一并删掉。`operation` 的合法性判断也提前到循环之前（原先非法值只在循环内被发现，此时可能已有若干项被移动）。**未实现**原建议中"先复制到临时目录再整体交换"的事务化方案：它需要跨设备剩余空间探测与更复杂的回滚语义，超出"先验证、失败不落地"这一目标，已记为 W5 候选。**行为变更：允许（BUG）。**

### ISSUE-004 · `.env` is git-tracked

`ID | ISSUE-004`
`位置 | .env (git ls-files: tracked)`
`类型 | HYGIENE`
`风险等级 | P0`
`影响范围 | Repository secrets/paths; every clone inherits the author's local paths`
`现象与依据 |` `git ls-files` returns `.env`; content is `DATABASE_URL=sqlite://local.pastebar-db.data` and `MISSING_TRANSLATION_SAVE_PATH=../packages/pastebar-app-ui/src/locales/lang`. `.env.sample` lists the same two keys with empty values. No secret is currently leaked, but the file is a live foot-gun for any credential that gets added later, and it hard-codes one developer's layout.
`建议方案 |` `git rm --cached .env` (keep the working copy), add `.env` to `.gitignore`, document every key in `.env.sample`. Phase 3 §5.5, enforced afterwards by the hygiene gate (ISSUE-030).
`行为变更 | 无`
`所属阶段 | 3 (§5.5)`

### ISSUE-005 · Generated build artifacts and a generated 108 KB safelist are git-tracked

`ID | ISSUE-005`
`位置 | packages/pastebar-app-ui/vite.config.mts.timestamp-1749488629181-54149b69f9d44.mjs, tailwind-safelist.txt, packages/pastebar-app-ui/tailwind-safelist.txt`
`类型 | HYGIENE`
`风险等级 | P0`
`影响范围 | Repository size, every diff/review, agent context budget`
`现象与依据 |` `git ls-files` lists one `vite.config.mts.timestamp-*.mjs` (a Vite config-loading temp file) and two copies of the generated Tailwind safelist (108 821 bytes at the root). `.gitignore` ignores `safelist.txt` but neither `tailwind-safelist.txt` nor `*.timestamp-*`.
`建议方案 |` `git rm --cached` both patterns, keep local files, extend `.gitignore` with `vite.config.mts.timestamp-*.mjs` and `tailwind-safelist.txt`. Phase 3 §5.5.
`行为变更 | 无`
`所属阶段 | 3 (§5.5)`

---

## 2. P1 — systemic gaps that block reliable iteration

### ISSUE-006 · Zero automated tests in either language

`ID | ISSUE-006`
`位置 | src-tauri/src/**/*.rs (0 test markers), packages/pastebar-app-ui/src (5 files match `describe|it|test`, all vendored React/Twitter helper copies)`
`类型 | DEBT`
`风险等级 | P1`
`影响范围 | Every refactor in Phase 4; 80 k lines of TypeScript and 12.6 k lines of Rust are unprotected`
`现象与依据 |` `bash scripts/harness/scan.sh` reports `rust.test_markers = 0` and `ts.test_files = 5` where all 5 hits are inside `src/components/libs/**` (vendored). No test runner is installed and no `test` script exists in either `package.json`. CLAUDE.md's "no test infrastructure" statement is accurate.
`建议方案 |` Phase 5: vitest + testing-library in the UI package, `cargo test` for services, fake Tauri backend driven by the IPC contract. Before that, Phase 4 relies on contract freeze + the manual smoke checklist.
`行为变更 | 无`
`所属阶段 | 5`

### ISSUE-007 · ESLint is configured but not installed, so no lint gate can run

`ID | ISSUE-007`
`位置 | .eslintrc.js, package.json (no `lint`script, no`eslint` dependency), packages/pastebar-app-ui/.eslintrc.js`
`类型 | DEBT`
`风险等级 | P1`
`影响范围 | All TS/TSX code; 167 `console._`, 30 `any`, 76 `@ts-_` suppressions unguarded`
`现象与依据 |` Both `.eslintrc.js` files declare `plugins: ['@typescript-eslint', 'prettier', 'sonarjs']` and extend `plugin:@typescript-eslint/recommended`, but `eslint` and `@typescript-eslint/*` appear in **no** `package.json` dependency list, and there is no `lint` npm script. The config is eslintrc-format (v8), incompatible with the eslint v9 that `npx eslint` would fetch. `sonarjs/cognitive-complexity` is set to `['error', 200]`, which is effectively "off" for this codebase.
`建议方案 |` Phase 3.1: pin `eslint@8` + `@typescript-eslint@7` + the three plugins as devDeps, add `npm run lint`, lower the complexity threshold to a 40 baseline with a per-file exemption list, then ratchet down in W6.
`行为变更 | 无`
`所属阶段 | 3.1 → 4 (W6)`

### ISSUE-008 · No type-check gate, and 76 explicit type-check suppressions

`ID | ISSUE-008`
`位置 | tsconfig.json, packages/pastebar-app-ui/tsconfig.json, 76 × `@ts-ignore|@ts-expect-error|@ts-nocheck` across the UI package`
`类型 | DEBT`
`风险等级 | P1`
`影响范围 | All frontend code`
`现象与依据 |` Only `build:ts` runs `tsc` as part of a Vite build in the UI package; the root has no `typecheck` script, and the root `tsconfig.json` includes `packages/pastebar-app-ui/src` while the workspace package compiles the same tree with a different `paths` mapping. Nothing in CI runs either.
`建议方案 |` Phase 3.2: `npm run typecheck` at root and in the UI package, wired into CI; the suppression count is baselined and ratcheted.
`行为变更 | 无`
`所属阶段 | 3.2`

### ISSUE-009 · CI has no quality gate at all

`ID | ISSUE-009`
`位置 | .github/workflows/build-test.yml:1-8 (push trigger commented out), .github/workflows/build-test.yml:81-107 (test-tauri job)`
`类型 | DEBT`
`风险等级 | P1`
`影响范围 | Every contribution`
`现象与依据 |` The only build workflow is `workflow_dispatch`-only; its `push` trigger is commented out on line 5. It runs a changeset version-bump job and then a full macOS `tauri build --bundles app`, and **zero** lint / typecheck / test / hygiene checks. The other two workflows are Claude bot automations.
`建议方案 |` Phase 3.10: new `.github/workflows/quality.yml` on `pull_request` + `push`, running scan, lint, typecheck, format, clippy, tests, IPC drift, docs lint and hygiene; `build-test.yml` restricted to release-built concerns.
`行为变更 | 无`
`所属阶段 | 3.10`

### ISSUE-010 · IPC command surface has 57 backend commands with no frontend caller

`ID | ISSUE-010`
`位置 | src-tauri/src/main.rs:1282-1400 (115 registered names) vs 58 distinct names invoked from `packages/pastebar-app-ui/src`|`类型 | DEBT`
`风险等级 | P1`
`影响范围 | IPC contract, dead code, attack surface |
`现象与依据 |` Cross-referencing the generated handler list against every `invoke('…')` literal yields 115 registered − 58 invoked = **57 commands never called** by the UI (e.g. `insert_clipboard_history`, `update_clipboard_history_by_ids`, `delete_link_metadata`, `cmd_create_directory`, `set_icon`). The plan's pre-scan suspected _unregistered_ commands too: that is **disproved** — every name the frontend invokes is registered. The real drift is in the other direction, plus two commands invoked only through a computed string in `ClipEditContent.tsx:1734,1848` (`run_web_request`, `run_web_scraping`), which a naive literal scan would miss.
`建议方案 |` Phase 2.5 publishes the three-way contract table; Phase 3.6 adds `check-ipc-drift.mjs`; Phase 4 W2 removes provably dead commands with a per-command note (several are plausibly intended API surface and are kept but marked).
`行为变更 | 无（删除死命令需逐条确认）`
`所属阶段 | 2.5 → 3.6 → 4 (W2)`

### ISSUE-011 · `emit_all` event names drift between backend and frontend

`ID | ISSUE-011`
`位置 | src-tauri/src/clipboard/mod.rs:286-296 vs packages/pastebar-app-ui/src/App.tsx:370, QuickPasteApp.tsx:160, ClipboardHistoryPage.tsx:1613, ClipboardHistoryQuickPastePage.tsx:384, ClipViewTemplate.tsx:388`
`类型 | BUG`
`风险等级 | P1`
`影响范围 | Clipboard-history live refresh in the main window, history window and QuickPaste window |
`现象与依据 |`The Rust clipboard monitor emits`"clipboard://clipboard-monitor/update"`(mod.rs:286-289) but **emits**`"clips://clips-monitor/update"`in`src-tauri/src/commands/clipboard_commands.rs:761`. The frontend listens on `"clipboard://clipboard-monitor/update"`in five places and on`"clips://clips-monitor/update"`in exactly one (App.tsx:412). Neither side shares a constant, so the pairing is accidentally consistent at best.`"clipboard://clipboard-monitor/update/error"`is emitted (mod.rs:297) but has **no listener anywhere** — clipboard I/O failures are invisible to the user.`建议方案 |`Phase 2.5 documents events alongside commands; Phase 3.6 extends drift checking to event names; Phase 4 W2 introduces shared event-name constants and either wires or removes the error event.`行为变更 | BUG（未监听的错误事件）`
`所属阶段 | 2.5 → 3.6 → 4 (W2)`

### ISSUE-012 · 96 of 199 Rust `unwrap()/expect()` calls are on the startup path in `main.rs`

`ID | ISSUE-012`
`位置 | src-tauri/src/main.rs (96), src-tauri/src/services/history_service.rs (21), src-tauri/src/db.rs (19) |
`类型 | DEBT`
`风险等级 | P1`
`影响范围 | Startup, tray menu, window management |
`现象与依据 |` `scan.sh` reports 199 total and 96 in main.rs. Examples on the startup path: `src-tauri/src/main.rs:696-699` (`app.get_window("main").unwrap()`, `w.emit_all(…).unwrap()`, `w.show().unwrap()`), `src-tauri/src/main.rs:1048`, `db.rs:191-196` (`panic!("Error connecting to db pool")`), `db.rs:218-221` (`fs::create_dir_all(…).unwrap()`, `fs::File::create(…).unwrap()`), `src-tauri/src/menu.rs:43`. Any of these aborts the process from inside a tray callback or a window event handler, which the user sees as the app vanishing.
`建议方案 |` Phase 4 W1: replace startup-path unwraps with logged, recoverable error handling; keep a `debug_output` trace; do not change the frontend-visible error strings.
`行为变更 | 无（错误处理路径）`
`所属阶段 | 4 (W1)`

### ISSUE-013 · 152 `println!`/`eprintln!` calls bypass the project's own logging convention

`ID | ISSUE-013`
`位置 | src-tauri/src/**/*.rs (152) |
`类型 | DEBT`
`风险等级 | P1`
`影响范围 | Release builds (Windows ships with `windows_subsystem = "windows"`, main.rs:1-4, so stdout is discarded), diagnostics
`现象与依据 |` CLAUDE.md documents `debug_output(|| println!(…))` as the project convention so release builds stay quiet. 152 call sites ignore it — concentrated in `src-tauri/src/main.rs` (35), `commands/backup_restore_commands.rs` (17), `services/items_service.rs` (15), `services/history_service.rs` (13), `commands/clipboard_commands.rs` (13), `db.rs` (12), `clipboard/mod.rs` (7). On Windows release builds stdout has no console, so this diagnostic output is written nowhere.
`建议方案 |` Phase 4 W1: converge on `debug_output` plus `tauri-plugin-log` for release-visible diagnostics.
`行为变更 | 无`
`所属阶段 | 4 (W1)`

### ISSUE-014 · `cron_jobs` hourly cleanup never ticks

`ID | ISSUE-014`
`位置 | src-tauri/src/cron_jobs.rs:8-14, 60-63, src-tauri/src/clipboard/mod.rs:90-93, src-tauri/src/main.rs:1062`
`类型 | DEBT`
`风险等级 | P1`
`影响范围 | Auto-clear clipboard history (age-based retention) |
`现象与依据 |` `setup_cron_jobs`registers an hourly`run_history_cleanup_job`on a global`clokwerk::Scheduler`, but `Scheduler::run_pending()`is only ever called from`src-tauri/src/clipboard/mod.rs:92` — and only once every 200 clipboard inserts (`history_service::HISTORY_INSERT_COUNT`reaches 200). There is no timer thread driving the scheduler. Consequently the "auto clear history older than N" retention setting is effectively inert for a user who copies fewer than 200 items, and fires unpredictably otherwise.`建议方案 |`Drive the scheduler from a real interval thread (or a tokio interval task) and keep the 200-insert nudge as a secondary trigger. Phase 4 W1.`行为变更 | BUG（保留策略从未按时执行）`
`所属阶段 | 4 (W1) → 5.4`

### ISSUE-015 · The tray menu holds the settings mutex across database queries

`ID | ISSUE-015`
`位置 | src-tauri/src/menu.rs:132-186 (build_tray_menu) |
`类型 | RISK`
`风险等级 | P1`
`影响范围 | Tray menu rebuild, settings sync, main-thread responsiveness |
`现象与依据 |` `build_tray_menu` takes `let settings_map = app_settings.lock().unwrap();` (menu.rs:139) and keeps that guard alive while calling `history_service::get_recent_clipboard_histories(10)` (menu.rs:135), `get_active_collection_with_menu_items()`, the item-tree build and the per-word `Regex::new(…).unwrap()` (menu.rs:344). The same mutex is taken by the settings-sync command path and by `db::init`'s startup block (main.rs:1065-1087), so a slow or blocked database query stalls every settings read. The same file also unwraps a user-supplied auto-mask word into a regex at menu.rs:344 (guarded by `regex::escape`, so currently safe but unenforced).
`建议方案 |` Collect the menu data first, then take the lock only for the read; use `parking_lot` or a `RwLock` for the settings map. Phase 4 W1.
`行为变更 | 无`
`所属阶段 | 4 (W1)`

### ISSUE-016 · Insecure-user-input posture is undocumented while the app exposes full shell execution

`ID | ISSUE-016`
`位置 | src-tauri/src/services/shell_service.rs:30-93 (run_shell_command), src-tauri/src/commands/shell_commands.rs, src-tauri/tauri.conf.json:16-40 (`"all": true`, `"shell": {"open": true}`, `"protocol": {"assetScope": ["**"]}`) |
`类型 | RISK`
`风险等级 | P1`
`影响范围 | Security model, review burden |
`现象与依据 |` `run_shell_command` executes the clip's stored value through `sh -c` / `cmd /C` with a user-configurable working directory, no allowlist and no confirmation prompt; `tauri.conf.json` enables the entire allowlist (`"all": true`) with `assetScope: ["**"]`. This is plausibly an intentional feature (shell-output clips), but it is nowhere documented as a deliberate, reviewed decision, so no reviewer or agent can tell an intentional capability from an accidental backdoor.
`建议方案 |` Phase 2 documents the trust model in `docs/security-model.md` and links it from AGENTS.md; Phase 4 records the keep/reduce decision in `DECISIONS.md`. No behaviour change in this overhaul unless the decision log says otherwise.
`行为变更 | 无`
`所属阶段 | 2 → 4 (DECISIONS)`

---

## 3. P2 — significant maintenance risk

### ISSUE-017 · No enforcement of the intended `commands → services → models` layering

`ID | ISSUE-017`
`位置 | src-tauri/src/commands/**, src-tauri/src/services/**, src-tauri/src/models/**`
`类型 | DEBT`
`风险等级 | P2`
`影响范围 | Backend architecture |
`现象与依据 |`The three-tier shape exists on disk but nothing enforces it:`services/history_service.rs`calls`crate::db::\*`directly,`src-tauri/src/services/utils.rs:22`imports`super::collections_service`, and `main.rs` reaches into every layer (`use crate::services::…`, `use commands::…`) and itself defines Tauri commands (`app_ready`, `open_history_window`, …) alongside the `commands/`modules. There is no structural test or lint rule that would reject a new`services → commands`edge.`建议方案 |`Phase 3 records the rule in`GOLDEN-RULES.md`; Phase 4 W3 moves the main.rs commands into `commands/`and adds an import-direction check script.`行为变更 | 无`
`所属阶段 | 2 (rules) → 4 (W3)`

### ISSUE-018 · 22 source files exceed 1000 lines

`ID | ISSUE-018`
`位置 | packages/pastebar-app-ui/src/pages/main/ClipboardHistoryPage.tsx:3368, .../ClipEditContent.tsx:2292, .../layout/NavBar.tsx:2064, .../Dashboard.tsx:1830, src-tauri/src/main.rs:1410, src-tauri/src/services/history_service.rs:1356, .../store/settingsStore.ts:1341 (full list: `bash scripts/harness/scan.sh`) |
`类型 | DEBT`
`风险等级 | P2`
`影响范围 | Agent edit reliability, review size, merge conflicts |
`现象与依据 |` `scan.sh` reports 22 files > 1000 lines and 55 > 500 lines (vendored libs excluded). `ClipboardHistoryPage.tsx` alone is 3368 lines.
`建议方案 |` Phase 4 W3 (backend) and W4 (frontend): split by responsibility with pure-move commits, then remove each file from the lint baseline as its complexity drops.
`行为变更 | 无`
`所属阶段 | 4 (W3/W4)`

### ISSUE-019 · `sonarjs/cognitive-complexity` threshold set to 200

`ID | ISSUE-019`
`位置 | .eslintrc.js:44, packages/pastebar-app-ui/.eslintrc.js |
`类型 | DEBT`
`风险等级 | P2`
`影响范围 | All TS/TSX |
`现象与依据 |` `'sonarjs/cognitive-complexity': ['error', 200]` cannot fire on realistic functions, so complexity is unguarded today. The real distribution is currently unknown precisely because the rule is neutered — this is the item Phase 3.1 unblocks by installing eslint and lowering the threshold to a 40 baseline.
`建议方案 |` Phase 3.1 sets 40 with a per-file exemption list; Phase 4 W6 ratchets to 25.
`行为变更 | 无`
`所属阶段 | 3.1 → 4 (W6)`

### ISSUE-020 · Frontend invokes have no runtime response validation

`ID | ISSUE-020`
`位置 | packages/pastebar-app-ui/src/lib/commands.ts:10-14, packages/pastebar-app-ui/src/hooks/queries/use-invoke.ts:4-13, 35 files calling `invoke(`|`类型 | DEBT`
`风险等级 | P2`
`影响范围 | Every backend response crossing into the UI |
`现象与依据 |` `commands.ts` wraps `invoke()` in a bare generic cast (`invoke()<null>('app_ready')`) and `use-invoke.ts` does `invoke(command, args)` with the result cast to `TResult`. `zod` is already a dependency (root and UI `package.json`) but is not used at the IPC boundary, so a backend shape change surfaces as an `undefined` deep inside a component instead of a named error at the boundary. CLAUDE.md's "parse, don't validate" gap.
`建议方案 |` Phase 4 W2: typed `lib/commands.ts` with zod schemas generated from / checked against `docs/contracts/tauri-ipc.md`; Phase 5.2 supplies the fake backend that consumes the same schemas.
`行为变更 | 无`
`所属阶段 | 4 (W2) → 5.2`

### ISSUE-021 · Six silent `catch {}` sites swallow errors

`ID | ISSUE-021`
`位置 | packages/pastebar-app-ui/src/App.tsx:290, components/code-viewer/index.tsx:130, pages/settings/CustomDatabaseLocationSettings.tsx:380,485, pages/components/Dashboard/components/ClipCardBody.tsx:162, pages/components/Menu/components/MenuClipCardViewBody.tsx:146`
`类型 | DEBT`
`风险等级 | P2`
`影响范围 | Clipboard read/copy paths, custom-location settings, code viewer |
`现象与依据 |` `scan.sh`reports 6 matches for empty catch /`.catch(() => {})`. `CustomDatabaseLocationSettings.tsx:380,485` are inside the data-location flow already flagged as P0 (ISSUE-001/003), so failures there are invisible. Two of the six are vendored (`components/libs/react-resizable-panels`), which the metric currently counts — the Phase 3 baseline must exclude vendored paths.
`建议方案 |` Phase 4 W1/W4: log with context; Phase 3 lint rule (`no-empty`) at error level for non-vendored paths.
`行为变更 | 无`
`所属阶段 | 4 (W1)`

### ISSUE-022 · React 19 declared at the root, React 18 in the workspace package

`ID | ISSUE-022`
`位置 | package.json:109 (`"react": "^19.0.0"`), packages/pastebar-app-ui/package.json:104 (`"react": "^18.3.1"`) |
`类型 | RISK`
`风险等级 | P2`
`影响范围 | Dependency resolution, CI reproducibility, React Compiler setup |
`现象与依据 |` The root also pins `@types/react@^18.2.39` while depending on React 19, and the UI package carries `babel-plugin-react-compiler` + `eslint-plugin-react-compiler` against React 18. npm workspaces hoist, so which React the built UI actually bundles depends on the install order and hoisting outcome.
`建议方案 |` Declare React once at the workspace root (or lift to a shared version), align `@types/react`, and let the lockfile be the single record. Phase 3 records the decision; the change itself is a dependency-hygiene commit.
`行为变更 | 无`
`所属阶段 | 3（记录）→ 4（HYGIENE commit）`

### ISSUE-023 · Text clips are not truncated on capture, so a huge copy is stored and shipped in full

`ID | ISSUE-023`
`位置 | src-tauri/src/services/history_service.rs:389+ (add_clipboard_history_from_text), src-tauri/src/clipboard/mod.rs:113-121 (`clipTextMaxLength`, default 5000) |
`类型 | RISK`
`风险等级 | P2`
`影响范围 | Database growth, IPC payload size, renderer memory |
`现象与依据 |` The capture path only _excludes_ text longer than `clipTextMaxLength`; when that setting is `0` (or the value is under the cap) the text is stored verbatim. The 160-char preview truncation in `process_history_item` (history_service.rs:1313-1347) is display-only — `value` still carries the whole payload across the IPC boundary for every list query.
`建议方案 |` Decide and document a storage policy (hard cap with an explicit "truncated" flag, or a true streaming/lazy `value` fetch). Phase 4 W2 introduces a `get_clipboard_history_value` command for on-demand full text; Phase 5 tests the boundary.
`行为变更 | 可能变更（需 DECISIONS 记录）`
`所属阶段 | 4 (W2) → 5.4`

### ISSUE-024 · In-memory auto-mask regexes are compiled per query, per item

`ID | ISSUE-024`
`位置 | src-tauri/src/services/history_service.rs:1291-1311 (process_history_item), src-tauri/src/menu.rs:344 |
`类型 | DEBT`
`风险等级 | P2`
`影响范围 | History list latency with auto-mask enabled |
`现象与依据 |` For every returned history item whose `has_masked_words` is set, `process_history_item` rebuilds `Regex::new` for every entry in `auto_mask_words_list` (history_service.rs:1293-1296) and then does a `to_lowercase()` copy of the whole value per item. `src-tauri/src/services/utils.rs:25` already provides a `REGEX_CACHE` for exactly this problem (used by `apply_global_templates`), so the cache exists and is simply not used here.
`建议方案 |` Phase 4 W5: route the auto-mask patterns through the existing cache and mask in a single pass.
`行为变更 | 无`
`所属阶段 | 4 (W5)`

### ISSUE-025 · `value_more_preview_lines` can underflow

`ID | ISSUE-025`
`位置 | src-tauri/src/services/history_service.rs:1313-1321`
`类型 | BUG`
`风险等级 | P2`
`影响范围 | History preview metadata |
`现象与依据 |` `let more_line = lines - preview.lines().count();`where`lines`is`\_value.lines().count()`and`preview`is the first 160 chars. Both counts are of`usize`, and `lines()`counts non-trailing-newline-terminated lines, so a value whose 160-char window contains more line breaks than the total is not reachable — but a value with exactly one line and no trailing newline plus a very long single line yields`lines == 1`and`preview.lines().count() == 1`; the subtraction is safe only for this specific shape. Any change to the 160 constant or to trimming makes this an unchecked `usize`subtraction (panic in debug, wrap in release).`建议方案 |`Use`saturating_sub`and add a property test over the truncation function. Phase 4 W1 + Phase 5.5.`行为变更 | 无`
`所属阶段 | 4 (W1) → 5.5`

### ISSUE-026 · (withdrawn — merged into ISSUE-005)

This slot was reserved during drafting for a "stale build output" finding. On
verification the only tracked generated artifacts are the ones already listed in
ISSUE-005, so the row is withdrawn rather than renumbered — ISSUE-IDs stay stable for
commit messages written against this revision. **No action required.**

### ISSUE-027 · No documented IPC/event contract, so drift is invisible

`ID | ISSUE-027`
`位置 | docs/contracts/ (does not exist), 115 registered commands, 9 frontend-listened event names |
`类型 | DEBT`
`风险等级 | P2`
`影响范围 | Any change that crosses the boundary |
`现象与依据 |` There is no artifact that states which command exists, what shape it takes, what error strings it can return, or who calls it. ISSUE-010 and ISSUE-011 are both direct consequences.
`建议方案 |` Phase 2.5 (`docs/contracts/tauri-ipc.md` generated by `scripts/harness/gen-ipc-contract.mjs`) + Phase 3.6 drift gate.
`行为变更 | 无`
`所属阶段 | 2.5 → 3.6`

---

## 4. P3 — hygiene

### ISSUE-030 · 191 of 428 tracked frontend source files are unreachable dead code

`ID | ISSUE-030`
`位置 | 191 files under packages/pastebar-app-ui/src (list: `node scripts/harness/reachability.mjs`) |
`类型 | DEBT`
`风险等级 | P1`
`影响范围 | Type-check gate viability, review noise, agent context budget, bundle-adjacent confusion |
`现象与依据 |` A Vite-entry import walk (`scripts/harness/reachability.mjs`, entries read from `vite.config.mts` `rollupOptions.input`) reaches only **237 of 428** tracked TS/TSX sources. The other 191 are dead: they include a whole Medusa-derived design system (`components/atoms/fundamentals/icons/**` ≈ 100 icon components, `components/molecules/select/**`, `components/search-modal/**`, `components/notification`, `libs/hooks/_useAuth.ts`, `types/auth.ts`, most of `components/ui/**`). Decisive corroboration: `react-select`, `react-datepicker` and `moment` are imported by these modules and are **absent from `node_modules` and from every `package.json`** — the code cannot even resolve, which is exactly why `tsc` emits 408 errors (301 of them in vendored `components/libs/react-twitter-embed/tests/**`, 107 in project files, the large majority in dead modules). This is the true cause of the "no working typecheck" situation and it was not visible in the Phase 1 pre-scan.
`建议方案 |` Phase 4 W4a (new wave, executed before W4): delete the unreachable set in reviewed batches (per top-level directory, one commit each, each verified by `node scripts/harness/reachability.mjs --count` and a successful `vite build`), then make 3.2's typecheck gate green for the reachable set. Deletion must be confirmed by a production build, not only by the import walk.
`行为变更 | 无（删除不可达代码）`
`所属阶段 | 4 (W4a) → 3.2 gate turns green |

### ISSUE-028 · 167 `console.*` calls and 30 `any` usages are unguarded

`ID | ISSUE-028`
`位置 | packages/pastebar-app-ui/src (167 console, 30 any) |
`类型 | HYGIENE`
`风险等级 | P3`
`影响范围 | Production console noise, type safety |
`现象与依据 |` `scan.sh`: `ts.console = 167`, `ts.any = 30`. Nothing prevents them today (ISSUE-007). `use-invoke.ts:11` logs every failed invoke with `console.error`, which is legitimate; most of the rest are debugging leftovers.
`建议方案 |` Phase 3.1 enables `no-console` (warn) and `@typescript-eslint/no-explicit-any` (warn) with a baseline; Phase 4 W6 makes them errors for new code.
`行为变更 | 无`
`所属阶段 | 3.1 → 4 (W6)`

### ISSUE-029 · Four TODO/FIXME markers with no tracked owner

`ID | ISSUE-029`
`位置 | `grep -rn 'TODO|FIXME|XXX:'`over tracked source (4 hits) |`类型 | HYGIENE`
`风险等级 | P3`
`影响范围 | Debt discoverability |
`现象与依据 |` Four markers exist in source with no issue reference, so they cannot be triaged or closed.
`建议方案 |` Phase 4 W5: convert each to an ISSUE-ID reference or resolve it; the scan tracks the count from then on.
`行为变更 | 无`
`所属阶段 | 4 (W5)`

### ISSUE-031 · Root and workspace packages declared different React majors

`ID | ISSUE-031`
`位置 | package.json:120,126 (react/react-dom ^19.0.0) vs packages/pastebar-app-ui/package.json (react/react-dom ^18.3.1)`
`类型 | BUG`
`风险等级 | P1`
`影响范围 | Dependency resolution; build reproducibility; every frontend test`
`现象与依据 |` Root `package.json` declared `react@^19.0.0` and `react-dom@^19.0.0` while the only package that actually renders React (`packages/pastebar-app-ui`) declared `^18.3.1`, and `@types/react` was `^18.2.39` at the root. npm therefore installed **two React copies**: 19.0.0 at the root and 18.3.1 nested in the UI package. Nothing failed at build time because Vite resolved `react` from the UI package for application code — but any dependency hoisted to the root that imports React itself (`@tanstack/react-query`, `@testing-library/react`) received React 19. The symptom appeared only once tests existed: rendering a component produced "A React Element from an older version of React was rendered", because the provider tree and the component tree came from different copies. The 408 pre-existing type errors were also being checked against React 18 types while the root shipped 19.
`建议方案 |` Align the root declarations to `^18.3.1`, matching `@types/react@18` and the UI package. Done in Phase 5 setup — it is behaviour-preserving for the shipped bundle (which already resolved React 18 from the UI package) and removes the dual install. `react-compiler-runtime@19.0.0-beta` is a standalone runtime shim pulled in by the React Compiler babel transform and is unaffected.
`行为变更 | 无（打包产物解析的 React 版本不变，仅去除重复安装）`
`所属阶段 | 5`

---

## 5. Disproved pre-scan suspicions (recorded so they are not re-investigated)

| Plan §2 claim                                                                                       | Verification result                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "前端 58 个 invoke 命令名 vs 后端 101 条注册命令，名称集合无法直接对齐（疑似存在死命令与命名漂移）" | **Partly wrong.** Every frontend-invoked name _is_ registered — there are **no** unregistered/ghost commands. The registered count is 115 (not 101). The real drift is 57 registered-but-never-invoked commands (ISSUE-010). |
| "199 处 unwrap/expect（main.rs 独占 86 处）"                                                        | **Confirmed and refined:** 199 total, **96** in main.rs (not 86).                                                                                                                                                            |
| "`any` 113 处"                                                                                      | **Overcounted.** A word-boundary-anchored scan over tracked source gives **30**. The 113 figure came from substring matching (`company`, `many`, …).                                                                         |
| "`console.*` 222 处"                                                                                | **Overcounted.** 167 over tracked, non-vendored source.                                                                                                                                                                      |
| "空 catch {} 8 处"                                                                                  | **Close:** 6, two of which are in vendored code.                                                                                                                                                                             |
| "前端唯一的 \*.spec.tsx 属于 vendored"                                                              | **Confirmed.** All 5 files matching test vocabulary are under `components/libs/`.                                                                                                                                            |
| "eslint 与 @typescript-eslint/\* 均不在任何 package.json 依赖里"                                    | **Confirmed.** Also confirmed: no `lint` script anywhere.                                                                                                                                                                    |
| "`eslint-plugin-react-compiler` 在 `.eslintrc` 中被引用"                                            | **Wrong** — the plugin appears only in the UI `package.json`; the eslintrc `plugins` array lists only `@typescript-eslint`, `prettier`, `sonarjs`.                                                                           |

### Newly discovered during Phase 1 (not in the plan's pre-scan)

| Finding                                                                                                                                            | Issue     |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 191 of 428 frontend sources are unreachable dead code; three imported packages are entirely absent from the dependency tree                        | ISSUE-030 |
| The clipboard monitor thread can start before `db::init`, panicking on a startup-window copy                                                       | ISSUE-002 |
| `get_config_file_path()` is derived from the _default_ data dir while `get_data_dir()` reads `custom_db_path` out of it — circular by construction | ISSUE-001 |
| `cmd_set_and_relocate_data` never calls the validator that exists for it                                                                           | ISSUE-003 |
| The cron scheduler is registered but never driven by a timer                                                                                       | ISSUE-014 |
| Relocation moves only the DB and image dirs, not the config that records the custom path                                                           | ISSUE-001 |

### Environment note recorded for reproducibility

`npm ci` fails on this machine with `EALLOWSCRIPTS` inside the nested install of the two
GitHub dependencies. Root cause found: a global `~/.npmrc` line
`allow-scripts = ["esbuild,esbuild,esbuild,esbuild"]` is forwarded by npm 11.17 to the
git-dependency preparation install, which rejects it as project-scoped. Workaround used
throughout this overhaul: `npm ci --ignore-scripts --userconfig /dev/null`. CI runners have
no such user config and are unaffected. Documented in `AGENTS.md`.

---

## 6. Phase 1 acceptance checklist

- [x] Every P0/P1 row has a matching entry with a phase assignment in `docs/harness/FIX-PLAN.md`.
- [x] Every row carries an explicit `行为变更` field (`无` or `BUG（允许）`).
- [x] `bash scripts/harness/scan.sh` runs locally and is reproducible: two consecutive `--json` runs diff clean (`DETERMINISTIC-OK`).
- [x] IPC three-way comparison completed; the "ghost command" hypothesis is disproved and the actual drift is counted (57 dead commands, 1 unlistened event, 1 event name mismatch).
- [x] Corrected pre-scan figures documented in §5 rather than silently overwritten.
