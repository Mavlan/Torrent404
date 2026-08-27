mod sidecar;

use std::sync::Mutex;

use sidecar::{SidecarLaunchConfig, SidecarPaths, SidecarSupervisor};
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
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
