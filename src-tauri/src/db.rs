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
    pub is_favorite: bool,
    pub payload: ItemPayload,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ItemPayload {
    // Universal
    pub title: String,
    #[serde(default)] pub notes: String,
    #[serde(default)] pub favorite: bool,
    #[serde(default)] pub fields: Vec<CustomField>,

    // Login
    #[serde(default)] pub username: String,
    #[serde(default)] pub password: String,
    #[serde(default)] pub url: String,
    #[serde(default)] pub totp: String,

    // Card
    #[serde(default)] pub cardholder: String,
    #[serde(default)] pub card_number: String,
    #[serde(default)] pub expiry: String,
    #[serde(default)] pub cvv: String,
    #[serde(default)] pub pin: String,

    // Identity
    #[serde(default)] pub first_name: String,
    #[serde(default)] pub last_name: String,
    #[serde(default)] pub email: String,
    #[serde(default)] pub phone: String,
    #[serde(default)] pub company: String,
    #[serde(default)] pub job_title: String,
    #[serde(default)] pub address: String,
    #[serde(default)] pub city: String,
    #[serde(default)] pub zip: String,
    #[serde(default)] pub country: String,
    #[serde(default)] pub birthday: String,

    // v1.1.0
    #[serde(default)] pub tags: Vec<String>,
    #[serde(default)] pub totp_backup_codes: Vec<String>,
    #[serde(default)] pub card_expiry_reminder: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CustomField {
    #[serde(default)] pub id: String,
    pub label: String,
    pub value: String,
    #[serde(default)] pub field_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentMeta {
    pub id: String,
    pub item_id: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
}

pub fn insert_attachment(
    conn: &Connection,
    entry_key: &[u8; 32],
    item_id: &str,
    name: &str,
    mime: &str,
    data: &[u8],
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let blob = crypto::encrypt(entry_key, data)?;
    conn.execute(
        "INSERT INTO attachments (id, item_id, name, mime, size, encrypted_blob) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, item_id, name, mime, data.len() as i64, blob],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn get_attachments(conn: &Connection, item_id: &str) -> Result<Vec<AttachmentMeta>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, item_id, name, mime, size FROM attachments WHERE item_id = ?1 ORDER BY rowid ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![item_id], |row| Ok(AttachmentMeta {
        id: row.get(0)?,
        item_id: row.get(1)?,
        name: row.get(2)?,
        mime: row.get(3)?,
        size: row.get(4)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_attachment_data(
    conn: &Connection,
    entry_key: &[u8; 32],
    id: &str,
) -> Result<Vec<u8>, String> {
    let blob: Vec<u8> = conn.query_row(
        "SELECT encrypted_blob FROM attachments WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    crypto::decrypt(entry_key, &blob)
}

pub fn delete_attachment(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
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
            encrypted_blob  BLOB NOT NULL,
            is_favorite     INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS attachments (
            id              TEXT PRIMARY KEY,
            item_id         TEXT NOT NULL,
            name            TEXT NOT NULL,
            mime            TEXT NOT NULL DEFAULT '',
            size            INTEGER NOT NULL,
            encrypted_blob  BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS item_tags (
            item_id         TEXT NOT NULL,
            tag             TEXT NOT NULL,
            PRIMARY KEY (item_id, tag)
        );",
    )
    .map_err(|e| e.to_string())?;

    // Migrations für bestehende Vaults
    let _ = conn.execute_batch("ALTER TABLE items ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;");
    let _ = conn.execute_batch("CREATE TABLE IF NOT EXISTS item_tags (item_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (item_id, tag));");

    Ok(())
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

fn sync_item_metadata(conn: &Connection, id: &str, payload: &ItemPayload) -> Result<(), String> {
    let is_fav = payload.favorite as i64;
    conn.execute(
        "UPDATE items SET is_favorite = ?1 WHERE id = ?2",
        params![is_fav, id],
    ).map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM item_tags WHERE item_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    for tag in &payload.tags {
        conn.execute(
            "INSERT OR IGNORE INTO item_tags (item_id, tag) VALUES (?1, ?2)",
            params![id, tag],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    let is_fav = payload.favorite as i64;

    conn.execute(
        "INSERT INTO items (id, category, updated_at, sync_hash, encrypted_blob, is_favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, category, now, hash, blob, is_fav],
    )
    .map_err(|e| e.to_string())?;

    sync_item_metadata(conn, &id, payload)?;
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
    let is_fav = payload.favorite as i64;

    conn.execute(
        "UPDATE items SET updated_at = ?1, sync_hash = ?2, encrypted_blob = ?3, is_favorite = ?4 WHERE id = ?5",
        params![now, hash, blob, is_fav, id],
    )
    .map_err(|e| e.to_string())?;

    sync_item_metadata(conn, id, payload)?;
    Ok(())
}

/// Löscht einen Eintrag nach ID.
pub fn delete_item(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM item_tags WHERE item_id = ?1", params![id])
        .map_err(|e| e.to_string())?;
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
    let sql_all = "SELECT id, category, updated_at, encrypted_blob, is_favorite FROM items ORDER BY is_favorite DESC, updated_at DESC";
    let sql_cat = "SELECT id, category, updated_at, encrypted_blob, is_favorite FROM items WHERE category = ?1 ORDER BY is_favorite DESC, updated_at DESC";

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
        let is_favorite: i64 = row.get(4).unwrap_or(0);

        items.push(ItemWithPayload {
            id: row.get(0).map_err(|e| e.to_string())?,
            category: row.get(1).map_err(|e| e.to_string())?,
            updated_at: row.get(2).map_err(|e| e.to_string())?,
            is_favorite: is_favorite != 0,
            payload,
        });
    }

    Ok(items)
}

/// Gibt alle vorhandenen Tags zurück.
pub fn get_all_tags(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT DISTINCT tag FROM item_tags ORDER BY tag")
        .map_err(|e| e.to_string())?;
    let tags: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

/// Gibt alle Einträge mit einem bestimmten Tag zurück.
pub fn get_items_by_tag(
    conn: &Connection,
    entry_key: &[u8; 32],
    tag: &str,
) -> Result<Vec<ItemWithPayload>, String> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.category, i.updated_at, i.encrypted_blob, i.is_favorite
         FROM items i
         JOIN item_tags t ON t.item_id = i.id
         WHERE t.tag = ?1
         ORDER BY i.is_favorite DESC, i.updated_at DESC",
    ).map_err(|e| e.to_string())?;

    let mut rows = stmt.query(rusqlite::params![tag]).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let blob: Vec<u8> = row.get(3).map_err(|e| e.to_string())?;
        let plaintext = crypto::decrypt(entry_key, &blob)?;
        let payload: ItemPayload = serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;
        let is_favorite: i64 = row.get(4).unwrap_or(0);
        items.push(ItemWithPayload {
            id: row.get(0).map_err(|e| e.to_string())?,
            category: row.get(1).map_err(|e| e.to_string())?,
            updated_at: row.get(2).map_err(|e| e.to_string())?,
            is_favorite: is_favorite != 0,
            payload,
        });
    }
    Ok(items)
}
