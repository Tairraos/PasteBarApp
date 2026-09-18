use crate::models::models::Setting;
use crate::services::translations::translations::Translations;
use crate::services::utils::debug_output;
use serde::{Deserialize, Serialize};
use serde_yaml::{self, Mapping};

use std::collections::{BTreeMap, HashMap};
use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Read, Write};
use std::path::Path;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Debug)]
pub struct Translation {
  pub key: String,
  pub namespace: String,
  pub language: String,
  pub text: String,
}

#[tauri::command]
pub fn change_menu_language(
  language: String,
  app_handle: tauri::AppHandle,
  db_items_state: tauri::State<crate::menu::DbItems>,
  db_recent_history_items_state: tauri::State<crate::menu::DbRecentHistoryItems>,
  app_settings: tauri::State<Mutex<HashMap<String, Setting>>>,
) -> String {
  debug_output(|| {
    println!("Changing menu language to: {}", language);
  });
  Translations::set_user_language(&language);

  // Rebuild the tray, or it keeps the labels of the previous language.
  //
  // `Translations::get` is read while the menu is CONSTRUCTED, so the new language only
  // reaches the tray when the menu is rebuilt. Nothing else does that on a language change:
  // the setting writes that rebuild are named in `MENU_SETTING_NAMES` and the language is
  // not one of them. The failure is silent and cosmetic — the user switches language and the
  // tray alone stays behind — which is why it went unnoticed.
  //
  // A failure here does not fail the call: the language is already applied, and the tray is
  // rebuilt on the next menu-affecting change anyway.
  if let Err(e) = crate::menu::update_system_menu(
    &app_handle,
    db_items_state,
    db_recent_history_items_state,
    app_settings,
  ) {
    debug_output(|| {
      println!(
        "Changed menu language but could not refresh the tray menu: {}",
        e
      );
    });
  }

  "ok".to_string()
}

#[tauri::command(async)]
pub async fn update_translation_keys(translations: Vec<Translation>) -> Result<String, String> {
  if !cfg!(debug_assertions) {
    return Err("This command is only available in debug mode".to_string());
  }

  // Unset and empty both mean "this workflow is not configured on this machine", which is the
  // normal state for anyone not editing translations: `.env.sample` ships the key with an
  // empty value and documents that as "disabled". `unwrap()` turned that documented state
  // into a panic — and because the frontend calls this during startup, it took down the whole
  // dev build instead of failing one optional command. The `is_empty` check that followed was
  // unreachable whenever the variable was missing.
  let base_path = match std::env::var("MISSING_TRANSLATION_SAVE_PATH") {
    Ok(path) if !path.is_empty() => path,
    _ => return Err("MISSING_TRANSLATION_SAVE_PATH is not set".to_string()),
  };

  for translation in translations.iter() {
    debug_output(|| {
      println!("Adding missing translation key {:?}", translation);
    });

    let path_str = format!(
      "{}/{}/{}.yaml",
      base_path, translation.language, translation.namespace
    );

    let path = Path::new(&path_str);

    // Ensure the directory exists
    if let Some(parent) = path.parent() {
      if !parent.exists() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
      }
    }

    let mut file_map: HashMap<String, serde_yaml::Value> = match File::open(path) {
      Ok(mut file) => {
        let mut contents = String::new();
        file
          .read_to_string(&mut contents)
          .map_err(|e| e.to_string())?;
        serde_yaml::from_str(&contents).map_err(|e| e.to_string())?
      }
      Err(e) if e.kind() == ErrorKind::NotFound => HashMap::new(),
      Err(e) => return Err(e.to_string()),
    };

    let value_to_save = if let Some(separator_pos) = translation.text.rfind(":::") {
      translation
        .text
        .split_at(separator_pos)
        .1
        .trim_start_matches(":::")
    } else {
      &translation.text[..]
    };

    if let Some(separator_pos) = translation.key.find(":::") {
      let (parent_key, sub_key) = translation.key.split_at(separator_pos);
      let parent_key = parent_key;
      let sub_key = sub_key.trim_start_matches(":::");

      let entry = file_map
        .entry(parent_key.to_string())
        .or_insert_with(|| serde_yaml::Value::Mapping(Mapping::new()));
      if let serde_yaml::Value::Mapping(map) = entry {
        let mut sub_map: BTreeMap<String, serde_yaml::Value> = map
          .iter()
          // A YAML key is not necessarily a string: `123: text` parses as a number, and
          // `unwrap()` on one would panic exactly as the missing variable did above, on the
          // same optional dev-only path. A non-string key is rendered back to its source
          // text, which is what the file contained and what a human would edit.
          .map(|(k, v)| {
            let key = match k.as_str() {
              Some(s) => s.to_string(),
              None => serde_yaml::to_string(k)
                .unwrap_or_default()
                .trim()
                .to_string(),
            };
            (key, v.clone())
          })
          .collect();
        sub_map.insert(
          sub_key.to_string(),
          serde_yaml::Value::String(value_to_save.to_string()),
        );

        // Convert BTreeMap back to Mapping for serialization
        *map = sub_map
          .into_iter()
          .map(|(k, v)| (serde_yaml::Value::String(k), v))
          .collect();
      }
    } else {
      // Directly insert the key-value pair for keys without subkeys
      file_map.insert(
        translation.key.clone(),
        serde_yaml::Value::String(value_to_save.to_string()),
      );
    }

    // Convert HashMap to BTreeMap for sorting top-level keys
    let sorted_map: BTreeMap<String, serde_yaml::Value> = file_map.into_iter().collect();

    // Write the updated content back to the file
    let mut file = OpenOptions::new()
      .write(true)
      .create(true)
      .truncate(true)
      .open(path)
      .map_err(|e| {
        eprintln!("Failed to open file: {}", e);
        e.to_string()
      })?;

    let yaml = serde_yaml::to_string(&sorted_map).map_err(|e| e.to_string())?;
    // println!("YAML: {:?}", yaml);
    file.write_all(yaml.as_bytes()).map_err(|e| {
      eprintln!("Failed to write to file: {}", e);
      e.to_string()
    })?;

    debug_output(|| {
      println!("Updated translation key with text: {:?}", translation);
    });
  }

  Ok("Added".to_string())
}
