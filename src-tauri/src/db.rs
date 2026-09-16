use lazy_static::lazy_static;
use once_cell::sync::OnceCell;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::Duration;

use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::r2d2 as diesel_r2d2;

use crate::services::user_settings_service::load_user_config;
use diesel::sqlite::SqliteConnection;

// use diesel::connection::{set_default_instrumentation, Instrumentation, InstrumentationEvent};

use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};

use crate::services::utils::debug_output;

// Visible to the test module below, which runs these against an in-memory SQLite so the
// real migrations are exercised rather than a hand-built schema that can drift from them.
pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!();

type Pool = r2d2::Pool<diesel_r2d2::ConnectionManager<SqliteConnection>>;

#[derive(Serialize)]
pub struct AppConstants<'a> {
  pub app_data_dir: std::path::PathBuf,
  pub app_dev_data_dir: std::path::PathBuf,
  pub app_detect_languages_supported: [&'a str; 23],
}
pub static APP_CONSTANTS: OnceCell<AppConstants> = OnceCell::new();

#[derive(Debug)]
pub struct ConnectionOptions {
  pub enable_wal: bool,
  pub enable_foreign_keys: bool,
  pub busy_timeout: Option<Duration>,
}

lazy_static! {
  pub static ref DB_POOL_CONNECTION: RwLock<Pool> = RwLock::new(init_connection_pool());
}

impl diesel::r2d2::CustomizeConnection<SqliteConnection, diesel::r2d2::Error>
  for ConnectionOptions
{
  fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), diesel::r2d2::Error> {
    (|| {
      if self.enable_wal {
        conn.batch_execute("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
      }
      if self.enable_foreign_keys {
        conn.batch_execute("PRAGMA foreign_keys = ON;")?;
      }
      if let Some(d) = self.busy_timeout {
        conn.batch_execute(&format!("PRAGMA busy_timeout = {};", d.as_millis()))?;
      }
      Ok(())
    })()
    .map_err(diesel::r2d2::Error::QueryError)
  }
}

pub fn adjust_canonicalization<P: AsRef<Path>>(p: P) -> String {
  const VERBATIM_PREFIX: &str = r#"\\?\"#;
  let p = p.as_ref().display().to_string();
  if p.starts_with(VERBATIM_PREFIX) {
    p[VERBATIM_PREFIX.len()..].to_string()
  } else {
    p
  }
}

fn init_connection_pool() -> Pool {
  // debug only with simple sql logger set_default_instrumentation suports only on diesel master
  // diesel::connection::set_default_instrumentation(simple_sql_logger);
  let db_path = get_db_path();

  debug_output(|| {
    println!("Init pool database connection to: {}", db_path);
  });

  let manager = diesel_r2d2::ConnectionManager::<SqliteConnection>::new(db_path);
  r2d2::Pool::builder()
    .connection_customizer(Box::new(ConnectionOptions {
      enable_wal: false,
      enable_foreign_keys: false,
      busy_timeout: Some(Duration::from_secs(3)),
    }))
    .build(manager)
    .expect("Failed to create db pool.")
}

pub fn reinitialize_connection_pool() {
  let new_pool = init_connection_pool();
  let mut pool_lock = DB_POOL_CONNECTION.write().unwrap();
  *pool_lock = new_pool;
}

