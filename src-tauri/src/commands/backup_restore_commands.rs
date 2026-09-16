use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

use diesel::prelude::*;
use diesel::SqliteConnection;
use nanoid::nanoid;

use crate::db::{get_clip_images_dir, get_clipboard_images_dir, get_data_dir, get_db_path};
use crate::services::utils::debug_output;

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupInfo {
  pub filename: String,
  pub full_path: String,
  pub created_date: String,
  pub size: u64,
  pub size_formatted: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackupListResponse {
  pub backups: Vec<BackupInfo>,
  pub total_size: u64,
  pub total_size_formatted: String,
}

fn get_backup_filename() -> String {
  let now = Local::now();
  format!("pastebar-data-backup-{}.zip", now.format("%Y-%m-%d-%H-%M"))
}

fn format_file_size(size: u64) -> String {
  const UNITS: &[&str] = &["B", "KB", "MB", "GB"];
  let mut size_f = size as f64;
  let mut unit_index = 0;

  while size_f >= 1024.0 && unit_index < UNITS.len() - 1 {
    size_f /= 1024.0;
    unit_index += 1;
  }

  if unit_index == 0 {
    format!("{} {}", size, UNITS[unit_index])
  } else {
    format!("{:.1} {}", size_f, UNITS[unit_index])
  }
}

fn add_directory_to_zip<W: Write + Seek>(
  zip: &mut ZipWriter<W>,
  dir_path: &Path,
  base_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
  if !dir_path.exists() {
    debug_output(|| {
      println!("Directory does not exist: {}", dir_path.display());
    });
    return Ok(());
  }

  let options = FileOptions::default()
    .compression_method(zip::CompressionMethod::Deflated)
    .unix_permissions(0o755);

  for entry in fs::read_dir(dir_path)? {
    let entry = entry?;
    let path = entry.path();
    let relative_path = path.strip_prefix(base_path)?;

    if path.is_dir() {
      // Add directory entry
      let dir_name = format!("{}/", relative_path.display());
      zip.start_file(dir_name, options)?;

      // Recursively add directory contents
      add_directory_to_zip(zip, &path, base_path)?;
    } else {
      // Add file
      let mut file = fs::File::open(&path)?;
      let mut buffer = Vec::new();
      file.read_to_end(&mut buffer)?;

      zip.start_file(relative_path.to_string_lossy(), options)?;
      zip.write_all(&buffer)?;
    }
  }

  Ok(())
}

/// Which tables the backup keeps.
///
/// Everything the user *saved*: clips, the collections/tabs/menus that organise them, the
/// settings that describe their setup, and the clipboard entries they starred or pinned
/// (those are deliberate marks, not transient history).
const BACKUP_KEPT_TABLES: &[&str] = &[
  "collections",
  "tabs",
  "collection_clips",
  "collection_menu",
  "items",
  "settings",
];

/// Which tables the backup drops.
///
/// `clipboard_history` keeps only rows the user marked; everything else in it is history.
/// `link_metadata` is per-history-row metadata, so it is only meaningful alongside the rows
/// it describes.
const BACKUP_FILTERED_TABLES: &[&str] = &["clipboard_history"];

/// Tables whose rows are filtered by a custom predicate rather than wholesale.
///
/// `link_metadata` joins to EITHER a history row OR an item row (`history_id` and `item_id`
/// are each nullable and unique), so it belongs to both halves of the backup. Keeping the
/// table whole would carry metadata for history rows this backup deliberately excludes —
/// rows nothing references, which is exactly what excluding the history was meant to avoid.
/// Dropping it whole would lose the metadata for saved clips and for starred/pinned
/// entries. So it is filtered row by row, following whichever parent survives.
const BACKUP_CONDITIONAL_TABLES: &[&str] = &["link_metadata"];

/// Produce a consistent, filtered copy of the database as bytes.
///
/// Uses `VACUUM INTO`, which is the only way to get a consistent snapshot of a live SQLite
/// database without stopping writers: it rebuilds into a new file (so no WAL frame is
/// half-applied) *and* compacts (so the copy is not padded with free pages). Copying the
/// `.data` file directly — what this did before — can capture a torn write under WAL.
///
/// The filtered tables are then emptied in the COPY. Rows the user marked (`is_pinned` or
/// `is_favorite`) are kept, because those are saved content rather than history.
fn export_backup_database() -> Result<Vec<u8>, String> {
  let snapshot_path = std::env::temp_dir().join(format!("pastebar-backup-{}.data", nanoid!()));

  // Remove any stale file: `VACUUM INTO` refuses to overwrite an existing target.
  let _ = fs::remove_file(&snapshot_path);

  let result = (|| -> Result<Vec<u8>, String> {
    {
      let connection = &mut crate::db::establish_pool_db_connection();

      // Path is interpolated rather than bound: `VACUUM INTO` does not accept a parameter
      // for its target in SQLite — a bound parameter there is a syntax error, not a safety
      // feature. The path is machine-generated (temp dir + nanoid) and cannot contain a
      // quote, which is what makes the interpolation safe.
      let escaped = snapshot_path.to_string_lossy().replace('\'', "''");
      diesel::sql_query(format!("VACUUM INTO '{}'", escaped))
        .execute(connection)
        .map_err(|e| format!("Failed to snapshot database: {}", e))?;
    }

    // Filter the COPY on its own connection, so the live database is never written to.
    let mut snapshot = SqliteConnection::establish(&snapshot_path.to_string_lossy())
      .map_err(|e| format!("Failed to open database snapshot: {}", e))?;

    filter_backup_snapshot(&mut snapshot)?;
    drop(snapshot);

    fs::read(&snapshot_path).map_err(|e| format!("Failed to read database snapshot: {}", e))
  })();

  let _ = fs::remove_file(&snapshot_path);
  result
}

/// Empty the history out of a snapshot and verify the schema is accounted for.
///
/// Split from [`export_backup_database`] so it can be tested against an in-memory database
/// — the file orchestration around it needs the live connection pool, but this part is
/// where the decisions are, and a backup that quietly contains history is exactly the kind
/// of defect that is discovered too late to fix.
///
/// Two things happen here, and the second is the guard rail:
///
///   1. History rows are deleted FROM THE SNAPSHOT (never the live database), keeping rows
///      the user marked as pinned or starred — those are saved content, not history.
///   2. Every table in the snapshot must appear in one of the two lists. A new table added
///      to the schema by a future migration therefore FAILS the backup loudly, instead of
///      being archived by default (leaking whatever it holds into every backup) or dropped
///      by default (silently losing user data on restore). Both defaults are wrong, so the
///      code refuses to guess.
fn filter_backup_snapshot(snapshot: &mut SqliteConnection) -> Result<(), String> {
  for table in BACKUP_FILTERED_TABLES {
    let sql = format!(
      "DELETE FROM {} WHERE COALESCE(is_pinned, 0) = 0 AND COALESCE(is_favorite, 0) = 0",
      table
    );
    diesel::sql_query(sql)
      .execute(snapshot)
      .map_err(|e| format!("Failed to filter {} from snapshot: {}", table, e))?;
  }

  // Run AFTER the history delete above so the predicate can simply check whether the parent
  // row still exists, rather than re-deriving which rows were removed.
  for table in BACKUP_CONDITIONAL_TABLES {
    let sql = format!(
      "DELETE FROM {table} WHERE \
         (history_id IS NOT NULL AND history_id NOT IN (SELECT history_id FROM clipboard_history)) \
         OR (item_id IS NOT NULL AND item_id NOT IN (SELECT item_id FROM items))",
      table = table
    );
    diesel::sql_query(sql)
      .execute(snapshot)
      .map_err(|e| format!("Failed to filter {} from snapshot: {}", table, e))?;
  }

  // Reclaim what those deletes freed. Best-effort: a failure costs archive size, not
  // correctness, and must not fail the backup.
  if let Err(e) = diesel::sql_query("VACUUM").execute(snapshot) {
    eprintln!("Could not compact database snapshot: {}", e);
  }

  let tables: Vec<String> = diesel::sql_query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' \
     AND name != '__diesel_schema_migrations'",
  )
  .load::<TableNameRow>(snapshot)
  .map_err(|e| format!("Failed to read snapshot schema: {}", e))?
  .into_iter()
  .map(|r| r.name)
  .collect();

  for table in &tables {
    if !BACKUP_KEPT_TABLES.contains(&table.as_str())
      && !BACKUP_FILTERED_TABLES.contains(&table.as_str())
      && !BACKUP_CONDITIONAL_TABLES.contains(&table.as_str())
      && table != "maintenance_log"
    {
      return Err(format!(
        "Table '{}' is in none of the backup's three table lists. Add it to \
         BACKUP_KEPT_TABLES (archived whole), BACKUP_FILTERED_TABLES (emptied) or \
         BACKUP_CONDITIONAL_TABLES (filtered row by row) deliberately — a new table must \
         not be archived by default (leaking its contents into every backup) or dropped by \
         default (losing user data on restore).",
        table
      ));
    }
  }

  Ok(())
}

