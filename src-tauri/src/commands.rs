use std::process::Stdio;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tracing::{info, warn};
use serde::Serialize;

use crate::{PiStateHandle, SessionInfo};

async fn find_pi_cli() -> Option<String> {
    let candidates = [
        "C:/Users/Administrator/node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
        "node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
    ];
    for path in &candidates {
        if tokio::fs::metadata(path).await.is_ok() {
            info!("Found pi CLI at: {}", path);
            return Some(path.to_string());
        }
    }
    None
}

#[tauri::command]
pub async fn spawn_pi(app: AppHandle, state: State<'_, PiStateHandle>) -> Result<SessionInfo, String> {
    let mut pi_state = state.lock().await;

    if pi_state.child.is_some() {
        return Err("Pi process already running".to_string());
    }

    let mut cmd = match find_pi_cli().await {
        Some(cli_path) => {
            info!("Spawning pi via node: {}", cli_path);
            let mut c = Command::new("node");
            c.arg(cli_path);
            c
        }
        None => {
            info!("Spawning pi from PATH");
            Command::new("pi")
        }
    };

    cmd.arg("--mode").arg("rpc");
    cmd.arg("--no-session");

    // Run Pi from the user's home directory, not the app directory.
    // This prevents Pi from picking up pi-desktop's own AGENTS.md/context files.
    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    cmd.current_dir(&home_dir);

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    unsafe {
        std::env::set_var("NO_PROXY", "127.0.0.1,localhost,::1");
        std::env::set_var("no_proxy", "127.0.0.1,localhost,::1");
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn pi process: {}", e))?;

    let pid = child.id().unwrap_or(0);
    let session_id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().to_rfc3339();

    info!("Spawned pi RPC process PID={} session={}", pid, session_id);

    let stdout = child.stdout.take().expect("stdout not piped");
    let stderr = child.stderr.take().expect("stderr not piped");
    let app_clone = app.clone();

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    info!("pi stdout closed");
                    break;
                }
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() { continue; }
                    info!("pi stdout: {}", trimmed);
                    if let Ok(event) = serde_json::from_str::<serde_json::Value>(trimmed) {
                        let _ = app_clone.emit("pi-event", event);
                    }
                }
                Err(e) => {
                    tracing::error!("Error reading pi stdout: {}", e);
                    break;
                }
            }
        }
    });

    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() { warn!("[pi stderr] {}", trimmed); }
                }
                Err(_) => break,
            }
        }
    });

    pi_state.child = Some(child);
    pi_state.session_id = Some(session_id.clone());
    pi_state.initialized = true;

    Ok(SessionInfo { session_id, pid, started_at })
}

#[tauri::command]
pub async fn kill_pi(state: State<'_, PiStateHandle>) -> Result<String, String> {
    let mut pi_state = state.lock().await;
    if let Some(mut child) = pi_state.child.take() {
        info!("Killing pi process");
        child.kill().await.map_err(|e| format!("Failed to kill pi: {}", e))?;
        pi_state.session_id = None;
        pi_state.initialized = false;
        Ok("Pi process killed".to_string())
    } else {
        Err("No pi process running".to_string())
    }
}

#[tauri::command]
pub async fn pi_send_message(
    msg: String,
    id: String,
    state: State<'_, PiStateHandle>,
) -> Result<(), String> {
    let mut pi_state = state.lock().await;
    let child = pi_state.child.as_mut()
        .ok_or_else(|| "Pi process not running".to_string())?;
    let stdin = child.stdin.as_mut()
        .ok_or_else(|| "No stdin available".to_string())?;

    let rpc_cmd = serde_json::json!({
        "type": "prompt",
        "message": msg,
        "id": id
    });
    let mut msg_str = rpc_cmd.to_string();
    msg_str.push('\n');

    info!("Sending to pi: {}", msg_str.trim());
    stdin.write_all(msg_str.as_bytes()).await
        .map_err(|e| format!("Failed to write to pi stdin: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn pi_send_rpc(
    payload: serde_json::Value,
    state: State<'_, PiStateHandle>,
) -> Result<(), String> {
    let mut pi_state = state.lock().await;
    let child = pi_state.child.as_mut()
        .ok_or_else(|| "Pi process not running".to_string())?;
    let stdin = child.stdin.as_mut()
        .ok_or_else(|| "No stdin available".to_string())?;

    let mut msg_str = payload.to_string();
    msg_str.push('\n');

    info!("Sending RPC to pi: {}", msg_str.trim());
    stdin.write_all(msg_str.as_bytes()).await
        .map_err(|e| format!("Failed to write to pi stdin: {}", e))?;
    Ok(())
}

#[derive(Serialize)]
pub struct PiSessionEntry {
    pub path: String,
    pub title: String,
    pub modified_ms: u64,
}

#[tauri::command]
pub async fn list_pi_sessions() -> Result<Vec<PiSessionEntry>, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Cannot determine home directory".to_string())?;
    let sessions_dir = std::path::PathBuf::from(&home).join(".pi").join("agent").join("sessions");

    let mut entries: Vec<PiSessionEntry> = Vec::new();

    // Sessions live in subdirectories: ~/.pi/agent/sessions/<encoded-cwd>/*.jsonl
    collect_jsonl_files(&sessions_dir, &mut entries, 2);

    // Sort newest first
    entries.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(entries)
}

fn collect_jsonl_files(dir: &std::path::Path, entries: &mut Vec<PiSessionEntry>, max_depth: usize) {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return,
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() && max_depth > 0 {
            collect_jsonl_files(&path, entries, max_depth - 1);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            let modified_ms = entry.metadata()
                .and_then(|m| m.modified())
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
                .unwrap_or(0);
            let title = extract_session_title(&path);
            entries.push(PiSessionEntry {
                path: path.to_string_lossy().to_string(),
                title,
                modified_ms,
            });
        }
    }
}