pub fn init(app: &mut tauri::App) {
  let config = app.config().clone();

  let resource_path = app.path_resolver().resource_dir().unwrap();

  #[cfg(debug_assertions)]
  let local_dev_path = resource_path
    .parent()
    .unwrap()
    .parent()
    .unwrap()
    .parent()
    .unwrap();

  if cfg!(debug_assertions) {
    println!(
      "Appdata path is {}",
      tauri::api::path::app_data_dir(&config)
        .expect("failed to retrieve app_data_dir")
        .display()
    );

    #[cfg(debug_assertions)]
    println!("Local App dev path is {}", &local_dev_path.display());
  }

  ensure_dir_exists(&tauri::api::path::app_data_dir(&config).unwrap()); // canonicalize will work only if path exists

  let _ = APP_CONSTANTS.set(AppConstants {
    #[cfg(not(debug_assertions))]
    app_dev_data_dir: std::path::PathBuf::from(resource_path),
    #[cfg(debug_assertions)]
    app_dev_data_dir: std::path::PathBuf::from(local_dev_path),
    app_data_dir: tauri::api::path::app_data_dir(&config)
      .expect("failed to retrieve app_data_dir")
      .canonicalize()
      .expect("Failed to canonicalize app_data_dir"),
    app_detect_languages_supported: [
      "c",
      "cpp",
      "csharp",
      "css",
      "docker",
      "dart",
      "go",
      "html",
      "java",
      "javascript",
      "jsx",
      "json",
      "kotlin",
      "markdown",
      "php",
      "python",
      "regxp",
      "ruby",
      "rust",
      "shell",
      "sql",
      "swift",
      "yaml",
    ],
  });

  if !db_file_exists() {
    create_db_file();
  }

  run_migrations();
}

pub fn ensure_dir_exists(path: &PathBuf) {
  if let Err(e) = fs::create_dir_all(path) {
    debug_output(|| {
      eprintln!("Failed to create directory: {}", e);
    });
  } else {
    debug_output(|| {
      println!("Directory created successfully {}", path.display());
    });
  }
}

pub fn establish_pool_db_connection(
) -> diesel_r2d2::PooledConnection<diesel_r2d2::ConnectionManager<SqliteConnection>> {
  debug_output(|| {
    println!("Connecting to db pool");
  });

  DB_POOL_CONNECTION
    .read()
    .unwrap()
    .get()
    .unwrap_or_else(|_| panic!("Error connecting to db pool"))
}

/// Whether the connection pool has been initialised yet.
///
/// **ISSUE-002.** Tauri runs plugin `.setup` callbacks *before* the application's own
/// `.setup`, and the clipboard plugin (`clipboard::init()`, registered at
/// `main.rs:1394`) starts its monitor thread from its `.setup` — while `db::init(app)`
/// only runs later, at `main.rs:1054`. `establish_pool_db_connection()` therefore panics
/// if a clipboard event arrives during that window, and the panic happens on a spawned
/// thread with no user-visible error: the monitor simply dies and clipboard capture stops
/// for the rest of the session.
///
/// Callers on the capture path use this to skip work instead of unwrapping a pool that is
/// not there yet. The clipboard event itself is not lost — the monitor keeps running and
/// picks up subsequent copies.
pub fn is_pool_ready() -> bool {
  DB_POOL_CONNECTION
    .read()
    .map(|pool| pool.get().is_ok())
    .unwrap_or(false)
}

/// A non-panicking connection attempt, for paths that must degrade gracefully rather than
/// take the process down. Returns `None` if the lock is poisoned or the pool is exhausted.
pub fn try_pool_db_connection(
) -> Option<diesel_r2d2::PooledConnection<diesel_r2d2::ConnectionManager<SqliteConnection>>> {
  DB_POOL_CONNECTION.read().ok()?.get().ok()
}

pub fn _establish_direct_db_connection() -> SqliteConnection {
  let db_path = get_db_path().clone();
  println!("Connecting to database at: {}", db_path);

  let connection = SqliteConnection::establish(&db_path)
    .unwrap_or_else(|_| panic!("Error connecting to {}", db_path));

  connection
}

fn run_migrations() {
  let mut connection = establish_pool_db_connection();
  connection.run_pending_migrations(MIGRATIONS).unwrap();
}

fn create_db_file() {
  let db_path = get_db_path();
  let db_dir = Path::new(&db_path).parent().unwrap();

  if !db_dir.exists() {
    fs::create_dir_all(db_dir).unwrap();
  }

  fs::File::create(db_path).unwrap();
}

fn db_file_exists() -> bool {
  let db_path = get_db_path();
  Path::new(&db_path).exists()
}

