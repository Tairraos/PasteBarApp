//! Window lifecycle commands: history / QuickPaste window creation and the
//! QuickPaste paste-and-close flow. Moved verbatim from `main.rs` in W3
//! (ISSUE-017/018); the textual changes are the import header and paths that
//! depend on the file's location.

use crate::commands::clipboard_commands;
use fns::debounce;
use mouse_position::mouse_position::Mouse;
use std::time::Duration as StdDuration;
use tauri::Manager;
use tauri::Menu;
use tauri::MenuItem;
use tauri::Submenu;
use tokio::time::sleep;
use window_state::AppHandleExt;
use window_state::StateFlags;

#[cfg(target_os = "macos")]
use crate::window_ext::WindowToolBar;

#[cfg(target_os = "macos")]
use cocoa::{appkit::NSApplication, base::nil};

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
fn return_focus_to_previous_window() {
  unsafe {
    let app = NSApplication::sharedApplication(nil);
    let _: () = msg_send![app, hide: nil];
  }
}

#[tauri::command]
pub async fn quickpaste_hide_paste_close(
  app_handle: tauri::AppHandle,
  history_id: String,
) -> Result<(), String> {
  // Get the quickpaste window
  let window = app_handle
    .get_window("quickpaste")
    .ok_or_else(|| "Failed to get quickpaste window".to_string())?;

  // Hide the window
  window
    .hide()
    .map_err(|e| format!("Failed to hide window: {}", e))?;

  // Return focus to the previous window
  #[cfg(target_os = "macos")]
  return_focus_to_previous_window();

  sleep(StdDuration::from_millis(200)).await;

  // Copy and paste the history item
  clipboard_commands::copy_paste_history_item(app_handle.clone(), history_id, 0);

  // Close the window
  window
    .close()
    .map_err(|e| format!("Failed to close window: {}", e))?;

  Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn open_history_window(app_handle: tauri::AppHandle) -> Result<(), String> {
  // check if the window is already open
  if app_handle.get_window("history").is_some() {
    // show if exist and return
    let window = app_handle
      .get_window("history")
      .ok_or_else(|| "Failed to get history window".to_string())?;
    // bring to front
    window.show().map_err(|e| e.to_string())?;
    // window.set_focus().map_err(|e| e.to_string())?;

    return Ok(());
  }
  let menu = Menu::new().add_submenu(Submenu::new(
    "PasteBar",
    Menu::new()
      .add_native_item(MenuItem::CloseWindow)
      .add_native_item(MenuItem::Copy)
      .add_native_item(MenuItem::SelectAll)
      .add_native_item(MenuItem::Undo)
      .add_native_item(MenuItem::Redo)
      .add_native_item(MenuItem::Paste),
  ));

  let mut window_builder = tauri::WindowBuilder::new(
    &app_handle,
    "history",
    tauri::WindowUrl::App("history-index".into()),
  )
  .title("PasteBar History")
  .max_inner_size(700.0, 2200.0)
  .min_inner_size(300.0, 400.0)
  .menu(menu)
  .visible(false);

  window_builder = window_builder
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true);

  let history_window = window_builder.build().map_err(|e| e.to_string())?;

  history_window.set_transparent_titlebar(true);
  history_window.position_traffic_lights(-10., -10.);

  {
    let app_handle_clone = app_handle.clone();

    let debounced_save = debounce(
      move |_: ()| {
        app_handle_clone
          .save_window_state(StateFlags::POSITION | StateFlags::SIZE)
          .unwrap_or_else(|e| eprintln!("Failed to save window state: {}", e));
      },
      StdDuration::from_secs(1),
    );

    history_window.on_window_event(move |e| match e {
      tauri::WindowEvent::Destroyed => {
        app_handle.save_window_state(StateFlags::all()).unwrap();
        app_handle
          .emit_all("window-events", "history-window-closed")
          .unwrap_or_else(|e| eprintln!("Failed to emit window closed event: {}", e));
      }
      tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
        debounced_save.call(());
      }
      _ => {}
    });
  }

  // history_window.hide().map_err(|e| e.to_string())?;
  history_window.show().map_err(|e| e.to_string())?;
  history_window.set_focus().map_err(|e| e.to_string())?;

  Ok(())
}

// On Windows, the open new window command must be async
#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn open_history_window(app_handle: tauri::AppHandle) -> Result<(), String> {
  // check if the window is already open
  if app_handle.get_window("history").is_some() {
    // show if exist and return
    let window = app_handle
      .get_window("history")
      .ok_or_else(|| "Failed to get history window".to_string())?;
    // bring to front
    window.show().map_err(|e| e.to_string())?;
    // window.set_focus().map_err(|e| e.to_string())?;

    return Ok(());
  }
  let menu = Menu::new().add_submenu(Submenu::new(
    "PasteBar",
    Menu::new()
      .add_native_item(MenuItem::CloseWindow)
      .add_native_item(MenuItem::Copy)
      .add_native_item(MenuItem::SelectAll)
      .add_native_item(MenuItem::Undo)
      .add_native_item(MenuItem::Redo)
      .add_native_item(MenuItem::Paste),
  ));

  let mut window_builder = tauri::WindowBuilder::new(
    &app_handle,
    "history",
    tauri::WindowUrl::App("history-index".into()),
  )
  .title("PasteBar History")
  .decorations(false)
  .transparent(true)
  .max_inner_size(700.0, 2200.0)
  .min_inner_size(300.0, 400.0)
  .menu(menu)
  .visible(false);

  window_builder = window_builder.decorations(false).transparent(true);

  let history_window = window_builder.build().map_err(|e| e.to_string())?;

  {
    let app_handle_clone = app_handle.clone();

    let debounced_save = debounce(
      move |_: ()| {
        app_handle_clone
          .save_window_state(StateFlags::POSITION | StateFlags::SIZE)
          .unwrap_or_else(|e| eprintln!("Failed to save window state: {}", e));
      },
      StdDuration::from_secs(1),
    );

    history_window.on_window_event(move |e| match e {
      tauri::WindowEvent::Destroyed => {
        app_handle.save_window_state(StateFlags::all()).unwrap();
        app_handle
          .emit_all("window-events", "history-window-closed")
          .unwrap_or_else(|e| eprintln!("Failed to emit window closed event: {}", e));
      }
      tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
        debounced_save.call(());
      }
      _ => {}
    });
  }

  let _ = history_window.set_decorations(false);
  history_window.show().map_err(|e| e.to_string())?;
  history_window.set_focus().map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
