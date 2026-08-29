mod sidecar;

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use sidecar::{SidecarLaunchConfig, SidecarPaths, SidecarSupervisor};
use tauri::{Manager, RunEvent, State};

struct DownloadDirectory(PathBuf);

#[cfg(target_os = "windows")]
fn show_startup_failure(reason: &str) {
    use std::ffi::c_void;
    use std::iter;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            window: *mut c_void,
            text: *const u16,
            caption: *const u16,
            kind: u32,
        ) -> i32;
    }

    let message = format!(
        "Torrent404 启动失败。请重新安装应用；如果问题持续存在，请提交错误报告。\n\n{reason}"
    );
    let message: Vec<u16> = std::ffi::OsStr::new(&message)
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let caption: Vec<u16> = std::ffi::OsStr::new("Torrent404 — 启动失败")
        .encode_wide()
        .chain(iter::once(0))
        .collect();

    // SAFETY: both UTF-16 buffers are NUL-terminated and remain alive for the call.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            message.as_ptr(),
            caption.as_ptr(),
            0x0000_0010,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn show_startup_failure(reason: &str) {
    eprintln!("Torrent404 startup failed: {reason}");
}

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
    provider_ids: Option<Vec<String>>,
    state: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    use_sidecar(state, |supervisor| {
        supervisor.start_search(&query, &category, provider_ids.as_deref())
    })
}

#[tauri::command]
fn search_providers(state: State<'_, Mutex<SidecarSupervisor>>) -> Result<Value, String> {
    use_sidecar(state, SidecarSupervisor::search_providers)
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

#[tauri::command]
fn download_directory(state: State<'_, DownloadDirectory>) -> String {
    state.0.to_string_lossy().into_owned()
}

#[tauri::command]
fn download_add(
    magnet: String,
    name: Option<String>,
    total: Option<u64>,
    sidecar: State<'_, Mutex<SidecarSupervisor>>,
    directory: State<'_, DownloadDirectory>,
) -> Result<Value, String> {
    let supervisor = sidecar
        .lock()
        .map_err(|_| "sidecar supervisor is unavailable".to_owned())?;
    supervisor
        .add_download(&magnet, name.as_deref(), total, &directory.0)
        .map_err(|error| error.to_string())
}

fn control_download(
    command: &'static str,
    task_id: String,
    sidecar: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    use_sidecar(sidecar, |supervisor| {
        supervisor.control_download(command, &task_id)
    })
}

#[tauri::command]
fn download_pause(
    task_id: String,
    sidecar: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    control_download("download.pause", task_id, sidecar)
}

#[tauri::command]
fn download_resume(
    task_id: String,
    sidecar: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    control_download("download.resume", task_id, sidecar)
}

#[tauri::command]
fn download_start_seeding(
    task_id: String,
    sidecar: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    control_download("download.seed.start", task_id, sidecar)
}

#[tauri::command]
fn download_stop_seeding(
    task_id: String,
    sidecar: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    control_download("download.seed.stop", task_id, sidecar)
}

#[tauri::command]
fn download_remove(
    task_id: String,
    sidecar: State<'_, Mutex<SidecarSupervisor>>,
) -> Result<Value, String> {
    control_download("download.remove", task_id, sidecar)
}

#[tauri::command]
fn download_list(sidecar: State<'_, Mutex<SidecarSupervisor>>) -> Result<Value, String> {
    use_sidecar(sidecar, SidecarSupervisor::list_downloads)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            search_providers,
            search_start,
            search_poll,
            search_cancel,
            download_directory,
            download_add,
            download_pause,
            download_resume,
            download_start_seeding,
            download_stop_seeding,
            download_remove,
            download_list
        ])
        .setup(|app| {
            let resource_dir = match app.path().resource_dir() {
                Ok(path) => path,
                Err(error) => {
                    show_startup_failure(&format!(
                        "application resources are unavailable: {error}"
                    ));
                    app.handle().exit(1);
                    return Ok(());
                }
            };
            let download_dir = match app.path().download_dir() {
                Ok(path) => path.join("Torrent404"),
                Err(error) => {
                    show_startup_failure(&format!(
                        "the download directory is unavailable: {error}"
                    ));
                    app.handle().exit(1);
                    return Ok(());
                }
            };
            let task_store_path = match app.path().app_local_data_dir() {
                Ok(path) => path.join("download-tasks.v1.json"),
                Err(error) => {
                    show_startup_failure(&format!(
                        "the local task store directory is unavailable: {error}"
                    ));
                    app.handle().exit(1);
                    return Ok(());
                }
            };
            let mut supervisor = SidecarSupervisor::default();
            if let Err(error) = supervisor.start(
                &SidecarPaths::from_resource_dir(&resource_dir),
                &SidecarLaunchConfig {
                    task_store_path: Some(task_store_path),
                    ..SidecarLaunchConfig::default()
                },
            ) {
                show_startup_failure(&error.safe_startup_reason());
                app.handle().exit(1);
                return Ok(());
            }
            app.manage(Mutex::new(supervisor));
            app.manage(DownloadDirectory(download_dir));
            Ok(())
        })
        .build(tauri::generate_context!());

    let app = match app {
        Ok(app) => app,
        Err(error) => {
            show_startup_failure(&format!("the desktop shell could not be created: {error}"));
            return;
        }
    };

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