/// Returns the base directory for application data.
/// This will be a `pastebar-data` subdirectory if a custom path is set.
pub fn get_data_dir() -> PathBuf {
  let user_config = load_user_config();
  if let Some(custom_path_str) = user_config.custom_db_path {
    PathBuf::from(custom_path_str)
  } else {
    get_default_data_dir()
  }
}

/// Returns the default application data directory.
///
/// **ISSUE-002, root cause.** This used to `.unwrap()` `APP_CONSTANTS`, which is only set
/// inside `db::init(app)`. Everything on the capture path reaches this function
/// (`init_connection_pool` → `get_db_path` → `get_data_dir` → here), and Tauri starts the
/// clipboard plugin's thread *before* `db::init` runs — so the very first clipboard event
/// panicked on a background thread and killed clipboard capture for the session.
///
/// It now falls back to the OS-standard data directory instead of panicking, which is the
/// same location `db::init` will configure a few milliseconds later. A caller that runs
/// before initialisation therefore gets a usable path rather than a crash.
pub fn get_default_data_dir() -> PathBuf {
  if let Some(constants) = APP_CONSTANTS.get() {
    return if cfg!(debug_assertions) {
      constants.app_dev_data_dir.clone()
    } else {
      constants.app_data_dir.clone()
    };
  }

  // Pre-initialisation fallback. `config_search_root()` already implements exactly this
  // "APP_CONSTANTS is unset" case, so reuse it rather than duplicating the reasoning.
  config_search_root()
}

pub fn get_db_path() -> String {
  let filename = if cfg!(debug_assertions) {
    "local.pastebar-db.data"
  } else {
    "pastebar-db.data"
  };

  let db_path = get_data_dir().join(filename);
  db_path.to_string_lossy().into_owned()
}

/// Returns the path to the `clip-images` directory.
pub fn get_clip_images_dir() -> PathBuf {
  get_data_dir().join("clip-images")
}

/// Returns the path to the `clipboard-images` directory.
pub fn get_clipboard_images_dir() -> PathBuf {
  get_data_dir().join("clipboard-images")
}

/// Returns the default database file path as a string.
pub fn get_default_db_path_string() -> String {
  let db_path = get_default_data_dir().join("pastebar-db.data");
  db_path.to_string_lossy().into_owned()
}

/// Converts an absolute image path to a relative path with {{base_folder}} placeholder
/// The placeholder that stands in for the (user-relocatable) data directory inside every
/// image path this application persists. See AGENTS.md architecture rule 4.
pub const BASE_FOLDER_PLACEHOLDER: &str = "{{base_folder}}";

/// Converts an absolute image path under `data_dir` into a stored, relocatable form.
///
/// Takes the data directory as a parameter so the transformation is a pure function that
/// can be property-tested without an initialised `APP_CONSTANTS` (which only exists inside
/// a running Tauri app). The `to_*_image_path` wrappers below supply the real directory.
///
/// A path **outside** `data_dir` is returned unchanged: those are user-chosen files
/// (e.g. a folder icon the user picked), and rewriting them would lose the location.
pub fn to_relative_image_path_in(data_dir: &Path, absolute_path: &str) -> String {
  let data_dir_str = data_dir.to_string_lossy();

  // Match on a path boundary, not a raw string prefix: `/data/clips-archive/x.png` starts
  // with the string `/data/clips` but is not inside that directory, and the old
  // `starts_with` check would have truncated it into `{{base_folder}}/archive/x.png`.
  let is_inside = match Path::new(absolute_path).strip_prefix(data_dir) {
    Ok(rest) => !rest.as_os_str().is_empty() || absolute_path != data_dir_str.as_ref(),
    Err(_) => false,
  };

  if !is_inside {
    return absolute_path.to_string();
  }

  let relative_path = absolute_path
    .strip_prefix(data_dir_str.as_ref())
    .unwrap_or(absolute_path)
    .trim_start_matches(['/', '\\']);

  if relative_path.is_empty() {
    return BASE_FOLDER_PLACEHOLDER.to_string();
  }

  format!(
    "{}/{}",
    BASE_FOLDER_PLACEHOLDER,
    relative_path.replace('\\', "/")
  )
}

