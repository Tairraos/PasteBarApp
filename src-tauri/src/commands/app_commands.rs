//! Application-level Tauri commands that were defined directly in `main.rs`.
//!
//! W3 (ISSUE-017/018) moved them here without behaviour changes: this is the same code,
//! reached through `commands::app_commands::*` instead of living in the binary root.
//! They stay in `commands/` (not `services/`) because each one is an IPC adapter: it
//! dereferences `AppHandle` state and converts errors to strings, which is the command
//! layer's job.

use crate::db;
use crate::models::Setting;
use crate::services::settings_service::insert_or_update_setting_by_name;
use crate::services::utils;
use crate::services::utils::debug_output;
use auto_launch::AutoLaunchBuilder;
use serde::Serialize;
use std::collections::HashMap;
use std::env::current_exe;
use std::sync::Mutex;
use tauri::Manager;

/// Response of `app_ready` / `get_app_settings`: build constants plus the live settings
/// map, serialised to the frontend in one round trip.
#[derive(Serialize)]
struct AppReadyResponse<'a> {
  permissionstrusted: bool,
  constants: &'a db::AppConstants<'a>,
  settings: &'a Mutex<HashMap<String, Setting>>,
}

#[derive(Clone, serde::Serialize)]
pub struct SettingUpdatePayload {
  pub name: String,
  pub value_bool: Option<bool>,
  pub value_string: Option<String>,
  pub value_number: Option<i32>,
}

#[tauri::command]
pub fn update_setting(setting: Setting, app_handle: tauri::AppHandle) -> Result<String, String> {
  match insert_or_update_setting_by_name(&setting, app_handle) {
    Ok(result) => Ok(result),
    Err(err) => Err(err.to_string()),
  }
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn update_left_click_tray_env(
  is_toggle_enabled: bool,
  is_disabled: bool,
) -> Result<(), String> {
  let should_disable_context_menu = is_disabled || is_toggle_enabled;

  std::env::set_var(
    "PASTEBAR_ENABLE_LEFT_CLICK_MENU",
    should_disable_context_menu.to_string(),
  );
  Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn update_left_click_tray_env(
  _is_toggle_enabled: bool,
  _is_disabled: bool,
) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
pub fn is_autostart_enabled() -> Result<bool, bool> {
  let current_exe = current_exe().unwrap();

  let auto_start = AutoLaunchBuilder::new()
    .set_app_name("PasteBar")
    .set_app_path(current_exe.to_str().unwrap())
    .set_use_launch_agent(true)
    .build()
    .unwrap();

  Ok(auto_start.is_enabled().unwrap())
}

#[tauri::command]
pub fn autostart(enabled: bool) -> Result<bool, bool> {
  let current_exe = current_exe().unwrap();

  let auto_start = AutoLaunchBuilder::new()
    .set_app_name("PasteBar")
    .set_app_path(current_exe.to_str().unwrap())
    .set_use_launch_agent(true)
    .build()
    .unwrap();

  if enabled {
    auto_start.enable().unwrap();
  } else {
    auto_start.disable().unwrap();
  }

  Ok(auto_start.is_enabled().unwrap())
}

#[tauri::command]
pub fn app_ready(app_handle: tauri::AppHandle) -> Result<String, String> {
  let window = app_handle.get_window("main").unwrap();

  let current_size = window.inner_size().unwrap();
  let mut new_size = current_size;

  if current_size.width < 600 {
    new_size.width = 600;
  }
  if current_size.height < 550 {
    new_size.height = 550;
  }

  if new_size != current_size {
    window.set_size(new_size).unwrap();
  }

  let app_settings = app_handle.state::<Mutex<HashMap<String, Setting>>>();

  let hide_main_window_on_startup = app_settings
    .lock()
    .unwrap()
    .get("isKeepMainWindowClosedOnRestartEnabled")
    .map(|setting| setting.value_bool.unwrap_or(false))
    .unwrap_or(false);

  if !hide_main_window_on_startup {
    window.show().unwrap();
  }

  debug_output(|| {
    println!("app_ready on client");
  });

  let constants = db::APP_CONSTANTS
    .get()
    .ok_or("APP_CONSTANTS not initialized")?;

  let mut is_permissions_trusted = true;

  #[cfg(target_os = "macos")]
  {
    is_permissions_trusted =
      macos_accessibility_client::accessibility::application_is_trusted_with_prompt();

    debug_output(|| {
      println!("Application is trusted: {}", is_permissions_trusted);
    });
  }

  let response = AppReadyResponse {
    constants,
    permissionstrusted: is_permissions_trusted,
    settings: &app_settings,
  };

  let serialized = serde_json::to_string(&response).map_err(|e| e.to_string())?;

  Ok(serialized)
}

#[tauri::command]
pub fn get_app_settings(app_handle: tauri::AppHandle) -> Result<String, String> {
  println!("app_settings on client");
  let app_settings = app_handle.state::<Mutex<HashMap<String, Setting>>>();

  let constants = db::APP_CONSTANTS
    .get()
    .ok_or("APP_CONSTANTS not initialized")?;

  let response = AppReadyResponse {
    constants,
    permissionstrusted: true,
    settings: &app_settings,
  };

  let serialized = serde_json::to_string(&response).map_err(|e| e.to_string())?;

  Ok(serialized)
}

#[tauri::command]
pub fn open_osx_accessibility_preferences() {
  #[cfg(target_os = "macos")]
  {
    let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
    if let Err(err) = opener::open(url) {
      eprintln!("Failed to open URL: {}", err);
    }
  }
}

#[tauri::command]
pub fn check_osx_accessibility_preferences() -> bool {
  #[cfg(target_os = "macos")]
  {
    macos_accessibility_client::accessibility::application_is_trusted()
  }

  #[cfg(target_os = "windows")]
  {
    true
  }
}

#[tauri::command]
pub fn open_path_or_app(path: String) -> Result<(), String> {
  opener::open(path).map_err(|e| format!("Failed to open path: {}", e))
}

#[tauri::command]
pub fn get_device_id() -> Result<String, String> {
  match mid::get("PasteBarApp") {
    Ok(id) => {
      debug_output(|| {
        println!("Device ID: {}", &id[..24]);
      });
      Ok(id[..24].to_string())
    }
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub fn set_icon(app_handle: tauri::AppHandle, name: &str, is_dark: bool) {
  let _ = app_handle.tray_handle().set_tooltip("PasteBar");
  let is_windows_system_dark_mode = utils::is_windows_system_uses_dark_theme();

  match name {
    "notification" => {
      app_handle
        .tray_handle()
        .set_icon(if cfg!(windows) {
          if is_dark || is_windows_system_dark_mode {
            tauri::Icon::Raw(
              include_bytes!("../../icons/tray128x128-white-notification.png").to_vec(),
            )
          } else {
            tauri::Icon::Raw(include_bytes!("../../icons/tray128x128-notification.png").to_vec())
          }
        } else {
          tauri::Icon::Raw(include_bytes!("../../icons/tray128x128-notification.png").to_vec())
        })
        .unwrap();
    }
    _ => app_handle
      .tray_handle()
      .set_icon(if cfg!(windows) {
        if is_dark || is_windows_system_dark_mode {
          tauri::Icon::Raw(include_bytes!("../../icons/tray128x128-color.png").to_vec())
        } else {
          tauri::Icon::Raw(include_bytes!("../../icons/tray128x128-color.png").to_vec())
        }
      } else {
        tauri::Icon::Raw(include_bytes!("../../icons/tray128x128.png").to_vec())
      })
      .unwrap(),
  }
}
