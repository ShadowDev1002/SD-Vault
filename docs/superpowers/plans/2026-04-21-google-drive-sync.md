# Google Drive Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OAuth2-PKCE-basierte Google Drive Synchronisierung — Vault-Datei im appDataFolder, manueller Sync per Button, vollständig in bestehende Sync-Infrastruktur integriert.

**Architecture:** `GoogleDriveProvider` implementiert `SyncProvider`-Trait (upload/download/remote_hash). OAuth2-Flow (PKCE) läuft über 2 Tauri-Commands: `start_google_oauth` startet TcpListener + gibt Auth-URL zurück; `complete_google_oauth` wartet per `spawn_blocking` auf Browser-Callback, tauscht Code gegen Tokens, speichert verschlüsselt. Alle reqwest-blocking-Aufrufe laufen in `spawn_blocking` (identisches Pattern wie SFTP).

**Tech Stack:** Rust (reqwest+json, sha2, base64, rand_core, rusqlite — alles bereits in Cargo.toml), React/TypeScript, @tauri-apps/plugin-opener

---

## Dateistruktur

| Datei | Aktion | Verantwortlichkeit |
|-------|--------|--------------------|
| `src-tauri/Cargo.toml` | Modifizieren | `json`-Feature für reqwest aktivieren |
| `src-tauri/src/sync/google_drive.rs` | Erstellen | OAuth2-Commands + GoogleDriveProvider + SyncProvider-Impl |
| `src-tauri/src/lib.rs` | Modifizieren | GoogleOAuthState-Struct + AppState-Feld + Commands registrieren |
| `src-tauri/src/sync/mod.rs` | Modifizieren | `pub mod google_drive;` + `"google_drive"`-Arm in `trigger_sync` |
| `src/components/GoogleDriveSync.tsx` | Erstellen | UI-Komponente (Verbinden/Sync/Trennen) |
| `src/components/Settings.tsx` | Modifizieren | `<GoogleDriveSync />` einbinden |

## Wichtiger Hinweis: Google Cloud Credentials

Vor der Nutzung müssen in `google_drive.rs` die Konstanten `CLIENT_ID` und `CLIENT_SECRET` mit echten Werten aus der Google Cloud Console befüllt werden (OAuth2-Credentials vom Typ "Desktop App", Google Drive API aktiviert).

---

### Task 1: Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Schritt 1: `json`-Feature zu reqwest hinzufügen**

Aktuelle Zeile in `src-tauri/Cargo.toml`:
```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "blocking"] }
```

Ersetzen durch:
```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "blocking", "json"] }
```

- [ ] **Schritt 2: Kompilieren prüfen**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager/src-tauri && cargo check 2>&1 | tail -3
```

Erwartetes Ergebnis: `Finished` ohne neue Fehler.

- [ ] **Schritt 3: Commit**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager && git add src-tauri/Cargo.toml src-tauri/Cargo.lock && git commit -m "chore: enable reqwest json feature for Google Drive API"
```

---

### Task 2: Rust-Backend `src-tauri/src/sync/google_drive.rs`

**Files:**
- Create: `src-tauri/src/sync/google_drive.rs`

- [ ] **Schritt 1: Datei erstellen**

Erstelle `/home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager/src-tauri/src/sync/google_drive.rs` mit folgendem Inhalt:

```rust
use argon2::password_hash::rand_core::{OsRng as GDOsRng, RngCore};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::blocking::Client;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::State;

use crate::{encrypt_data_with_key, AppState, GoogleOAuthState};
use super::{SyncConfig, SyncProvider};

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
                ("fields", "files(id,md5Checksum)"),
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
        Ok(files[0]["md5Checksum"].as_str().map(|s| s.to_string()))
    }

    fn upload(&self, vault_bytes: &[u8], _hash: &str) -> Result<(), String> {
        let file_id = self.file_id.lock().unwrap().clone();
        let client = Client::new();
        let metadata = if file_id.is_none() {
            serde_json::json!({ "name": "vault.db", "parents": ["appDataFolder"] })
        } else {
            serde_json::json!({ "name": "vault.db" })
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
```

