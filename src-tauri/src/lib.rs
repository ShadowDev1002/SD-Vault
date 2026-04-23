pub mod commands;
pub mod crypto;
pub mod db;
pub mod emergency_kit;
pub mod sync;

use dirs::document_dir;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use zeroize::Zeroizing;

pub struct AppState {
    pub master_key: Mutex<Option<Zeroizing<[u8; 32]>>>,
    pub db_conn: Mutex<Option<Connection>>,
    pub vault_dir: Mutex<Option<PathBuf>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            master_key: Mutex::new(None),
            db_conn: Mutex::new(None),
            vault_dir: Mutex::new(None),
        }
    }
}

pub(crate) fn get_vault_dir() -> Result<PathBuf, String> {
    let docs = document_dir().ok_or("Dokumente-Ordner nicht gefunden")?;
    let dir = docs.join("SD-Vault");
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
pub(crate) fn write_secret_key(key_bytes: &[u8; 20]) -> Result<(), String> {
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

pub(crate) fn read_secret_key() -> Result<[u8; 20], String> {
    let bytes = fs::read(secret_key_path()?)
        .map_err(|e| format!("vault.secret nicht gefunden: {}", e))?;
    if bytes.len() != 20 {
        return Err("Korrupte vault.secret Datei".into());
    }
    let mut key = [0u8; 20];
    key.copy_from_slice(&bytes);
    Ok(key)
}

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
        ])
        .run(tauri::generate_context!())
        .expect("SD-Vault konnte nicht gestartet werden");
}
