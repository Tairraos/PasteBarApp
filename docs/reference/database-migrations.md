# Database Migrations

> Last verified: 2026-09-16 · Branch `harnessing`
> Scope: the SQLite schema, how migrations are embedded and applied, and the
> `{{base_folder}}` image-path convention. See
> [`build-and-release.md`](build-and-release.md) for toolchain setup.

## 1. Where migrations live

Migrations live in `migrations/` at the repository root. The directory is configured in
`diesel.toml`:

```toml
[migrations_directory]
dir = "migrations"
```

Seven migrations exist today. Each is a directory containing `up.sql` and `down.sql`:

| #   | Directory                                    | Kind                                               |
| --- | -------------------------------------------- | -------------------------------------------------- |
| 1   | `2023-08-05-153510_create_collections`       | schema — creates `collections`, `items`            |
| 2   | `2023-08-05-230732_seeds`                    | data — seed collections, history, settings         |
| 3   | `2023-08-07-141400_seed2`                    | data — seed items, `collection_menu`               |
| 4   | `2023-10-24-164344_seeds3`                   | data — seed items, `tabs`, `collection_clips`      |
| 5   | `2024-06-26-160020_link_meta_mp3_id3_update` | schema — adds track columns + `items.item_options` |
| 6   | `2024-06-29-010924_add_history_options`      | schema — adds `clipboard_history.history_options`  |
| 7   | `2024-07-30-220029_adding_copied_from_app`   | schema — adds `clipboard_history.copied_from_app`  |

**Naming convention.** The prefix is a hand-written `YYYY-MM-DD-HHMMSS` timestamp — Diesel's
`YYYY-MM-DD-HHMMSS` format written by hand, not generated. Names are descriptive and
lowercase with underscores (`create_collections`, `seeds3`), and the `seeds*` family shows the
pattern in use: several data-only migrations were added by hand between schema changes. Only
five of the seven carry a schema change; two (and the `seeds*` group) are pure data.

This matters for ordering: Diesel sorts migrations **lexically by directory name**, so the
timestamp prefix is the ordering key. A new migration must have a prefix that sorts after
`2024-07-30-220029` or it will not run.

## 2. Embedding and execution

Migrations are compiled into the binary — no SQL files are read at runtime:

```rust
// src-tauri/src/db.rs:19
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

// src-tauri/src/db.rs:23
const MIGRATIONS: EmbeddedMigrations = embed_migrations!();
```

`embed_migrations!()` with no argument resolves `migrations/` relative to the crate root
(`src-tauri/`), i.e. the repo-root directory `diesel.toml` also points at.

They are applied by `run_migrations` (`db.rs:208-211`), which calls
`connection.run_pending_migrations(MIGRATIONS).unwrap()`. That call is idempotent: it
consults Diesel's `__diesel_schema_migrations` table and applies only migrations whose
version is absent.

### Startup sequence

`db::init` (`db.rs:102`) performs, in order:

| Line            | Action                                                           |
| --------------- | ---------------------------------------------------------------- |
| `db.rs:128`     | `ensure_dir_exists` on the app data dir                          |
| `db.rs:130-164` | initialise the `APP_CONSTANTS` global (data dirs, language list) |
| `db.rs:166-168` | `create_db_file()` if the DB file does not exist                 |
| `db.rs:170`     | `run_migrations()`                                               |

`db::init(app)` is called from the Tauri app `.setup` closure at `src-tauri/src/main.rs:1061`.

### ISSUE-002 — the ordering bug

**`db::init` runs too late to protect the clipboard monitor.** Tauri executes plugin
`.setup` closures _before_ the app `.setup` closure. `clipboard::init()` is registered via
`.plugin(clipboard::init())` at `src-tauri/src/main.rs:1401`, and its plugin setup immediately spawns the
clipboard watcher thread. That thread's `on_clipboard_change` calls into `history_service`,
which reaches `establish_pool_db_connection()` (`db.rs:185-196`) — and that function
`panic!`s when the pool is not yet usable. `db::init` (and therefore pool creation and the
migration run) only happens later, at `src-tauri/src/main.rs:1061`.

Net effect: a copy performed in the startup window can `panic!` inside the clipboard thread.
Documented as **ISSUE-002** (P0) in [`../harness/ISSUES.md`](../harness/ISSUES.md); the fix
is to gate the monitor start on a "db ready" signal and make `establish_pool_db_connection`
return `Result`. **Not yet fixed** on this branch — do not rely on migrations having run
when the monitor starts.

## 3. `diesel.toml` and `schema.rs`

```toml
# diesel.toml
[print_schema]
file = "src-tauri/src/schema.rs"

[migrations_directory]
dir = "migrations"
```

`src-tauri/src/schema.rs` is generated — its first line is
`// @generated automatically by Diesel CLI.` — and is **not** edited by hand. Regenerate it
after any migration that changes the schema:

```bash
cd src-tauri
diesel print-schema > src/schema.rs        # or just: diesel print-schema
```