- [ ] **Schritt 2: Commit (noch nicht kompilierbar — Wiring fehlt)**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager && git add src-tauri/src/sync/google_drive.rs && git commit -m "feat: add Google Drive OAuth2 provider and Tauri commands"
```

---

### Task 3: Wiring — `lib.rs` + `sync/mod.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/sync/mod.rs`

- [ ] **Schritt 1: `GoogleOAuthState`-Struct + AppState-Feld in `lib.rs` hinzufügen**

Lies `src-tauri/src/lib.rs`. Füge nach `use std::sync::Mutex;` (Zeile 15) folgende Zeile ein:
```rust
use std::net::TcpListener;
```

Füge nach den `use`-Importen (vor `mod sync;`, also vor Zeile 19) folgende Struct-Definition ein:
```rust
pub(crate) struct GoogleOAuthState {
    pub(crate) listener: TcpListener,
    pub(crate) code_verifier: String,
    pub(crate) port: u16,
}
```

Ersetze die bestehende `AppState`-Struct:
```rust
pub(crate) struct AppState {
    pub(crate) master_key: Mutex<Option<Zeroizing<[u8; 32]>>>,
    pub(crate) db_path: Mutex<Option<PathBuf>>,
}
```
durch:
```rust
pub(crate) struct AppState {
    pub(crate) master_key: Mutex<Option<Zeroizing<[u8; 32]>>>,
    pub(crate) db_path: Mutex<Option<PathBuf>>,
    pub(crate) google_oauth_state: Mutex<Option<GoogleOAuthState>>,
}
```

In der `run()`-Funktion, ersetze `.manage(AppState { master_key: Mutex::new(None), db_path: Mutex::new(None), })` durch:
```rust
.manage(AppState {
    master_key: Mutex::new(None),
    db_path: Mutex::new(None),
    google_oauth_state: Mutex::new(None),
})
```

Füge in `generate_handler![]` nach `import_export::import_bitwarden_csv,` diese 3 Commands an:
```rust
            sync::google_drive::start_google_oauth,
            sync::google_drive::complete_google_oauth,
            sync::google_drive::disconnect_google_drive,
```

- [ ] **Schritt 2: `sync/mod.rs` modifizieren**

Lies `src-tauri/src/sync/mod.rs`. Füge nach `pub mod webdav;` am Anfang folgende Zeile ein:
```rust
pub mod google_drive;
```

Im `trigger_sync`-Command, ersetze den `p => Err(...)` Arm:
```rust
        p => Err(format!("Unknown provider: {}", p)),
```
durch:
```rust
        "google_drive" => {
            let creds_json = config.password.clone();
            let master_key = {
                let guard = state.master_key.lock().map_err(|_| "Lock poisoned")?;
                **guard.as_ref().ok_or("Vault is locked")?
            };
            let db_path_clone = db_path.clone();
            let last_hash_clone = last_hash.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let provider = google_drive::GoogleDriveProvider::from_creds_json(
                    &creds_json,
                    master_key,
                    &db_path_clone,
                )?;
                perform_sync(&provider, &db_path_clone, last_hash_clone.as_deref())
            })
            .await
            .map_err(|e| format!("Google Drive sync error: {}", e))?
        }
        p => Err(format!("Unknown provider: {}", p)),
```

- [ ] **Schritt 3: Kompilieren**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager/src-tauri && cargo check 2>&1 | tail -5
```

Erwartetes Ergebnis: `Finished` ohne Fehler. Falls Fehler: selbst debuggen und beheben.

- [ ] **Schritt 4: Commit**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager && git add src-tauri/src/lib.rs src-tauri/src/sync/mod.rs && git commit -m "feat: wire Google Drive sync into AppState, trigger_sync, and command handler"
```

---

### Task 4: Frontend

**Files:**
- Create: `src/components/GoogleDriveSync.tsx`
- Modify: `src/components/Settings.tsx`

- [ ] **Schritt 1: `src/components/GoogleDriveSync.tsx` erstellen**

```tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

interface SyncConfig {
    id: string;
    provider: string;
    last_synced_at: number | null;
}

type SyncResult =
    | { status: "UpToDate" }
    | { status: "Uploaded" }
    | { status: "Downloaded" }
    | { status: "Conflict"; detail: { backup_path: string } }
    | { status: "Error"; detail: string };

