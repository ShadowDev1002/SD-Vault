pub mod webdav;
pub mod sftp;

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::AppState;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncConfig {
    pub id: String,
    pub provider: String,
    pub enabled: bool,
    pub interval_secs: i64,
    pub remote_url: String,
    pub remote_path: String,
    pub username: String,
    pub password: String,
    pub last_synced_at: Option<i64>,
    pub last_remote_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "status", content = "detail")]
pub enum SyncResult {
    UpToDate,
    Uploaded,
    Downloaded,
    Conflict { backup_path: String },
    Error(String),
}

#[tauri::command]
pub fn get_sync_configs(_state: State<AppState>) -> Result<Vec<SyncConfig>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn save_sync_config(_state: State<AppState>, _config: SyncConfig) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn delete_sync_config(_state: State<AppState>, _id: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn trigger_sync(_state: State<'_, AppState>, _config_id: String) -> Result<SyncResult, String> {
    Err("Not implemented yet".into())
}

#[tauri::command]
pub fn get_last_sync_status(_state: State<AppState>, _config_id: &str) -> Result<Option<i64>, String> {
    Ok(None)
}
