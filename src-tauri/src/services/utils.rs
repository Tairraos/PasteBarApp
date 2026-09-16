use colored_json::ToColoredJson;
use html_escape;
use lazy_static::lazy_static;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use winreg::RegKey;

use tld;
use url::Url;

use crate::models::Setting;

// Global regex cache for template patterns
lazy_static! {
  static ref REGEX_CACHE: Mutex<HashMap<String, Regex>> = Mutex::new(HashMap::new());
}

pub const GLOBAL_TEMPLATES_ENABLED_KEY: &str = "globalTemplatesEnabled";

pub fn pretty_print_struct<T: Serialize>(data: &T) -> String {
  serde_json::to_string_pretty(data)
    .map_err(|_| "Failed to serialize to JSON.".to_string())
    .and_then(|json_str| {
      json_str
        .to_colored_json_auto()
        .map_err(|_| "Failed to colorize JSON.".to_string())
    })
    .unwrap_or_else(|err| err)
}

pub fn delete_file_and_maybe_parent(file_path: &Path) -> Result<(), std::io::Error> {
  // Try deleting the file first
  fs::remove_file(file_path)?;

  // Check parent directory
  if let Some(parent) = file_path.parent() {
    // Check if directory is empty
    if parent.read_dir()?.next().is_none() {
      fs::remove_dir(parent)?;
    }
  }

  Ok(())
}

pub fn remove_dir_if_exists<P: AsRef<Path>>(path: P) -> std::io::Result<()> {
  if path.as_ref().exists() {
    fs::remove_dir_all(path)
  } else {
    Ok(())
  }
}

pub fn has_emoji(text: &str) -> bool {
  lazy_static! {
    static ref REGGIE_EMOJI: Regex = Regex::new(r"\p{RI}\p{RI}|\p{Emoji_Presentation}(\p{EMod}|\x{FE0F}\x{20E3}?|[\x{E0020}-\x{E007E}]+\x{E007F})?(\x{200D}[\p{Emoji_Presentation}--\p{Ascii}](\p{EMod}|\x{FE0F}\x{20E3}?|[\x{E0020}-\x{E007E}]+\x{E007F})?)*").unwrap();
  }
  REGGIE_EMOJI.is_match(text)
}

pub fn is_youtube_url(url: &str) -> bool {
  url.contains("youtube.com") || url.contains("youtu.be")
}

pub fn is_image_url(url: &str) -> bool {
  lazy_static! {
    static ref REGGIE_IMAGE_URL: Regex =
      Regex::new(r"^https?://(\S+?\.(?:jpe?g|png|gif|svg))").unwrap();
  }
  REGGIE_IMAGE_URL.is_match(url)
}

pub fn has_valid_tld(url: &str) -> bool {
  let parsed_url = Url::parse(&ensure_url_prefix(url));

  match parsed_url {
    Ok(url) => {
      if let Some(domain) = url.domain() {
        let parts: Vec<&str> = domain.split('.').collect();
        if let Some(tld) = parts.last() {
          return tld::exist(tld);
        }
      }
      false
    }
    Err(_) => false,
  }
}

pub fn ensure_url_or_email_prefix(url: &str) -> String {
  if url.contains('@') && !url.starts_with("mailto:") {
    return format!("mailto:{}", url);
  }

  if !url.starts_with("http://") && !url.starts_with("https://") {
    return format!("https://{}", url);
  }

  url.to_string()
}

pub fn ensure_url_prefix(url: &str) -> String {
  if !url.starts_with("http://") && !url.starts_with("https://") {
    return format!("https://{}", url);
  }

  url.to_string()
}

pub fn is_base64_image(data: &str) -> bool {
  lazy_static! {
    static ref REGGIE_BASE64_IMAGE: Regex =
      Regex::new(r"^data:image/(png|jpeg|jpg|svg\+xml|svg|gif);base64").unwrap();
  }
  REGGIE_BASE64_IMAGE.is_match(data)
}

pub fn decode_html_entities(encoded: &str) -> String {
  html_escape::decode_html_entities(encoded).to_string()
}

pub fn mask_value(value: &str) -> String {
  let mask_char = '•';

  value
    .split_whitespace()
    .map(|word| {
      let first_char = word.chars().next().unwrap().to_string();

      if word.chars().count() > 2 {
        let middle_len = word.chars().count() - 2;
        let last_char = word.chars().last().unwrap().to_string();
        let masked_middle: String = mask_char.to_string().repeat(middle_len);

        format!("{}{}{}", first_char, masked_middle, last_char)
      } else {
        let masked_middle: String = mask_char.to_string().clone();

        format!("{}{}", first_char, masked_middle)
      }
    })
    .collect::<Vec<String>>()
    .join(" ")
}

