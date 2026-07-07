use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct SidecarState(Mutex<Option<CommandChild>>);

/// Build the menu-bar tray icon (Show / Hide / New Project / Quit) and wire
/// its events back to the main window. Purely additive — closing the window
/// still quits the app.
fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
    let new_project =
        MenuItem::with_id(app, "new_project", "New Project", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Sahamati", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &new_project, &sep, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            "new_project" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                    let _ = w.emit("tray://new-project", ());
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
fn read_resource_file(#[allow(unused)] app: tauri::AppHandle, path: String) -> Result<String, String> {
    let resource_path = {
        #[cfg(debug_assertions)]
        {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join(&path)
        }
        #[cfg(not(debug_assertions))]
        {
            app.path()
                .resolve(&path, tauri::path::BaseDirectory::Resource)
                .map_err(|e| e.to_string())?
        }
    };

    std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Failed to read {}: {}", resource_path.display(), e))
}

fn kill_sidecar(app_handle: &tauri::AppHandle) {
    if let Some(state) = app_handle.try_state::<SidecarState>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.take() {
                let pid = child.pid();
                if let Err(err) = child.kill() {
                    eprintln!("[agent-server] failed to kill PID {}: {}", pid, err);
                } else {
                    println!("[agent-server] killed PID {} on shell exit", pid);
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![read_resource_file])
        .setup(|app| {
            // Translucent macOS window behind the title bar + frosted sidebar.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }
            }

            if let Err(err) = setup_tray(app) {
                eprintln!("[tray] failed to set up tray icon: {}", err);
            }

            // `bun build --compile` can't embed libsql's native addon — libsql require()s its
            // platform package (@libsql/<target>) dynamically at import time, and a native .node
            // can't live inside the single-file binary. So the sidecar needs NODE_PATH pointing at a
            // node_modules that contains it. Dev uses the source tree; release uses the staged
            // resource copied by agent-server/scripts/stage-native-deps.mjs (bundle.resources
            // preserves the src-tauri-relative path, hence "resources/node_modules").
            #[cfg(debug_assertions)]
            let libsql_node_path: PathBuf = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("repo root")
                .join("agent-server/node_modules");
            #[cfg(not(debug_assertions))]
            let libsql_node_path: PathBuf = app
                .path()
                .resource_dir()
                .expect("resource dir")
                .join("resources/node_modules");

            let parent_pid = std::process::id().to_string();
            let sidecar = app
                .shell()
                .sidecar("agent-server")
                .expect("failed to resolve agent-server sidecar")
                .env("__SAHAMATI_PARENT_PID", parent_pid)
                .env("NODE_PATH", &libsql_node_path);

            // Installed apps have no repo tree for the sidecar to walk up to, and its
            // execPath dir (/usr/bin, /Applications/...) isn't writable — give it an
            // explicit writable root for data/ (DB, pid file) and generated docs.
            // Dev keeps the repo root discovered by the sidecar itself.
            #[cfg(not(debug_assertions))]
            let sidecar = {
                let data_root = app
                    .path()
                    .app_data_dir()
                    .expect("app data dir");
                std::fs::create_dir_all(&data_root).ok();
                sidecar.env("__SAHAMATI_ROOT", &data_root)
            };

            let (mut rx, child) = sidecar.spawn().expect("Failed to start agent server");

            app.manage(SidecarState(Mutex::new(Some(child))));

            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[agent-server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[agent-server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(status) => {
                            println!("[agent-server] terminated with {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            kill_sidecar(app_handle);
        }
        _ => {}
    });
}
