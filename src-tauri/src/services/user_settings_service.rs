use serde_yaml;
use std::collections::HashMap;

// `UserConfig`, `load_user_config` and `save_user_config` live in `db` because they are
// file IO over a path that `db` owns — keeping them here made `db` import `services`, which
// is the wrong direction (ISSUE-017). This module keeps the business-facing wrappers and
// depends downward, so the edge runs one way only.
use crate::db::{load_user_config, save_user_config};

// ===========================
//  Custom DB Path Methods
// ===========================

/// Get the current `custom_db_path` (if any).
pub fn get_custom_db_path() -> Option<String> {
  load_user_config().custom_db_path
}

/// Insert or update the `custom_db_path`.
pub fn set_custom_db_path(new_path: &str) -> Result<(), String> {
  let mut config = load_user_config();
  config.custom_db_path = Some(new_path.to_string());
  save_user_config(&config)
}

/// Remove (clear) the `custom_db_path`.
pub fn remove_custom_db_path() -> Result<(), String> {
  let mut config = load_user_config();
  config.custom_db_path = None;
  save_user_config(&config)
}

// ===========================
//  Key–Value data Methods
// ===========================

pub fn get_setting(key: &str) -> Option<serde_yaml::Value> {
  let config = load_user_config();
  config.data.get(key).cloned()
}

pub fn set_setting(key: &str, value: serde_yaml::Value) -> Result<(), String> {
  let mut config = load_user_config();
  config.data.insert(key.to_string(), value);
  save_user_config(&config)
}

pub fn remove_setting(key: &str) -> Result<(), String> {
  let mut config = load_user_config();
  config.data.remove(key);
  save_user_config(&config)
}

pub fn get_all_settings() -> HashMap<String, serde_yaml::Value> {
  load_user_config().data
}
