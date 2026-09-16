# Backend — database, migrations and path handling

> Last verified: 2026-09-16 · Branch `harnessing` · Refactor status: **pre-Phase-4**

Sources: `src-tauri/src/db.rs` (402 lines), `src-tauri/src/schema.rs`, `migrations/`,
`src-tauri/src/models/models.rs`.

## 1. Responsibility

`db.rs` owns four things and nothing else:

1. The **connection pool** (`r2d2` + Diesel/SQLite) and the process-wide `DB_POOL_CONNECTION`.
2. **Startup initialisation** — creating the data directory, creating the DB file, running
   embedded migrations.
3. **Path resolution** — where the database, images and settings file live.
4. **The `{{base_folder}}` transform** that keeps image paths relocatable.

It does not own queries; those live in `services/`.

## 2. Connection pool

```rust
// db.rs:43
lazy_static! {
  pub static ref DB_POOL_CONNECTION: RwLock<Pool> = RwLock::new(init_connection_pool());
}
```

| Property     | Value                                             | Line          |
| ------------ | ------------------------------------------------- | ------------- |
| Pool type    | `r2d2::Pool<ConnectionManager<SqliteConnection>>` | `db.rs:21`    |
| Builder size | r2d2 default (10)                                 | `db.rs:86-92` |
| WAL journal  | **disabled** (`enable_wal: false`)                | `db.rs:88`    |
| Foreign keys | **disabled** (`enable_foreign_keys: false`)       | `db.rs:89`    |
| Busy timeout | 3 s                                               | `db.rs:90`    |

`establish_pool_db_connection()` (`db.rs:185-196`) is the accessor used everywhere:

```rust
DB_POOL_CONNECTION.read().unwrap().get()
  .unwrap_or_else(|_| panic!("Error connecting to db pool"))
```

Both the read-lock `unwrap()` and the pool `panic!` are on every database call path. Because
the `lazy_static` initialises on first touch, the first touch also decides which database
file is opened — see §5.

`reinitialize_connection_pool()` (`db.rs:96-100`) rebuilds the pool after the user relocates
the data directory. It is called from `commands/user_settings_command.rs:210` and `:224`.

## 3. Startup sequence

```rust
// db.rs:105-171  (called from main.rs:1061, inside the app .setup closure)
pub fn init(app: &mut tauri::App) {
  let resource_path = app.path_resolver().resource_dir().unwrap();   // :109
  ...
  ensure_dir_exists(&tauri::api::path::app_data_dir(&config).unwrap()); // :128
  let _ = APP_CONSTANTS.set(AppConstants { ... });                    // :130-164
  if !db_file_exists() { create_db_file(); }                          // :166-168
  run_migrations();                                                    // :170
}
```

`APP_CONSTANTS` is a `OnceCell` holding `app_data_dir`, `app_dev_data_dir` and the supported
language list. Everything that resolves a path depends on it being set:

| Consumer                         | Line             | Failure mode if unset                                      |
| -------------------------------- | ---------------- | ---------------------------------------------------------- |
| `get_default_data_dir()`         | `db.rs:241-247`  | `.unwrap()` on the `OnceCell`                              |
| `get_config_file_path()`         | `db.rs:346, 375` | `.expect("APP_CONSTANTS not initialized")` / `.unwrap()`   |
| `src-tauri/src/main.rs:267, 299` | —                | returns a friendly `"APP_CONSTANTS not initialized"` error |

`get_data_dir()` (`db.rs:231-238`) is the single indirection point:

```rust
pub fn get_data_dir() -> PathBuf {
  let user_config = load_user_config();          // ← reads pastebar_settings.yaml
  if let Some(custom_path_str) = user_config.custom_db_path {
    PathBuf::from(custom_path_str)
  } else {
    get_default_data_dir()
  }
}
```

Everything else is derived from it:

| Function                     | Returns                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `get_db_path()`              | `<data_dir>/pastebar-db.data` (release) or `local.pastebar-db.data` (debug) |
| `get_clip_images_dir()`      | `<data_dir>/clip-images` — stored clip images                               |
| `get_clipboard_images_dir()` | `<data_dir>/clipboard-images` — captured clipboard images                   |
| `get_config_file_path()`     | `<default_data_dir>/pastebar_settings.yaml`                                 |

## 4. The `{{base_folder}}` path convention

**This is the most load-bearing convention in the codebase.** Image paths are persisted
_relative_ to the data directory so the directory can be relocated without rewriting rows.

```rust
// db.rs:277 — absolute → relative, on write
pub fn to_relative_image_path(absolute_path: &str) -> String {
  let data_dir = get_data_dir();
  let data_dir_str = data_dir.to_string_lossy();
  if absolute_path.starts_with(&data_dir_str.as_ref()) {
    let relative_path = absolute_path
      .strip_prefix(&data_dir_str.as_ref())
      .unwrap_or(absolute_path)
      .trim_start_matches('/')
      .trim_start_matches('\\');
    format!("{{{{base_folder}}}}/{}", relative_path)   // → "{{base_folder}}/clip-images/abc/…png"
  } else {
    absolute_path.to_string()                          // unchanged when outside the data dir
  }
}

// db.rs:296 — relative → absolute, on read
pub fn to_absolute_image_path(relative_path: &str) -> String {
  if relative_path.starts_with("{{base_folder}}") {
    /* join data_dir + remainder */
  } else {
    relative_path.to_string()                          // already absolute → passthrough
  }
}
```

