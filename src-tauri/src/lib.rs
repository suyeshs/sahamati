use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct SidecarState(Mutex<Option<CommandChild>>);

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
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_resource_file])
        .setup(|app| {
            let parent_pid = std::process::id().to_string();
            let sidecar = app
                .shell()
                .sidecar("agent-server")
                .expect("failed to resolve agent-server sidecar")
                .env("__SAHAMATI_PARENT_PID", parent_pid);
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
