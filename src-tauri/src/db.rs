use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;

use crate::crypto;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VaultMeta {
    pub id: String,
    pub created_at: i64,
    pub argon2_mem: u32,
    pub argon2_ops: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ItemWithPayload {
    pub id: String,
    pub category: String,
    pub updated_at: i64,
    pub payload: ItemPayload,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ItemPayload {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: String,
    pub notes: String,
    #[serde(default)]
    pub fields: Vec<CustomField>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomField {
    pub label: String,
    pub value: String,
}

/// Öffnet (oder erstellt) eine SQLCipher-Datenbank. Der Key MUSS gesetzt werden
/// bevor irgendeine andere Operation ausgeführt wird.
pub fn open_db(path: &Path, sqlcipher_key: &[u8; 32]) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;

    let key_hex = hex::encode(sqlcipher_key.as_ref());
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";\n", key_hex))
        .map_err(|e| format!("SQLCipher Key-Fehler: {}", e))?;

    // Verify: Query schlägt fehl wenn Key falsch
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|_| "Falscher Master Key oder korrupte Datenbank".to_string())?;

    ensure_schema(&conn)?;
    Ok(conn)
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS vault_meta (
            id           TEXT PRIMARY KEY,
            created_at   INTEGER NOT NULL,
            argon2_salt  BLOB NOT NULL,
            argon2_ops   INTEGER NOT NULL,
            argon2_mem   INTEGER NOT NULL,
            version      INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS items (
            id              TEXT PRIMARY KEY,
            category        TEXT NOT NULL,
            updated_at      INTEGER NOT NULL,
            sync_hash       TEXT NOT NULL,
            encrypted_blob  BLOB NOT NULL
        );",
    )
    .map_err(|e| e.to_string())
}

/// Legt einen neuen vault_meta-Eintrag an. Nur einmal beim Vault-Erstellen aufrufen.
pub fn init_vault_meta(
    conn: &Connection,
    vault_id: &str,
    salt: &[u8; 32],
) -> Result<VaultMeta, String> {
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO vault_meta (id, created_at, argon2_salt, argon2_ops, argon2_mem, version)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        params![vault_id, now, salt.as_ref(), crypto::ARGON2_OPS, crypto::ARGON2_MEM_KB],
    )
    .map_err(|e| e.to_string())?;

    Ok(VaultMeta {
        id: vault_id.to_string(),
        created_at: now,
        argon2_mem: crypto::ARGON2_MEM_KB,
        argon2_ops: crypto::ARGON2_OPS,
    })
}

/// Liest vault_meta (für die UI nach dem Unlock).
pub fn read_vault_meta(conn: &Connection) -> Result<VaultMeta, String> {
    conn.query_row(
        "SELECT id, created_at, argon2_ops, argon2_mem FROM vault_meta LIMIT 1",
        [],
        |row| {
            Ok(VaultMeta {
                id: row.get(0)?,
                created_at: row.get(1)?,
                argon2_ops: row.get(2)?,
                argon2_mem: row.get(3)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

/// Fügt einen verschlüsselten Eintrag ein. Gibt die neue ID zurück.
pub fn insert_item(
    conn: &Connection,
    entry_key: &[u8; 32],
    category: &str,
    payload: &ItemPayload,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let json = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
    let blob = crypto::encrypt(entry_key, &json)?;
    let hash = hex::encode(Sha256::digest(&blob));

    conn.execute(
        "INSERT INTO items (id, category, updated_at, sync_hash, encrypted_blob)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, category, now, hash, blob],
    )
    .map_err(|e| e.to_string())?;

    Ok(id)
}

/// Aktualisiert den verschlüsselten Payload eines Eintrags.
pub fn update_item(
    conn: &Connection,
    entry_key: &[u8; 32],
    id: &str,
    payload: &ItemPayload,
) -> Result<(), String> {
    let now = Utc::now().timestamp();
    let json = serde_json::to_vec(payload).map_err(|e| e.to_string())?;
    let blob = crypto::encrypt(entry_key, &json)?;
    let hash = hex::encode(Sha256::digest(&blob));

    conn.execute(
        "UPDATE items SET updated_at = ?1, sync_hash = ?2, encrypted_blob = ?3 WHERE id = ?4",
        params![now, hash, blob, id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Löscht einen Eintrag nach ID.
pub fn delete_item(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM items WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Gibt alle Einträge entschlüsselt zurück, optional nach Kategorie gefiltert.
pub fn get_items(
    conn: &Connection,
    entry_key: &[u8; 32],
    category: Option<&str>,
) -> Result<Vec<ItemWithPayload>, String> {
    let sql_all = "SELECT id, category, updated_at, encrypted_blob FROM items ORDER BY updated_at DESC";
    let sql_cat = "SELECT id, category, updated_at, encrypted_blob FROM items WHERE category = ?1 ORDER BY updated_at DESC";

    let mut stmt = match category {
        Some(_) => conn.prepare(sql_cat),
        None => conn.prepare(sql_all),
    }
    .map_err(|e| e.to_string())?;

    let mut rows = match category {
        Some(cat) => stmt.query(params![cat]),
        None => stmt.query([]),
    }
    .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let blob: Vec<u8> = row.get(3).map_err(|e| e.to_string())?;
        let plaintext = crypto::decrypt(entry_key, &blob)?;
        let payload: ItemPayload =
            serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;

        items.push(ItemWithPayload {
            id: row.get(0).map_err(|e| e.to_string())?,
            category: row.get(1).map_err(|e| e.to_string())?,
            updated_at: row.get(2).map_err(|e| e.to_string())?,
            payload,
        });
    }

    Ok(items)
}
