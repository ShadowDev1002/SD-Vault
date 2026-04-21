use argon2::password_hash::rand_core::{OsRng as GDOsRng, RngCore};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::blocking::Client;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::State;

use crate::{encrypt_data_with_key, AppState, GoogleOAuthState};
use super::SyncProvider;

// ─── Hier eigene Google Cloud OAuth2-Credentials eintragen ─────────────────
const CLIENT_ID: &str = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const CLIENT_SECRET: &str = "YOUR_GOOGLE_CLIENT_SECRET";
// ───────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct GoogleCredentials {
    access_token: String,
    refresh_token: String,
    expires_at: i64,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn refresh_access_token(creds: &GoogleCredentials) -> Result<GoogleCredentials, String> {
    let client = Client::new();
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .json(&serde_json::json!({
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": creds.refresh_token,
            "grant_type": "refresh_token",
        }))
        .send()
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    if let Some(err) = json["error"].as_str() {
        return Err(format!("Token-Refresh fehlgeschlagen: {}", err));
    }
    let access_token = json["access_token"].as_str().ok_or("Kein access_token")?.to_string();
    let expires_in = json["expires_in"].as_i64().unwrap_or(3600);
    Ok(GoogleCredentials {
        access_token,
        refresh_token: creds.refresh_token.clone(),
        expires_at: now_secs() + expires_in,
    })
}

fn save_credentials_to_db(
    creds: &GoogleCredentials,
    master_key: &[u8; 32],
    db_path: &std::path::PathBuf,
) -> Result<(), String> {
    let creds_json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    let enc = encrypt_data_with_key(master_key, &creds_json)?;
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sync_config SET encrypted_credentials = ?1 WHERE id = 'google_drive'",
        params![enc],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub struct GoogleDriveProvider {
    access_token: String,
    file_id: Mutex<Option<String>>,
}

impl GoogleDriveProvider {
    pub fn from_creds_json(
        creds_json: &str,
        master_key: [u8; 32],
        db_path: &std::path::PathBuf,
    ) -> Result<Self, String> {
        let mut creds: GoogleCredentials = serde_json::from_str(creds_json)
            .map_err(|_| "Ungültige Google-Drive-Zugangsdaten")?;
        if creds.expires_at - now_secs() < 60 {
            creds = refresh_access_token(&creds)?;
            save_credentials_to_db(&creds, &master_key, db_path)?;
        }
        Ok(GoogleDriveProvider {
            access_token: creds.access_token,
            file_id: Mutex::new(None),
        })
    }
}

impl SyncProvider for GoogleDriveProvider {
    fn remote_hash(&self) -> Result<Option<String>, String> {
        let client = Client::new();
        let resp = client
            .get("https://www.googleapis.com/drive/v3/files")
            .query(&[
                ("spaces", "appDataFolder"),
                ("q", "name = 'vault.db'"),
                ("fields", "files(id,appProperties)"),
            ])
            .bearer_auth(&self.access_token)
            .send()
            .map_err(|e| e.to_string())?;
        let json: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        let files = json["files"].as_array().ok_or("Ungültige Drive-Antwort")?;
        if files.is_empty() {
            return Ok(None);
        }
        if let Some(id) = files[0]["id"].as_str() {
            *self.file_id.lock().unwrap() = Some(id.to_string());
        }
        Ok(files[0]["appProperties"]["sha256"].as_str().map(|s| s.to_string()))
    }

    fn upload(&self, vault_bytes: &[u8], hash: &str) -> Result<(), String> {
        let file_id = self.file_id.lock().unwrap().clone();
        let client = Client::new();
        let metadata = if file_id.is_none() {
            serde_json::json!({
                "name": "vault.db",
                "parents": ["appDataFolder"],
                "appProperties": { "sha256": hash }
            })
        } else {
            serde_json::json!({
                "name": "vault.db",
                "appProperties": { "sha256": hash }
            })
        }
        .to_string();

        let boundary = "sdpasswort_boundary_xXx";
        let mut body = format!(
            "--{}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{}\r\n--{}\r\nContent-Type: application/octet-stream\r\n\r\n",
            boundary, metadata, boundary
        )
        .into_bytes();
        body.extend_from_slice(vault_bytes);
        body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());

        let url = match &file_id {
            Some(id) => format!(
                "https://www.googleapis.com/upload/drive/v3/files/{}?uploadType=multipart",
                id
            ),
            None => {
                "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart".to_string()
            }
        };

        let req = if file_id.is_some() {
            client.patch(&url)
        } else {
            client.post(&url)
        };

        let resp = req
            .bearer_auth(&self.access_token)
            .header(
                "Content-Type",
                format!("multipart/related; boundary={}", boundary),
            )
            .body(body)
            .send()
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            return Err(format!("Upload fehlgeschlagen: HTTP {}", resp.status()));
        }

        if file_id.is_none() {
            let json: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
            if let Some(id) = json["id"].as_str() {
                *self.file_id.lock().unwrap() = Some(id.to_string());
            }
        }
        Ok(())
    }

    fn download(&self) -> Result<Vec<u8>, String> {
        let file_id = self
            .file_id
            .lock()
            .unwrap()
            .clone()
            .ok_or("Keine Datei auf Google Drive gefunden")?;
        let client = Client::new();
        let resp = client
            .get(&format!(
                "https://www.googleapis.com/drive/v3/files/{}?alt=media",
                file_id
            ))
            .bearer_auth(&self.access_token)
            .send()
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Download fehlgeschlagen: HTTP {}", resp.status()));
        }
        Ok(resp.bytes().map_err(|e| e.to_string())?.to_vec())
    }
}

