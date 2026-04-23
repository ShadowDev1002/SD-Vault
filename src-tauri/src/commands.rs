use chrono::{Datelike, Utc};
use printpdf::{BuiltinFont, Mm, PdfDocument};
use zeroize::Zeroize;
use crate::db::{ItemPayload, ItemWithPayload, VaultMeta};
use crate::AppState;
use std::fs;
use std::io::{Read, Write};
use tauri::State;

use crate::sync::config::{SftpConfig, SyncConfig};
use crate::sync::local::LocalBackupProvider;
use crate::sync::sftp::SftpProvider;
use crate::sync::{BackupEntry, SyncProvider};

use super::{get_vault_dir, db_path, write_salt, read_salt, write_secret_key, read_secret_key,
            write_recovery_wrap, read_recovery_wrap, write_kdf_params, read_kdf_params, KdfParams};

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
pub async fn create_vault(
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

    let kdf = KdfParams {
        mem_kb:  crate::crypto::ARGON2_MEM_KB,
        ops:     crate::crypto::ARGON2_OPS,
        threads: crate::crypto::ARGON2_THREADS,
    };
    write_kdf_params(&kdf)?;

    // Argon2id auf Blocking-Thread — blockiert nicht den UI-Thread
    let master_key = tokio::task::spawn_blocking(move || {
        crate::crypto::derive_master_key(&master_pw, &secret_key_bytes, &salt,
                                         kdf.mem_kb, kdf.ops, kdf.threads)
    }).await.map_err(|e| e.to_string())??;

    let sqlcipher_key = crate::crypto::derive_sqlcipher_key(&*master_key);
    let conn = crate::db::open_db(&db_path, &*sqlcipher_key)?;

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
pub async fn unlock_vault(
    state: State<'_, AppState>,
    master_pw: String,
) -> Result<VaultMeta, String> {
    let db_path = db_path()?;
    if !db_path.exists() {
        return Err("Kein Vault gefunden. Bitte zuerst einen neuen Vault erstellen.".into());
    }

    let secret_key_bytes = read_secret_key()?;
    let salt = read_salt()?;
    let kdf = read_kdf_params();

    // Argon2id auf Blocking-Thread
    let master_key = tokio::task::spawn_blocking(move || {
        crate::crypto::derive_master_key(&master_pw, &secret_key_bytes, &salt,
                                         kdf.mem_kb, kdf.ops, kdf.threads)
    }).await.map_err(|e| e.to_string())??;

    let sqlcipher_key = crate::crypto::derive_sqlcipher_key(&*master_key);
    let conn = crate::db::open_db(&db_path, &*sqlcipher_key)?;
    let meta = crate::db::read_vault_meta(&conn)?;

    // Migration: Recovery-Datei erstellen falls noch nicht vorhanden
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
pub async fn reset_master_password(
    secret_key_formatted: String,
    new_master_pw: String,
) -> Result<(), String> {
    let provided_bytes = crate::crypto::parse_secret_key(&secret_key_formatted)?;
    let stored_bytes = read_secret_key()?;
    if provided_bytes != stored_bytes {
        return Err("Ungültiger Secret Key — stimmt nicht mit diesem Vault überein".into());
    }

    let recovery_key = crate::crypto::derive_recovery_key(&stored_bytes);
    let wrapped = read_recovery_wrap()?;
    let old_master_key = crate::crypto::unwrap_key(&recovery_key, &wrapped)?;

    let old_sqlcipher_key = crate::crypto::derive_sqlcipher_key(&*old_master_key);
    let db_path = db_path()?;
    let conn = crate::db::open_db(&db_path, &*old_sqlcipher_key)?;

    let new_salt = crate::crypto::generate_salt();
    let kdf = read_kdf_params();

    // Neuer Master Key auf Blocking-Thread
    let new_master_key = tokio::task::spawn_blocking(move || {
        crate::crypto::derive_master_key(&new_master_pw, &stored_bytes, &new_salt,
                                         kdf.mem_kb, kdf.ops, kdf.threads)
    }).await.map_err(|e| e.to_string())??;

    let new_sqlcipher_key = crate::crypto::derive_sqlcipher_key(&*new_master_key);
    conn.execute_batch(&format!(
        "PRAGMA rekey = \"x'{}'\";",
        hex::encode(new_sqlcipher_key.as_ref())
    )).map_err(|e| format!("Rekey fehlgeschlagen: {}", e))?;

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

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open::that_detached(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_webdav(state: State<'_, AppState>) -> Result<(), String> {
    let vault_dir = state.vault_dir.lock().unwrap().clone().ok_or("Vault ist gesperrt")?;
    let config = crate::sync::config::SyncConfig::load(&vault_dir.join("sync_config.toml"))?;
    let webdav_config = config.webdav.ok_or("Keine WebDAV-Konfiguration gefunden")?;
    let data = fs::read(vault_dir.join("vault.db")).map_err(|e| e.to_string())?;
    crate::sync::webdav::WebDavProvider::new(webdav_config)
        .upload(&data, "vault.db")
        .await
}

#[tauri::command]
pub fn save_webdav_config(
    state: State<'_, AppState>,
    webdav_config: crate::sync::config::WebDavConfig,
) -> Result<(), String> {
    let vault_dir = state.vault_dir.lock().unwrap().clone().ok_or("Vault ist gesperrt")?;
    let config_path = vault_dir.join("sync_config.toml");
    let mut config = crate::sync::config::SyncConfig::load(&config_path).unwrap_or_default();
    config.webdav = Some(webdav_config);
    config.save(&config_path)
}

#[tauri::command]
pub fn get_attachments(
    state: State<'_, AppState>,
    item_id: String,
) -> Result<Vec<crate::db::AttachmentMeta>, String> {
    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;
    crate::db::get_attachments(conn, &item_id)
}

#[tauri::command]
pub fn add_attachment(
    state: State<'_, AppState>,
    item_id: String,
    name: String,
    mime: String,
    data: Vec<u8>,
) -> Result<String, String> {
    if data.len() > 10 * 1024 * 1024 {
        return Err("Anhang zu groß (max. 10 MB)".into());
    }
    let key_guard = state.master_key.lock().unwrap();
    let master_key = key_guard.as_ref().ok_or("Vault ist gesperrt")?;
    let entry_key = crate::crypto::derive_entry_key(master_key);
    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;
    crate::db::insert_attachment(conn, &entry_key, &item_id, &name, &mime, &data)
}

#[tauri::command]
pub fn get_attachment_data(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<u8>, String> {
    let key_guard = state.master_key.lock().unwrap();
    let master_key = key_guard.as_ref().ok_or("Vault ist gesperrt")?;
    let entry_key = crate::crypto::derive_entry_key(master_key);
    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;
    crate::db::get_attachment_data(conn, &entry_key, &id)
}

#[tauri::command]
pub fn delete_attachment(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;
    crate::db::delete_attachment(conn, &id)
}

#[tauri::command]
pub fn export_entry_pdf(
    state: State<'_, AppState>,
    id: String,
    save_path: String,
) -> Result<(), String> {
    let key_guard = state.master_key.lock().unwrap();
    let master_key = key_guard.as_ref().ok_or("Vault ist gesperrt")?;
    let entry_key = crate::crypto::derive_entry_key(master_key);
    let conn_guard = state.db_conn.lock().unwrap();
    let conn = conn_guard.as_ref().ok_or("Vault ist gesperrt")?;

    let items = crate::db::get_items(conn, &entry_key, None)?;
    let item = items.into_iter().find(|i| i.id == id)
        .ok_or("Eintrag nicht gefunden")?;
    let p = &item.payload;

    let (doc, page1, layer1) = PdfDocument::new("SD-Vault Export", Mm(210.0), Mm(297.0), "Layer 1");
    let layer = doc.get_page(page1).get_layer(layer1);
    let font = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| e.to_string())?;
    let font_reg = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| e.to_string())?;

    let mut y = 270.0f32;

    layer.use_text("SD-Vault — Eintrag Export", 16.0, Mm(20.0), Mm(y), &font);
    y -= 8.0;
    layer.use_text(
        &format!("Erstellt: {}", Utc::now().format("%d.%m.%Y %H:%M UTC")),
        9.0, Mm(20.0), Mm(y), &font_reg,
    );
    y -= 15.0;

    layer.use_text(&format!("Titel: {}", p.title), 13.0, Mm(20.0), Mm(y), &font);
    y -= 8.0;
    layer.use_text(&format!("Kategorie: {}", item.category), 10.0, Mm(20.0), Mm(y), &font_reg);
    y -= 12.0;

    let card_last4 = if p.card_number.len() >= 4 {
        format!("**** {}", &p.card_number[p.card_number.len()-4..])
    } else {
        p.card_number.clone()
    };

    let fields: &[(&str, &str)] = &[
        ("Benutzername",   &p.username),
        ("URL",            &p.url),
        ("E-Mail",         &p.email),
        ("Karteninhaber",  &p.cardholder),
        ("Kartennummer",   &card_last4),
        ("Ablaufdatum",    &p.expiry),
        ("Vorname",        &p.first_name),
        ("Nachname",       &p.last_name),
        ("Telefon",        &p.phone),
        ("Unternehmen",    &p.company),
        ("Position",       &p.job_title),
        ("Adresse",        &p.address),
        ("Stadt",          &p.city),
        ("PLZ",            &p.zip),
        ("Land",           &p.country),
        ("Geburtstag",     &p.birthday),
    ];

    for (label, value) in fields {
        if value.is_empty() { continue; }
        layer.use_text(&format!("{}: {}", label, value), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 7.0;
        if y < 20.0 { break; }
    }

    if !p.notes.is_empty() {
        y -= 3.0;
        layer.use_text("Notizen:", 10.0, Mm(20.0), Mm(y), &font);
        y -= 7.0;
        for line in p.notes.lines().take(20) {
            if y < 20.0 { break; }
            layer.use_text(line, 9.0, Mm(20.0), Mm(y), &font_reg);
            y -= 6.0;
        }
    }

    layer.use_text(
        "Dieses Dokument enthalt sensible Daten — sicher aufbewahren.",
        8.0, Mm(20.0), Mm(12.0), &font_reg,
    );

    doc.save(&mut std::io::BufWriter::new(
        fs::File::create(&save_path).map_err(|e| e.to_string())?
    )).map_err(|e| e.to_string())?;

    Ok(())
}

/// Exportiert den gesamten Vault als .sdpx-Datei (ZIP mit allen nötigen Vault-Dateien).
/// Die vault.db ist bereits AES-256-GCM-verschlüsselt; vault.secret + vault.salt werden mitgepackt.
/// Der Empfänger braucht das Master-Passwort um den Vault zu entschlüsseln.
#[tauri::command]
pub fn export_vault(save_path: String) -> Result<(), String> {
    let vault_dir = get_vault_dir()?;

    let files = [
        ("vault.db",       vault_dir.join("vault.db")),
        ("vault.secret",   vault_dir.join("vault.secret")),
        ("vault.salt",     vault_dir.join("vault.salt")),
        ("vault.recovery", vault_dir.join("vault.recovery")),
        ("vault.kdf",      vault_dir.join("vault.kdf")),
    ];

    let out_file = fs::File::create(&save_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(out_file);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for (name, path) in &files {
        if !path.exists() { continue; }
        let data = fs::read(path).map_err(|e| format!("{name}: {e}"))?;
        zip.start_file(*name, opts).map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Importiert einen Vault aus einer .sdpx-Datei. Überschreibt keinen bestehenden Vault.
#[tauri::command]
pub fn import_vault(sdpx_path: String) -> Result<(), String> {
    let vault_dir = get_vault_dir()?;

    if vault_dir.join("vault.db").exists() {
        return Err("Es existiert bereits ein Vault. Bitte zuerst die App zurücksetzen.".into());
    }

    let file = fs::File::open(&sdpx_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        let allowed = ["vault.db", "vault.secret", "vault.salt", "vault.recovery", "vault.kdf"];
        if !allowed.contains(&name.as_str()) { continue; }

        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        fs::write(vault_dir.join(&name), &data).map_err(|e| e.to_string())?;
    }

    Ok(())
}