pub async fn open_quickpaste_window(
  app_handle: tauri::AppHandle,
  title: String,
) -> Result<(), String> {
  if let Some(window) = app_handle.get_window("quickpaste") {
    window.close().map_err(|e| e.to_string())?;
    return Ok(());
  }

  let window_width = 310.0;
  let window_height = 420.0;

  let main_window = app_handle.get_window("main").unwrap();
  let is_main_window_visible = main_window.is_visible().unwrap();

  if is_main_window_visible {
    #[cfg(target_os = "macos")]
    main_window.hide().map_err(|e| e.to_string())?;
  }

  let window_builder = tauri::WindowBuilder::new(
    &app_handle,
    "quickpaste",
    tauri::WindowUrl::App("quickpaste-index".into()),
  )
  .title(title)
  .always_on_top(true)
  .maximizable(false)
  .resizable(true)
  .max_inner_size(500.0, 800.0)
  .min_inner_size(window_width, window_height)
  .minimizable(false)
  .inner_size(window_width, window_height)
  .visible(false);

  let quickpaste_window = window_builder.build().map_err(|e| e.to_string())?;

  let position = Mouse::get_mouse_position();

  let (cursor_x, cursor_y) = match position {
    Mouse::Position { x, y } => (x, y),
    Mouse::Error => {
      println!("Failed to get mouse position, using default (100, 100)");
      (100, 100)
    }
  };

  // Get all monitors
  let monitors = quickpaste_window
    .available_monitors()
    .map_err(|e| e.to_string())?;

  // Calculate global screen size
  let mut global_width = 0;
  let mut global_height = 0;
  let mut scale_factor = 1.0;

  for monitor in &monitors {
    scale_factor = monitor.scale_factor(); // Use the scale factor of the primary monitor
    println!("Monitor scale factor: {}", scale_factor);
    let monitor_size = monitor.size();

    println!(
      "Monitor size: {}x{}",
      monitor_size.width, monitor_size.height
    );

    let actual_width = (monitor_size.width as f64 / scale_factor).round() as i32;
    let actual_height = (monitor_size.height as f64 / scale_factor).round() as i32;

    global_width += actual_width;
    global_height = global_height.max(actual_height);
  }

  #[cfg(target_os = "macos")]
  let cursor_x_scale = (cursor_x as f64).round() as i32;
  #[cfg(target_os = "macos")]
  let cursor_y_scale = (cursor_y as f64).round() as i32;

  #[cfg(target_os = "windows")]
  let cursor_x_scale = (cursor_x as f64 / scale_factor).round() as i32;
  #[cfg(target_os = "windows")]
  let cursor_y_scale = (cursor_y as f64 / scale_factor).round() as i32;

  // Calculate the window position in logical coordinates
  let window_x = if cursor_x_scale + window_width as i32 + 50 > global_width {
    cursor_x_scale - window_width as i32 - 50 // Place to the left if not enough space on the right
  } else {
    cursor_x_scale + 50
  };

  let window_y = if cursor_y_scale + window_height as i32 > global_height {
    cursor_y_scale - window_height as i32 - 50
  } else {
    cursor_y_scale - 50
  };

  quickpaste_window
    .set_position(tauri::LogicalPosition {
      x: window_x,
      y: window_y,
    })
    .map_err(|e| e.to_string())?;

  {
    let app_handle_clone = app_handle.clone();

    quickpaste_window.on_window_event(move |e| match e {
      tauri::WindowEvent::Destroyed => {
        #[cfg(target_os = "macos")]
        {
          return_focus_to_previous_window();
          if is_main_window_visible {
            let _ = app_handle_clone
              .get_window("main")
              .unwrap()
              .show()
              .map_err(|e| e.to_string());
          }
        }

        app_handle_clone
          .emit_all("window-events", "quickpaste-window-closed")
          .unwrap_or_else(|e| eprintln!("Failed to emit window closed event: {}", e));
      }
      tauri::WindowEvent::CloseRequested { api, .. } => {
        api.prevent_close();
        if let Some(window) = app_handle_clone.get_window("quickpaste") {
          let _ = window
            .close()
            .map_err(|e| eprintln!("Failed to close window: {}", e));
        }
        #[cfg(target_os = "macos")]
        return_focus_to_previous_window();
      }
      _ => {}
    });
  }

  quickpaste_window.show().map_err(|e| e.to_string())?;
  quickpaste_window.set_focus().map_err(|e| e.to_string())?;

  // println!(
  //   "User cursor position: {}x{}",
  //   cursor_x_scale, cursor_y_scale
  // );
  // println!("Global window size: {}x{}", global_width, global_height);
  // println!("Window position: {}x{}", window_x, window_y);

  Ok(())
}
