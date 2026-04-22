use chrono::{Datelike, Utc};
use zeroize::Zeroize;
use crate::db::{ItemPayload, ItemWithPayload, VaultMeta};
use crate::AppState;
use std::fs;
use tauri::State;

use crate::sync::config::{SftpConfig, SyncConfig};
use crate::sync::local::LocalBackupProvider;
use crate::sync::sftp::SftpProvider;
use crate::sync::{BackupEntry, SyncProvider};

use super::{get_vault_dir, db_path, write_salt, read_salt, write_secret_key, read_secret_key, write_recovery_wrap, read_recovery_wrap};

#[tauri::command]
pub fn vault_exists() -> bool {
    db_path().map(|p| p.exists()).unwrap_or(false)
}

#[derive(serde::Serialize)]
pub struct CreateVaultResult {
    pub vault_id: String,
    pub secret_key_formatted: String,
    pub created_at_formatted: String,
    pub pdf_bytes: Vec<u8>,
}

#[tauri::command]
pub fn create_vault(
    state: State<'_, AppState>,
    master_pw: String,
) -> Result<CreateVaultResult, String> {
    let db_path = db_path()?;
    if db_path.exists() {
        return Err("Vault existiert bereits".into());
    }

    let (secret_key_bytes, secret_key_formatted) = crate::crypto::generate_secret_key();
    let salt = crate::crypto::generate_salt();
    write_salt(&salt)?;
    write_secret_key(&secret_key_bytes)?;

    let master_key = crate::crypto::derive_master_key(&master_pw, &secret_key_bytes, &salt)?;
    let sqlcipher_key = crate::crypto::derive_sqlcipher_key(&master_key);
    let conn = crate::db::open_db(&db_path, &sqlcipher_key)?;

    // Recovery wrap: ermöglicht Passwort-Reset via Secret Key
    let recovery_key = crate::crypto::derive_recovery_key(&secret_key_bytes);
    let wrapped = crate::crypto::wrap_key(&recovery_key, &*master_key)?;
    write_recovery_wrap(&wrapped)?;

    let vault_id = uuid::Uuid::new_v4().to_string();
    crate::db::init_vault_meta(&conn, &vault_id, &salt)?;

    let now = Utc::now();
    let de_months = ["Januar","Februar","März","April","Mai","Juni",
                     "Juli","August","September","Oktober","November","Dezember"];
    let month = de_months[(now.month0()) as usize];
    let created_at_formatted = format!("{}. {} {}", now.day(), month, now.year());
    let pdf_bytes =
        crate::emergency_kit::generate_pdf(&vault_id, &secret_key_formatted, &created_at_formatted)?;

    *state.master_key.lock().unwrap() = Some(master_key);
    *state.db_conn.lock().unwrap() = Some(conn);
    *state.vault_dir.lock().unwrap() = Some(get_vault_dir()?);

    Ok(CreateVaultResult {
        vault_id,
        secret_key_formatted,
        created_at_formatted,
        pdf_bytes,
    })
}

#[tauri::command]
pub fn unlock_vault(
    state: State<'_, AppState>,
    master_pw: String,
) -> Result<VaultMeta, String> {
    let db_path = db_path()?;
    if !db_path.exists() {
        return Err("Kein Vault gefunden. Bitte zuerst einen neuen Vault erstellen.".into());
    }

    let secret_key_bytes = read_secret_key()?;
    let salt = read_salt()?;
    let master_key = crate::crypto::derive_master_key(&master_pw, &secret_key_bytes, &salt)?;

    let sqlcipher_key = crate::crypto::derive_sqlcipher_key(&master_key);
    let conn = crate::db::open_db(&db_path, &sqlcipher_key)?;
    let meta = crate::db::read_vault_meta(&conn)?;

    // Migration: Recovery-Datei nachträglich erstellen falls noch nicht vorhanden
    if !super::recovery_path()?.exists() {
        let sk = read_secret_key()?;
        let recovery_key = crate::crypto::derive_recovery_key(&sk);
        let wrapped = crate::crypto::wrap_key(&recovery_key, &*master_key)?;
        write_recovery_wrap(&wrapped)?;
    }

    *state.master_key.lock().unwrap() = Some(master_key);
    *state.db_conn.lock().unwrap() = Some(conn);
    *state.vault_dir.lock().unwrap() = Some(get_vault_dir()?);

    Ok(meta)
}

