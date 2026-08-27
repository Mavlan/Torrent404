mod sidecar;

use std::sync::Mutex;

use serde_json::Value;
use sidecar::{SidecarLaunchConfig, SidecarPaths, SidecarSupervisor};
use tauri::{Manager, RunEvent, State};

fn use_sidecar(
    state: State<'_, Mutex<SidecarSupervisor>>,
    operation: impl FnOnce(&SidecarSupervisor) -> Result<Value, sidecar::SidecarError>,
) -> Result<Value, String> {
    let supervisor = state
        .lock()
        .map_err(|_| "sidecar supervisor is unavailable".to_owned())?;
    operation(&supervisor).map_err(|error| error.to_string())
}

#[tauri::command]
fn search_start(
    query: String,
    category: String,
    state: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    use_sidecar(state, |supervisor| {
        supervisor.start_search(&query, &category)
    })
}

#[tauri::command]
fn search_poll(
    request_id: String,
    cursor: u64,
    state: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    use_sidecar(state, |supervisor| {
        supervisor.poll_search(&request_id, cursor)
    })
}

#[tauri::command]
fn search_cancel(
    request_id: String,
    state: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    use_sidecar(state, |supervisor| supervisor.cancel_search(&request_id))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            search_start,
            search_poll,
            search_cancel
        ])
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let mut supervisor = SidecarSupervisor::default();
            supervisor.start(
                &SidecarPaths::from_resource_dir(&resource_dir),
                &SidecarLaunchConfig::default(),
            )?;
            app.manage(Mutex::new(supervisor));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build TorLink Desktop");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            if let Some(supervisor) = app_handle.try_state::<Mutex<SidecarSupervisor>>() {
                if let Ok(mut supervisor) = supervisor.lock() {
                    let _ = supervisor.stop();
                }
            }
        }
    });
}