The `[print_schema] file` key is what makes bare `diesel print-schema` write straight to
`src-tauri/src/schema.rs`. The Diesel CLI must be installed ([`build-and-release.md`](build-and-release.md) §1),
and `DATABASE_URL` must point at a database with the migrations applied — `.env` sets
`DATABASE_URL=sqlite://local.pastebar-db.data`.

`npm run diesel:migration:run` (`package.json:16`) wraps `diesel migration run` against that
`DATABASE_URL` — useful for local inspection, but the running app does not depend on it (§2).

## 4. Adding a new migration

```bash
# 1. Generate the directory (Diesel stamps the timestamp for you)
cd src-tauri
diesel migration generate add_my_column
# → migrations/<timestamp>_add_my_column/{up.sql,down.sql}

# 2. Edit up.sql (the change) and down.sql (the exact inverse)

# 3. Apply locally and confirm the inverse works
diesel migration run
diesel migration redo       # exercises down.sql, then re-applies up.sql

# 4. Regenerate the schema
diesel print-schema > src/schema.rs

# 5. Rebuild so the embedded migration set includes the new directory
cd .. && cargo build --manifest-path src-tauri/Cargo.toml
```

Notes specific to this repository:

- Prefix sorting is the ordering key — if you create the directory by hand (as the existing
  `seeds*` migrations appear to have been), pick a timestamp after `2024-07-30-220029`.
- New columns must be `Nullable` or carry a `DEFAULT`: `ALTER TABLE ADD COLUMN` cannot add
  `NOT NULL` without one. Migrations 5–7 use plain `ADD COLUMN` with an optional `DEFAULT`.
- After a schema change, update the Diesel model in `src-tauri/src/models/models.rs` and any
  affected IPC payload.
- Add **data-only** migrations sparingly — three of the seven existing ones are seed data
  that ships in every fresh install.

## 5. Schema summary

Derived from `src-tauri/src/schema.rs` and cross-checked against the migration SQL. Types
are Diesel's mapping of `src/schema.rs`; `Nullable<T>` means the column has no `NOT NULL`.

### `clipboard_history` — PK `history_id` (Text)

Created in migration 1; `history_options` added in 6, `copied_from_app` in 7.

Not-null: `history_id` (Text), `created_at` / `updated_at` (BigInt), `created_date` /
`updated_date` (Timestamp). All 33 remaining columns are `Nullable`:

| Type      | Columns                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Text`    | `title`, `value`, `value_preview`, `value_hash`, `image_path_full_res`, `image_data_url`, `image_hash`, `links`, `detected_language`, `history_options`, `copied_from_app` |
| `Integer` | `value_more_preview_lines`, `value_more_preview_chars`, `image_preview_height`, `image_height`, `image_width`, `pinned_order_number`                                       |
| `Bool`    | `is_image`, `is_image_data`, `is_masked`, `is_text`, `is_code`, `is_link`, `is_video`, `has_emoji`, `has_masked_words`, `is_pinned`, `is_favorite`                         |
| `Binary`  | `image_data_low_res`                                                                                                                                                       |

### `items` — PK `item_id` (Text)

Created in migration 1; `item_options` added in 5. 61 columns.

Not-null `Bool`: `is_active`, `is_disabled`, `is_deleted`, `is_folder`, `is_separator`,
`is_board`, `is_menu`, `is_clip`. Not-null: `item_id` (Text), `name` (Text),
`layout_split` (Integer), `created_at` / `updated_at` (BigInt), `created_date` /
`updated_date` (Timestamp), plus `item_options` (Nullable\<Text\>, migration 5). Remaining
Nullable columns by type:

| Type      | Columns                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Text`    | `description`, `value`, `color`, `image_path_full_res`, `image_data_url`, `image_type`, `image_hash`, `path_type`, `icon`, `icon_visibility`, `command_request_output`, `request_options`, `form_template_options`, `links`, `detected_language`, `size`, `layout`, `layout_items_max_width` |
| `Integer` | `border_width`, `image_preview_height`, `image_height`, `image_width`, `image_scale`, `pinned_order_number`                                                                                                                                                                                  |
| `Bool`    | `is_image`, `is_image_data`, `is_masked`, `is_text`, `is_form`, `is_template`, `is_code`, `is_link`, `is_path`, `is_file`, `is_pinned`, `is_favorite`, `is_protected`, `is_command`, `is_web_request`, `is_web_scraping`, `is_video`, `has_emoji`, `has_masked_words`, `show_description`    |
| `BigInt`  | `command_request_last_run_at`                                                                                                                                                                                                                                                                |

### `collections` — PK `collection_id` (Text)

`collection_id`, `title` (Text), `description` (Nullable\<Text\>), `is_default` / `is_enabled`
/ `is_selected` (Bool), `created_at` / `updated_at` (BigInt), `created_date` /
`updated_date` (Timestamp). The three `is_*` flags carry `NOT NULL DEFAULT` in migration 1.

### `tabs` — PK `tab_id` (Text)

