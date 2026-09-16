# Backend Services

> Last verified: 2026-09-16 · Branch `harnessing`

Business logic for the Rust core. Each service is called by one or more handlers in
[`modules/backend-commands.md`](backend-commands.md) and talks to `models/` and `db.rs`
directly. Layering is described in [`architecture.md`](../architecture.md) §2.

---

## 1. Responsibility and boundaries

| Belongs in a **service**                                    | Belongs in a **command**                              |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| Diesel queries, transactions, row → DTO mapping             | Deserialising the frontend payload                    |
| Filesystem work under a `db::get_*_dir()` path              | Resolving `tauri::State` and `AppHandle`              |
| Policy (what to mask, what to delete, what counts as valid) | Converting a `Result` into the frontend's error shape |
| Image encode/decode and path transforms                     | Tray-menu refresh side effects                        |

Rules (`AGENTS.md` "Architecture rules" 1, `harness/GOLDEN-RULES.md`):

- A service **never imports from `commands`** — verified today: `grep -rn 'crate::commands'
src-tauri/src/services/` returns no matches.
- A service **may** import `crate::db::*` and `crate::models::*`; `services/history_service.rs`
  and `services/settings_service.rs` do so directly, which is intended.
- The known sideways edge is `services/utils.rs:21` (`use super::collections_service;`),
  tracked as ISSUE-017 — see [`harness/ISSUES.md`](../harness/ISSUES.md):238-248.

`{{base_folder}}` is **not** handled here. The relative↔absolute image-path transforms
(`to_relative_image_path` / `to_absolute_image_path`) live in `src-tauri/src/db.rs`, as does
`get_data_dir()`; services only _call_ them (e.g. `items_service.rs:807`). See
[`architecture.md`](../architecture.md) §4.

---

## 2. Module inventory

`src-tauri/src/services/` — 11 files plus the `translations/` subtree, 4 781 lines.

| File                       | Lines | Purpose                                                              |
| -------------------------- | ----- | -------------------------------------------------------------------- |
| `collections_service.rs`   | 772   | Collections, their item/clip membership, ordering, active selection. |
| `history_service.rs`       | 1356  | Clipboard-history capture, query, masking, retention, pinning.       |
| `items_service.rs`         | 901   | Clip/menu item CRUD, images on disk, pin ordering, save-to-file.     |
| `link_metadata_service.rs` | 309   | Link/preview metadata rows plus local/remote audio probing.          |
| `mod.rs`                   | 11    | `pub mod` declarations.                                              |
| `request_service.rs`       | 685   | HTTP request + HTML scraping engine driven by user rules.            |
| `settings_service.rs`      | 73    | Load the settings table into the in-memory map; upsert one setting.  |
| `shell_service.rs`         | 178   | Shell execution and filesystem path classification.                  |
| `tabs_service.rs`          | 88    | Tabs within a collection.                                            |
| `translations/`            | —     | YAML-backed menu translations (`Translations::get`).                 |
| `user_settings_service.rs` | 99    | `pastebar_settings.yaml` config: custom DB path + key-value data.    |
| `utils.rs`                 | 309   | Shared helpers: masking, templates, URL/base64 predicates, logging.  |

`history_service.rs` (1 356 lines) is baselined as > 1000 lines under ISSUE-018; splitting it
is planned in FIX-PLAN W3.

---

## 3. Per-service detail

### `history_service.rs` — 30 public fns, 7 returning `Result`

The largest and most load-bearing service. Six groups:

| Group              | Representative fns                                                                                                                                                                                                                                                                                      | Returns                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Capture            | `add_clipboard_history_from_text` (:389), `add_clipboard_history_from_image` (:210), `compute_image_hash` (:331)                                                                                                                                                                                        | `String` — `"ok"` or a human-readable failure                                             |
| Query              | `get_clipboard_histories` (:600), `get_clipboard_history_pinned` (:573), `get_clipboard_history_by_id` (:634), `get_recent_clipboard_histories` (:1080), `get_clipboard_histories_within_date_range` (:1088), `find_clipboard_histories_by_value_or_filter` (:913), `count_clipboard_histories` (:1098) | mostly `Result<_, diesel::result::Error>`; `get_clipboard_history_by_id` returns `Option` |
| Delete / retention | `delete_clipboard_history_older_than` (:648), `delete_recent_clipboard_history` (:738), `delete_all_clipboard_histories` (:822), `delete_clipboard_history_by_ids` (:888)                                                                                                                               | `String`                                                                                  |
| Mutate / pin       | `insert_clipboard_history` (:1103), `update_clipboard_history_by_id` (:1112), `update_clipboard_history_by_ids` (:1137), `update_pinned_clipboard_history_by_ids` (:1164), `move_pinned_item_up_down` (:1201), `unpin_all_clipboard_history_items` (:1256)                                              | `String`                                                                                  |
| Counters           | `increment_history_insert_count` (:59), `reset_history_insert_count` (:64)                                                                                                                                                                                                                              | `()`, backed by `HISTORY_INSERT_COUNT`                                                    |
| Helpers            | `get_source_apps_list` (:199), `ensure_dir_exists` (:1273), `transform_image_path_for_frontend` (:192)                                                                                                                                                                                                  | `Result<Vec<Option<String>>, Error>` / `()`                                               |