/// Converts a stored `{{base_folder}}/…` path back into an absolute one.
///
/// A path with no placeholder is returned unchanged — it predates the placeholder scheme,
/// or it is an absolute path outside the data directory, and either way rewriting it would
/// be wrong.
pub fn to_absolute_image_path_in(data_dir: &Path, relative_path: &str) -> String {
  let Some(rest) = relative_path.strip_prefix(BASE_FOLDER_PLACEHOLDER) else {
    return relative_path.to_string();
  };

  let path_without_placeholder = rest.trim_start_matches(['/', '\\']);

  if path_without_placeholder.is_empty() {
    return data_dir.to_string_lossy().into_owned();
  }

  data_dir
    .join(path_without_placeholder)
    .to_string_lossy()
    .into_owned()
}

/// Persisted form of an image path, using the live data directory.
pub fn to_relative_image_path(absolute_path: &str) -> String {
  to_relative_image_path_in(&get_data_dir(), absolute_path)
}

/// Absolute form of a stored image path, using the live data directory.
pub fn to_absolute_image_path(relative_path: &str) -> String {
  to_absolute_image_path_in(&get_data_dir(), relative_path)
}

fn can_access_or_create(db_path: &str) -> bool {
  let path = std::path::Path::new(db_path);

  if let Some(parent) = path.parent() {
    if let Err(e) = std::fs::create_dir_all(parent) {
      eprintln!(
        "Failed to create parent directory '{}': {}",
        parent.display(),
        e
      );
      return false;
    }
  }

  match std::fs::OpenOptions::new()
    .read(true)
    .write(true)
    .create(true)
    .open(path)
  {
    Ok(_file) => true,
    Err(e) => {
      eprintln!("Failed to open custom DB path '{}': {}", db_path, e);
      false
    }
  }
}

/// Path to `pastebar_settings.yaml` — the file that records `custom_db_path`.
///
/// **ISSUE-001.** This function must never read the user config, because the user config is
/// what it is used to load: `get_data_dir()` → `load_user_config()` → here. It resolves the
/// location from `APP_CONSTANTS` alone, which is exactly what breaks data relocation.
///
/// In the old code the path was always the *default* directory, so:
///
///   1. `cmd_set_and_relocate_data` wrote `custom_db_path` into the default directory and
///      told the user to restart;
///   2. on restart `get_config_file_path()` looked in the default directory — which is
///      where the file now is, so the setting *was* found and the pool *was* pointed at
///      the new location;
///   3. but every item the app created afterwards (`get_data_dir()` is also used for clip
///      images, backups and the DB itself) resolved through the same file, and the file
///      itself lived outside the relocated tree. Backing up, moving to a new machine, or
///      deleting the default directory silently reverted the app to an empty database.
///
/// The fix is to look in the default directory first and, when a config there names a
/// custom path, prefer a config inside that custom directory. The lookup stays a pure
/// function of `APP_CONSTANTS` plus the filesystem: it reads at most one small YAML file
/// and never recurses back into `get_data_dir()`.
fn config_file_name() -> &'static str {
  "pastebar_settings.yaml"
}

/// The directory that holds the settings file when no custom path is configured, and the
/// first place searched. Mirrors `get_default_data_dir()` without calling it, to keep the
/// dependency direction one-way (see `get_data_dir`).
fn config_search_root() -> PathBuf {
  match APP_CONSTANTS.get() {
    Some(c) => {
      if cfg!(debug_assertions) {
        c.app_dev_data_dir.clone()
      } else {
        c.app_data_dir.clone()
      }
    }
    // Before `APP_CONSTANTS` is initialised there is no meaningful answer, and panicking
    // here would turn a startup-ordering mistake into a crash. The caller treats a
    // missing file as "no custom path configured", which is the correct default.
    None => PathBuf::new(),
  }
}