pub fn remove_special_bbcode_tags(text: &str) -> String {
  let bbcode_patterns = vec![
    r"\[copy\](.+?)\[/copy\]",
    r"\[mask\](.+?)\[/mask\]",
    r"\[blank\](.+?)\[/blank\]",
    r"\[hl\](.+?)\[/hl\]",
    r"\[h\](.+?)\[/h\]",
    r"\[b\](.+?)\[/b\]",
    r"\[i\](.+?)\[/i\]",
    // Add more patterns here if necessary
  ];

  let mut result = text.to_string();

  for pattern in bbcode_patterns {
    let re = Regex::new(pattern).unwrap();
    result = re.replace_all(&result, "$1").to_string();
  }

  result
}

pub fn is_valid_json(text: &str) -> bool {
  serde_json::from_str::<Value>(text).is_ok()
}

pub fn apply_global_templates(text: &str, settings_map: &HashMap<String, Setting>) -> String {
  // Check if global templates are enabled
  let is_enabled = settings_map
    .get(GLOBAL_TEMPLATES_ENABLED_KEY)
    .and_then(|s| s.value_bool)
    .unwrap_or(false);

  if !is_enabled {
    return text.to_string();
  }

  // Get global templates from settings
  let templates_json = match settings_map
    .get("globalTemplates")
    .and_then(|s| s.value_text.as_ref())
  {
    Some(json) => json,
    None => return text.to_string(),
  };

  // Parse templates JSON
  let templates: Vec<serde_json::Value> = match serde_json::from_str(templates_json) {
    Ok(t) => t,
    Err(_) => return text.to_string(),
  };

  let mut result = text.to_string();

  // Apply each enabled template
  for template in templates {
    let is_template_enabled = template
      .get("isEnabled")
      .and_then(|v| v.as_bool())
      .unwrap_or(false);

    if !is_template_enabled {
      continue;
    }

    let name = match template.get("name").and_then(|v| v.as_str()) {
      Some(n) => n,
      None => continue,
    };

    let value = match template.get("value").and_then(|v| v.as_str()) {
      Some(v) => v,
      None => continue,
    };

    // Check if regex is already cached
    let re = {
      let mut cache = REGEX_CACHE.lock().unwrap();
      cache
        .entry(name.to_string())
        .or_insert_with(|| {
          let pattern = format!(r"(?i)\{{\{{\s*{}\s*\}}\}}", regex::escape(name));
          Regex::new(&pattern).unwrap()
        })
        .clone()
    };

    result = re.replace_all(&result, value).to_string();
  }

  result
}

// Re-exported so the many existing `services::utils::debug_output` call sites keep working;
// the definition moved to `helpers` so `db` can use it without importing `services`
// (ISSUE-017). Prefer importing from `crate::helpers` in new code.
pub use crate::helpers::debug_output;

#[cfg(target_os = "windows")]
const SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
#[cfg(target_os = "windows")]
const VALUE: &str = "SystemUsesLightTheme";

pub fn is_windows_system_uses_dark_theme() -> bool {
  #[cfg(target_os = "windows")]
  {
    let hkcu = RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    if let Ok(subkey) = hkcu.open_subkey(SUBKEY) {
      if let Ok(dword) = subkey.get_value::<u32, _>(VALUE) {
        return dword == 0;
      }
    }
  }
  false
}

#[cfg(test)]
mod tests {
  use super::*;

  fn setting(name: &str, text: Option<&str>, boolean: Option<bool>) -> Setting {
    Setting {
      name: name.to_string(),
      value_text: text.map(|s| s.to_string()),
      value_bool: boolean,
      value_int: None,
    }
  }

  // ---------------------------------------------------------------------------------
  // mask_value — security relevant. This is what hides passwords and auto-masked words
  // in the history list, so "it never leaks the original and never panics" is the
  // contract, and the panic half is not theoretical: the implementation calls
  // `chars().next().unwrap()` and `chars().last().unwrap()` per whitespace-split word.
  // ---------------------------------------------------------------------------------

  #[test]
  fn mask_value_keeps_the_first_character_and_hides_the_rest() {
    // 11 chars -> first, 9 masks, last.
    assert_eq!(mask_value("password123"), "p•••••••••3")
  }

  #[test]
  fn mask_value_never_returns_the_original_for_a_word_longer_than_two_chars() {
    let secret = "hunter2";
    let masked = mask_value(secret);
    assert_ne!(masked, secret, "a maskable secret came back unchanged");
  }

  #[test]
  fn mask_value_handles_words_of_one_and_two_characters_without_panicking() {
    // Regression guard for the two unwraps: a two-character word produces
    // `middle_len = 0`, and a one-character word takes the else branch.
    assert_eq!(mask_value("a"), "a•");
    assert_eq!(mask_value("ab"), "a•");
  }

  #[test]
  fn mask_value_does_not_panic_on_empty_or_whitespace_input() {
    // `split_whitespace` yields nothing for these, so the body never runs — but an
    // implementation that used `split(' ')` instead would produce an empty word and
    // panic on `chars().next().unwrap()`. That is exactly the regression this pins.
    assert_eq!(mask_value(""), "");
    assert_eq!(mask_value("   "), "");
    assert_eq!(mask_value("\t\n"), "");
  }

