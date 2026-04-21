use argon2::password_hash::{
    rand_core::{OsRng as ArgonOsRng, RngCore},
    SaltString,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    decrypt_data_with_key, derive_key_internal, encrypt_data_with_key, get_db_conn, AppState,
};

#[derive(Serialize, Deserialize, Clone)]
struct CustomField {
    id: String,
    label: String,
    value: String,
    #[serde(rename = "type")]
    field_type: String,
}

#[derive(Serialize, Deserialize)]
struct DecryptedPayload {
    fields: Vec<CustomField>,
    #[serde(default)]
    notes: String,
}

#[derive(Serialize, Deserialize)]
struct ExportItem {
    id: String,
    category: String,
    title: String,
    username: String,
    is_favorite: bool,
    fields: Vec<CustomField>,
    #[serde(default)]
    notes: String,
}

#[derive(Serialize, Deserialize)]
struct SdpxFile {
    version: u32,
    salt: String,
    data: String,
}

fn new_id() -> String {
    let mut bytes = [0u8; 16];
    ArgonOsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut fields = Vec::new();
        let mut current = String::new();
        let mut in_quotes = false;
        let mut chars = line.chars().peekable();
        while let Some(ch) = chars.next() {
            match ch {
                '"' if !in_quotes => in_quotes = true,
                '"' if in_quotes => {
                    if chars.peek() == Some(&'"') {
                        chars.next();
                        current.push('"');
                    } else {
                        in_quotes = false;
                    }
                }
                ',' if !in_quotes => {
                    fields.push(current.clone());
                    current.clear();
                }
                _ => current.push(ch),
            }
        }
        fields.push(current);
        rows.push(fields);
    }
    rows
}