Round-trip rules a reader must know:

1. **Persist relative, serve absolute.** `history_service` calls `to_relative_image_path`
   before insert and `transform_image_path_for_frontend` (`history_service.rs:192-196`)
   before returning rows over IPC.
2. **Paths outside the data directory are passed through untouched** by both directions.
   A path that already looks absolute is never re-prefixed, so a stale absolute path is
   returned to the frontend as-is (it will simply fail to load, silently).
3. **No canonicalisation.** `starts_with` is a raw string prefix test, so a sibling
   directory named `pastebar-data-old` would not match `pastebar-data`, but the check is
   purely lexical — symlinks and `..` segments are not resolved.
4. **Non-UTF-8 paths** degrade to an empty string: `image_file_name.to_str()` in
   `history_service.rs:297-300` is `.map(...).unwrap_or_default()`, so a non-UTF-8 path
   produces `PathBuf::from("")` rather than an error.

Any change to this pair of functions changes the on-disk format contract. They are the first
targets for Phase 5 property tests (round-trip over generated paths).

## 5. Known limitations

| Limitation                                         | Issue              | Detail                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Circular config lookup                             | **ISSUE-001 (P0)** | `get_config_file_path()` (`db.rs:343-390`) derives its path from `APP_CONSTANTS` (the _default_ dir), while `get_data_dir()` (`db.rs:231-238`) reads `custom_db_path` **out of that file**. The config that records a custom location is therefore only ever read from the default location; if it is missing there, the app silently opens (or creates) a fresh database in the default directory. |
| `APP_CONSTANTS` unwraps                            | ISSUE-012          | `db.rs:243,245,346,375` panic if init has not run                                                                                                                                                                                                                                                                                                                                                   |
| Pool unwrap/panic                                  | ISSUE-012          | `db.rs:191-196` `panic!("Error connecting to db pool")` on every call path                                                                                                                                                                                                                                                                                                                          |
| Pool initialised at first touch, not at `db::init` | ISSUE-002 (P0)     | the `lazy_static` at `db.rs:43` can be initialised by the clipboard thread before migrations run                                                                                                                                                                                                                                                                                                    |
| File creation unwraps                              | ISSUE-012          | `create_db_file()` `db.rs:213-222`: `parent().unwrap()`, `create_dir_all(…).unwrap()`, `File::create(…).unwrap()`                                                                                                                                                                                                                                                                                   |
| Migration failure unwraps                          | ISSUE-012          | `run_migrations()` `db.rs:208-211`: `.unwrap()`                                                                                                                                                                                                                                                                                                                                                     |
| WAL and foreign keys disabled                      | —                  | intentional or not, it is undocumented; WAL would improve concurrent-window behaviour                                                                                                                                                                                                                                                                                                               |
| Raw `println!` for DB diagnostics                  | ISSUE-013          | `db.rs:77,200` (and `eprintln!` at `db.rs:319,336`)                                                                                                                                                                                                                                                                                                                                                 |

## 6. Space reclamation (`VACUUM`)

Deleting rows frees pages **inside** the SQLite file; it does not return them to the
filesystem. Since this app deletes constantly — every history clear, every retention sweep —
a long-lived database accumulates free pages without bound.

`services/maintenance_service.rs` owns the policy:

| Behaviour      | Detail                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| Cadence        | At most once per **120 hours** (5 days), decided by the job, not the scheduler  |
| Scheduler tick | Hourly (`cron_jobs.rs`), because the tick is also the retry mechanism           |
| On **failure** | `last_run_at` is left untouched → the next hourly tick retries                  |
| On **success** | `last_run_at` is written → the cooldown starts                                  |
| Bookkeeping    | `maintenance_log` table (`task`, `last_run_at`, `run_count`), survives restarts |

The asymmetry is deliberate: if a failure armed the cooldown, a transient lock would
silently postpone maintenance for five days — and a transient lock is exactly the case
where retrying soon is right.

`VACUUM` takes an exclusive lock for its whole duration, so it is a synchronous, blocking
operation by choice. Both callers are already off the UI thread (the scheduler has its own
thread; the backup command is `async`).

### Backups vacuum first

`create_backup` runs `VACUUM` before archiving and **refuses to continue if it fails**,
returning an error prefixed `VACUUM_FAILED:`. Two reasons, in order of importance:

1. `VACUUM` rebuilds the database into a fresh file, so the archived copy cannot capture a
   torn write. This is what makes the backup a consistent snapshot rather than a hopeful
   file copy — the previous implementation copied the `.data` file directly, which under
   WAL can catch a half-applied write.
2. Free pages would otherwise be archived instead of reclaimed.

The frontend shows a dialog offering "create the backup anyway"; that path sets
`force_without_vacuum`, and the backend proceeds without the snapshot guarantee.

## 7. Schema entry point

`src-tauri/src/schema.rs` is Diesel-generated (`diesel print-schema`). It is the source of
truth for table and column names used in `services/` query builders. Regenerate it whenever a
migration changes the schema. Table-level detail and the migration workflow live in
[`../reference/database-migrations.md`](../reference/database-migrations.md).
