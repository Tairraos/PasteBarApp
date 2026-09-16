# Tauri IPC contract

> **Generated.** Regenerate with `node scripts/harness/gen-ipc-contract.mjs`.
> Do not hand-edit the command/event index; add prose in the sections at the end.

## Summary

| Surface                                    | Count |
| ------------------------------------------ | ----- |
| Commands registered in `generate_handler!` | 115   |
| Commands invoked by the frontend           | 58    |
| Registered but never invoked (`uncalled`)  | 57    |
| Invoked but not registered (`ghost`)       | 0     |
| Events emitted by Rust                     | 9     |
| Events listened for by TS                  | 12    |
| Events emitted by Rust with no TS listener | 3     |

## Commands

| Command                                          | Defined in                                            | Invoked by frontend |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------- |
| `add_image_to_item_id`                           | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `app_ready`                                      | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `autostart`                                      | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `build_system_menu`                              | `src-tauri/src/menu.rs`                               | yes                 |
| `change_menu_language`                           | `src-tauri/src/commands/translations_commands.rs`     | yes                 |
| `check_osx_accessibility_preferences`            | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `check_path`                                     | `src-tauri/src/commands/shell_commands.rs`            | yes                 |
| `clear_clipboard_history_older_than`             | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `clear_recent_clipboard_history`                 | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `cmd_check_custom_data_path`                     | `src-tauri/src/commands/user_settings_command.rs`     | yes                 |
| `cmd_create_directory`                           | `src-tauri/src/commands/user_settings_command.rs`     | yes                 |
| `cmd_get_all_settings`                           | `src-tauri/src/commands/user_settings_command.rs`     | **no**              |
| `cmd_get_custom_db_path`                         | `src-tauri/src/commands/user_settings_command.rs`     | yes                 |
| `cmd_get_setting`                                | `src-tauri/src/commands/user_settings_command.rs`     | **no**              |
| `cmd_remove_setting`                             | `src-tauri/src/commands/user_settings_command.rs`     | **no**              |
| `cmd_revert_to_default_data_location`            | `src-tauri/src/commands/user_settings_command.rs`     | yes                 |
| `cmd_set_and_relocate_data`                      | `src-tauri/src/commands/user_settings_command.rs`     | yes                 |
| `cmd_set_setting`                                | `src-tauri/src/commands/user_settings_command.rs`     | **no**              |
| `cmd_validate_custom_db_path`                    | `src-tauri/src/commands/user_settings_command.rs`     | yes                 |
| `copy_clip_item`                                 | `src-tauri/src/commands/clipboard_commands.rs`        | yes                 |
| `copy_history_item`                              | `src-tauri/src/commands/clipboard_commands.rs`        | yes                 |
| `copy_link_metadata_to_new_item_id`              | `src-tauri/src/commands/link_metadata_commands.rs`    | yes                 |
| `copy_paste`                                     | `src-tauri/src/commands/clipboard_commands.rs`        | yes                 |
| `copy_paste_clip_item`                           | `src-tauri/src/commands/clipboard_commands.rs`        | yes                 |
| `copy_paste_history_item`                        | `src-tauri/src/commands/clipboard_commands.rs`        | yes                 |
| `copy_text`                                      | `src-tauri/src/commands/clipboard_commands.rs`        | yes                 |
| `count_clipboard_histories`                      | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `create_backup`                                  | `src-tauri/src/commands/backup_restore_commands.rs`   | yes                 |
| `create_collection`                              | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `create_item`                                    | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `create_tab`                                     | `src-tauri/src/commands/tabs_commands.rs`             | **no**              |
| `delete_backup`                                  | `src-tauri/src/commands/backup_restore_commands.rs`   | yes                 |
| `delete_clipboard_history_by_ids`                | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `delete_collection_by_id`                        | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `delete_image_by_item_by_id`                     | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `delete_item_by_id`                              | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `delete_items_by_ids`                            | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `delete_link_metadata`                           | `src-tauri/src/commands/link_metadata_commands.rs`    | yes                 |
| `delete_menu_item_by_id`                         | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `delete_menu_items_by_ids`                       | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `delete_os_password`                             | `src-tauri/src/commands/security_commands.rs`         | yes                 |
| `delete_tab`                                     | `src-tauri/src/commands/tabs_commands.rs`             | **no**              |
| `download_and_execute`                           | `src-tauri/src/commands/download_update.rs`           | yes                 |
| `download_audio`                                 | `src-tauri/src/commands/link_metadata_commands.rs`    | yes                 |
| `duplicate_item`                                 | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `duplicate_menu_item`                            | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `fetch_link_metadata`                            | `src-tauri/src/commands/link_metadata_commands.rs`    | yes                 |
| `fetch_link_track_metadata`                      | `src-tauri/src/commands/link_metadata_commands.rs`    | **no**              |
| `fetch_path_metadata`                            | `src-tauri/src/commands/link_metadata_commands.rs`    | yes                 |
| `find_clipboard_histories_by_value_or_filters`   | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `find_clipboard_history_by_id`                   | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `format_convert`                                 | `src-tauri/src/commands/format_converter_commands.rs` | yes                 |
| `get_active_collection_with_clips`               | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `get_active_collection_with_menu_items`          | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `get_app_settings`                               | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `get_clipboard_histories_within_date_range`      | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `get_clipboard_history`                          | `src-tauri/src/commands/history_commands.rs`          | yes                 |
| `get_clipboard_history_by_id`                    | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `get_clipboard_history_pinned`                   | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `get_collection`                                 | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `get_collections`                                | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `get_data_paths`                                 | `src-tauri/src/commands/backup_restore_commands.rs`   | yes                 |
| `get_device_id`                                  | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `get_history_items_source_apps`                  | `src-tauri/src/commands/history_commands.rs`          | yes                 |
| `get_link_metadata_by_item_id`                   | `src-tauri/src/commands/link_metadata_commands.rs`    | **no**              |
| `get_recent_clipboard_histories`                 | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `get_stored_os_password`                         | `src-tauri/src/commands/security_commands.rs`         | yes                 |
| `hash_password`                                  | `src-tauri/src/commands/security_commands.rs`         | yes                 |
| `insert_clipboard_history`                       | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `is_autostart_enabled`                           | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `link_clip_to_menu_item`                         | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `list_backups`                                   | `src-tauri/src/commands/backup_restore_commands.rs`   | yes                 |
| `move_pinned_clip_item_up_down`                  | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `move_pinned_item_up_down`                       | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `open_history_window`                            | `src-tauri/src/commands/window_commands.rs`           | yes                 |
| `open_osx_accessibility_preferences`             | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `open_path_or_app`                               | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `open_quickpaste_window`                         | `src-tauri/src/commands/window_commands.rs`           | yes                 |
| `path_type_check`                                | `src-tauri/src/commands/shell_commands.rs`            | yes                 |
| `quickpaste_hide_paste_close`                    | `src-tauri/src/commands/window_commands.rs`           | yes                 |
| `restore_backup`                                 | `src-tauri/src/commands/backup_restore_commands.rs`   | yes                 |
| `run_form_fill`                                  | `src-tauri/src/commands/clipboard_commands.rs`        | yes                 |
| `run_shell_command`                              | `src-tauri/src/commands/shell_commands.rs`            | yes                 |
| `run_template_fill`                              | `src-tauri/src/commands/clipboard_commands.rs`        | yes                 |
| `run_web_request`                                | `src-tauri/src/commands/request_commands.rs`          | yes                 |
| `run_web_scraping`                               | `src-tauri/src/commands/request_commands.rs`          | yes                 |
| `save_to_file_clip_item`                         | `src-tauri/src/commands/items_commands.rs`            | yes                 |
| `save_to_file_history_item`                      | `src-tauri/src/commands/history_commands.rs`          | yes                 |
| `search_clipboard_histories_by_value_or_filters` | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `select_collection_by_id`                        | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `set_icon`                                       | `src-tauri/src/commands/app_commands.rs`              | **no**              |
| `store_os_password`                              | `src-tauri/src/commands/security_commands.rs`         | yes                 |
| `unpin_all_clipboard_history_items`              | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `unpin_all_items_clips`                          | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `update_clipboard_history_by_id`                 | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `update_clipboard_history_by_ids`                | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `update_collection_by_id`                        | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `update_item_by_id`                              | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `update_item_value_by_history_id`                | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `update_items_by_ids`                            | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `update_left_click_tray_env`                     | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `update_menu_item_by_id`                         | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `update_menu_items_by_ids`                       | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `update_moved_clips_in_collection`               | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `update_moved_menu_items_in_collection`          | `src-tauri/src/commands/collections_commands.rs`      | **no**              |
| `update_pinned_clipboard_history_by_ids`         | `src-tauri/src/commands/history_commands.rs`          | **no**              |
| `update_pinned_items_by_ids`                     | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `update_setting`                                 | `src-tauri/src/commands/app_commands.rs`              | yes                 |
| `update_tab`                                     | `src-tauri/src/commands/tabs_commands.rs`             | **no**              |
| `update_tabs`                                    | `src-tauri/src/commands/tabs_commands.rs`             | **no**              |
| `update_translation_keys`                        | `src-tauri/src/commands/translations_commands.rs`     | yes                 |
| `upload_image_file_to_item_id`                   | `src-tauri/src/commands/items_commands.rs`            | **no**              |
| `validate_audio`                                 | `src-tauri/src/commands/link_metadata_commands.rs`    | yes                 |
| `verify_os_password`                             | `src-tauri/src/commands/security_commands.rs`         | yes                 |
| `verify_password`                                | `src-tauri/src/commands/security_commands.rs`         | yes                 |