fn insert_item(
    conn: &rusqlite::Connection,
    master_key: &[u8; 32],
    item: &ExportItem,
) -> Result<(), String> {
    let payload = DecryptedPayload {
        fields: item.fields.clone(),
        notes: item.notes.clone(),
    };
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let enc_payload = encrypt_data_with_key(master_key, &payload_json)?;
    let enc_category = encrypt_data_with_key(master_key, &item.category)?;
    let enc_title = encrypt_data_with_key(master_key, &item.title)?;
    let enc_username = encrypt_data_with_key(master_key, &item.username)?;
    conn.execute(
        "INSERT INTO items (id, category, title, username, encrypted_payload, is_favorite)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            item.id,
            enc_category,
            enc_title,
            enc_username,
            enc_payload,
            item.is_favorite as i64
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_items(state: State<AppState>, password: String) -> Result<String, String> {
    let guard = state.master_key.lock().map_err(|_| "Lock poisoned")?;
    let master_key = guard.as_ref().ok_or("Vault is locked")?;

    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, category, title, username, encrypted_payload, is_favorite FROM items",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, String, String, String, i64)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    let mut items: Vec<ExportItem> = Vec::new();
    for (id, enc_cat, enc_title, enc_user, enc_payload, is_fav) in rows {
        let category = decrypt_data_with_key(master_key, &enc_cat)?;
        let title = decrypt_data_with_key(master_key, &enc_title)?;
        let username = decrypt_data_with_key(master_key, &enc_user)?;
        let payload_json = decrypt_data_with_key(master_key, &enc_payload)?;
        let payload: DecryptedPayload =
            serde_json::from_str(&payload_json).map_err(|e| e.to_string())?;
        items.push(ExportItem {
            id,
            category,
            title,
            username,
            is_favorite: is_fav == 1,
            fields: payload.fields,
            notes: payload.notes,
        });
    }

    let json = serde_json::to_string(&items).map_err(|e| e.to_string())?;
    let salt = SaltString::generate(&mut ArgonOsRng);
    let export_key = derive_key_internal(&password, salt.as_str())?;
    let enc_hex = encrypt_data_with_key(&*export_key, &json)?;

    let sdpx = SdpxFile {
        version: 1,
        salt: salt.as_str().to_string(),
        data: enc_hex,
    };
    let sdpx_json = serde_json::to_string(&sdpx).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(sdpx_json.as_bytes()))
}

#[tauri::command]
pub fn import_sdpx(
    state: State<AppState>,
    data_base64: String,
    password: String,
) -> Result<usize, String> {
    let guard = state.master_key.lock().map_err(|_| "Lock poisoned")?;
    let master_key = **guard.as_ref().ok_or("Vault is locked")?;
    drop(guard);

    let sdpx_bytes = STANDARD.decode(&data_base64).map_err(|e| e.to_string())?;
    let sdpx_json = String::from_utf8(sdpx_bytes).map_err(|e| e.to_string())?;
    let sdpx: SdpxFile = serde_json::from_str(&sdpx_json).map_err(|e| e.to_string())?;

    let export_key = derive_key_internal(&password, &sdpx.salt)?;
    let json = decrypt_data_with_key(&*export_key, &sdpx.data)?;
    let mut items: Vec<ExportItem> = serde_json::from_str(&json).map_err(|e| e.to_string())?;

    for item in &mut items {
        item.id = new_id();
    }

    let conn = get_db_conn(&state)?;
    let count = items.len();
    for item in &items {
        insert_item(&conn, &master_key, item)?;
    }
    Ok(count)
}

#[tauri::command]
pub fn import_bitwarden_csv(state: State<AppState>, csv_text: String) -> Result<usize, String> {
    let guard = state.master_key.lock().map_err(|_| "Lock poisoned")?;
    let master_key = **guard.as_ref().ok_or("Vault is locked")?;
    drop(guard);

    let rows = parse_csv(&csv_text);
    if rows.is_empty() {
        return Ok(0);
    }

    let headers = &rows[0];
    let col = |row: &Vec<String>, name: &str| -> String {
        headers
            .iter()
            .position(|h| h == name)
            .and_then(|i| row.get(i))
            .cloned()
            .unwrap_or_default()
    };

    let conn = get_db_conn(&state)?;
    let mut count = 0;

    for row in rows.iter().skip(1) {
        let item_type = col(row, "type");
        let name = col(row, "name");
        if name.is_empty() {
            continue;
        }
        let notes = col(row, "notes");

        let (category, fields, username) = match item_type.as_str() {
            "login" => {
                let uname = col(row, "login_username");
                let pwd = col(row, "login_password");
                let uri = col(row, "login_uri");
                let totp = col(row, "login_totp");
                let mut fields = Vec::new();
                if !uname.is_empty() {
                    fields.push(CustomField {
                        id: new_id(),
                        label: "Benutzername".into(),
                        value: uname.clone(),
                        field_type: "text".into(),
                    });
                }
                if !pwd.is_empty() {
                    fields.push(CustomField {
                        id: new_id(),
                        label: "Passwort".into(),
                        value: pwd,
                        field_type: "password".into(),
                    });
                }
                if !uri.is_empty() {
                    fields.push(CustomField {
                        id: new_id(),
                        label: "Website".into(),
                        value: uri,
                        field_type: "url".into(),
                    });
                }
                if !totp.is_empty() {
                    fields.push(CustomField {
                        id: new_id(),
                        label: "Einmalpasswort".into(),
                        value: totp,
                        field_type: "totp".into(),
                    });
                }
                ("login".to_string(), fields, uname)
            }
            "card" => {
                let holder = col(row, "card_cardholderName");
                let number = col(row, "card_number");
                let exp_m = col(row, "card_expMonth");
                let exp_y = col(row, "card_expYear");
                let code = col(row, "card_code");
                let mut fields = Vec::new();
                if !holder.is_empty() {
                    fields.push(CustomField {
                        id: new_id(),
                        label: "Karteninhaber".into(),
                        value: holder,
                        field_type: "text".into(),
                    });
                }
                if !number.is_empty() {
                    fields.push(CustomField {
                        id: new_id(),
                        label: "Kartennummer".into(),
                        value: number,
                        field_type: "text".into(),
                    });
                }
                let exp = format!("{}/{}", exp_m, exp_y);
                if exp != "/" {
                    fields.push(CustomField {
                        id: new_id(),
                        label: "Ablaufdatum".into(),
                        value: exp,
                        field_type: "text".into(),
                    });
                }
                if !code.is_empty() {
                    fields.push(CustomField {
                        id: new_id(),
                        label: "Prüfnummer (CVV)".into(),
                        value: code,
                        field_type: "password".into(),
                    });
                }
                ("finance".to_string(), fields, String::new())
            }
            _ => ("note".to_string(), Vec::new(), String::new()),
        };

        let item = ExportItem {
            id: new_id(),
            category,
            title: name,
            username,
            is_favorite: false,
            fields,
            notes,
        };
        insert_item(&conn, &master_key, &item)?;
        count += 1;
    }
    Ok(count)
}