Error behaviour: **mixed and lossy**. `Result`-returning query fns propagate Diesel errors
correctly (`:206` uses `?`). But the mutating fns return `String` and substitute `"ok"` for
success (`:311, :478, :569, :885, :910, :1109, :1253, :1263`), swallowing the underlying error
in the ones that use `let _ =` on the Diesel call. Some failures are logged and then treated as
success — `:678`, `:772`, `:855` do `if let Err(e) = delete_file_and_maybe_parent(…)` and only
`eprintln!`, leaving an orphan image file while the row delete is reported as `"ok"`. One panic
exists: `add_clipboard_history_from_image` uses `.expect("Width conversion failed")` (`:219`) and
`.expect("Height conversion failed")` (`:223`) on the `u32 → i32` conversions of OS-supplied
image dimensions.

### `items_service.rs` — 18 public fns, 3 returning `Result`

CRUD for clips and menu items, plus the image files that belong to them.

- **Read**: `get_item_by_id` (:96) → `Result<Item, String>`.
- **Write**: `create_item` (:593), `update_item_by_id` (:124), `update_item_value_by_id`
  (:174), `update_item_is_menu_by_id` (:114), `update_items_by_ids` (:220) — all `-> String`.
- **Pin ordering**: `update_pinned_items_by_ids` (:603), `move_pinned_item_up_down` (:709),
  `unpin_all_items_clips` (:767) — all `-> String`.
- **Delete**: `delete_item_by_id` (:282), `delete_items_by_ids` (:333),
  `delete_image_by_item_by_id` (:233) → `String`; `delete_menu_item_by_id` (:384),
  `delete_menu_items_by_ids` (:479) → `Result<String, Error>`.
- **Images**: `update_item_image_by_id` (:187), `add_image_to_item` (:642),
  `save_item_image_from_history_item` (:777), `upload_image_file_to_item_id` (:813) —
  the last three return `Result<String, String>` and, on success, a path already passed
  through `db::to_relative_image_path` (`:807`).

Error behaviour: the three `Result` fns use explicit string errors —
`"Image file does not exist"` (`:646`), `"Unsupported file type"` (`:825`), and
`.ok_or("Failed to read image extension")?` (`:651`). Everything else returns `"ok"` regardless
of whether the Diesel `execute()` succeeded (several call sites discard the result with `let _ =
`). `unreachable`-style indexing `&item_id[..3]` (`:657`, `:781`, `:830`) will panic on an item
id shorter than 3 bytes.

### `collections_service.rs` — 17 public fns, 6 returning `Result`

- **Read**: `get_collections` (:520), `get_collection` (:469, `Option`),
  `get_selected_collection_id` (:593), `get_active_collection_with_menu_items` (:299),
  `get_active_collection_with_clips` (:376).
- **Write**: `create_collection` (:527), `update_collection_by_id` (:263),
  `select_collection_by_id` (:278), `delete_collection_by_id` (:478).
- **Membership / ordering**: `add_item_to_collection` (:542), `add_menu_to_collection` (:566),
  `update_moved_clips_in_collection` (:203), `update_moved_menu_items_in_collection` (:229).
- **Defaults**: `create_default_menu_item` (:608), `create_default_board_item` (:681).

Error behaviour: `delete_collection_by_id` is the notable one — if the item-id lookup fails it
logs `println!("Error retrieving item IDs: {:?}", e)` and returns the _string_
`"Error retrieving item IDs"` from a `-> String` fn (`:491-494`), which the command layer then
discards (see `commands/collections_commands.rs:45-49`). It also deletes across four tables
with `let _ =` on each `execute()`, so a partial delete is reported as `"ok"`. Elsewhere
`create_collection` logs and propagates (`:535-538`).

