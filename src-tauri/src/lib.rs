use tauri::Manager;

mod clip_server;
mod commands;
mod types;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    clip_server::start_clip_server();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::list_directory,
            commands::fs::copy_file,
            commands::fs::preprocess_file,
            commands::fs::delete_file,
            commands::fs::find_related_wiki_pages,
            commands::fs::create_directory,
            commands::project::create_project,
            commands::project::open_project,
            commands::vectorstore::vector_upsert,
            commands::vectorstore::vector_search,
            commands::vectorstore::vector_delete,
            commands::vectorstore::vector_count,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                #[cfg(target_os = "macos")]
                {
                    // macOS: hide window instead of quitting, Cmd+Q still quits
                    let _ = window.hide();
                    api.prevent_close();
                }

                #[cfg(not(target_os = "macos"))]
                {
                    // Windows/Linux: show confirmation dialog before closing
                    use tauri::Emitter;
                    api.prevent_close();
                    let win = window.clone();
                    tauri::async_runtime::spawn(async move {
                        let confirm = tauri_plugin_dialog::MessageDialogBuilder::new(
                            "Confirm Exit",
                            "Are you sure you want to quit LLM Wiki?",
                        )
                        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                        .ok_button_label("Quit")
                        .cancel_button_label("Cancel")
                        .blocking_show();

                        if confirm {
                            let _ = win.destroy();
                        }
                    });
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS: re-show window when dock icon is clicked
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        });
}
