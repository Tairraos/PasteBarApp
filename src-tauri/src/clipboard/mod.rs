use arboard::{Clipboard, ImageData};
use clipboard_master::{CallbackResult, ClipboardHandler, Master};
use std::{
  collections::HashMap,
  sync::{Arc, Mutex},
};

// The Windows clipboard path decodes PNG/DIB by hand through the `image` crate; macOS goes
// through arboard. These imports therefore have no user on macOS, and an ungated import is
// an unused import there — `Cow` included, since both of its uses are in that path.
#[cfg(target_os = "windows")]
use base64::{engine::general_purpose, Engine as _};
#[cfg(target_os = "windows")]
use image::GenericImageView;
#[cfg(target_os = "windows")]
use image::{ImageBuffer, RgbaImage};
#[cfg(target_os = "windows")]
use std::borrow::Cow;
#[cfg(target_os = "windows")]
use std::fs::File;
#[cfg(target_os = "windows")]
use std::io::Read;
use tauri::{self};
use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime,
};

// Windows-specific clipboard handling
#[cfg(target_os = "windows")]
use clipboard_win::{formats, get_clipboard};

use active_win_pos_rs::get_active_window;

use crate::cron_jobs;
use crate::models::Setting;
use crate::services::history_service;
use crate::services::utils::debug_output;

#[derive(Debug)]
pub struct LanguageDetectOptions {
  pub should_detect_language: bool,
  pub min_lines_required: usize,
  pub enabled_languages: Vec<String>,
  pub prioritized_languages: Vec<String>,
  pub auto_mask_words_list: Vec<String>,
}

struct ClipboardMonitor<R>
where
  R: Runtime,
{
  // window: tauri::Window,
  app_handle: tauri::AppHandle<R>,
  clipboard_manager: Arc<Mutex<ClipboardManager>>,
}

impl<R> ClipboardMonitor<R>
where
  R: Runtime,
{
  fn new(app_handle: tauri::AppHandle<R>, clipboard_manager: Arc<Mutex<ClipboardManager>>) -> Self {
    Self {
      app_handle,
      clipboard_manager,
    }
  }
}