### `link_metadata_service.rs` — 11 public fns, 3 returning `Result`

- **Audio probing (async)**: `check_audio_file` (:26) dispatches on `Path::exists` to
  `check_local_audio_file` (:34) or `check_url_audio_file` (:88); all three return
  `Result<AudioInfo, Box<dyn std::error::Error>>`. An invalid extension is **not** an `Err` —
  it returns `Ok(AudioInfo { is_valid: false, error: Some("Invalid file type"), .. })` (:41-50).
- **Metadata rows**: `insert_or_update_link_metadata` (:162, `Result<String, Error>` via
  `replace_into`), `get_link_metadata_by_item_id` (:174) and `…_by_history_id` (:183) both
  `-> Option<LinkMetadata>` using `.first(connection).ok()`, `copy_link_metadata_to_new_item_id`
  (:192).
- **Delete**: `delete_link_metadata_by_history_id` (:225), `…_by_item_id` (:233),
  `…_by_history_ids` (:241), `delete_all_link_metadata_with_history_ids` (:250) — `-> String`.

Error behaviour: the `Option`-returning getters erase the difference between "row absent" and
"query failed"; callers cannot distinguish a DB error from a missing row.

### `request_service.rs` — 2 public fns, both `Result`

A self-contained HTTP + scraping engine; no database access.

- `run_web_request(HttpRequest) -> Result<Content, String>` (:163) — builds a `reqwest::Client`,
  applies enabled headers, optional bearer/basic/API-key auth, query params and body, then
  projects the response through a `FilterType` chain (`jsonPath`, `regex`, …).
- `run_web_scraping(HttpScraping) -> Result<ContentScraping, String>` (:270) — `scraper`-based
  CSS-selector extraction with `RuleType` post-processing.

Input types (`HttpRequest`, `Header`, `FilterType`, `HttpScraping`, `ScrapingOptions`, …) are
`Deserialize` structs with `#[serde(rename_all = "camelCase")]`, i.e. the frontend payload maps
1:1 onto them. Errors are `String` via `map_err(|e| e.to_string())` (`:168`) or bespoke
messages; a malformed user regex surfaces as a plain string error.

### `utils.rs` — 20 public fns

See §4 — this file is mostly a helper grab-bag, and `mask_value` / `apply_global_templates`
are its only functions with real policy content.

### `shell_service.rs` — 3 public fns, 2 returning `Result`

- `run_shell_command(exec_cmd, exec_home_dir, output_template, output_regex_filter)
-> Result<String, String>` (:30) — runs `cmd /C` on Windows, `sh -c` elsewhere (:50-59), with
  a working directory from `ExecHomeDir` or `dirs::home_dir()` (falling back to `/`). Non-empty
  stderr becomes `Err(format!("Error: {}\n{}", stderr, stdout))` (:66); an optional regex filter
  keeps only capture group 1 (:74-84); an optional `{{output}}` template wraps stdout (:87-89).
  **This is arbitrary command execution by design** — see ISSUE-016
  ([`harness/ISSUES.md`](../harness/ISSUES.md):222-232) and
  [`security-model.md`](../security-model.md).
- `check_path` (:97) → `Ok("File"|"Folder"|"Other")`, `Err("Path does not exist")`.
- `path_type_check` (:113) → a finer classification (`"Executable script"`, `"App"` on
  macOS/Windows, `"Parallels"`, `"VirtualBox"`, `"Script"`, …).

Error behaviour: no panics; every failure path returns `Err(String)`.

### `user_settings_service.rs` — 9 public fns, 5 returning `Result`

Reads/writes `pastebar_settings.yaml` through `db::get_config_file_path()` (note: the
config-location circularity is ISSUE-001).

- `load_user_config() -> UserConfig` (:17) — **never fails**. A missing file, an unreadable
  file, or invalid YAML all return `UserConfig::default()`, with `eprintln!` only for the
  latter two (:31, :36). A corrupted config therefore silently resets the custom DB path.
- `save_user_config(&UserConfig) -> Result<(), String>` (:39) — `create_dir_all`, YAML
  serialise, `fs::write`, each mapped to a `"Failed to …"` string.
- Custom path: `get_custom_db_path` (:58, `Option`), `set_custom_db_path` (:63),
  `remove_custom_db_path` (:70).