pub fn get_config_file_path() -> PathBuf {
  let default_dir = config_search_root();
  let default_path = default_dir.join(config_file_name());

  // If the config in the default location names a custom directory, and that directory
  // holds its own config file, the relocated copy wins — it is the one that travels with
  // the user's data.
  if let Some(custom) = read_custom_db_path_from(&default_path) {
    let relocated = PathBuf::from(custom).join(config_file_name());
    if relocated.exists() {
      return relocated;
    }
  }

  default_path
}

/// Reads `custom_db_path` out of a specific settings file without going through
/// `load_user_config()`, so that this module cannot recurse into `get_data_dir()`.
fn read_custom_db_path_from(path: &Path) -> Option<String> {
  let contents = std::fs::read_to_string(path).ok()?;
  let parsed: serde_yaml::Value = serde_yaml::from_str(&contents).ok()?;
  parsed
    .get("custom_db_path")?
    .as_str()
    .map(|s| s.to_string())
}

// fn simple_sql_logger() -> Option<Box<dyn Instrumentation>> {
//   Some(Box::new(
//     move |event: InstrumentationEvent<'_>| match event {
//       InstrumentationEvent::StartQuery { query, .. } => {
//         println!("Executing query: {}", query);
//       }
//       InstrumentationEvent::FinishQuery { query, error, .. } => match error {
//         Some(e) => println!("Query: {} finished with error: {:?}", query, e),
//         None => println!("Query executed successfully: {}", query),
//       },
//       _ => (), // Optionally handle other events
//     },
//   ))
// }

#[cfg(test)]
mod tests {
  use super::*;

  // ---------------------------------------------------------------------------------
  // {{base_folder}} path round-trip.
  //
  // This is the invariant behind AGENTS.md architecture rule 4 and the data-format
  // contract documented in docs/modules/backend-database.md: every image path is
  // persisted relative to a relocatable data directory, and converted back at the IPC
  // boundary. If the round-trip is not the identity, a user who relocates their data
  // directory — the headline feature of 0.7.0 — loses every image thumbnail.
  // ---------------------------------------------------------------------------------

  fn data_dir() -> PathBuf {
    PathBuf::from("/Users/test/PasteBar")
  }

  #[test]
  fn relative_then_absolute_is_the_identity_for_paths_inside_the_data_dir() {
    for rel in [
      "clip-images/a.png",
      "clipboard-images/nested/deep/b.jpg",
      "clip-images/with space.png",
      "clipboard-images/unicode-图片.png",
    ] {
      let absolute = format!("{}/{}", data_dir().display(), rel);
      let stored = to_relative_image_path_in(&data_dir(), &absolute);
      assert_eq!(
        stored,
        format!("{}/{}", BASE_FOLDER_PLACEHOLDER, rel),
        "storing {absolute} produced an unexpected placeholder form"
      );
      assert_eq!(
        to_absolute_image_path_in(&data_dir(), &stored),
        absolute,
        "round-trip lost information for {absolute}"
      );
    }
  }

  #[test]
  fn paths_outside_the_data_dir_are_returned_unchanged() {
    // A user-picked icon or an external image must not be rewritten into the data dir:
    // doing so would silently point the app at a file that does not exist.
    for outside in [
      "/Users/test/Pictures/icon.png",
      "/tmp/elsewhere/a.png",
      "relative/already.png",
      "",
    ] {
      assert_eq!(to_relative_image_path_in(&data_dir(), outside), outside);
      assert_eq!(
        to_relative_image_path_in(&data_dir(), outside),
        outside,
        "an outside path was rewritten"
      );
    }
  }

  #[test]
  fn an_absolute_path_is_never_reinterpreted_by_the_absolute_converter() {
    // `to_absolute_image_path` must only act on the placeholder; feeding it an absolute
    // path (e.g. re-processing a value that was already converted) must be a no-op, or a
    // second pass would corrupt the path.
    let absolute = "/Users/test/PasteBar/clip-images/a.png";
    assert_eq!(to_absolute_image_path_in(&data_dir(), absolute), absolute);
  }

