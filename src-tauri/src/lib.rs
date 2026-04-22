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
        ])
        .run(tauri::generate_context!())
        .expect("SD-Vault konnte nicht gestartet werden");
}