impl<R> ClipboardHandler for ClipboardMonitor<R>
where
  R: Runtime,
{
  fn on_clipboard_change(&mut self) -> CallbackResult {
    // ISSUE-002: Tauri runs plugin `.setup` before the application's own `.setup`, so this
    // monitor thread starts (clipboard::init is registered at main.rs:1394) before
    // `db::init(app)` runs (main.rs:1054). A copy during that window would reach
    // `establish_pool_db_connection()`, which panics — on a spawned thread, with no
    // user-visible error, killing the monitor for the rest of the session.
    //
    // Skipping the event instead is correct behaviour: the pool is only milliseconds away,
    // and the clipboard still holds the value afterwards. The alternative — buffering
    // events until the pool appears — adds state to the hot path to recover a copy the
    // user can trivially repeat.
    if !crate::db::is_pool_ready() {
      debug_output(|| {
        println!("Clipboard event received before the database pool was ready; skipping.");
      });
      return CallbackResult::Next;
    }

    let clipboard_manager = self.clipboard_manager.lock().unwrap();
    let app_settings = self.app_handle.state::<Mutex<HashMap<String, Setting>>>();
    let settings_map = app_settings.lock().unwrap();

    if let Some(setting) = settings_map.get("isHistoryEnabled") {
      if let Some(value_bool) = setting.value_bool {
        if !value_bool {
          println!("History capturing is disabled, no event will be send!");
          return CallbackResult::Next; // Return early if history capturing is disabled
        }
      }
    }

    let clipboard_text = clipboard_manager.read_text();

    history_service::increment_history_insert_count();

    let current_count = *history_service::HISTORY_INSERT_COUNT.lock().unwrap();

    if current_count >= 200 {
      history_service::reset_history_insert_count();
      cron_jobs::run_pending_jobs();
    }

    let mut do_refresh_clipboard: Option<String> = None;

    let should_auto_star_on_double_copy = settings_map
      .get("isAutoFavoriteOnDoubleCopyEnabled")
      .and_then(|s| s.value_bool)
      .unwrap_or(true);

    let copied_from_app = match get_active_window() {
      Ok(active_window) => Some(active_window.app_name),
      Err(()) => None,
    };

    if let Ok(mut text) = clipboard_text {
      let trim_text_history = settings_map
        .get("isHistoryAutoTrimOnCaputureEnabled")
        .and_then(|s| s.value_bool)
        .unwrap_or(true);

      if trim_text_history {
        text = text.trim().to_string();
      }

      if !text.is_empty() {
        let mut is_excluded = false;

        let text_min_length = settings_map
          .get("clipTextMinLength")
          .and_then(|s| s.value_int)
          .unwrap_or(0) as usize;

        let text_max_length = settings_map
          .get("clipTextMaxLength")
          .and_then(|s| s.value_int)
          .unwrap_or(5000) as usize;

        if text.len() < text_min_length || (text.len() > text_max_length && text_max_length > 0) {
          is_excluded = true;
        }

        if !is_excluded {
          if let Some(setting) = settings_map.get("isExclusionListEnabled") {
            if let Some(value_bool) = setting.value_bool {
              if value_bool {
                let exclusion_list: Vec<String> = settings_map
                  .get("historyExclusionList")
                  .and_then(|s| s.value_text.as_ref())
                  .map_or(Vec::new(), |exclusion_list_text| {
                    exclusion_list_text.lines().map(String::from).collect()
                  });

                is_excluded = text.lines().any(|line| {
                  exclusion_list
                    .iter()
                    .any(|item| line.to_lowercase().contains(&item.to_lowercase()))
                });
              }
            }
          }
        }

        if !is_excluded {
          if let Some(setting) = settings_map.get("isExclusionAppListEnabled") {
            if let Some(value_bool) = setting.value_bool {
              if value_bool {
                if let Some(app_name) = &copied_from_app {
                  let exclusion_app_list: Vec<String> = settings_map
                    .get("historyExclusionAppList")
                    .and_then(|s| s.value_text.as_ref())
                    .map_or(Vec::new(), |exclusion_list_text| {
                      exclusion_list_text.lines().map(String::from).collect()
                    });

                  is_excluded |= exclusion_app_list
                    .iter()
                    .any(|item| item.to_lowercase() == app_name.to_lowercase());
                }
              }
            }
          }
        }

        if !is_excluded {
          let should_detect_language = settings_map
            .get("isHistoryDetectLanguageEnabled")
            .and_then(|s| s.value_bool)
            .unwrap_or(true);

          let min_lines_required = settings_map
            .get("historyDetectLanguageMinLines")
            .and_then(|s| s.value_int)
            .unwrap_or(3) as usize;

          let enabled_languages: Vec<String> = settings_map
            .get("historyDetectLanguagesEnabledList")
            .and_then(|s| s.value_text.as_ref())
            .map_or(Vec::new(), |langs| {
              langs.split(',').map(String::from).collect()
            });

          let prioritized_languages: Vec<String> = settings_map
            .get("historyDetectLanguagesPrioritizedList")
            .and_then(|s| s.value_text.as_ref())
            .map_or(Vec::new(), |langs| {
              langs.split(',').map(String::from).collect()
            });

          let auto_mask_words_list = {
            if let Some(is_enabled) = settings_map
              .get("isAutoMaskWordsListEnabled")
              .and_then(|setting| setting.value_bool)
            {
              if is_enabled {
                settings_map
                  .get("autoMaskWordsList")
                  .and_then(|setting| setting.value_text.as_ref())
                  .map_or(Vec::new(), |exclusion_list_text| {
                    exclusion_list_text.lines().map(String::from).collect()
                  })
              } else {
                Vec::new()
              }
            } else {
              Vec::new()
            }
          };

          let detect_options = LanguageDetectOptions {
            should_detect_language,
            min_lines_required,
            enabled_languages,
            prioritized_languages,
            auto_mask_words_list,
          };

          do_refresh_clipboard = Some(history_service::add_clipboard_history_from_text(
            text,
            detect_options,
            should_auto_star_on_double_copy,
            copied_from_app,
          ));
        }
      }
    } else {
      // Check if image capturing is disabled first (before accessing clipboard)
      let is_image_capture_disabled = settings_map
        .get("isImageCaptureDisabled")
        .and_then(|s| s.value_bool)
        .unwrap_or(false);

      if is_image_capture_disabled {
        debug_output(|| {
          println!("Image capturing is disabled, skipping image capture!");
        });
        return CallbackResult::Next;
      }

      // Only try to get image from clipboard if capture is enabled
      if let Ok(image_binary) = clipboard_manager.get_image_binary() {
        let mut is_app_excluded = false;

        if let Some(setting) = settings_map.get("isExclusionAppListEnabled") {
          if let Some(value_bool) = setting.value_bool {
            if value_bool {
              if let Some(app_name) = &copied_from_app {
                let exclusion_app_list: Vec<String> = settings_map
                  .get("historyExclusionAppList")
                  .and_then(|s| s.value_text.as_ref())
                  .map_or(Vec::new(), |exclusion_list_text| {
                    exclusion_list_text.lines().map(String::from).collect()
                  });

                is_app_excluded |= exclusion_app_list
                  .iter()
                  .any(|item| item.to_lowercase() == app_name.to_lowercase());
              }
            }
          }
        }

        if !is_app_excluded {
          do_refresh_clipboard = Some(history_service::add_clipboard_history_from_image(
            image_binary,
            should_auto_star_on_double_copy,
            copied_from_app,
          ));
        }
      }
    }

    if let Some(refresh_value) = &do_refresh_clipboard {
      if refresh_value == "ok" {
        let _ = self.app_handle.emit_all(
          "clipboard://clipboard-monitor/update",
          "clipboard update".to_string(),
        );
      }
    }

    CallbackResult::Next
  }

  fn on_clipboard_error(&mut self, error: std::io::Error) -> CallbackResult {
    let _ = self.app_handle.emit_all(
      "clipboard://clipboard-monitor/update/error",
      error.to_string(),
    );
    eprintln!("Error: {}", error);
    CallbackResult::Next
  }
}