## Events

| Event                                        | Emitted by (Rust)                              | Listened by (TS)                                                                     |
| -------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `audio-player`                               | —                                              | `packages/pastebar-app-ui/src/store/playerStore.ts`                                  |
| `clipboard://clipboard-monitor/update`       | `src-tauri/src/clipboard/mod.rs`               | `packages/pastebar-app-ui/src/pages/main/ClipboardHistoryQuickPastePage.tsx`         |
| `clipboard://clipboard-monitor/update/error` | `src-tauri/src/clipboard/mod.rs`               | —                                                                                    |
| `clips://clips-monitor/update`               | `src-tauri/src/commands/clipboard_commands.rs` | `packages/pastebar-app-ui/src/App.tsx`                                               |
| `execMenuItemById`                           | `src-tauri/src/main.rs`                        | —                                                                                    |
| `macosx-permissions-modal`                   | `src-tauri/src/main.rs`                        | `packages/pastebar-app-ui/src/App.tsx`                                               |
| `menu:add_first_menu_item`                   | `src-tauri/src/main.rs`                        | `packages/pastebar-app-ui/src/App.tsx`                                               |
| `navigate-main`                              | —                                              | `packages/pastebar-app-ui/src/App.tsx`                                               |
| `scheme-request-received`                    | `src-tauri/src/main.rs`                        | —                                                                                    |
| `setting:update`                             | `src-tauri/src/main.rs`                        | `packages/pastebar-app-ui/src/App.tsx`                                               |
| `settings-store-sync`                        | —                                              | `packages/pastebar-app-ui/src/store/settingsStore.ts`                                |
| `signal-store-sync`                          | —                                              | `packages/pastebar-app-ui/src/store/signalStore.ts`                                  |
| `tauri://file-drop`                          | —                                              | `packages/pastebar-app-ui/src/pages/components/Dashboard/components/ClipAddPath.tsx` |
| `update-history-items-quickpaste`            | —                                              | `packages/pastebar-app-ui/src/QuickPasteApp.tsx`                                     |
| `window-events`                              | `src-tauri/src/commands/window_commands.rs`    | `packages/pastebar-app-ui/src/App.tsx`                                               |

