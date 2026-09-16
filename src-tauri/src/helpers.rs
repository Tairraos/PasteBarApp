#[macro_export]
macro_rules! log_err {
  ($result: expr) => {
    if let Err(err) = $result {
      println!("{:?}", err);
    }
  };

  ($result: expr, $err_str: expr) => {
    if let Err(_) = $result {
      println!("{:?}", $err_str);
    }
  };
}

/// Run `f` only in debug builds.
///
/// Lives here rather than in `services/utils.rs` because `db` needs it (ISSUE-017): a
/// helper used by the infrastructure layer cannot sit in the service layer without
/// inverting the dependency. `helpers` has no crate-internal imports, so anything may
/// depend on it.
///
/// Prefer this over a bare `println!` for diagnostics: it compiles out of release builds,
/// where the output goes nowhere a user can see it anyway (AGENTS.md rule 7).
pub fn debug_output<F: FnOnce()>(f: F) {
  if cfg!(debug_assertions) {
    f();
  }
}