#[tauri::command]
pub fn start_google_oauth(state: State<AppState>) -> Result<String, String> {
    if state.master_key.lock().map_err(|_| "Lock poisoned")?.is_none() {
        return Err("Vault is locked".into());
    }

    let mut verifier_bytes = [0u8; 32];
    GDOsRng.fill_bytes(&mut verifier_bytes);
    let code_verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    *state
        .google_oauth_state
        .lock()
        .map_err(|_| "Lock poisoned")? = Some(GoogleOAuthState {
        listener,
        code_verifier,
        port,
    });

    let redirect_uri = percent_encode(&format!("http://127.0.0.1:{}", port));
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
        ?client_id={}\
        &redirect_uri={}\
        &response_type=code\
        &scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.appdata\
        &code_challenge={}\
        &code_challenge_method=S256\
        &access_type=offline\
        &prompt=consent",
        CLIENT_ID, redirect_uri, code_challenge
    );
    Ok(auth_url)
}

#[tauri::command]
pub async fn complete_google_oauth(state: State<'_, AppState>) -> Result<(), String> {
    if state.master_key.lock().map_err(|_| "Lock poisoned")?.is_none() {
        return Err("Vault is locked".into());
    }

    let oauth = state
        .google_oauth_state
        .lock()
        .map_err(|_| "Lock poisoned")?
        .take()
        .ok_or("OAuth-Flow nicht gestartet. Bitte zuerst start_google_oauth aufrufen.")?;

    let master_key = **state
        .master_key
        .lock()
        .map_err(|_| "Lock poisoned")?
        .as_ref()
        .ok_or("Vault is locked")?;

    let db_path = state
        .db_path
        .lock()
        .unwrap()
        .clone()
        .ok_or("DB path not set")?;

    tauri::async_runtime::spawn_blocking(move || {
        oauth
            .listener
            .set_read_timeout(Some(std::time::Duration::from_secs(120)))
            .map_err(|e| e.to_string())?;
        let (mut stream, _) = oauth
            .listener
            .accept()
            .map_err(|e| format!("Timeout oder Verbindungsfehler beim Warten auf Browser: {}", e))?;

        use std::io::{Read, Write};
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n\
            <html><body style='font-family:sans-serif;text-align:center;padding:60px'>\
            <h2>Authentifizierung erfolgreich</h2>\
            <p>Du kannst diesen Tab schlie\xc3\x9fen.</p>\
            </body></html>",
        );

        let first_line = request.lines().next().unwrap_or("");
        let query = first_line
            .split('?')
            .nth(1)
            .unwrap_or("")
            .split(' ')
            .next()
            .unwrap_or("");
        let code = query
            .split('&')
            .find(|p| p.starts_with("code="))
            .and_then(|p| p.splitn(2, '=').nth(1))
            .ok_or("Kein Autorisierungs-Code in der Callback-URL gefunden")?
            .to_string();

        let redirect_uri = format!("http://127.0.0.1:{}", oauth.port);
        let client = Client::new();
        let resp = client
            .post("https://oauth2.googleapis.com/token")
            .json(&serde_json::json!({
                "code": code,
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": oauth.code_verifier,
            }))
            .send()
            .map_err(|e| e.to_string())?;

        let json: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
        if let Some(err) = json["error"].as_str() {
            return Err(format!(
                "Token-Fehler: {} — {}",
                err,
                json["error_description"].as_str().unwrap_or("")
            ));
        }

        let access_token = json["access_token"]
            .as_str()
            .ok_or("Kein access_token in Antwort")?
            .to_string();
        let refresh_token = json["refresh_token"]
            .as_str()
            .ok_or("Kein refresh_token in Antwort (access_type=offline gesetzt?)")?
            .to_string();
        let expires_in = json["expires_in"].as_i64().unwrap_or(3600);

        let creds = GoogleCredentials {
            access_token,
            refresh_token,
            expires_at: now_secs() + expires_in,
        };
        let creds_json = serde_json::to_string(&creds).map_err(|e| e.to_string())?;
        let enc_creds = encrypt_data_with_key(&master_key, &creds_json)?;

        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO sync_config (id, provider, enabled, interval_secs, remote_url, remote_path, username, encrypted_credentials)
             VALUES ('google_drive', 'google_drive', 1, 0, '', '', '', ?1)
             ON CONFLICT(id) DO UPDATE SET encrypted_credentials = excluded.encrypted_credentials",
            params![enc_creds],
        )
        .map_err(|e| e.to_string())?;

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task-Fehler: {}", e))?
}

#[tauri::command]
pub fn disconnect_google_drive(state: State<AppState>) -> Result<(), String> {
    if state.master_key.lock().map_err(|_| "Lock poisoned")?.is_none() {
        return Err("Vault is locked".into());
    }
    let conn = crate::get_db_conn(&state)?;
    conn.execute("DELETE FROM sync_config WHERE id = 'google_drive'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