## Drift findings

No ghost commands: every frontend-invoked command is registered.

**Uncalled commands** (57) — registered, no frontend caller:

- `add_image_to_item_id`
- `clear_clipboard_history_older_than`
- `clear_recent_clipboard_history`
- `cmd_get_all_settings`
- `cmd_get_setting`
- `cmd_remove_setting`
- `cmd_set_setting`
- `count_clipboard_histories`
- `create_collection`
- `create_item`
- `create_tab`
- `delete_clipboard_history_by_ids`
- `delete_collection_by_id`
- `delete_image_by_item_by_id`
- `delete_item_by_id`
- `delete_items_by_ids`
- `delete_menu_item_by_id`
- `delete_menu_items_by_ids`
- `delete_tab`
- `duplicate_item`
- `duplicate_menu_item`
- `fetch_link_track_metadata`
- `find_clipboard_histories_by_value_or_filters`
- `find_clipboard_history_by_id`
- `get_active_collection_with_clips`
- `get_active_collection_with_menu_items`
- `get_clipboard_histories_within_date_range`
- `get_clipboard_history_by_id`
- `get_clipboard_history_pinned`
- `get_collection`
- `get_collections`
- `get_link_metadata_by_item_id`
- `get_recent_clipboard_histories`
- `insert_clipboard_history`
- `link_clip_to_menu_item`
- `move_pinned_clip_item_up_down`
- `move_pinned_item_up_down`
- `search_clipboard_histories_by_value_or_filters`
- `select_collection_by_id`
- `set_icon`
- `unpin_all_clipboard_history_items`
- `unpin_all_items_clips`
- `update_clipboard_history_by_id`
- `update_clipboard_history_by_ids`
- `update_collection_by_id`
- `update_item_by_id`
- `update_item_value_by_history_id`
- `update_items_by_ids`
- `update_menu_item_by_id`
- `update_menu_items_by_ids`
- `update_moved_clips_in_collection`
- `update_moved_menu_items_in_collection`
- `update_pinned_clipboard_history_by_ids`
- `update_pinned_items_by_ids`
- `update_tab`
- `update_tabs`
- `upload_image_file_to_item_id`

**Events with no frontend listener:**

- `clipboard://clipboard-monitor/update/error` (emitted in `src-tauri/src/clipboard/mod.rs`)
- `execMenuItemById` (emitted in `src-tauri/src/main.rs`)
- `scheme-request-received` (emitted in `src-tauri/src/main.rs`)

**Files with a computed `invoke()` argument** (not statically checkable):

- `packages/pastebar-app-ui/src/hooks/queries/use-invoke.ts`