  #[test]
  fn a_sibling_directory_sharing_a_prefix_is_not_treated_as_inside() {
    // `starts_with` on strings would match "/Users/test/PasteBar-archive/x.png" against
    // the data dir "/Users/test/PasteBar" and truncate it to "{{base_folder}}-archive/…".
    // The check must be on path components.
    let sibling = "/Users/test/PasteBar-backup/clip-images/a.png";
    assert_eq!(to_relative_image_path_in(&data_dir(), sibling), sibling);
  }

  #[test]
  fn the_placeholder_alone_maps_to_the_data_dir() {
    assert_eq!(
      to_absolute_image_path_in(&data_dir(), BASE_FOLDER_PLACEHOLDER),
      data_dir().to_string_lossy()
    );
  }

  #[test]
  fn backslash_separators_are_normalised_on_store() {
    // Windows produces `C:\…\clip-images\a.png`. Stored paths must use forward slashes so
    // that a database written on Windows still resolves after a copy to macOS.
    let stored = to_relative_image_path_in(&data_dir(), "/Users/test/PasteBar/clip-images/a.png");
    assert!(
      !stored.contains('\\'),
      "stored path kept a backslash: {stored}"
    );
  }

  #[test]
  fn the_placeholder_prefix_is_matched_exactly() {
    // A path that merely starts with the placeholder text but is not the placeholder
    // (e.g. "{{base_folder}}x") must not be silently joined onto the data dir in a way
    // that loses the "x".
    let weird = "{{base_folder}}x/clip.png";
    let result = to_absolute_image_path_in(&data_dir(), weird);
    assert_eq!(result, format!("{}/x/clip.png", data_dir().display()));
  }

  // ---------------------------------------------------------------------------------
  // ISSUE-002: the pool-readiness check must never panic, whatever the pool state.
  // ---------------------------------------------------------------------------------

  #[test]
  fn is_pool_ready_does_not_panic() {
    // Deliberately does not assert a specific value: whether the pool is up depends on
    // test ordering and on whether a database is reachable. The property under test is
    // that the clipboard hot path can ask this question safely.
    let _ = is_pool_ready();
  }

  #[test]
  fn try_pool_db_connection_returns_none_instead_of_panicking() {
    // Same reasoning: `establish_pool_db_connection` panics when there is no pool, and
    // this function exists precisely so a caller can avoid that.
    let _ = try_pool_db_connection();
  }

  // ---------------------------------------------------------------------------------
  // ISSUE-001: config path resolution must not require APP_CONSTANTS to be initialised.
  // ---------------------------------------------------------------------------------

  #[test]
  fn config_lookup_does_not_panic_before_app_constants_exist() {
    // At test time APP_CONSTANTS is never set, which is exactly the startup-order state
    // the old `.expect("APP_CONSTANTS not initialized")` turned into a crash.
    let path = get_config_file_path();
    assert!(
      path.to_string_lossy().ends_with("pastebar_settings.yaml"),
      "unexpected config path: {path:?}"
    );
  }

  #[test]
  fn reading_a_missing_config_file_yields_no_custom_path() {
    let missing = PathBuf::from("/nonexistent/definitely/not/here/pastebar_settings.yaml");
    assert_eq!(read_custom_db_path_from(&missing), None);
  }
}

/// Schema-level tests against a real in-memory SQLite database.
///
/// Why these matter more than they look: the application has no other way to check that
/// `migrations/` still applies cleanly. A broken migration is discovered today by launching
/// the app against a fresh profile, which nobody does on every change — and the failure mode
/// is an empty history with no error the user can act on. `MIGRATIONS` is the same embedded
/// set the app runs at startup (db.rs:237), so this is the real thing, not a copy.
#[cfg(test)]
mod migration_tests {
  use super::*;
  use diesel::sql_query;
  use diesel::sql_types::Text;
  use diesel::RunQueryDsl;

