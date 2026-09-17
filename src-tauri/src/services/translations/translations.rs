use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock; // Import RwLock from std::sync

/// The tray-menu catalogs.
///
/// Chinese only, matching the product decision for the UI. English is kept as the fallback:
/// [`Translations::get_lang`] returns it for any unrecognised code, so the menu degrades to
/// readable English rather than to a "language not supported" message.
// `zhCN` is the language code used by every other layer (the frontend catalogs, the stored
// setting, `LANGUAGES`). Renaming the field to `zh_cn` would mean adding a serde rename to
// keep the YAML key, which trades a Rust naming warning for a second name for the same
// thing. The allow is on the struct because an attribute on the field does not silence this
// lint.
#[allow(non_snake_case)]
#[derive(Debug, Serialize, Deserialize)]
pub struct Translations {
  en: HashMap<String, String>,
  zhCN: HashMap<String, String>,
}

static CURRENT_LANGUAGE: Lazy<RwLock<String>> = Lazy::new(|| RwLock::new("en".to_string()));

static TRANSLATIONS: Lazy<Translations> = Lazy::new(|| {
  let yaml_str = include_str!("./translations.yaml");
  serde_yaml::from_str(yaml_str).expect("Failed to parse translations at compile time")
});

impl Translations {
  pub fn set_user_language(lang: &str) {
    let mut current_lang = CURRENT_LANGUAGE.write().unwrap();
    *current_lang = lang.to_string();
  }

  pub fn get(key: &str) -> String {
    let current_lang = CURRENT_LANGUAGE.read().unwrap();
    match TRANSLATIONS.get_lang(&current_lang) {
      Some(lang_map) => lang_map
        .get(key)
        .cloned()
        .unwrap_or_else(|| format!("Translation for '{}' not found.", key)),
      None => format!("Language '{}' not supported.", *current_lang),
    }
  }

  fn get_lang(&self, lang: &str) -> Option<&HashMap<String, String>> {
    match lang {
      "zhCN" => Some(&self.zhCN),
      // English, and anything unrecognised. An install upgraded from a multi-language build
      // still has a deleted code stored (e.g. "de"); falling back to English keeps the menu
      // readable. The frontend rewrites that stored value to zhCN on next launch.
      _ => Some(&self.en),
    }
  }
}