  #[test]
  fn mask_value_masks_each_word_independently() {
    // For words longer than two characters the first AND last character are kept and
    // everything between is masked ("secret" -> "s••••t"). Worth pinning precisely: the
    // masked form is shown in the UI, so an off-by-one here is visible to the user.
    assert_eq!(mask_value("secret token"), "s••••t t•••n");
  }

  #[test]
  fn mask_value_is_unicode_safe() {
    // `chars().count()` rather than `len()` matters here: a multibyte word must not be
    // split mid-codepoint, which would panic on a byte-indexed slice.
    let masked = mask_value("密码测试");
    assert_eq!(
      masked.chars().count(),
      4,
      "multibyte word was miscounted: {masked}"
    );
    assert!(masked.starts_with('密'));
  }

  // ---------------------------------------------------------------------------------
  // apply_global_templates — user-supplied templates applied to clipboard text.
  // ---------------------------------------------------------------------------------

  fn templates(enabled: bool, json: &str) -> HashMap<String, Setting> {
    let mut map = HashMap::new();
    map.insert(
      GLOBAL_TEMPLATES_ENABLED_KEY.to_string(),
      setting(GLOBAL_TEMPLATES_ENABLED_KEY, None, Some(enabled)),
    );
    map.insert(
      "globalTemplates".to_string(),
      setting("globalTemplates", Some(json), None),
    );
    map
  }

  #[test]
  fn templates_are_a_no_op_when_the_feature_is_disabled() {
    let map = templates(false, r#"[{"name":"x","value":"Y","isEnabled":true}]"#);
    assert_eq!(apply_global_templates("{{x}}", &map), "{{x}}");
  }

  #[test]
  fn templates_are_a_no_op_when_the_setting_is_absent() {
    // No panic, no substitution: a user who never opened the setting must not be
    // affected by template machinery.
    let empty = HashMap::new();
    assert_eq!(
      apply_global_templates("{{anything}}", &empty),
      "{{anything}}"
    );
  }

  #[test]
  fn a_disabled_template_is_not_applied() {
    let map = templates(true, r#"[{"name":"x","value":"Y","isEnabled":false}]"#);
    assert_eq!(apply_global_templates("{{x}}", &map), "{{x}}");
  }

  #[test]
  fn an_enabled_template_replaces_the_placeholder() {
    let map = templates(
      true,
      r#"[{"name":"date","value":"2026-01-01","isEnabled":true}]"#,
    );
    assert_eq!(
      apply_global_templates("Today: {{date}}", &map),
      "Today: 2026-01-01"
    );
  }

  #[test]
  fn placeholder_matching_ignores_case_and_inner_whitespace() {
    let map = templates(true, r#"[{"name":"Sig","value":"S","isEnabled":true}]"#);
    assert_eq!(apply_global_templates("{{sig}}", &map), "S");
    assert_eq!(apply_global_templates("{{  SIG  }}", &map), "S");
  }

  #[test]
  fn malformed_template_json_leaves_the_text_untouched() {
    // The setting is user-editable, so it can contain anything. Returning the original
    // text is the only safe response; panicking or emptying the clipboard would be worse.
    let map = templates(true, "{ not json at all");
    assert_eq!(apply_global_templates("{{x}}", &map), "{{x}}");
  }

  #[test]
  fn a_template_name_containing_regex_metacharacters_is_escaped() {
    // `regex::escape(name)` is the difference between a literal template name and a
    // user-authored regular expression running over every clipboard value. A name like
    // "a.c" must not match "abc".
    let map = templates(
      true,
      r#"[{"name":"a.c","value":"MATCHED","isEnabled":true}]"#,
    );
    assert_eq!(apply_global_templates("{{a.c}}", &map), "MATCHED");
    assert_eq!(
      apply_global_templates("{{abc}}", &map),
      "{{abc}}",
      "an unescaped '.' matched an arbitrary character"
    );
  }

  #[test]
  fn a_catastrophic_backtracking_pattern_is_not_reachable_through_a_template_name() {
    // Without escaping, a name of "(a+)+$" would be compiled as-is, and applying it to a
    // long clipboard value is the classic way to hang the UI thread. The test asserts the
    // escaped behaviour: the literal text is what gets matched.
    let map = templates(true, r#"[{"name":"(a+)+$","value":"X","isEnabled":true}]"#);
    let text = "a".repeat(30);
    assert_eq!(apply_global_templates(&text, &map), text);
    assert_eq!(apply_global_templates("{{(a+)+$}}", &map), "X");
  }

  #[test]
  fn templates_that_lack_a_name_or_value_are_skipped() {
    let map = templates(
      true,
      r#"[{"value":"V","isEnabled":true},{"name":"n","isEnabled":true},
          {"name":"ok","value":"OK","isEnabled":true}]"#,
    );
    assert_eq!(apply_global_templates("{{ok}}", &map), "OK");
  }
}
