use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::Manager;
use tokio::process::Child;
use tokio::sync::Mutex;
use tracing::info;

pub mod commands;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub pid: u32,
    pub started_at: String,
}

pub struct PiState {
    pub child: Option<Child>,
    pub session_id: Option<String>,
    pub initialized: bool,
}

impl Default for PiState {
    fn default() -> Self {
        Self { child: None, session_id: None, initialized: false }
    }
}

pub type PiStateHandle = Arc<Mutex<PiState>>;

fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(filter).with_target(true).init();
    info!("Pi Desktop starting up...");
}

pub fn run() {
    init_tracing();
    let pi_state: PiStateHandle = Arc::new(Mutex::new(PiState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            info!("Single instance triggered");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .manage(pi_state)
        .invoke_handler(tauri::generate_handler![
            commands::spawn_pi,
            commands::kill_pi,
            commands::pi_send_message,
            commands::pi_send_rpc,
            commands::await_initialization,
            commands::list_pi_sessions,
            commands::read_session_file,
            commands::delete_session_file,
            commands::list_directory,
            commands::get_git_status,
            commands::get_git_branch,
            commands::get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
