# Backend Commands (`#[tauri::command]` layer)

> Last verified: 2026-09-16 · Branch `harnessing`

This is the IPC surface: the only place where a frontend `invoke('name', args)` enters the
Rust core. It sits between [`architecture.md`](../architecture.md) §2 (layering) and
[`contracts/tauri-ipc.md`](../contracts/tauri-ipc.md) (the generated three-way table).
Business logic lives in [`modules/backend-services.md`](backend-services.md), never here.

---

## 1. Responsibility

Per `AGENTS.md` ("Architecture rules" 1) and [`harness/GOLDEN-RULES.md`](../harness/GOLDEN-RULES.md):

- A command **parses input** (deserialises the JS payload into a Rust struct), obtains
  application state, calls one service function, and **converts errors** into a
  frontend-renderable value.
- A command **contains no business logic**. It must not run Diesel queries, build file
  paths, or decide policy.

What this layer must never do, and what the code actually does today:

| Rule                                    | Reality                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No business logic in a command          | Mostly honoured. Clear exceptions: `commands/history_commands.rs:14-41` reads the auto-mask settings out of `tauri::State` and assembles `auto_mask_words_list` before calling the service; `commands/items_commands.rs:47-53` calls `update_system_menu` after a successful service call (a side effect, not a query). |
| Never import `commands` from `services` | Honoured. `grep -rn 'crate::commands' src-tauri/src/services/` returns **no matches**.                                                                                                                                                                                                                                  |
| Convert errors, don't invent errors     | Partly honoured. Some commands correctly map (`history_commands.rs:76`), others return a _success_ value carrying a failure string (`collections_commands.rs:47-48`). See §4.                                                                                                                                           |

---

## 2. Module inventory

`src-tauri/src/commands/` — 15 files, 4 025 lines.

| File                           | Lines | Purpose                                                                             |
| ------------------------------ | ----- | ----------------------------------------------------------------------------------- |
| `backup_restore_commands.rs`   | 366   | Create/list/restore/delete zip backups of the DB and image dirs; report data paths. |
| `clipboard_commands.rs`        | 795   | Copy/paste a clip or history item, run templates and form-fill, `copy_text`.        |
| `collections_commands.rs`      | 193   | Collection CRUD, move items/clips between collections, select active collection.    |
| `download_update.rs`           | 83    | Download a release asset over HTTPS and execute it.                                 |
| `format_converter_commands.rs` | 375   | Pure string conversion (CSV↔JSON, YAML, TOML, HTML, Markdown). Single command.     |
| `history_commands.rs`          | 428   | Clipboard-history queries, deletions, pinning, save-to-file, source-app list.       |
| `items_commands.rs`            | 593   | Clip/menu item CRUD, image upload/delete, pin moves, link clip to menu item.        |
| `link_metadata_commands.rs`    | 605   | Fetch/unfurl link and path metadata, audio validation and download.                 |
| `mod.rs`                       | 14    | `pub(crate) mod` declarations for the 14 sibling files.                             |
| `request_commands.rs`          | 11    | Thin pass-through to `request_service` for web request + scraping.                  |
| `security_commands.rs`         | 45    | bcrypt hash/verify and OS-keyring password storage.                                 |
| `shell_commands.rs`            | 26    | Thin pass-through to `shell_service` (shell exec, path checks).                     |
| `tabs_commands.rs`             | 92    | Tab create/update/delete/bulk-update.                                               |
| `translations_commands.rs`     | 141   | Debug-only missing-translation key writing and menu-language change.                |
| `user_settings_command.rs`     | 258   | Custom data-location validation and relocation; YAML key-value settings.            |

92 `#[tauri::command]` attributes appear across `commands/**` and `main.rs`; the generated
handler list has **115** registered names — the difference is that several command functions
are registered under different names or wrap multiple service entry points (see §5 and
ISSUE-010).

---

## 3. Command conventions

### 3.1 Visibility and attributes