`tab_id`, `collection_id`, `tab_name` (Text), `tab_is_active` / `tab_is_hidden` /
`tab_is_protected` (Bool), `tab_order_number` (Integer), `tab_color` (Nullable\<Text\>),
`tab_layout` (Nullable\<Text\>), `tab_layout_split` (Integer).

### `settings` — PK `name` (Text)

`name` (Text), `value_text` (Nullable\<Text\>), `value_bool` (Nullable\<Bool\>),
`value_int` (Nullable\<Integer\>). A generic key/value store: exactly one of the three value
columns is populated per row.

### `link_metadata` — PK `metadata_id` (Text)

`metadata_id` (Text); `history_id` / `item_id` (Nullable\<Text\>, FKs into
`clipboard_history` / `items`); `link_url`, `link_title`, `link_description`, `link_image`,
`link_domain`, `link_favicon` (all Nullable\<Text\>); then the ID3 block added in migration 5
— `link_track_artist`, `link_track_title`, `link_track_album`, `link_track_year`
(Nullable\<Text\>) and `link_is_track` (Nullable\<Bool\>).

### Join tables

| Table              | Primary key                            | Other columns                                        |
| ------------------ | -------------------------------------- | ---------------------------------------------------- |
| `collection_clips` | (`collection_id`, `item_id`, `tab_id`) | `parent_id` Nullable\<Text\>, `order_number` Integer |
| `collection_menu`  | (`collection_id`, `item_id`)           | `parent_id` Nullable\<Text\>, `order_number` Integer |

Foreign keys via `diesel::joinable!` (`schema.rs:185-190`): `collection_clips` →
`collections`, `tabs`; `collection_menu` → `collections`; `link_metadata` →
`clipboard_history`, `items`; `tabs` → `collections`.

**Cross-check note.** All seven tables are created by migration 1 (five tables) plus the two
join tables; migrations 5–7 are pure `ALTER TABLE ADD COLUMN` and add no tables and no
indexes. There is **no index** anywhere in the migrations — including on
`clipboard_history.created_at`, which the history list orders by.

## 6. The `{{base_folder}}` image-path convention

Image paths are **persisted relative** so the data directory can be relocated, and made
absolute only at the boundary. Two functions in `src-tauri/src/db.rs` own the transform:

| Function                 | Line        | Direction                           |
| ------------------------ | ----------- | ----------------------------------- |
| `to_relative_image_path` | `db.rs:277` | absolute path → `{{base_folder}}/…` |
| `to_absolute_image_path` | `db.rs:296` | `{{base_folder}}/…` → absolute path |

Both resolve the current base via `get_data_dir()` (`db.rs:231`), which returns
`custom_db_path` from the user config when set, else the platform default.

- `to_relative_image_path` (`db.rs:277-293`) strips the `data_dir` prefix from an absolute
  path, trims a leading `/` or `\`, and formats `{{base_folder}}/<rest>`. **If the path does
  not start with the current data directory, the input is returned unchanged.**
- `to_absolute_image_path` (`db.rs:296-312`) is the inverse: if the value starts with
  `{{base_folder}}`, it strips the placeholder, trims the separator, and `join`s the
  remainder onto `get_data_dir()`. **If the placeholder is absent, the input is returned
  unchanged.**

**Round-trip rule.** For a path `p` under the current data directory,
`to_absolute_image_path(to_relative_image_path(p)) == p`, with these caveats, all directly
implied by the code:

- A string that is already relative but lacks the placeholder survives both directions
  untouched — the transform is base-relative, not idempotent-safe across relocation.
- Neither function normalises separators or resolves `..`, so a trailing separator or a
  mixed-style path can round-trip to a different (equivalent) string.
- Because both ends call `get_data_dir()` live, a path converted under one data location and
  read back under another yields a **different absolute path** — the intended behaviour, and
  the reason the convention exists.

Rules that follow: never persist an absolute image path, and use `get_clip_images_dir()` /
`get_clipboard_images_dir()` (`db.rs:261-268`) rather than hard-coding a directory.

## 7. Known limitation: the custom-data-location lookup is circular

**ISSUE-001** (P0, `BUG`) in [`../harness/ISSUES.md`](../harness/ISSUES.md). The config file
that records a relocated data directory is itself only looked up in the _default_ directory:
`get_config_file_path()` (`db.rs:342-387`) builds its path from `APP_CONSTANTS.app_data_dir` /
`app_dev_data_dir` and can never return a custom location, while `get_data_dir()`
(`db.rs:231-238`) reads `custom_db_path` _out of that same config_ via `load_user_config()`.
The lookup is circular by construction, so the design depends on the user never moving the
config file. Because relocation (`cmd_set_and_relocate_data`) moves only the database and the
two image directories, any environment where the default-directory config is lost — a fresh
install pointed at a pre-existing data directory, or a restored backup — silently falls back
to a **new empty database**, which the user experiences as total data loss.

---

See also: [`build-and-release.md`](build-and-release.md) · [`../architecture.md`](../architecture.md) ·
[`../harness/ISSUES.md`](../harness/ISSUES.md)