#[tauri::command]
pub fn reset_master_password(
    secret_key_formatted: String,
    new_master_pw: String,
) -> Result<(), String> {
    // 1. Secret Key verifizieren
    let provided_bytes = crate::crypto::parse_secret_key(&secret_key_formatted)?;
    let stored_bytes = read_secret_key()?;
    if provided_bytes != stored_bytes {
        return Err("Ungültiger Secret Key — stimmt nicht mit diesem Vault überein".into());
    }

    // 2. Recovery Key ableiten und alten Master Key entschlüsseln
    let recovery_key = crate::crypto::derive_recovery_key(&stored_bytes);
    let wrapped = read_recovery_wrap()?;
    let old_master_key = crate::crypto::unwrap_key(&recovery_key, &wrapped)?;

    // 3. Alten SQLCipher Key ableiten, DB öffnen
    let old_sqlcipher_key = crate::crypto::derive_sqlcipher_key(&*old_master_key);
    let db_path = db_path()?;
    let conn = crate::db::open_db(&db_path, &*old_sqlcipher_key)?;

    // 4. Neuen Master Key mit neuem Passwort ableiten
    let new_salt = crate::crypto::generate_salt();
    let new_master_key = crate::crypto::derive_master_key(&new_master_pw, &stored_bytes, &new_salt)?;
    let new_sqlcipher_key = crate::crypto::derive_sqlcipher_key(&*new_master_key);

    // 5. DB in-place re-verschlüsseln
    conn.execute_batch(&format!(
        "PRAGMA rekey = \"x'{}'\";",
        hex::encode(new_sqlcipher_key.as_ref())
    )).map_err(|e| format!("Rekey fehlgeschlagen: {}", e))?;

    // 6. Neue Salt und neuen Recovery Wrap speichern
    write_salt(&new_salt)?;
    let new_wrapped = crate::crypto::wrap_key(&recovery_key, &*new_master_key)?;
    write_recovery_wrap(&new_wrapped)?;

    Ok(())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) {
    if let Ok(mut k) = state.master_key.lock() {
        if let Some(ref mut key) = *k {
            key.zeroize();
        }
        *k = None;
    }
    if let Ok(mut c) = state.db_conn.lock() {
        c.take();
    }
    if let Ok(mut d) = state.vault_dir.lock() {
        d.take();
    }
}

#[tauri::command]
pub fn get_items(
    state: State<'_, AppState>,
    category: Option<String>,
) -> Result<Vec<ItemWithPayload>, String> {
    let key_guard = state.master_key.lock().unwrap();
    let master_key = key_guard.as_ref().ok_or("Vault ist gesperrt")?;
    let entry_key = crate::crypto::derive_entry_key(master_key);

    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;

    crate::db::get_items(conn, &entry_key, category.as_deref())
}

#[tauri::command]
pub fn add_item(
    state: State<'_, AppState>,
    category: String,
    payload: ItemPayload,
) -> Result<String, String> {
    let key_guard = state.master_key.lock().unwrap();
    let master_key = key_guard.as_ref().ok_or("Vault ist gesperrt")?;
    let entry_key = crate::crypto::derive_entry_key(master_key);

    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;

    crate::db::insert_item(conn, &entry_key, &category, &payload)
}

#[tauri::command]
pub fn update_item(
    state: State<'_, AppState>,
    id: String,
    payload: ItemPayload,
) -> Result<(), String> {
    let key_guard = state.master_key.lock().unwrap();
    let master_key = key_guard.as_ref().ok_or("Vault ist gesperrt")?;
    let entry_key = crate::crypto::derive_entry_key(master_key);

    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;

    crate::db::update_item(conn, &entry_key, &id, &payload)
}

#[tauri::command]
pub fn delete_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;
    crate::db::delete_item(conn, &id)
}

#[tauri::command]
pub async fn sync_local(state: State<'_, AppState>) -> Result<(), String> {
    let vault_dir = state.vault_dir.lock().unwrap().clone().ok_or("Vault ist gesperrt")?;
    let data = fs::read(vault_dir.join("vault.db")).map_err(|e| e.to_string())?;
    LocalBackupProvider::new(&vault_dir)?.upload(&data, "vault.db").await
}

#[tauri::command]
pub async fn sync_sftp(state: State<'_, AppState>) -> Result<(), String> {
    let vault_dir = state.vault_dir.lock().unwrap().clone().ok_or("Vault ist gesperrt")?;
    let config = SyncConfig::load(&vault_dir.join("sync_config.toml"))?;
    let sftp_config = config.sftp.ok_or("Keine SFTP-Konfiguration gefunden")?;

    let data = fs::read(vault_dir.join("vault.db")).map_err(|e| e.to_string())?;
    SftpProvider::new(sftp_config, &vault_dir).upload(&data, "vault.db").await
}

#[tauri::command]
pub fn save_sftp_config(
    state: State<'_, AppState>,
    sftp_config: SftpConfig,
) -> Result<(), String> {
    let vault_dir = state.vault_dir.lock().unwrap().clone().ok_or("Vault ist gesperrt")?;
    let config_path = vault_dir.join("sync_config.toml");
    let mut config = SyncConfig::load(&config_path).unwrap_or_default();
    config.sftp = Some(sftp_config);
    config.save(&config_path)
}

#[tauri::command]
pub async fn list_local_backups(state: State<'_, AppState>) -> Result<Vec<BackupEntry>, String> {
    let vault_dir = state.vault_dir.lock().unwrap().clone().ok_or("Vault ist gesperrt")?;
    LocalBackupProvider::new(&vault_dir)?.list_backups().await
}