Every handler is `pub fn` (or `pub async fn`) prefixed by `#[tauri::command]`; `commands/mod.rs`
declares the modules `pub(crate)`. Three attribute forms are in use:

- `#[tauri::command]` — the default, synchronous (`history_commands.rs:14`).
- `#[tauri::command(async)]` — runs the body off the main thread; used where the handler does
  blocking I/O or awaits: `request_commands.rs:5,10`, `history_commands.rs:264`.
- A bare `async fn` under plain `#[tauri::command]` — `history_commands.rs:73`
  (`get_history_items_source_apps`), `main.rs:123` (`quickpaste_hide_paste_close`).

### 3.2 Return-type shapes

Four shapes coexist. The choice is not systematic — it is per-file history.

| Shape               | Meaning                                                            | Examples                                                                                                             |
| ------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `Result<T, String>` | Canonical shape. Error string reaches the frontend rejection path. | `history_commands.rs:73`, `shell_commands.rs:4-11`, `security_commands.rs:9`                                         |
| `T` (plain)         | No failure channel; success and failure are both returned as data. | `history_commands.rs:15-19` → `Vec<ClipboardHistoryWithMetaData>`; `history_commands.rs:49` → `String`               |
| `Option<T>`         | "Not found" is modelled as `null`, not as an error.                | `history_commands.rs:44` (`get_clipboard_history_by_id`), `collections_commands.rs` `get_collection`                 |
| `()` / `bool`       | Fire-and-forget or a pure predicate.                               | `main.rs:315` (`open_osx_accessibility_preferences`), `main.rs:326` (`check_osx_accessibility_preferences` → `bool`) |

A non-canonical variant worth noting: `main.rs:199` and `main.rs:213` return
`Result<bool, bool>` — the error channel is a bool, so `autostart` / `is_autostart_enabled`
give the frontend no message at all.

### 3.3 State: `tauri::State<T>`

Three state types are injected, always as a function parameter (Tauri resolves them by type):

| State type                                      | Occurrences | Used for                                                                  |
| ----------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `tauri::State<Mutex<HashMap<String, Setting>>>` | 13          | The in-memory settings map; commands read it to decide masking/behaviour. |
| `tauri::State<menu::DbItems>`                   | 8           | Tray menu item cache, passed straight through to `update_system_menu`.    |
| `tauri::State<menu::DbRecentHistoryItems>`      | 8           | Tray menu recent-history cache.                                           |

The canonical read pattern locks the mutex inside a scoped block so the guard is released
before the service call — `history_commands.rs:20-40`:

```rust
let mut auto_mask_words_list = Vec::new();
{
  let settings_map = app_settings.lock().unwrap();   // history_commands.rs:22
  ...
}
history_service::get_clipboard_histories(limit, offset, auto_mask_words_list)
```

The `lock().unwrap()` is unguarded: a poisoned mutex panics inside the command.

### 3.4 `AppHandle` threading

`AppHandle` is injected as a leading `tauri::AppHandle` parameter in 8 command signatures
(`items_commands.rs:37,60,88,176,201,260,301`; `collections_commands.rs:29`) and in most
`main.rs` commands. Its single purpose in this layer is to rebuild the tray menu after a
mutation, via the shared helper `update_system_menu(&app_handle, db_items_state,
db_recent_history_items_state, app_settings)` — see `items_commands.rs:47-53`. The result is
deliberately discarded (`let _ = update_system_menu(...)`), so a tray rebuild failure never
fails the IPC call.

Commands that need no handle simply omit it (`shell_commands.rs`, `security_commands.rs`,
`request_commands.rs`).

---

## 4. Error contract

**Errors are plain `String`. There is no error-code enum, no typed error struct, and no
`thiserror`/`anyhow` type crossing the boundary.** The frontend receives whatever
`format!`/`to_string()` produced, or — for the `T`-returning commands — a string _inside a
successful response_.

Recurring shapes found in `commands/**`:

