pub mod webdav;
pub mod sftp;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::State;

use crate::{
    decrypt_data_internal, encrypt_data_internal, get_db_conn, get_db_path_from_state, AppState,
};

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

pub trait SyncProvider: Send {
    fn upload(&self, vault_bytes: &[u8], hash: &str) -> Result<(), String>;
    fn download(&self) -> Result<Vec<u8>, String>;
    fn remote_hash(&self) -> Result<Option<String>, String>;
}

pub fn local_hash(db_path: &PathBuf) -> Result<String, String> {
    let bytes = std::fs::read(db_path).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

pub fn perform_sync(
    provider: &dyn SyncProvider,
    db_path: &PathBuf,
    last_remote_hash: Option<&str>,
) -> Result<SyncResult, String> {
    let local_hash = local_hash(db_path)?;
    let remote_hash = provider.remote_hash()?;

    match remote_hash {
        None => {
            let bytes = std::fs::read(db_path).map_err(|e| e.to_string())?;
            provider.upload(&bytes, &local_hash)?;
            Ok(SyncResult::Uploaded)
        }
        Some(ref remote) => {
            let last = last_remote_hash.unwrap_or("");
            let local_changed = local_hash != last;
            let remote_changed = remote != last;

            match (local_changed, remote_changed) {
                (false, false) => Ok(SyncResult::UpToDate),
                (true, false) => {
                    let bytes = std::fs::read(db_path).map_err(|e| e.to_string())?;
                    provider.upload(&bytes, &local_hash)?;
                    Ok(SyncResult::Uploaded)
                }
                (false, true) => {
                    let remote_bytes = provider.download()?;
                    std::fs::write(db_path, &remote_bytes).map_err(|e| e.to_string())?;
                    Ok(SyncResult::Downloaded)
                }
                (true, true) => {
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs();
                    let backup = db_path.with_file_name(format!("vaultzero_conflict_{}.db", ts));
                    std::fs::copy(db_path, &backup).map_err(|e| e.to_string())?;
                    let remote_bytes = provider.download()?;
                    std::fs::write(db_path, &remote_bytes).map_err(|e| e.to_string())?;
                    Ok(SyncResult::Conflict {
                        backup_path: backup.to_string_lossy().into_owned(),
                    })
                }
            }
        }
    }
}

fn load_configs(state: &State<AppState>) -> Result<Vec<SyncConfig>, String> {
    let conn = get_db_conn(state)?;
    let mut stmt = conn
        .prepare("SELECT id, provider, enabled, interval_secs, remote_url, remote_path, username, encrypted_credentials, last_synced_at, last_remote_hash FROM sync_config")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut configs = Vec::new();
    for row in rows {
        let (id, provider, enabled, interval_secs, enc_url, enc_path, enc_user, enc_creds, last_synced_at, last_remote_hash) =
            row.map_err(|e| e.to_string())?;
        configs.push(SyncConfig {
            id,
            provider,
            enabled: enabled == 1,
            interval_secs,
            remote_url: decrypt_data_internal(state, &enc_url).unwrap_or_default(),
            remote_path: decrypt_data_internal(state, &enc_path).unwrap_or_default(),
            username: decrypt_data_internal(state, &enc_user).unwrap_or_default(),
            password: decrypt_data_internal(state, &enc_creds).unwrap_or_default(),
            last_synced_at,
            last_remote_hash,
        });
    }
    Ok(configs)
}

#[tauri::command]
pub fn get_sync_configs(state: State<AppState>) -> Result<Vec<SyncConfig>, String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    load_configs(&state)
}

#[tauri::command]
pub fn save_sync_config(state: State<AppState>, config: SyncConfig) -> Result<(), String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    let enc_url = encrypt_data_internal(&state, &config.remote_url)?;
    let enc_path = encrypt_data_internal(&state, &config.remote_path)?;
    let enc_user = encrypt_data_internal(&state, &config.username)?;
    let enc_creds = encrypt_data_internal(&state, &config.password)?;
    conn.execute(
        "INSERT INTO sync_config (id, provider, enabled, interval_secs, remote_url, remote_path, username, encrypted_credentials)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           enabled = excluded.enabled,
           interval_secs = excluded.interval_secs,
           remote_url = excluded.remote_url,
           remote_path = excluded.remote_path,
           username = excluded.username,
           encrypted_credentials = excluded.encrypted_credentials",
        params![config.id, config.provider, config.enabled as i64, config.interval_secs,
                enc_url, enc_path, enc_user, enc_creds],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_sync_config(state: State<AppState>, id: &str) -> Result<(), String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    conn.execute("DELETE FROM sync_config WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn trigger_sync(state: State<'_, AppState>, config_id: String) -> Result<SyncResult, String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    let db_path = get_db_path_from_state(&state)?;
    let configs = load_configs(&state)?;
    let config = configs
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or("Sync config not found")?;

    let last_hash = config.last_remote_hash.clone();
    let result = match config.provider.as_str() {
        "webdav" => {
            let provider = webdav::WebDavProvider::new(
                config.remote_url.clone(),
                config.remote_path.clone(),
                config.username.clone(),
                config.password.clone(),
            );
            perform_sync(&provider, &db_path, last_hash.as_deref())
        }
        "sftp" => {
            let remote_url = config.remote_url.clone();
            let remote_path = config.remote_path.clone();
            let username = config.username.clone();
            let password = config.password.clone();
            let db_path_clone = db_path.clone();
            let last_hash_clone = last_hash.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let provider = sftp::SftpProvider::new(remote_url, remote_path, username, password)?;
                perform_sync(&provider, &db_path_clone, last_hash_clone.as_deref())
            })
            .await
            .map_err(|e| format!("SFTP task error: {}", e))?
        }
        p => Err(format!("Unknown provider: {}", p)),
    }?;

    let new_hash = match &result {
        SyncResult::Uploaded => Some(local_hash(&db_path)?),
        SyncResult::Downloaded => Some(local_hash(&db_path)?),
        SyncResult::UpToDate => last_hash,
        _ => last_hash,
    };

    if let Some(hash) = new_hash {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let conn = get_db_conn(&state)?;
        conn.execute(
            "UPDATE sync_config SET last_remote_hash = ?1, last_synced_at = ?2 WHERE id = ?3",
            params![hash, now, config_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(result)
}

#[tauri::command]
pub fn get_last_sync_status(state: State<AppState>, config_id: &str) -> Result<Option<i64>, String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    let ts: Option<i64> = conn
        .query_row(
            "SELECT last_synced_at FROM sync_config WHERE id = ?1",
            params![config_id],
            |row| row.get(0),
        )
        .unwrap_or(None);
    Ok(ts)
}
