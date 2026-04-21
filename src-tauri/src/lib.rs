use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{rand_core::{OsRng as ArgonOsRng, RngCore}, PasswordHasher, SaltString},
    Algorithm, Argon2, Params, Version,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::net::TcpListener;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

mod sync;
mod import_export;

pub(crate) struct GoogleOAuthState {
    pub(crate) listener: TcpListener,
    pub(crate) code_verifier: String,
    pub(crate) port: u16,
}

pub(crate) struct AppState {
    pub(crate) master_key: Mutex<Option<Zeroizing<[u8; 32]>>>,
    pub(crate) db_path: Mutex<Option<PathBuf>>,
    pub(crate) google_oauth_state: Mutex<Option<GoogleOAuthState>>,
}

#[derive(Serialize, Deserialize)]
struct PasswordItem {
    id: String,
    category: String,
    title: String,
    username: String,
    encrypted_payload: String,
    is_favorite: bool,
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS vaults (
            id TEXT PRIMARY KEY,
            salt TEXT NOT NULL,
            enc_dek_pwd TEXT NOT NULL,
            enc_dek_recovery TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL DEFAULT 'login',
            title TEXT NOT NULL,
            username TEXT,
            encrypted_payload TEXT NOT NULL,
            is_favorite INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS item_tags (
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (item_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            encrypted_bytes TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_config (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            interval_secs INTEGER NOT NULL DEFAULT 300,
            remote_url TEXT NOT NULL DEFAULT '',
            remote_path TEXT NOT NULL DEFAULT '/vaultzero.db',
            username TEXT NOT NULL DEFAULT '',
            encrypted_credentials TEXT NOT NULL DEFAULT '',
            last_synced_at INTEGER,
            last_remote_hash TEXT
        );
    ").map_err(|e| e.to_string())?;
    // Safe migration for DBs created before is_favorite existed
    let _ = conn.execute("ALTER TABLE items ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0", []);
    Ok(())
}

fn get_db_conn(state: &State<AppState>) -> Result<Connection, String> {
    let path = state.db_path.lock().unwrap().clone().ok_or("DB path not set")?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
    Ok(conn)
}

pub(crate) fn get_db_path_from_state(state: &State<AppState>) -> Result<std::path::PathBuf, String> {
    state.db_path.lock().unwrap().clone().ok_or_else(|| "DB path not set".to_string())
}

#[tauri::command]
fn check_vault_exists(app_handle: AppHandle, state: State<AppState>) -> Result<bool, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    let db_path = app_dir.join("vaultzero.db");
    
    *state.db_path.lock().unwrap() = Some(db_path.clone());
    
    if !db_path.exists() {
        return Ok(false);
    }
    
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    ensure_schema(&conn)?;
    let vault_count: i64 = conn
        .query_row("SELECT count(*) FROM vaults", [], |row| row.get(0))
        .unwrap_or(0);
    Ok(vault_count > 0)
}

#[tauri::command]
fn create_vault(state: State<AppState>, password: &str, secret_key: &str) -> Result<(), String> {
    let conn = get_db_conn(&state)?;
    ensure_schema(&conn)?;

    let salt = SaltString::generate(&mut ArgonOsRng);
    
    let mut dek_bytes = [0u8; 32];
    ArgonOsRng.fill_bytes(&mut dek_bytes);
    let dek = Zeroizing::new(dek_bytes);

    let pwd_key = derive_key_internal(password, salt.as_str())?;
    let rec_key = derive_key_internal(secret_key, salt.as_str())?;
    
    let enc_dek_pwd = encrypt_data_with_key(&pwd_key, &hex::encode(&*dek))?;
    let enc_dek_recovery = encrypt_data_with_key(&rec_key, &hex::encode(&*dek))?;

    conn.execute(
        "INSERT INTO vaults (id, salt, enc_dek_pwd, enc_dek_recovery) VALUES (?1, ?2, ?3, ?4)",
        params!["default", salt.as_str(), enc_dek_pwd, enc_dek_recovery],
    ).map_err(|e| e.to_string())?;
    
    *state.master_key.lock().unwrap() = Some(dek);
    Ok(())
}

#[tauri::command]
fn unlock_vault(state: State<AppState>, password: &str) -> Result<bool, String> {
    let conn = get_db_conn(&state)?;
    
    let (salt, enc_dek_pwd): (String, String) = conn.query_row(
        "SELECT salt, enc_dek_pwd FROM vaults WHERE id = 'default'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| "Vault not found".to_string())?;
    
    let pwd_key = derive_key_internal(password, &salt)?;
    
    let dek_hex = decrypt_data_with_key(&pwd_key, &enc_dek_pwd)?;
    let mut dek_bytes = [0u8; 32];
    hex::decode_to_slice(dek_hex, &mut dek_bytes).map_err(|e| e.to_string())?;
    
    *state.master_key.lock().unwrap() = Some(Zeroizing::new(dek_bytes));
    Ok(true)
}

#[tauri::command]
fn recover_vault(state: State<AppState>, secret_key: &str, new_password: &str) -> Result<bool, String> {
    let conn = get_db_conn(&state)?;
    
    let (salt, enc_dek_recovery): (String, String) = conn.query_row(
        "SELECT salt, enc_dek_recovery FROM vaults WHERE id = 'default'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| "Vault not found".to_string())?;
    
    let rec_key = derive_key_internal(secret_key, &salt)?;
    
    let dek_hex = decrypt_data_with_key(&rec_key, &enc_dek_recovery)?;
    let mut dek_bytes = [0u8; 32];
    hex::decode_to_slice(&dek_hex, &mut dek_bytes).map_err(|e| e.to_string())?;
    let dek = Zeroizing::new(dek_bytes);
    
    let pwd_key = derive_key_internal(new_password, &salt)?;
    let enc_dek_pwd = encrypt_data_with_key(&pwd_key, &dek_hex)?;
    
    conn.execute(
        "UPDATE vaults SET enc_dek_pwd = ?1 WHERE id = 'default'",
        params![enc_dek_pwd],
    ).map_err(|e| e.to_string())?;
    
    *state.master_key.lock().unwrap() = Some(dek);
    Ok(true)
}

fn derive_key_internal(password: &str, salt_str: &str) -> Result<Zeroizing<[u8; 32]>, String> {
    let pwd = Zeroizing::new(password.as_bytes().to_vec());
    let params = Params::new(65536, 3, 4, None).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(&pwd, salt_str.as_bytes(), &mut *key)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

#[tauri::command]
fn lock_vault(state: State<AppState>) {
    *state.master_key.lock().unwrap() = None;
}

#[tauri::command]
fn is_unlocked(state: State<AppState>) -> bool {
    state.master_key.lock().unwrap().is_some()
}

fn decrypt_data_internal(state: &State<AppState>, encrypted_hex: &str) -> Result<String, String> {
    let guard = state.master_key.lock().unwrap();
    let mk = guard.as_ref().ok_or("Vault is locked")?;
    decrypt_data_with_key(&**mk, encrypted_hex)
}

#[tauri::command]
fn get_items(state: State<AppState>) -> Result<Vec<PasswordItem>, String> {
    if !is_unlocked(state.clone()) {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare("SELECT id, category, title, username, encrypted_payload, is_favorite FROM items ORDER BY is_favorite DESC, title ASC")
        .map_err(|e| e.to_string())?;

    let items_iter = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in items_iter {
        let (id, enc_cat, enc_title, enc_user, enc_payload, is_fav) =
            row.map_err(|e| e.to_string())?;
        items.push(PasswordItem {
            id,
            category: decrypt_data_internal(&state, &enc_cat)
                .unwrap_or_else(|_| "login".to_string()),
            title: decrypt_data_internal(&state, &enc_title)
                .unwrap_or_else(|_| "Unknown".to_string()),
            username: decrypt_data_internal(&state, &enc_user).unwrap_or_default(),
            encrypted_payload: enc_payload,
            is_favorite: is_fav == 1,
        });
    }
    Ok(items)
}

#[tauri::command]
fn add_item(state: State<AppState>, id: &str, category: &str, title: &str, username: &str, payload: &str) -> Result<(), String> {
    let enc_category = encrypt_data_internal(&state, category)?;
    let enc_title = encrypt_data_internal(&state, title)?;
    let enc_username = encrypt_data_internal(&state, username)?;
    let enc_payload = encrypt_data_internal(&state, payload)?;
    
    let conn = get_db_conn(&state)?;
    conn.execute(
        "INSERT INTO items (id, category, title, username, encrypted_payload)
VALUES (?1, ?2, ?3, ?4, ?5)
ON CONFLICT(id) DO UPDATE SET
    category = excluded.category,
    title = excluded.title,
    username = excluded.username,
    encrypted_payload = excluded.encrypted_payload",
        params![id, enc_category, enc_title, enc_username, enc_payload],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

fn encrypt_data_internal(state: &State<AppState>, payload: &str) -> Result<String, String> {
    let guard = state.master_key.lock().unwrap();
    let mk = guard.as_ref().ok_or("Vault is locked")?;
    encrypt_data_with_key(&**mk, payload)
}

fn encrypt_data_with_key(key_bytes: &[u8; 32], payload: &str) -> Result<String, String> {
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    
    use aes_gcm::aead::AeadCore;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);

    let ciphertext = cipher
        .encrypt(&nonce, payload.as_bytes())
        .map_err(|e| e.to_string())?;
        
    let mut combined = nonce.to_vec();
    combined.extend(ciphertext);
    Ok(hex::encode(combined))
}

#[tauri::command]
fn decrypt_data(state: State<AppState>, encrypted_hex: &str) -> Result<String, String> {
    let guard = state.master_key.lock().unwrap();
    let mk = guard.as_ref().ok_or("Vault is locked")?;
    decrypt_data_with_key(&**mk, encrypted_hex)
}

fn decrypt_data_with_key(key_bytes: &[u8; 32], encrypted_hex: &str) -> Result<String, String> {
    let combined = hex::decode(encrypted_hex).map_err(|e| e.to_string())?;
    if combined.len() < 12 {
        return Err("Invalid ciphertext".into());
    }
    
    let nonce = Nonce::from_slice(&combined[0..12]);
    let ciphertext = &combined[12..];
    
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| e.to_string())?;
        
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

#[tauri::command]
fn change_password(state: State<AppState>, new_password: &str) -> Result<(), String> {
    let conn = get_db_conn(&state)?;
    let salt: String = conn.query_row("SELECT salt FROM vaults WHERE id = 'default'", [], |row| row.get(0))
        .map_err(|_| "Vault not found".to_string())?;
        
    let current_dek = state.master_key.lock().unwrap().clone().ok_or("Not unlocked")?;
    let dek_hex = hex::encode(&*current_dek);
    
    let pwd_key = derive_key_internal(new_password, &salt)?;
    let enc_dek_pwd = encrypt_data_with_key(&pwd_key, &dek_hex)?;
    
    conn.execute(
        "UPDATE vaults SET enc_dek_pwd = ?1 WHERE id = 'default'",
        params![enc_dek_pwd],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn delete_item(state: State<AppState>, id: &str) -> Result<(), String> {
    let conn = get_db_conn(&state)?;
    conn.execute("DELETE FROM items WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn reset_vault(app_handle: AppHandle) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("vaultzero.db");
    if db_path.exists() {
        std::fs::remove_file(db_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn export_vault_data(app_handle: AppHandle) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("vaultzero.db");
    
    let mut file = fs::File::open(db_path).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
    
    Ok(STANDARD.encode(buffer))
}

#[tauri::command]
fn import_vault_data(app_handle: AppHandle, base64_data: &str) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let db_path = app_dir.join("vaultzero.db");
    
    let decoded = STANDARD.decode(base64_data).map_err(|e| e.to_string())?;
    fs::write(db_path, decoded).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_tags(state: State<AppState>) -> Result<Vec<(String, String)>, String> {
    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare("SELECT id, name FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
fn create_tag(state: State<AppState>, id: &str, name: &str) -> Result<(), String> {
    if !is_unlocked(state.clone()) {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    conn.execute(
        "INSERT OR IGNORE INTO tags (id, name) VALUES (?1, ?2)",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_tag(state: State<AppState>, id: &str) -> Result<(), String> {
    if !is_unlocked(state.clone()) {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_item_tags(state: State<AppState>, item_id: &str) -> Result<Vec<(String, String)>, String> {
    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name FROM tags t
             JOIN item_tags it ON t.id = it.tag_id
             WHERE it.item_id = ?1 ORDER BY t.name",
        )
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_map(params![item_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
fn set_item_tags(
    state: State<AppState>,
    item_id: &str,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    if !is_unlocked(state.clone()) {
        return Err("Vault is locked".into());
    }
    let mut conn = get_db_conn(&state)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM item_tags WHERE item_id = ?1", params![item_id])
        .map_err(|e| e.to_string())?;
    for tag_id in &tag_ids {
        tx.execute(
            "INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
            params![item_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_favorite(state: State<AppState>, id: &str) -> Result<bool, String> {
    if !is_unlocked(state.clone()) {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    let current: i64 = conn
        .query_row(
            "SELECT is_favorite FROM items WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Item not found".to_string())?;
    let new_val = if current == 0 { 1i64 } else { 0i64 };
    conn.execute(
        "UPDATE items SET is_favorite = ?1 WHERE id = ?2",
        params![new_val, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_val == 1)
}

#[tauri::command]
fn add_attachment(
    state: State<AppState>,
    id: &str,
    item_id: &str,
    filename: &str,
    data_b64: &str,
) -> Result<(), String> {
    if !is_unlocked(state.clone()) {
        return Err("Vault is locked".into());
    }
    let encrypted = encrypt_data_internal(&state, data_b64)?;
    let conn = get_db_conn(&state)?;
    conn.execute(
        "INSERT OR REPLACE INTO attachments (id, item_id, filename, encrypted_bytes) VALUES (?1, ?2, ?3, ?4)",
        params![id, item_id, filename, encrypted],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_attachments(
    state: State<AppState>,
    item_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare("SELECT id, filename FROM attachments WHERE item_id = ?1")
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_map(params![item_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
fn get_attachment_data(state: State<AppState>, id: &str) -> Result<String, String> {
    let conn = get_db_conn(&state)?;
    let encrypted: String = conn
        .query_row(
            "SELECT encrypted_bytes FROM attachments WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Attachment not found".to_string())?;
    decrypt_data_internal(&state, &encrypted)
}

#[tauri::command]
fn delete_attachment(state: State<AppState>, id: &str) -> Result<(), String> {
    if !is_unlocked(state.clone()) {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            master_key: Mutex::new(None),
            db_path: Mutex::new(None),
            google_oauth_state: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            check_vault_exists,
            create_vault,
            unlock_vault,
            lock_vault,
            is_unlocked,
            get_items,
            add_item,
            decrypt_data,
            delete_item,
            reset_vault,
            change_password,
            recover_vault,
            export_vault_data,
            import_vault_data,
            get_tags,
            create_tag,
            delete_tag,
            get_item_tags,
            set_item_tags,
            toggle_favorite,
            add_attachment,
            get_attachments,
            get_attachment_data,
            delete_attachment,
            sync::get_sync_configs,
            sync::save_sync_config,
            sync::delete_sync_config,
            sync::trigger_sync,
            sync::get_last_sync_status,
            sync::google_drive::start_google_oauth,
            sync::google_drive::complete_google_oauth,
            sync::google_drive::disconnect_google_drive,
            import_export::export_items,
            import_export::import_sdpx,
            import_export::import_bitwarden_csv,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