| Shape                                 | Example                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"Failed to <verb>: {source}"`        | `backup_restore_commands.rs:123` — `"Failed to create backup file: {}"`; `collections_commands.rs:191` — `"Failed to create new collection: {}"`                     |
| `"Error <gerund>: {source}"`          | `history_commands.rs:76` — `"Error fetching source apps: {}"`                                                                                                        |
| `"Error: {stderr}\n{stdout}"` (shell) | `shell_service.rs:66` (reaches the UI via `shell_commands.rs`)                                                                                                       |
| `"<Noun> is not <adjective>"`         | `link_metadata_commands.rs:98` — `"The file is not an MP3"`; `link_metadata_commands.rs:172` — `"No existing metadata found for the provided item ID or history ID"` |
| `"<Noun> is required"`                | `items_commands.rs` — `"Item ID is required for item update"` (line 27); `link_metadata_commands.rs:156` — `"Item ID or History ID is required"`                     |
| Enumerated-fix message                | `format_converter_commands.rs:373` lists all 16 valid `conversionType` values                                                                                        |
| Raw source string                     | `map_err(\|e\| e.to_string())` — e.g. `security_commands.rs:10`, `user_settings_command.rs`                                                                          |

Consequences visible in the code:

- **`"ok"` is the success sentinel.** Service functions and the commands that wrap them return
  the literal `"ok"` on success (`clipboard_commands.rs:93,123,152`; `items_commands.rs:46`,
  which compares `update_results == "ok".to_string()` to decide whether to rebuild the tray).
  Any real message is therefore indistinguishable from a payload unless the caller knows the
  exact string.
- **Failure can be reported as success.** `collections_commands.rs:45-49` catches a service
  error and returns `"Failed to update moved menu items".to_string()` from a `-> String`
  command, so the frontend promise resolves rather than rejects.
- **Failure can be reported as data.** `get_recent_clipboard_histories`
  (`history_commands.rs:102`) does `unwrap_or_else(|_| Vec::new())`; a database outage is
  indistinguishable from an empty history.

---

## 5. Registration

All handlers are registered in one `tauri::generate_handler![…]` block in
`src-tauri/src/main.rs:1282-1390`, inside the `.setup()` closure's builder chain. Each entry
is a bare path: `main.rs`-local functions by name (`app_ready`, `update_setting`,
`quickpaste_hide_paste_close`, `set_icon`), and `commands/` functions qualified by module
(`items_commands::create_item`, `user_settings_command::cmd_get_setting`).

Two commented-out entries show retired commands that were never removed from the source:
`main.rs:1373-1374` disable `cmd_set_custom_db_path` and `cmd_remove_custom_db_path`
("Replaced by …").

### Commands defined directly in `main.rs`

`main.rs` (1 410 lines) defines 16 `#[tauri::command]` functions — this is the ISSUE-017
layering violation. They are:

| Command                               | Line      | Note                                                               |
| ------------------------------------- | --------- | ------------------------------------------------------------------ |
| `quickpaste_hide_paste_close`         | 123       | async; hides QuickPaste and pastes.                                |
| `open_path_or_app`                    | 155       | `opener::open` wrapper.                                            |
| `get_device_id`                       | 160       | Machine ID; prints in debug.                                       |
| `update_setting`                      | 173       | Delegates to `settings_service::insert_or_update_setting_by_name`. |
| `update_left_click_tray_env`          | 182 / 194 | Two `#[cfg]`-gated definitions of the same name.                   |
| `is_autostart_enabled`                | 199       | `Result<bool, bool>`.                                              |
| `autostart`                           | 213       | `Result<bool, bool>`.                                              |
| `app_ready`                           | 233       | Main-window readiness handshake.                                   |
| `get_app_settings`                    | 295       | Returns settings as a JSON string.                                 |
| `open_osx_accessibility_preferences`  | 315       | macOS-only; returns `()`.                                          |
| `check_osx_accessibility_preferences` | 326       | Returns `bool`.                                                    |
| `set_icon`                            | 339       | Tray icon swap; returns `()`.                                      |
| `open_history_window`                 | 375 / 455 | Two `#[cfg]`-gated definitions of the same name.                   |
| `open_quickpaste_window`              | 530       | async.                                                             |