- Key-value data: `get_setting` (:80, `Option`), `set_setting` (:85), `remove_setting` (:91),
  `get_all_settings` (:97).

### `settings_service.rs` — 2 public fns, 0 returning `Result`

- `get_all_settings(Option<AppHandle>) -> Result<Mutex<HashMap<String, Setting>>, Error>` (:13)
  — loads the `settings` table and, when a handle is given, **overwrites the shared
  `tauri::State` map**. It calls `.expect("Error loading settings options")` on the query
  (:19) and `.expect("Failed to lock app_settings")` (:31), so a DB or lock failure panics
  rather than returning the `Err` its signature advertises.
- `insert_or_update_setting_by_name(&Setting, AppHandle) -> Result<String, Error>` (:38) —
  upserts by name, then refreshes the map via `get_all_settings(Some(app_handle))`
  **discarding the result with `.unwrap_or_default()`** (:69), and returns `"ok"`.

### `tabs_service.rs` — 6 public fns, 3 returning `Result`

- `create_new_tab(&Tabs) -> Result<String, diesel::result::Error>` (:21) — but the insert's
  result is discarded (`let _ = … .execute(connection)` at :24) and it returns
  `Ok(tab.tab_id.clone())` unconditionally. The `Result` is decorative.
- `update_tab_by_id` (:31) and `delete_tab_by_tab_id` (:41) — `let _ =` on the Diesel call,
  then `"ok".to_string()`.
- `get_tabs_by_collection_id` (:49), `get_tab_by_tab_id` (:59),
  `create_default_tab` (:68) — propagate Diesel results properly.

---

## 4. `utils.rs` helpers worth knowing

`{{base_folder}}` handling is **not** here — it lives in `db.rs`
(`to_relative_image_path` / `to_absolute_image_path`). What is here:

| Helper                                                        | Line | Exact behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mask_value(&str) -> String`                                  | :170 | Splits on whitespace and maps each word. A word of **> 2 chars** → first char + `•` × `(len − 2)` + last char. A word of **≤ 2 chars** (including a **single-character word**) → first char + exactly **one** `•`, so `"a"` → `"a•"` and `"ab"` → `"a•"` (`:184-188`). Words are rejoined with a single space, so original spacing and newlines are not preserved. The `first_char` uses `.chars().next().unwrap()` (`:176`) — safe only because `split_whitespace` never yields an empty slice.                                                                                                                       |
| `apply_global_templates(text, settings_map) -> String`        | :220 | Returns `text` unchanged unless `globalTemplatesEnabled` (`GLOBAL_TEMPLATES_ENABLED_KEY`, `:28`) is a truthy `value_bool` (`:222-229`), `globalTemplates` exists as JSON text, and it parses as an array. For each template with `isEnabled == true`, replaces `{{ name }}` (case-insensitive, whitespace-tolerant, via `(?i)\{\{\s*NAME\s*\}\}` with `regex::escape`) with `value`. Patterns go through the `REGEX_CACHE` at `:25`, locked and populated at `:270-279` — so a template whose `value` changed is still fine, but a _renamed_ template leaves a stale entry. Malformed JSON silently returns the input. |
| `debug_output<F: FnOnce()>(f)`                                | :287 | Runs `f` only `if cfg!(debug_assertions)`. This is the project's logging convention (`AGENTS.md` rule 7) — it compiles out in release, which is why `println!` outside it is a defect (ISSUE-013).                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `has_valid_tld(url) -> bool`                                  | :121 | Prepends `https://` via `ensure_url_prefix`, parses with `url::Url`, takes the **last** dot-separated label of `.domain()` and asks `tld::exist`. Any parse failure returns `false`. Note: `https://localhost` and raw IPs yield `false`; a string with no dot yields the whole string as "tld".                                                                                                                                                                                                                                                                                                                       |
| `is_base64_image(data) -> bool`                               | :158 | Anchored regex `^data:image/(png\|jpeg\|jpg\|svg\+xml\|svg\|gif);base64` — a prefix check only. It does **not** validate the payload or try to decode it, and it rejects other image media types (e.g. webp).                                                                                                                                                                                                                                                                                                                                                                                                          |
| `remove_special_bbcode_tags(text) -> String`                  | :194 | Sequentially applies 7 inline patterns — `[copy]`, `[mask]`, `[blank]`, `[hl]`, `[h]`, `[b]`, `[i]` — each replaced by capture group 1, i.e. the tags are stripped and the inner text kept. Patterns use `(.+?)` (non-greedy) and are compiled with `Regex::new(pattern).unwrap()` inside the loop (`:209`), so they are recompiled on **every call**; the `unwrap` is safe only because the patterns are literals. Not multiline-aware.                                                                                                                                                                               |
| `delete_file_and_maybe_parent(path) -> Result<(), io::Error>` | :79  | `fs::remove_file` first (an already-missing file is an `Err`, propagated). Then, if the parent directory's `read_dir()?.next()` is `None`, removes that parent. Because the emptiness check happens only after the file is gone, it deletes the parent when it becomes empty — but a `read_dir` failure on the parent is propagated even though the file deletion already succeeded.                                                                                                                                                                                                                                   |

