//! Periodic database maintenance.
//!
//! Two jobs live here, and they share one concern: SQLite file size. Deleting rows — which
//! this app does constantly, on every history clear and every retention sweep — frees pages
//! *inside* the file but does not return them to the filesystem. Only `VACUUM` does that,
//! by rebuilding the database into a new file and swapping it in.
//!
//! `VACUUM` is expensive and takes an exclusive lock for its whole duration, so the policy
//! is deliberately conservative:
//!
//!   - it runs at most once per [`VACUUM_COOLDOWN`] (120 hours, i.e. roughly five days),
//!     tracked in the `maintenance_log` table rather than in memory, so the cooldown
//!     survives restarts;
//!   - a **failed** attempt does not start the cooldown, so the hourly scheduler retries it
//!     on the next tick;
//!   - a **successful** attempt records the timestamp, which is what starts the cooldown.
//!
//! The asymmetry is the point. If a failure armed the cooldown, a transient lock (the app
//! is busy, another connection holds a read) would silently postpone maintenance by five
//! days — and the failure is exactly the case where retrying soon is correct.

use crate::schema::maintenance_log;
use crate::services::utils::debug_output;
use diesel::prelude::*;
use diesel::sql_query;

/// How long to wait after a *successful* VACUUM before running another.
///
/// 120 hours (5 days) rather than daily: VACUUM locks the whole database for its duration,
/// and on a large history that is long enough for the user to notice. Five days keeps the
/// file from growing without bound while making the pause rare.
pub const VACUUM_COOLDOWN_SECS: i64 = 120 * 60 * 60;

/// The `maintenance_log.task` key for the vacuum job.
const VACUUM_TASK: &str = "vacuum";

/// Current time as epoch seconds.
fn now_secs() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs() as i64)
    .unwrap_or(0)
}

/// When the vacuum job last **succeeded**, or `None` if it never has.
///
/// Returns `None` on a query error as well as on a missing row: a database old enough to
/// lack the `maintenance_log` table should be treated as "never vacuumed" and simply fail
/// the vacuum, not as an error worth propagating into the scheduler.
pub fn last_vacuum_at() -> Option<i64> {
  let connection = &mut crate::db::establish_pool_db_connection();
  maintenance_log::table
    .filter(maintenance_log::task.eq(VACUUM_TASK))
    .select(maintenance_log::last_run_at)
    .first::<i64>(connection)
    .ok()
}

/// Whether a vacuum is due, given the last successful run.
///
/// Split out from [`run_vacuum_if_due`] so the policy is testable without a database: the
/// clock is the only input besides the stored timestamp.
pub fn is_vacuum_due(last_run_at: Option<i64>, now: i64) -> bool {
  match last_run_at {
    None => true,
    Some(last) => now.saturating_sub(last) >= VACUUM_COOLDOWN_SECS,
  }
}

/// Run `VACUUM`, recording the timestamp only if it succeeds.
///
/// Returns whether the vacuum actually ran and committed. `Err` carries the database's own
/// message, which the backup path surfaces to the user.
///
/// Blocking is intentional (the user chose it): `VACUUM` needs an exclusive lock, so any
/// concurrent query waits rather than failing. Every caller is already off the UI thread —
/// the cron scheduler runs on its own thread, and the backup command is `async`.
pub fn run_vacuum() -> Result<(), String> {
  let connection = &mut crate::db::establish_pool_db_connection();

  // `VACUUM` cannot run inside a transaction, and `sql_query` does not open one, so this is
  // a plain statement. It is safe against a WAL database: SQLite handles the interaction.
  sql_query("VACUUM").execute(connection).map_err(|e| {
    // Logged at error level because the caller may swallow it (the hourly job retries
    // silently by design); without this the retry loop would be invisible.
    eprintln!("VACUUM failed: {}", e);
    format!("{}", e)
  })?;

  record_vacuum_success(connection);

  debug_output(|| {
    println!("VACUUM completed successfully");
  });

  Ok(())
}

/// Upsert the success timestamp, so the cooldown starts from *now*.
///
/// `run_count` is incremented rather than overwritten: it makes "how often does this
/// actually run" answerable from the database, which is the question that tells you whether
/// the cooldown is too long.
fn record_vacuum_success(connection: &mut SqliteConnection) {
  let now = now_secs();
  let result = diesel::sql_query(
    "INSERT INTO maintenance_log (task, last_run_at, run_count) VALUES (?, ?, 1) \
     ON CONFLICT(task) DO UPDATE SET last_run_at = excluded.last_run_at, \
     run_count = maintenance_log.run_count + 1",
  )
  .bind::<diesel::sql_types::Text, _>(VACUUM_TASK)
  .bind::<diesel::sql_types::BigInt, _>(now)
  .execute(connection);

  if let Err(e) = result {
    // A failed bookkeeping write does not undo a successful vacuum — the space IS
    // reclaimed. The next tick will simply vacuum again, which is wasteful but harmless.
    eprintln!("Failed to record VACUUM timestamp: {}", e);
  }
}

/// The hourly entry point: vacuum only if the cooldown has elapsed.
///
/// Returns whether a vacuum ran, which the scheduler logs.
pub fn run_vacuum_if_due() -> bool {
  let last = last_vacuum_at();
  if !is_vacuum_due(last, now_secs()) {
    return false;
  }

  debug_output(|| {
    println!(
      "VACUUM is due (last run: {:?}); starting",
      last.map(|t| format!("{}s ago", now_secs().saturating_sub(t)))
    );
  });

  // A failure deliberately leaves `last_run_at` untouched, so the next hourly tick retries.
  run_vacuum().is_ok()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_database_that_was_never_vacuumed_is_due() {
    assert!(is_vacuum_due(None, 1_000_000));
  }

  #[test]
  fn a_recent_successful_vacuum_is_not_due() {
    let now = 1_000_000;
    // One hour ago: well inside the 120-hour cooldown.
    assert!(!is_vacuum_due(Some(now - 3600), now));
  }

  #[test]
  fn the_boundary_is_inclusive_of_the_cooldown() {
    let now = 1_000_000;
    assert!(!is_vacuum_due(Some(now - VACUUM_COOLDOWN_SECS + 1), now));
    assert!(is_vacuum_due(Some(now - VACUUM_COOLDOWN_SECS), now));
    assert!(is_vacuum_due(Some(now - VACUUM_COOLDOWN_SECS - 1), now));
  }

  #[test]
  fn a_timestamp_in_the_future_does_not_trigger_a_vacuum() {
    // A clock that moved backwards (timezone change, NTP correction, a restored backup from
    // a machine with a fast clock) must not cause a vacuum storm. `saturating_sub` makes
    // this a large negative number, which is outside any cooldown.
    let now = 1_000_000;
    assert!(!is_vacuum_due(Some(now + 10_000_000), now));
  }

  #[test]
  fn the_cooldown_is_five_days() {
    // Pinned as a test rather than left as a bare constant: the value is a product decision
    // (see the module docs), and changing it should be a deliberate edit that shows up here.
    assert_eq!(VACUUM_COOLDOWN_SECS, 432_000);
  }
}
