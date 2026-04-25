pub mod commands;
pub mod crypto;
pub mod db;
pub mod emergency_kit;
pub mod sync;

use dirs::{data_dir, document_dir};
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use zeroize::Zeroizing;

pub struct AppState {
    pub master_key: Mutex<Option<Zeroizing<[u8; 32]>>>,
    pub db_conn: Mutex<Option<Connection>>,
    pub vault_dir: Mutex<Option<PathBuf>>,
    pub lockout_until: Mutex<Option<Instant>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            master_key: Mutex::new(None),
            db_conn: Mutex::new(None),
            vault_dir: Mutex::new(None),
            lockout_until: Mutex::new(None),
        }
    }
}

pub(crate) fn get_vault_dir() -> Result<PathBuf, String> {
    // Android hat kein Document-Verzeichnis — App-privaten Datenpfad nutzen
    #[cfg(target_os = "android")]
    let base = data_dir().ok_or("Kein Datenpfad gefunden")?;
    #[cfg(not(target_os = "android"))]
    let base = document_dir().ok_or("Dokumente-Ordner nicht gefunden")?;

    let dir = base.join("SD-Vault");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn db_path() -> Result<PathBuf, String> {
    Ok(get_vault_dir()?.join("vault.db"))
}

pub(crate) fn salt_path() -> Result<PathBuf, String> {
    Ok(get_vault_dir()?.join("vault.salt"))
}

pub(crate) fn write_salt(salt: &[u8; 32]) -> Result<(), String> {
    fs::write(salt_path()?, salt.as_ref()).map_err(|e| e.to_string())
}

pub(crate) fn read_salt() -> Result<[u8; 32], String> {
    let bytes = fs::read(salt_path()?).map_err(|e| format!("vault.salt nicht gefunden: {}", e))?;
    if bytes.len() != 32 {
        return Err("Korrupte vault.salt Datei".into());
    }
    let mut salt = [0u8; 32];
    salt.copy_from_slice(&bytes);
    Ok(salt)
}

pub(crate) fn secret_key_path() -> Result<PathBuf, String> {
    Ok(get_vault_dir()?.join("vault.secret"))
}

pub(crate) fn kdf_params_path() -> Result<PathBuf, String> {
    Ok(get_vault_dir()?.join("vault.kdf"))
}

#[derive(Clone, Copy)]
pub(crate) struct KdfParams {
    pub mem_kb: u32,
    pub ops: u32,
    pub threads: u32,
}

pub(crate) fn write_kdf_params(p: &KdfParams) -> Result<(), String> {
    let mut b = Vec::with_capacity(12);
    b.extend_from_slice(&p.mem_kb.to_le_bytes());
    b.extend_from_slice(&p.ops.to_le_bytes());
    b.extend_from_slice(&p.threads.to_le_bytes());
    fs::write(kdf_params_path()?, b).map_err(|e| e.to_string())
}

pub(crate) fn read_kdf_params() -> KdfParams {
    if let Ok(path) = kdf_params_path() {
        if let Ok(b) = fs::read(path) {
            if b.len() >= 12 {
                return KdfParams {
                    mem_kb: u32::from_le_bytes(b[0..4].try_into().unwrap()),
                    ops:    u32::from_le_bytes(b[4..8].try_into().unwrap()),
                    threads: u32::from_le_bytes(b[8..12].try_into().unwrap()),
                };
            }
        }
    }
    KdfParams {
        mem_kb:  crate::crypto::ARGON2_MEM_KB,
        ops:     crate::crypto::ARGON2_OPS,
        threads: crate::crypto::ARGON2_THREADS,
    }
}

pub(crate) fn attempts_path() -> Result<PathBuf, String> {
    Ok(get_vault_dir()?.join("vault.attempts"))
}

pub(crate) fn read_failed_attempts() -> u32 {
    attempts_path()
        .and_then(|p| fs::read_to_string(p).map_err(|e| e.to_string()))
        .and_then(|s| s.trim().parse::<u32>().map_err(|e| e.to_string()))
        .unwrap_or(0)
}

pub(crate) fn write_failed_attempts(n: u32) -> Result<(), String> {
    fs::write(attempts_path()?, n.to_string()).map_err(|e| e.to_string())
}

pub(crate) fn lockout_path() -> Result<PathBuf, String> {
    Ok(get_vault_dir()?.join("vault.lockout"))
}

pub(crate) fn write_lockout_until(until_unix: u64) -> Result<(), String> {
    fs::write(lockout_path()?, until_unix.to_string()).map_err(|e| e.to_string())
}

pub(crate) fn clear_lockout_file() {
    if let Ok(path) = lockout_path() {
        let _ = fs::remove_file(path);
    }
}

/// Liest den persistierten Lockout-Zeitstempel und gibt einen Instant zurück,
/// falls die Sperre noch aktiv ist.
pub(crate) fn read_lockout_until() -> Option<Instant> {
    let path = lockout_path().ok()?;
    let content = fs::read_to_string(path).ok()?;
    let until_unix: u64 = content.trim().parse().ok()?;
    let now_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs();
    if until_unix <= now_unix {
        return None;
    }
    let remaining = Duration::from_secs(until_unix - now_unix);
    Some(Instant::now() + remaining)
}

pub(crate) fn recovery_path() -> Result<PathBuf, String> {
    Ok(get_vault_dir()?.join("vault.recovery"))
}

pub(crate) fn write_recovery_wrap(data: &[u8]) -> Result<(), String> {
    let path = recovery_path()?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn read_recovery_wrap() -> Result<Vec<u8>, String> {
    fs::read(recovery_path()?).map_err(|e| format!("vault.recovery nicht gefunden: {}", e))
}

/// Speichert den Secret Key gerätebunden (chmod 600). Wird nie synchronisiert.
pub(crate) fn write_secret_key(key_bytes: &[u8; 32]) -> Result<(), String> {
    let path = secret_key_path()?;
    fs::write(&path, key_bytes.as_ref()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn read_secret_key() -> Result<[u8; 32], String> {
    let bytes = fs::read(secret_key_path()?)
        .map_err(|e| format!("vault.secret nicht gefunden: {}", e))?;
    if bytes.len() != 32 {
        return Err("Korrupte vault.secret Datei (v1.1.0: 32 Byte erwartet)".into());
    }
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    Ok(key)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::vault_exists,
            commands::create_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::get_items,
            commands::add_item,
            commands::update_item,
            commands::delete_item,
            commands::sync_local,
            commands::sync_sftp,
            commands::save_sftp_config,
            commands::list_local_backups,
            commands::reset_master_password,
            commands::open_url,
            commands::sync_webdav,
            commands::save_webdav_config,
            commands::get_attachments,
            commands::add_attachment,
            commands::get_attachment_data,
            commands::delete_attachment,
            commands::export_entry_pdf,
            commands::export_vault,
            commands::import_vault,
            commands::reset_lockout_with_key,
            commands::move_item_category,
            commands::toggle_favorite,
            commands::get_all_tags,
            commands::get_items_by_tag,
        ])
        .run(tauri::generate_context!())
        .expect("SD-Vault konnte nicht gestartet werden");
}
