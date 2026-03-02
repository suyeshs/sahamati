#[allow(unused_imports)]
use std::path::PathBuf;
#[allow(unused_imports)]
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
fn read_resource_file(#[allow(unused)] app: tauri::AppHandle, path: String) -> Result<String, String> {
    let resource_path = {
        #[cfg(debug_assertions)]
        {
            // Dev mode: resolve relative to project root (parent of src-tauri/)
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("..")
                .join(&path)
        }
        #[cfg(not(debug_assertions))]
        {
            // Production: resolve from app resource directory
            app.path()
                .resolve(&path, tauri::path::BaseDirectory::Resource)
                .map_err(|e| e.to_string())?
        }
    };

    std::fs::read_to_string(&resource_path)
        .map_err(|e| format!("Failed to read {}: {}", resource_path.display(), e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![read_resource_file])
        .setup(|app| {
            let sidecar = app.shell().sidecar("agent-server").unwrap();
            let (mut _rx, _child) = sidecar.spawn().expect("Failed to start agent server");

            // Log sidecar output in background
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = _rx.recv().await {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