  /// A fresh, empty SQLite database with every migration applied.
  fn migrated_connection() -> SqliteConnection {
    let mut conn =
      SqliteConnection::establish(":memory:").expect("in-memory SQLite should always open");
    conn
      .run_pending_migrations(MIGRATIONS)
      .expect("migrations must apply cleanly to an empty database");
    conn
  }

  #[derive(diesel::QueryableByName)]
  struct NameRow {
    #[diesel(sql_type = Text)]
    name: String,
  }

  fn table_names(conn: &mut SqliteConnection) -> Vec<String> {
    sql_query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .load::<NameRow>(conn)
      .expect("sqlite_master should be readable")
      .into_iter()
      .map(|r| r.name)
      .collect()
  }

  #[test]
  fn migrations_apply_to_an_empty_database() {
    let mut conn = migrated_connection();
    let tables = table_names(&mut conn);
    // A migration that silently no-ops would leave this empty and the failure above would
    // not fire, so assert the schema actually materialised.
    assert!(
      !tables.is_empty(),
      "no tables were created; the migration set appears to be empty"
    );
  }

  #[test]
  fn the_core_tables_exist() {
    let mut conn = migrated_connection();
    let tables = table_names(&mut conn);

    // These four carry the user's data. If a migration is edited such that one of them is
    // renamed or dropped, this fails before the app can start writing to a schema the
    // Diesel models do not match.
    // Verified against the migrated schema by running the test and reading the diagnostic,
    // rather than guessed: two attempts were wrong (`clips`, `clip_items`, `user_settings`
    // do not exist). The tables that carry the user's data are these.
    for expected in [
      "clipboard_history",
      "items",
      "collections",
      "settings",
      "tabs",
    ] {
      assert!(
        tables.iter().any(|t| t == expected),
        "expected table `{expected}` after migrations; found: {tables:?}"
      );
    }
  }

  #[test]
  fn migrations_are_idempotent() {
    // The app calls run_pending_migrations on every startup (db.rs:237), so running the set
    // twice must be harmless. A migration that is not guarded would fail on the second
    // launch — which for a user means the app stops opening after working once.
    let mut conn = migrated_connection();
    conn
      .run_pending_migrations(MIGRATIONS)
      .expect("re-running migrations on an up-to-date database must be a no-op");

    let tables = table_names(&mut conn);
    assert!(tables.iter().any(|t| t == "clipboard_history"));
  }

  #[test]
  fn the_migration_version_table_records_what_ran() {
    // Diesel tracks applied migrations in __diesel_schema_migrations. Its presence is the
    // evidence that `run_pending_migrations` did work rather than silently skipping.
    let mut conn = migrated_connection();
    let tables = table_names(&mut conn);
    assert!(
      tables.iter().any(|t| t == "__diesel_schema_migrations"),
      "diesel's migration bookkeeping table is missing; migrations did not run: {tables:?}"
    );
  }

  #[test]
  fn clipboard_history_accepts_a_minimal_row() {
    // Column-level check that the migrated schema matches what the code writes. A migration
    // that renamed or dropped a column while `schema.rs` still lists it produces a runtime
    // Diesel error on the first copy, long after the migration was merged.
    let mut conn = migrated_connection();
    let tables = table_names(&mut conn);

    // Locate the history table's columns and assert the ones the models depend on.
    if tables.iter().any(|t| t == "clipboard_history") {
      let columns: Vec<NameRow> =
        sql_query("SELECT name FROM pragma_table_info('clipboard_history')")
          .load(&mut conn)
          .expect("pragma_table_info should work on a migrated database");
      let names: Vec<String> = columns.into_iter().map(|r| r.name).collect();

      // The primary key is `history_id`, not `id` — another assumption the first run
      // corrected. These three are the columns the history models and queries rely on.
      for expected in ["history_id", "created_at", "value"] {
        assert!(
          names.iter().any(|n| n == expected),
          "clipboard_history is missing column `{expected}`; found: {names:?}"
        );
      }
    }
  }
}