fn extract_session_title(path: &std::path::Path) -> String {
    use std::io::{BufRead, BufReader};
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return path.file_stem().unwrap_or_default().to_string_lossy().to_string(),
    };
    let reader = BufReader::new(file);
    let mut session_name: Option<String> = None;
    let mut first_user_message: Option<String> = None;

    for line in reader.lines().take(100).flatten() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            // Pi format: {"type":"session","name":"..."} for explicit names
            if val["type"] == "session" {
                if let Some(name) = val["name"].as_str().filter(|s| !s.is_empty()) {
                    session_name = Some(name.to_string());
                }
            }
            // Pi format: {"type":"message","message":{"role":"user","content":[...]}}
            if first_user_message.is_none() && val["type"] == "message" {
                let msg = &val["message"];
                if msg["role"] == "user" {
                    if let Some(arr) = msg["content"].as_array() {
                        for part in arr {
                            if part["type"] == "text" {
                                if let Some(t) = part["text"].as_str().filter(|s| !s.is_empty()) {
                                    first_user_message = Some(t.chars().take(60).collect());
                                    break;
                                }
                            }
                        }
                    } else if let Some(t) = msg["content"].as_str() {
                        first_user_message = Some(t.chars().take(60).collect());
                    }
                }
            }
        }
        if session_name.is_some() && first_user_message.is_some() {
            break;
        }
    }

    session_name
        .or(first_user_message)
        .unwrap_or_else(|| path.file_stem().unwrap_or_default().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_session_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path)
        .map_err(|e| format!("Failed to delete session: {}", e))
}

#[tauri::command]
pub async fn read_session_file(path: String) -> Result<Vec<serde_json::Value>, String> {
    use std::io::{BufRead, BufReader};
    let file = std::fs::File::open(&path)
        .map_err(|e| format!("Cannot open session file: {}", e))?;
    let reader = BufReader::new(file);
    let entries: Vec<serde_json::Value> = reader
        .lines()
        .flatten()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(&l).ok())
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn await_initialization(state: State<'_, PiStateHandle>) -> Result<bool, String> {
    let pi_state = state.lock().await;
    if pi_state.child.is_none() {
        return Err("Pi process not running".to_string());
    }
    Ok(pi_state.initialized)
}

// ============================================================================
// File Tree
// ============================================================================

#[derive(Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileEntry>,
}

fn read_dir_recursive(dir: &std::path::Path, current_depth: u32, max_depth: u32) -> Vec<FileEntry> {
    if current_depth > max_depth { return vec![]; }
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(_) => return vec![],
    };
    let mut entries: Vec<FileEntry> = read_dir.flatten().filter_map(|entry| {
        let path = entry.path();
        let name = match path.file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => return None,
        };
        if name.starts_with('.') { return None; }
        if matches!(name.as_str(), "node_modules" | "target" | "dist" | ".git" | "__pycache__" | ".next" | "build") {
            return None;
        }
        let is_dir = path.is_dir();
        let children = if is_dir && current_depth < max_depth {
            read_dir_recursive(&path, current_depth + 1, max_depth)
        } else {
            vec![]
        };
        Some(FileEntry { name, path: path.to_string_lossy().to_string(), is_dir, children })
    }).collect();
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });
    entries
}

#[tauri::command]
pub async fn list_directory(path: String, depth: u32) -> Result<Vec<FileEntry>, String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    Ok(read_dir_recursive(&path_buf, 0, depth.min(5)))
}

// ============================================================================
// Git Status
// ============================================================================

#[derive(Serialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
}

#[tauri::command]
pub async fn get_git_status(cwd: String) -> Result<Vec<GitFileStatus>, String> {
    let output = std::process::Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;

    if !output.status.success() && output.stdout.is_empty() {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(if err.is_empty() { "Not a git repository".to_string() } else { err });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries = stdout.lines()
        .filter(|line| line.len() >= 4)
        .filter_map(|line| {
            let xy = line[0..2].trim();
            let path = line[3..].trim();
            if path.is_empty() || xy.is_empty() { return None; }
            let status = if xy.contains('A') { "A" }
                else if xy.contains('D') { "D" }
                else if xy.contains('M') || xy.contains('m') { "M" }
                else if xy == "??" { "?" }
                else { xy };
            Some(GitFileStatus { path: path.to_string(), status: status.to_string() })
        })
        .collect();
    Ok(entries)
}

#[tauri::command]
pub async fn get_git_branch(cwd: String) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err("Not a git repository".to_string())
    }
}

#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|p| p.replace('\\', "/"))
        .map_err(|_| "Cannot determine home directory".to_string())
}
