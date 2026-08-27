#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Phase 1 intentionally grants no shell, network or filesystem plugin.
        // The sidecar supervisor arrives behind narrow commands in Phase 3.
        .run(tauri::generate_context!())
        .expect("failed to run TorLink Desktop");
}