Other helpers in the file (not detailed): `pretty_print_json` (:30), `pretty_print_struct` (:46),
`pretty_print_forest` (:66), `print_db_items` (:74, raw `println!`), `remove_dir_if_exists` (:94),
`has_emoji` (:102), `is_youtube_url` (:109), `is_image_url` (:113),
`ensure_url_or_email_prefix` (:138), `ensure_url_prefix` (:150), `decode_html_entities` (:166),
`is_valid_json` (:216), `is_windows_system_uses_dark_theme` (:298).

---

## 5. Known limitations

**ISSUE-024 — auto-mask regexes are recompiled per item, per query.** In
`history_service.rs:1291-1296` (`process_history_item`), for every returned history item with
`has_masked_words == true`, a fresh `Vec<Regex>` is built with
`Regex::new(&format!(r"(?i){}", regex::escape(word))).unwrap()` for every entry of
`auto_mask_words_list`, and the whole value is cloned and lowercased per item
(`:1298-1300`). **Verified**: `utils.rs` already provides a compile-once cache —
`REGEX_CACHE` is declared at `services/utils.rs:25` and the _only_ consumer is
`apply_global_templates` at `services/utils.rs:271`. The auto-mask path never touches it, so the same
patterns are rebuilt for every row of every history page. `src-tauri/src/menu.rs:344` compiles the same
patterns again for the tray. Details at ISSUES.md:322-332.

**ISSUE-025 — `value_more_preview_lines` can underflow.** `history_service.rs:1317-1321`:

```rust
let lines = _value.lines().count();
let preview = _value.chars().take(160).collect::<String>();
let more_line = lines - preview.lines().count();   // unchecked usize subtraction
```

Reached only when the value exceeds 160 chars (`:1315`). The subtraction is safe for the
current shapes the code can produce, but it is unchecked, so any change to the 160 constant or
to the trimming above it turns this into a debug panic / release wrap-around. Fix is
`saturating_sub`. Details at ISSUES.md:334-344.

**ISSUE-013 — `println!` instead of `debug_output`.** Services hold 35 raw
`println!`/`eprintln!` sites (excluding `libs/`): `items_service.rs` 15,
`history_service.rs` 13, `collections_service.rs` 3, `user_settings_service.rs` 2,
`link_metadata_service.rs` 1. `services/utils.rs:76` (`print_db_items`) is itself a raw `println!`
rather than a `debug_output` wrapper. Because release Windows builds have no console
(`src-tauri/src/main.rs:1-4`), these are invisible in production — including the error paths that are the
_only_ record of a swallowed failure (e.g. `history_service.rs:900`, `collections_service.rs:492`).
Details at ISSUES.md:186-196.

### Additional observations (not separately issued)

- `settings_service.rs:19,31` uses `.expect()`; `items_service.rs:657,781,830` and
  `history_service.rs:234` slice ids as `&id[..3]`; `tabs_service.rs:21-28` advertises `Result`
  but discards the insert error. Each is detailed in §3.

---

## See also

| Question                                    | Document                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Which command calls which service function? | [`modules/backend-commands.md`](backend-commands.md)                                         |
| Whole-system picture and layering           | [`architecture.md`](../architecture.md)                                                      |
| IPC contract (generated)                    | [`contracts/tauri-ipc.md`](../contracts/tauri-ipc.md)                                        |
| Capture path                                | [`modules/backend-clipboard.md`](backend-clipboard.md)                                       |
| Open defects and their order                | [`harness/ISSUES.md`](../harness/ISSUES.md), [`harness/FIX-PLAN.md`](../harness/FIX-PLAN.md) |