/// The local clipboard accessor used by the monitor.
///
/// It previously carried `terminate_flag` and `running` fields that nothing ever read —
/// the `running` flag that actually drives shutdown is created in `init` and handed to
/// `ClipboardMonitor` directly. Removed rather than left as a second, unused source of
/// truth for the same state.
#[derive(Default)]
pub struct ClipboardManager {}

impl ClipboardManager {
  pub fn read_text(&self) -> Result<String, String> {
    let mut clipboard = Clipboard::new().unwrap();
    clipboard.get_text().map_err(|err| err.to_string())
  }

  // write_image function remains unchanged as it's writing, not reading
  pub fn get_image_binary(&self) -> Result<ImageData<'static>, String> {
    // Use our safe image retrieval function instead of clipboard_rs
    get_image_safe()
  }

  // Function 2: Returns Vec<u8> of PNG file data
}

// Safe image retrieval function to avoid clipboard corruption
#[cfg(target_os = "windows")]
fn get_image_safe() -> Result<ImageData<'static>, String> {
  // Try PNG format first (safest) - using the correct format ID
  let png_format = clipboard_win::register_format("PNG")
    .map(|f| f.into())
    .unwrap_or(0);
  if png_format != 0 && clipboard_win::is_format_avail(png_format) {
    match get_clipboard(formats::RawData(png_format)) {
      Ok(png_data) => {
        // Load PNG data directly using image crate
        match image::load_from_memory(&png_data) {
          Ok(img) => {
            let rgba_img = img.to_rgba8();
            let (width, height) = img.dimensions();
            return Ok(ImageData {
              width: width as usize,
              height: height as usize,
              bytes: Cow::Owned(rgba_img.into_raw()),
            });
          }
          Err(e) => println!("PNG decode error: {}", e),
        }
      }
      Err(e) => println!("PNG clipboard error: {}", e),
    }
  }

  // Fallback to DIB format (safer than DIBV5)
  if clipboard_win::is_format_avail(formats::CF_DIB) {
    match get_clipboard(formats::Bitmap) {
      Ok(bmp_data) => match image::load_from_memory(&bmp_data) {
        Ok(img) => {
          let rgba_img = img.to_rgba8();
          let (width, height) = img.dimensions();
          return Ok(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(rgba_img.into_raw()),
          });
        }
        Err(e) => println!("BMP decode error: {}", e),
      },
      Err(e) => println!("BMP clipboard error: {}", e),
    }
  }

  Err("No supported image format found in clipboard".to_string())
}

#[cfg(target_os = "macos")]
fn get_image_safe() -> Result<ImageData<'static>, String> {
  // For macos platforms, use arboard
  let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
  let image_data = clipboard.get_image().map_err(|e| e.to_string())?;
  Ok(image_data)
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("clipboard")
    .setup(|app| {
      let clipboard_manager = Arc::new(Mutex::new(ClipboardManager::default()));

      let app_handle = app.app_handle();

      // No `running` flag is created here: `Master::new` takes only the handler, and
      // `ClipboardMonitor` never read the copy it used to be handed. Stopping the monitor
      // is `Master`'s to manage, so a second flag here would have been a second source of
      // truth for the same state — and one nothing observed.
      tauri::async_runtime::spawn(async move {
        let _ = Master::new(ClipboardMonitor::new(
          app_handle,
          Arc::clone(&clipboard_manager),
        ))
        .run();
      });
      Ok(())
    })
    .build()
}