export function GoogleDriveSync() {
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [status, setStatus] = useState("");
    const [lastSynced, setLastSynced] = useState<number | null>(null);

    useEffect(() => {
        invoke<SyncConfig[]>("get_sync_configs")
            .then(configs => {
                const drive = configs.find(c => c.provider === "google_drive");
                setIsConnected(!!drive);
                if (drive) setLastSynced(drive.last_synced_at);
            })
            .catch(() => {});
    }, []);

    async function handleConnect() {
        setIsConnecting(true);
        setStatus("Öffne Browser...");
        try {
            const authUrl = await invoke<string>("start_google_oauth");
            await openUrl(authUrl);
            setStatus("Warte auf Browser-Bestätigung (max. 2 Minuten)...");
            await invoke("complete_google_oauth");
            setIsConnected(true);
            setStatus("Erfolgreich verbunden!");
        } catch (err) {
            setStatus(`Fehler: ${err}`);
        } finally {
            setIsConnecting(false);
        }
    }

    async function handleSync() {
        setIsSyncing(true);
        setStatus("");
        try {
            const result = await invoke<SyncResult>("trigger_sync", { configId: "google_drive" });
            const labels: Record<string, string> = {
                UpToDate: "Bereits aktuell",
                Uploaded: "Hochgeladen",
                Downloaded: "Heruntergeladen",
                Conflict: "Konflikt — lokales Backup erstellt",
            };
            setStatus(labels[result.status] ?? "Synchronisiert");
            setLastSynced(Math.floor(Date.now() / 1000));
        } catch (err) {
            setStatus(`Fehler: ${err}`);
        } finally {
            setIsSyncing(false);
        }
    }

    async function handleDisconnect() {
        if (!confirm("Google Drive Verbindung trennen?")) return;
        try {
            await invoke("disconnect_google_drive");
            setIsConnected(false);
            setStatus("");
            setLastSynced(null);
        } catch (err) {
            setStatus(`Fehler: ${err}`);
        }
    }

    const btnStyle: React.CSSProperties = {
        padding: "10px 16px", borderRadius: "6px", border: "1px solid var(--border-color)",
        background: "transparent", color: "white", cursor: "pointer", fontSize: "13px",
    };

    return (
        <div>
            <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "32px 0" }} />
            <h3 style={{ fontSize: "14px", marginBottom: "16px" }}>Google Drive Sync</h3>

            {!isConnected ? (
                <>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
                        Tresor verschlüsselt mit Google Drive synchronisieren. Daten landen in einem privaten App-Ordner.
                    </p>
                    <button
                        onClick={handleConnect}
                        disabled={isConnecting}
                        style={{ ...btnStyle, width: "100%", opacity: isConnecting ? 0.6 : 1 }}
                    >
                        {isConnecting ? "Verbinde..." : "Mit Google Drive verbinden"}
                    </button>
                </>
            ) : (
                <>
                    <p style={{ fontSize: "12px", color: "#4CD964", marginBottom: "8px" }}>
                        ✓ Verbunden
                    </p>
                    {lastSynced && (
                        <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
                            Letzter Sync: {new Date(lastSynced * 1000).toLocaleString("de-DE")}
                        </p>
                    )}
                    <div style={{ display: "flex", gap: "12px" }}>
                        <button
                            onClick={handleSync}
                            disabled={isSyncing}
                            style={{ ...btnStyle, flex: 1, background: "var(--accent-blue)", border: "none", opacity: isSyncing ? 0.6 : 1 }}
                        >
                            {isSyncing ? "Synchronisiere..." : "Jetzt synchronisieren"}
                        </button>
                        <button onClick={handleDisconnect} style={btnStyle}>
                            Trennen
                        </button>
                    </div>
                </>
            )}

            {status && (
                <p style={{ fontSize: "12px", marginTop: "8px", color: status.startsWith("Fehler") ? "var(--danger)" : "#4CD964" }}>
                    {status}
                </p>
            )}
        </div>
    );
}
```

- [ ] **Schritt 2: `src/components/Settings.tsx` modifizieren**

Lies die Datei. Füge nach `import { ImportExport } from "./ImportExport";` hinzu:
```typescript
import { GoogleDriveSync } from "./GoogleDriveSync";
```

Füge `<GoogleDriveSync />` nach `<ImportExport />` ein (vor dem letzten schließenden `</div>` des inneren Containers):
```tsx
                <ImportExport />
                <GoogleDriveSync />
            </div>
        </div>
    );
```

- [ ] **Schritt 3: TypeScript prüfen**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager && ./node_modules/.bin/tsc --noEmit 2>&1
```

Erwartetes Ergebnis: Keine Fehler.

- [ ] **Schritt 4: Commit**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager && git add src/components/GoogleDriveSync.tsx src/components/Settings.tsx && git commit -m "feat: add GoogleDriveSync frontend component, wire into Settings"
```