/// Row shape for the schema check above.
#[derive(diesel::QueryableByName)]
struct TableNameRow {
  #[diesel(sql_type = diesel::sql_types::Text)]
  name: String,
}

/// Create a backup archive.
///
/// `include_images` is retained for call-site compatibility and still gates the image
/// directories, but it no longer affects the database contents.
///
/// `force_without_vacuum` exists because a vacuum can legitimately fail (the database is
/// locked by another connection, the disk is full). The user then chooses: retry later, or
/// back up anyway knowing the archive may contain reclaimed-but-unreleased free pages. The
/// frontend asks; this command never decides silently.
#[tauri::command]
pub async fn create_backup(
  include_images: bool,
  force_without_vacuum: bool,
) -> Result<String, String> {
  debug_output(|| {
    println!(
      "Creating backup (include_images: {}, force_without_vacuum: {})",
      include_images, force_without_vacuum
    );
  });

  // Vacuum BEFORE archiving, and refuse to continue if it fails.
  //
  // Two reasons, and the first is the one that matters. VACUUM rebuilds the database into a
  // fresh file, so the export below cannot capture a torn write — this is what makes the
  // backup a consistent snapshot rather than a hopeful file copy. The second is size: a
  // history cleared many times carries a lot of free pages, and they would be archived
  // instead of reclaimed.
  //
  // Refusing on failure is deliberate. A backup the user believes is sound but is not is
  // worse than no backup, because the moment they need it is the moment they find out.
  // `VACUUM_FAILED:` is the prefix the frontend matches to offer the forced retry.
  if !force_without_vacuum {
    crate::services::maintenance_service::run_vacuum().map_err(|e| {
      format!(
        "VACUUM_FAILED: could not reclaim database space before backing up ({}). \
         The backup was not created.",
        e
      )
    })?;
  } else {
    debug_output(|| {
      println!("Backing up without a vacuum, at the user's request");
    });
  }

  let data_dir = get_data_dir();
  let backup_filename = get_backup_filename();
  let backup_path = data_dir.join(&backup_filename);

  debug_output(|| {
    println!("Data directory: {}", data_dir.display());
    println!("Backup will be created at: {}", backup_path.display());
  });

  // Database file path - use the actual database path which handles debug/release naming
  let db_path_str = get_db_path();
  let db_path = PathBuf::from(&db_path_str);

  debug_output(|| {
    println!("Looking for database file at: {}", db_path_str);
    println!("Database file exists: {}", db_path.exists());
  });

  if !db_path.exists() {
    return Err(format!("Database file not found at: {}", db_path_str));
  }

  // Create zip file
  let file =
    fs::File::create(&backup_path).map_err(|e| format!("Failed to create backup file: {}", e))?;
  let mut zip = ZipWriter::new(file);

  let options = FileOptions::default()
    .compression_method(zip::CompressionMethod::Deflated)
    .unix_permissions(0o644);

  // Archive a FILTERED copy of the database, not the live file.
  //
  // A backup holds the user's saved content — clips, collections, tabs, menus, settings and
  // starred/pinned clipboard entries — and deliberately NOT the clipboard history itself.
  // History is bulk transient data: it is what makes a backup large, it is regenerated by
  // using the app, and restoring it is not something the user asked for. Excluding it keeps
  // backups small enough to be routine.
  //
  // Note the consequence, which is intended: `restore_backup` replaces the database file
  // wholesale and the archive carries no history rows, so a restore clears the current
  // history. That is the documented behaviour (see docs/reference/build-and-release.md),
  // not an accident.
  let db_buffer = export_backup_database()?;

  // Get just the filename for the zip entry
  let db_filename = db_path
    .file_name()
    .and_then(|name| name.to_str())
    .unwrap_or("pastebar-db.data");

  zip
    .start_file(db_filename, options)
    .map_err(|e| format!("Failed to start database file in zip: {}", e))?;
  zip
    .write_all(&db_buffer)
    .map_err(|e| format!("Failed to write database to zip: {}", e))?;

  // Add image directories if requested
  if include_images {
    let clip_images_dir = get_clip_images_dir();
    let history_images_dir = get_clipboard_images_dir();

    debug_output(|| {
      println!("Clip images directory: {}", clip_images_dir.display());
      println!("Clip images exists: {}", clip_images_dir.exists());
      println!("History images directory: {}", history_images_dir.display());
      println!("History images exists: {}", history_images_dir.exists());
    });

    if clip_images_dir.exists() {
      add_directory_to_zip(&mut zip, &clip_images_dir, &data_dir)
        .map_err(|e| format!("Failed to add clip-images directory: {}", e))?;
    }

    // `clipboard-images` is deliberately NOT archived. It is the on-disk half of the
    // clipboard history, so archiving it while excluding the history rows would restore
    // images nothing references — unreachable data occupying space, with no way to see or
    // delete it from the UI. `clip-images` IS archived: those belong to saved clips.
    let _ = &history_images_dir; // still read, for the debug trace above
  }

  zip
    .finish()
    .map_err(|e| format!("Failed to finalize zip file: {}", e))?;

  debug_output(|| {
    println!("Backup created successfully: {}", backup_path.display());
  });

  Ok(backup_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn list_backups() -> Result<BackupListResponse, String> {
  let data_dir = get_data_dir();
  let mut backups = Vec::new();
  let mut total_size = 0u64;

  if let Ok(entries) = fs::read_dir(&data_dir) {
    for entry in entries {
      if let Ok(entry) = entry {
        let path = entry.path();
        if let Some(filename) = path.file_name() {
          let filename_str = filename.to_string_lossy();
          if filename_str.starts_with("pastebar-data-backup-") && filename_str.ends_with(".zip") {
            if let Ok(metadata) = entry.metadata() {
              let size = metadata.len();
              total_size += size;

              // Parse date from filename
              let created_date = if let Some(date_part) = filename_str
                .strip_prefix("pastebar-data-backup-")
                .and_then(|s| s.strip_suffix(".zip"))
              {
                // Format: YYYY-MM-DD-HH-MM
                if let Ok(parsed_date) = DateTime::parse_from_str(
                  &format!(
                    "{} +0000",
                    date_part
                      .replace('-', " ")
                      .replacen(' ', "-", 2)
                      .replacen(' ', "-", 1)
                      .replacen(' ', ":", 1)
                  ),
                  "%Y-%m-%d-%H-%M %z",
                ) {
                  parsed_date.format("%B %d, %Y at %I:%M %p").to_string()
                } else {
                  "Unknown date".to_string()
                }
              } else {
                "Unknown date".to_string()
              };

              backups.push(BackupInfo {
                filename: filename_str.to_string(),
                full_path: path.to_string_lossy().to_string(),
                created_date,
                size,
                size_formatted: format_file_size(size),
              });
            }
          }
        }
      }
    }
  }

  // Sort by filename (which includes date) in descending order
  backups.sort_by(|a, b| b.filename.cmp(&a.filename));

  Ok(BackupListResponse {
    backups,
    total_size,
    total_size_formatted: format_file_size(total_size),
  })
}

#[tauri::command]
pub async fn restore_backup(
  backup_path: String,
  create_pre_restore_backup: bool,
) -> Result<String, String> {
  debug_output(|| {
    println!("Restoring backup from: {}", backup_path);
  });

  // Basic validation - check if file exists and is a zip
  let backup_file = Path::new(&backup_path);
  if !backup_file.exists() {
    return Err("Backup file does not exist".to_string());
  }
  if !backup_file.extension().is_some_and(|ext| ext == "zip") {
    return Err("Backup file must be a zip file".to_string());
  }

  let data_dir = get_data_dir();

  // Optionally create backup of current data before restore
  if create_pre_restore_backup {
    if let Err(e) = create_backup(true, false).await {
      debug_output(|| {
        println!("Warning: Could not create pre-restore backup: {}", e);
      });
    } else {
      debug_output(|| {
        println!("Created pre-restore backup");
      });
    }
  } else {
    debug_output(|| {
      println!("Skipping pre-restore backup as requested");
    });
  }

  // Open the backup zip file
  let file =
    fs::File::open(&backup_path).map_err(|e| format!("Failed to open backup file: {}", e))?;

  let mut archive =
    ZipArchive::new(file).map_err(|e| format!("Failed to read backup file: {}", e))?;

  // Extract files
  for i in 0..archive.len() {
    let mut file = archive
      .by_index(i)
      .map_err(|e| format!("Failed to read file from backup: {}", e))?;

    let sanitized_name = file.name().replace("..", "");
    let outpath = data_dir.join(sanitized_name);

    if file.name().ends_with('/') {
      // Directory
      fs::create_dir_all(&outpath).map_err(|e| format!("Failed to create directory: {}", e))?;
    } else {
      // File
      if let Some(parent) = outpath.parent() {
        fs::create_dir_all(parent)
          .map_err(|e| format!("Failed to create parent directory: {}", e))?;
      }

      let mut outfile =
        fs::File::create(&outpath).map_err(|e| format!("Failed to create file: {}", e))?;

      std::io::copy(&mut file, &mut outfile)
        .map_err(|e| format!("Failed to extract file: {}", e))?;
    }
  }

  debug_output(|| {
    println!("Backup restored successfully from: {}", backup_path);
  });

  Ok("Backup restored successfully".to_string())
}

#[tauri::command]
pub async fn delete_backup(backup_path: String) -> Result<String, String> {
  let path = Path::new(&backup_path);

  if !path.exists() {
    return Err("Backup file does not exist".to_string());
  }

  // Validate it's actually a backup file
  if let Some(filename) = path.file_name() {
    let filename_str = filename.to_string_lossy();
    if !filename_str.starts_with("pastebar-data-backup-") || !filename_str.ends_with(".zip") {
      return Err("File is not a valid backup file".to_string());
    }
  } else {
    return Err("Invalid file path".to_string());
  }

  fs::remove_file(path).map_err(|e| format!("Failed to delete backup file: {}", e))?;

  debug_output(|| {
    println!("Backup deleted successfully: {}", backup_path);
  });

  Ok("Backup deleted successfully".to_string())
}

#[tauri::command]
pub async fn get_data_paths() -> Result<serde_json::Value, String> {
  let data_dir = get_data_dir();

  Ok(serde_json::json!({
      "data_dir": data_dir.to_string_lossy(),
      "database_file": if cfg!(debug_assertions) { "local.pastebar-db.data" } else { "pastebar-db.data" },
      "clip_images_dir": data_dir.join("clip-images").to_string_lossy(),
      // Was reported as "history-images", a directory that does not exist — the real name is
      // "clipboard-images" (db::get_clipboard_images_dir). Nothing consumed this field yet,
      // so the wrong path was harmless, but it is the field a UI would show a user, and a
      // confidently wrong path is worse than an absent one.
      "history_images_dir": get_clipboard_images_dir().to_string_lossy()
  }))
}

#[cfg(test)]
mod backup_filter_tests {
  use super::*;
  use diesel::connection::SimpleConnection;

  /// An in-memory database with the tables the backup filter reasons about.
  ///
  /// Hand-built rather than migrated: these tests are about the filter's decisions, and a
  /// hand-built schema lets a test use a table the real schema does not have yet (the
  /// "unknown table" case below), which is the whole point of that guard rail.
  fn snapshot_connection() -> SqliteConnection {
    use diesel_migrations::MigrationHarness;
    let mut conn = SqliteConnection::establish(":memory:").expect("in-memory SQLite opens");
    conn
      .run_pending_migrations(crate::db::MIGRATIONS)
      .expect("migrations must apply to an empty database");
    conn
  }

  fn count(conn: &mut SqliteConnection, table: &str) -> i64 {
    #[derive(diesel::QueryableByName)]
    struct N {
      #[diesel(sql_type = diesel::sql_types::BigInt)]
      n: i64,
    }
    diesel::sql_query(format!("SELECT COUNT(*) AS n FROM {}", table))
      .load::<N>(conn)
      .expect("count should work")
      .remove(0)
      .n
  }

  /// Insert a history row using only the columns that actually exist.
  ///
  /// `created_at`/`updated_at`/`created_date`/`updated_date` are NOT NULL in the real schema,
  /// so they must be supplied — the hand-written fixture never had to, which is part of why
  /// it drifted from reality.
  fn insert_history(conn: &mut SqliteConnection, id: &str, pinned: bool, favorite: bool) {
    conn
      .batch_execute(&format!(
        "INSERT INTO clipboard_history \
         (history_id, is_pinned, is_favorite, value, created_at, updated_at, created_date, updated_date) \
       VALUES ('{id}', {pinned}, {favorite}, 'v', 0, 0, '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
        id = id,
        pinned = pinned as i32,
        favorite = favorite as i32
      ))
      .expect("insert should work");
  }

  fn insert_item(conn: &mut SqliteConnection, id: &str) {
    conn
      .batch_execute(&format!(
        "INSERT INTO items (item_id, name, created_at, updated_at, created_date, updated_date) \
       VALUES ('{id}', 'clip', 0, 0, '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
        id = id
      ))
      .expect("insert should work");
  }

  /// Link metadata pointing at a history row, an item row, or both.
  fn insert_link_metadata(
    conn: &mut SqliteConnection,
    id: &str,
    history_id: Option<&str>,
    item_id: Option<&str>,
  ) {
    let render = |v: Option<&str>| match v {
      Some(v) => format!("'{}'", v),
      None => "NULL".to_string(),
    };
    conn
      .batch_execute(&format!(
        "INSERT INTO link_metadata (metadata_id, history_id, item_id, link_url) \
       VALUES ('{id}', {h}, {i}, 'https://example.com')",
        id = id,
        h = render(history_id),
        i = render(item_id)
      ))
      .expect("insert should work");
  }

  #[test]
  fn history_rows_are_removed_from_the_backup() {
    let mut conn = snapshot_connection();
    insert_history(&mut conn, "plain-1", false, false);
    insert_history(&mut conn, "plain-2", false, false);

    filter_backup_snapshot(&mut conn).expect("filter should succeed");

    assert_eq!(
      count(&mut conn, "clipboard_history"),
      0,
      "unmarked history must not be archived"
    );
  }

  #[test]
  fn pinned_and_starred_rows_are_kept() {
    // The distinction the whole feature rests on: a row the user marked is saved content,
    // not transient history. Deleting these would lose data the user deliberately kept.
    let mut conn = snapshot_connection();
    insert_history(&mut conn, "plain", false, false);
    insert_history(&mut conn, "pinned", true, false);
    insert_history(&mut conn, "starred", false, true);
    insert_history(&mut conn, "both", true, true);

    filter_backup_snapshot(&mut conn).expect("filter should succeed");

    assert_eq!(count(&mut conn, "clipboard_history"), 3, "kept rows");
  }

  #[test]
  fn a_null_marked_row_is_treated_as_unmarked() {
    // `is_pinned`/`is_favorite` are nullable, and older rows genuinely hold NULL (the live
    // database had them). Without COALESCE the comparison is NULL — neither true nor false —
    // and the DELETE would skip the row, silently archiving history.
    let mut conn = snapshot_connection();
    conn
      .batch_execute(
        "INSERT INTO clipboard_history \
           (history_id, is_pinned, is_favorite, value, created_at, updated_at, created_date, updated_date) \
         VALUES ('nulls', NULL, NULL, 'v', 0, 0, '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
      )
      .expect("insert should work");

    filter_backup_snapshot(&mut conn).expect("filter should succeed");

    assert_eq!(
      count(&mut conn, "clipboard_history"),
      0,
      "NULL means unmarked"
    );
  }

  #[test]
  fn link_metadata_follows_whichever_parent_survives() {
    // `link_metadata` joins to a history row OR an item row, so it belongs to both halves of
    // the backup. This is the case that shipped broken: the table exists in the real schema
    // but not in the hand-written test fixture, so the guard rejected every real backup while
    // the tests stayed green. Keeping only history-linked metadata would archive rows nothing
    // references; dropping the table whole would lose metadata for saved clips.
    let mut conn = snapshot_connection();

    insert_history(&mut conn, "hist-plain", false, false);
    insert_history(&mut conn, "hist-kept", true, false);
    insert_item(&mut conn, "item-1");

    insert_link_metadata(&mut conn, "m-history-deleted", Some("hist-plain"), None);
    insert_link_metadata(&mut conn, "m-history-kept", Some("hist-kept"), None);
    insert_link_metadata(&mut conn, "m-item", None, Some("item-1"));

    filter_backup_snapshot(&mut conn).expect("filter should succeed");

    let remaining: Vec<String> = {
      #[derive(diesel::QueryableByName)]
      struct R {
        #[diesel(sql_type = diesel::sql_types::Text)]
        metadata_id: String,
      }
      diesel::sql_query("SELECT metadata_id FROM link_metadata ORDER BY metadata_id")
        .load::<R>(&mut conn)
        .expect("query should work")
        .into_iter()
        .map(|r| r.metadata_id)
        .collect()
    };

    assert_eq!(
      remaining,
      vec!["m-history-kept".to_string(), "m-item".to_string()],
      "metadata must follow its parent: dropped with the history row it describes, kept for \
       starred history and for saved clips"
    );
  }

  #[test]
  fn every_real_table_is_classified() {
    // The guard, exercised against the MIGRATED schema rather than a fixture. If a migration
    // adds a table and nobody classifies it, this fails here — in a unit test — instead of
    // when a user clicks Backup and gets an error naming their own database.
    let mut conn = snapshot_connection();
    filter_backup_snapshot(&mut conn)
      .expect("every table in the migrated schema must be classified for backup");
  }

  #[test]
  fn saved_content_tables_survive() {
    let mut conn = snapshot_connection();
    // Columns named explicitly. The real schema has 61 columns on `items` alone, so a
    // positional INSERT — which the hand-written fixture allowed — cannot work here.
    conn
      .batch_execute(
        "INSERT INTO items (item_id, name, created_at, updated_at, created_date, updated_date) \
           VALUES ('i1', 'a clip', 0, 0, '2024-01-01 00:00:00', '2024-01-01 00:00:00');
         INSERT INTO settings (name, value_text) VALUES ('k', 'v');
         INSERT INTO collections (collection_id, title, created_at, updated_at, created_date, updated_date) \
           VALUES ('c1', 'c', 0, 0, '2024-01-01 00:00:00', '2024-01-01 00:00:00');
         INSERT INTO tabs (tab_id, collection_id, tab_name) \
           VALUES ('t1', 'c1', 't');",
      )
      .expect("inserts should work");

    // Snapshot the counts BEFORE filtering. The migrations seed default data (`items` starts
    // with 27 rows), so an absolute expected count would encode the seed contents and break
    // whenever a seed migration is added. What matters is that filtering removes nothing.
    let before: Vec<(String, i64)> = BACKUP_KEPT_TABLES
      .iter()
      .map(|t| (t.to_string(), count(&mut conn, t)))
      .collect();

    filter_backup_snapshot(&mut conn).expect("filter should succeed");

    for (table, expected) in before {
      assert_eq!(
        count(&mut conn, &table),
        expected,
        "{} holds user content and must survive filtering intact",
        table
      );
    }
  }

  #[test]
  fn an_unclassified_table_fails_the_backup_instead_of_being_guessed() {
    // The guard rail. A future migration adds a table; this must fail loudly rather than
    // silently archiving it (leaking its contents into every backup) or dropping it
    // (losing user data on restore).
    let mut conn = snapshot_connection();
    conn
      .batch_execute("CREATE TABLE something_new (id TEXT PRIMARY KEY);")
      .expect("create should work");

    let err = filter_backup_snapshot(&mut conn).expect_err("must refuse to guess");

    assert!(
      err.contains("something_new"),
      "the error must name the table so the fix is obvious; got: {}",
      err
    );
    assert!(
      err.contains("BACKUP_KEPT_TABLES"),
      "the error must say which list to add it to; got: {}",
      err
    );
  }

  #[test]
  fn the_keep_and_filter_lists_do_not_overlap() {
    // Overlapping lists would mean a table is both emptied and expected to survive, which
    // the schema check cannot detect at runtime — it only looks for *unclassified* tables.
    for table in BACKUP_FILTERED_TABLES {
      assert!(
        !BACKUP_KEPT_TABLES.contains(table),
        "{} is in both lists",
        table
      );
    }
  }
}