Note also `menu::build_system_menu` (`main.rs:1334`), which is registered from the `menu`
module rather than `commands/`.

---

## 6. Known limitations

These are the fresh, verified facts from [`harness/ISSUES.md`](../harness/ISSUES.md); the
issue numbers are stable and must be cited in any fix commit.

**ISSUE-010 — 57 registered commands have no frontend caller.** Cross-referencing the
generated handler list (`main.rs:1282-1390`, 115 registered names) against every `invoke('…')`
literal in `packages/pastebar-app-ui/src` yields 115 − 58 = **57 commands never invoked by the
UI** — for example `insert_clipboard_history`, `update_clipboard_history_by_ids`,
`delete_link_metadata`, `cmd_create_directory`, `set_icon`. `node
scripts/harness/gen-ipc-contract.mjs --json` prints this as the `uncalled` array. The converse
hypothesis is disproved: **every name the frontend invokes is registered**. Details at
ISSUES.md:150-160.

**ISSUE-012 — 96 `unwrap()`/`expect()` calls in `main.rs`.** Of 199 in the Rust tree
(verified: `grep -rn 'unwrap()\|expect(' src-tauri/src --include=*.rs` excluding `libs/`), 96
are in `main.rs` — the startup path, tray callbacks and window event handlers, where a panic
aborts the process and the user sees the app vanish. Examples: `main.rs:696-699`
(`app.get_window("main").unwrap()`, `w.emit_all(…).unwrap()`, `w.show().unwrap()`),
`main.rs:1048`, and `main.rs:1256` (`emit_all("scheme-request-received", …).unwrap()`).
`commands/**` itself holds only 24 of them. Details at ISSUES.md:174-184.

**ISSUE-013 — `println!` in release builds.** The project convention is
`debug_output(|| println!(…))` (`services/utils.rs:287-291`), which compiles out under
`cfg!(debug_assertions)`. 152 `println!`/`eprintln!` call sites ignore it, 35 of them in
`main.rs` — including `main.rs:264` (`"app_ready on client"`) and `main.rs:296`
(`"app_settings on client"`), both on the startup path. On Windows release builds
`windows_subsystem = "windows"` (`main.rs:1-4`) discards stdout, so this output goes nowhere.
`commands/collections_commands.rs:54` and `:64` are the same defect inside this layer.
Details at ISSUES.md:186-196.

**ISSUE-017 — the three-tier layering is unenforced.** The intended direction
`commands → services → models/db` is documented in
[`architecture.md`](../architecture.md) §2 but nothing checks it: no structural test, no lint
rule, no import-direction script. The violation is real and visible here — `main.rs` both
reaches into `services::*`/`commands::*` **and** defines its own 14 commands (§5), and
`services/utils.rs:21` imports `super::collections_service`. One part of the issue text is
**not** currently reproducible: a `services → commands` edge does not yet exist (grep returns
no matches), so the risk is prospective rather than present. Details at ISSUES.md:238-248.

---

## See also

| Question                                      | Document                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Which command/event exists, and who calls it? | [`contracts/tauri-ipc.md`](../contracts/tauri-ipc.md)                                        |
| What logic sits behind a command?             | [`modules/backend-services.md`](backend-services.md)                                         |
| Whole-system picture                          | [`architecture.md`](../architecture.md)                                                      |
| Trust and shell-execution posture             | [`security-model.md`](../security-model.md)                                                  |
| Open defects and their order                  | [`harness/ISSUES.md`](../harness/ISSUES.md), [`harness/FIX-PLAN.md`](../harness/FIX-PLAN.md) |
