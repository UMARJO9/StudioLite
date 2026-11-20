mod commands;
mod config;
mod error;

use commands::{fs, git, process};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(process::TaskState::default())
        .invoke_handler(tauri::generate_handler![
            fs::open_project,
            fs::read_dir,
            fs::open_in_system,
            fs::reveal_in_file_manager,
            git::git_branch,
            git::git_status,
            git::git_log,
            process::stop_task,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
