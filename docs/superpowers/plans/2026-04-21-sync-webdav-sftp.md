# SD Passwort Manager — Plan 2: Sync Engine (WebDAV + SFTP)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add encrypted vault sync via WebDAV and SFTP so the `vaultzero.db` file is automatically mirrored to a remote server.

**Architecture:** The vault file is synced as an opaque binary blob — since it's AES-256-GCM encrypted, it is safe to store on any server. A SHA-256 sidecar file (`.sha256`) alongside the vault enables change detection without downloading the full file. Conflicts (both sides changed since last sync) produce a timestamped local backup and notify the user. Sync requires the vault to be unlocked (credentials are encrypted with the master key).

**Tech Stack:** Rust: `reqwest` 0.12 (WebDAV HTTP), `ssh2` 0.9 (SFTP), `sha2` 0.10 (hashing). React/TypeScript: new `SyncStatus` component. Tauri 2 async commands.

---

## File Map

**Modify:**
- `src-tauri/Cargo.toml` — add reqwest, sha2, ssh2
- `src-tauri/src/lib.rs` — add sync_config table to ensure_schema, add `mod sync;`, register 5 new commands
- `src/App.tsx` — add SyncStatus to the import and render it in the layout when `showSync` is true
- `src/components/Sidebar.tsx` — add "Sync" nav item

**Create:**
- `src-tauri/src/sync/mod.rs` — provider trait, SyncConfig, SyncResult, conflict logic, Tauri commands
- `src-tauri/src/sync/webdav.rs` — WebDAV provider (reqwest)
- `src-tauri/src/sync/sftp.rs` — SFTP provider (ssh2)
- `src/components/SyncStatus.tsx` — sync config forms + status display

---

### Task 1: Cargo Dependencies + sync_config Schema

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add dependencies to Cargo.toml**

Open `src-tauri/Cargo.toml` and add after the existing dependencies:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls"] }
sha2 = "0.10"
ssh2 = "0.9"
```

- [ ] **Step 2: Add sync_config table to ensure_schema in lib.rs**

Find the `ensure_schema` function in `src-tauri/src/lib.rs`. It ends with:

```rust
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            encrypted_bytes TEXT NOT NULL
        );
    ").map_err(|e| e.to_string())?;
```

Replace that closing `");` with the sync_config table appended inside the same `execute_batch` string:

```rust
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
```

- [ ] **Step 3: Add `mod sync;` and expose db_path helper in lib.rs**

At the top of `src-tauri/src/lib.rs`, after the existing `use` statements, add:

```rust
mod sync;
```

Add this public(crate) helper function right after the `get_db_conn` function:

```rust
pub(crate) fn get_db_path_from_state(state: &State<AppState>) -> Result<std::path::PathBuf, String> {
    state.db_path.lock().unwrap().clone().ok_or_else(|| "DB path not set".to_string())
}
```

- [ ] **Step 4: Register sync commands in lib.rs**

Find the `tauri::generate_handler![...]` block and add 5 new commands at the end:

```rust
    sync::get_sync_configs,
    sync::save_sync_config,
    sync::delete_sync_config,
    sync::trigger_sync,
    sync::get_last_sync_status,
```

- [ ] **Step 5: Create the sync directory**

```bash
mkdir -p src-tauri/src/sync
```

- [ ] **Step 6: Verify the project compiles (no sync module yet, just check schema + deps)**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error|Compiling tauri-app|Finished"
```

Expected: Errors about `mod sync` not found — that's fine, we'll fix in Task 2.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs
git commit -m "feat: add sync_config schema + cargo deps for sync"
```

---

### Task 2: Sync Core Module

**Files:**
- Create: `src-tauri/src/sync/mod.rs`

- [ ] **Step 1: Create `src-tauri/src/sync/mod.rs`**

```rust
pub mod webdav;
pub mod sftp;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::State;

use crate::{
    decrypt_data_internal, encrypt_data_internal, get_db_conn, get_db_path_from_state, AppState,
};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncConfig {
    pub id: String,
    pub provider: String,
    pub enabled: bool,
    pub interval_secs: i64,
    pub remote_url: String,
    pub remote_path: String,
    pub username: String,
    pub password: String,
    pub last_synced_at: Option<i64>,
    pub last_remote_hash: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "status", content = "detail")]
pub enum SyncResult {
    UpToDate,
    Uploaded,
    Downloaded,
    Conflict { backup_path: String },
    Error(String),
}

pub trait SyncProvider: Send {
    fn upload(&self, vault_bytes: &[u8], hash: &str) -> Result<(), String>;
    fn download(&self) -> Result<Vec<u8>, String>;
    fn remote_hash(&self) -> Result<Option<String>, String>;
}

pub fn local_hash(db_path: &PathBuf) -> Result<String, String> {
    let bytes = std::fs::read(db_path).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

pub fn perform_sync(
    provider: &dyn SyncProvider,
    db_path: &PathBuf,
    last_remote_hash: Option<&str>,
) -> Result<SyncResult, String> {
    let local_hash = local_hash(db_path)?;
    let remote_hash = provider.remote_hash()?;

    match remote_hash {
        None => {
            // No remote file yet — first upload
            let bytes = std::fs::read(db_path).map_err(|e| e.to_string())?;
            provider.upload(&bytes, &local_hash)?;
            Ok(SyncResult::Uploaded)
        }
        Some(ref remote) => {
            let last = last_remote_hash.unwrap_or("");
            let local_changed = local_hash != last;
            let remote_changed = remote != last;

            match (local_changed, remote_changed) {
                (false, false) => Ok(SyncResult::UpToDate),
                (true, false) => {
                    let bytes = std::fs::read(db_path).map_err(|e| e.to_string())?;
                    provider.upload(&bytes, &local_hash)?;
                    Ok(SyncResult::Uploaded)
                }
                (false, true) => {
                    let remote_bytes = provider.download()?;
                    std::fs::write(db_path, &remote_bytes).map_err(|e| e.to_string())?;
                    Ok(SyncResult::Downloaded)
                }
                (true, true) => {
                    let ts = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_secs();
                    let backup = db_path.with_file_name(format!("vaultzero_conflict_{}.db", ts));
                    std::fs::copy(db_path, &backup).map_err(|e| e.to_string())?;
                    Ok(SyncResult::Conflict {
                        backup_path: backup.to_string_lossy().into_owned(),
                    })
                }
            }
        }
    }
}

fn load_configs(state: &State<AppState>) -> Result<Vec<SyncConfig>, String> {
    let conn = get_db_conn(state)?;
    let mut stmt = conn
        .prepare("SELECT id, provider, enabled, interval_secs, remote_url, remote_path, username, encrypted_credentials, last_synced_at, last_remote_hash FROM sync_config")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut configs = Vec::new();
    for row in rows {
        let (id, provider, enabled, interval_secs, enc_url, enc_path, enc_user, enc_creds, last_synced_at, last_remote_hash) =
            row.map_err(|e| e.to_string())?;
        configs.push(SyncConfig {
            id,
            provider,
            enabled: enabled == 1,
            interval_secs,
            remote_url: decrypt_data_internal(state, &enc_url).unwrap_or_default(),
            remote_path: decrypt_data_internal(state, &enc_path).unwrap_or_default(),
            username: decrypt_data_internal(state, &enc_user).unwrap_or_default(),
            password: decrypt_data_internal(state, &enc_creds).unwrap_or_default(),
            last_synced_at,
            last_remote_hash,
        });
    }
    Ok(configs)
}

#[tauri::command]
pub fn get_sync_configs(state: State<AppState>) -> Result<Vec<SyncConfig>, String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    load_configs(&state)
}

#[tauri::command]
pub fn save_sync_config(state: State<AppState>, config: SyncConfig) -> Result<(), String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    let enc_url = encrypt_data_internal(&state, &config.remote_url)?;
    let enc_path = encrypt_data_internal(&state, &config.remote_path)?;
    let enc_user = encrypt_data_internal(&state, &config.username)?;
    let enc_creds = encrypt_data_internal(&state, &config.password)?;
    conn.execute(
        "INSERT INTO sync_config (id, provider, enabled, interval_secs, remote_url, remote_path, username, encrypted_credentials)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           enabled = excluded.enabled,
           interval_secs = excluded.interval_secs,
           remote_url = excluded.remote_url,
           remote_path = excluded.remote_path,
           username = excluded.username,
           encrypted_credentials = excluded.encrypted_credentials",
        params![config.id, config.provider, config.enabled as i64, config.interval_secs,
                enc_url, enc_path, enc_user, enc_creds],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_sync_config(state: State<AppState>, id: &str) -> Result<(), String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    conn.execute("DELETE FROM sync_config WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn trigger_sync(state: State<'_, AppState>, config_id: String) -> Result<SyncResult, String> {
    if state.master_key.lock().unwrap().is_none() {
        return Err("Vault is locked".into());
    }
    let db_path = get_db_path_from_state(&state)?;
    let configs = load_configs(&state)?;
    let config = configs
        .into_iter()
        .find(|c| c.id == config_id)
        .ok_or("Sync config not found")?;

    let last_hash = config.last_remote_hash.clone();
    let result = match config.provider.as_str() {
        "webdav" => {
            let provider = webdav::WebDavProvider::new(
                config.remote_url.clone(),
                config.remote_path.clone(),
                config.username.clone(),
                config.password.clone(),
            );
            perform_sync(&provider, &db_path, last_hash.as_deref())
        }
        "sftp" => {
            let provider = sftp::SftpProvider::new(
                config.remote_url.clone(),
                config.remote_path.clone(),
                config.username.clone(),
                config.password.clone(),
            )?;
            perform_sync(&provider, &db_path, last_hash.as_deref())
        }
        p => Err(format!("Unknown provider: {}", p)),
    }?;

    // Update last_remote_hash and last_synced_at on success
    let new_hash = match &result {
        SyncResult::Uploaded => Some(local_hash(&db_path)?),
        SyncResult::Downloaded => Some(local_hash(&db_path)?),
        SyncResult::UpToDate => last_hash,
        _ => last_hash,
    };

    if let Some(hash) = new_hash {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let conn = get_db_conn(&state)?;
        conn.execute(
            "UPDATE sync_config SET last_remote_hash = ?1, last_synced_at = ?2 WHERE id = ?3",
            params![hash, now, config_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(result)
}

#[tauri::command]
pub fn get_last_sync_status(state: State<AppState>, config_id: &str) -> Result<Option<i64>, String> {
    let conn = get_db_conn(&state)?;
    let ts: Option<i64> = conn
        .query_row(
            "SELECT last_synced_at FROM sync_config WHERE id = ?1",
            params![config_id],
            |row| row.get(0),
        )
        .unwrap_or(None);
    Ok(ts)
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/src/sync/mod.rs
git commit -m "feat: add sync core module with provider trait and Tauri commands"
```

---

### Task 3: WebDAV Provider

**Files:**
- Create: `src-tauri/src/sync/webdav.rs`

The WebDAV protocol for file sync uses:
- `PUT {url}` to upload (creates or replaces the file)
- `GET {url}` to download
- A `.sha256` sidecar file for remote hash comparison

- [ ] **Step 1: Create `src-tauri/src/sync/webdav.rs`**

```rust
use super::SyncProvider;

pub struct WebDavProvider {
    vault_url: String,
    hash_url: String,
    username: String,
    password: String,
}

impl WebDavProvider {
    pub fn new(base_url: String, remote_path: String, username: String, password: String) -> Self {
        let base = base_url.trim_end_matches('/');
        let path = remote_path.trim_start_matches('/');
        let vault_url = format!("{}/{}", base, path);
        let hash_url = format!("{}.sha256", vault_url);
        Self { vault_url, hash_url, username, password }
    }

    fn client(&self) -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("failed to build reqwest client")
    }
}

impl SyncProvider for WebDavProvider {
    fn upload(&self, vault_bytes: &[u8], hash: &str) -> Result<(), String> {
        let client = self.client();

        // Ensure parent directory exists via MKCOL (ignore 405 = already exists)
        let parent = self.vault_url.rsplit_once('/').map(|(p, _)| p).unwrap_or(&self.vault_url);
        let _ = client
            .request(reqwest::Method::from_bytes(b"MKCOL").unwrap(), parent)
            .basic_auth(&self.username, Some(&self.password))
            .send();

        // Upload vault file
        client
            .put(&self.vault_url)
            .basic_auth(&self.username, Some(&self.password))
            .body(vault_bytes.to_vec())
            .send()
            .map_err(|e| format!("WebDAV PUT vault: {}", e))?
            .error_for_status()
            .map_err(|e| format!("WebDAV PUT vault status: {}", e))?;

        // Upload hash sidecar
        client
            .put(&self.hash_url)
            .basic_auth(&self.username, Some(&self.password))
            .body(hash.to_string())
            .send()
            .map_err(|e| format!("WebDAV PUT hash: {}", e))?
            .error_for_status()
            .map_err(|e| format!("WebDAV PUT hash status: {}", e))?;

        Ok(())
    }

    fn download(&self) -> Result<Vec<u8>, String> {
        let resp = self
            .client()
            .get(&self.vault_url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .map_err(|e| format!("WebDAV GET: {}", e))?
            .error_for_status()
            .map_err(|e| format!("WebDAV GET status: {}", e))?;
        resp.bytes()
            .map(|b| b.to_vec())
            .map_err(|e| format!("WebDAV read body: {}", e))
    }

    fn remote_hash(&self) -> Result<Option<String>, String> {
        let resp = self
            .client()
            .get(&self.hash_url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .map_err(|e| format!("WebDAV GET hash: {}", e))?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let text = resp
            .error_for_status()
            .map_err(|e| format!("WebDAV GET hash status: {}", e))?
            .text()
            .map_err(|e| format!("WebDAV read hash: {}", e))?;
        Ok(Some(text.trim().to_string()))
    }
}
```

- [ ] **Step 2: Verify compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished` (no errors). The `reqwest::blocking` feature requires `features = ["blocking"]` — if you get an error about blocking not found, update `Cargo.toml`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "blocking"] }
```

Then re-run the build.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/sync/webdav.rs src-tauri/Cargo.toml
git commit -m "feat: add WebDAV sync provider"
```

---

### Task 4: SFTP Provider

**Files:**
- Create: `src-tauri/src/sync/sftp.rs`

The `ssh2` crate is blocking. Since Tauri 2 async commands run on a tokio runtime, we use `tauri::async_runtime::spawn_blocking` — but since `perform_sync` is called synchronously inside `trigger_sync` (which is already in a blocking context via spawn_blocking), the SFTP provider can use blocking I/O directly.

Actually, `trigger_sync` is marked `async` — we need to run blocking SFTP code via `spawn_blocking`. We'll handle this by making the SFTP provider implement `SyncProvider` with blocking calls, and wrapping the call in `trigger_sync` with `spawn_blocking`.

For simplicity, update `trigger_sync` in `sync/mod.rs` to run the SFTP path in `spawn_blocking`:

- [ ] **Step 1: Create `src-tauri/src/sync/sftp.rs`**

```rust
use super::SyncProvider;
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;

pub struct SftpProvider {
    host: String,
    port: u16,
    remote_path: String,
    hash_path: String,
    username: String,
    password: String,
}

impl SftpProvider {
    pub fn new(
        host: String,
        remote_path: String,
        username: String,
        password: String,
    ) -> Result<Self, String> {
        // host may include port as "host:port"
        let (host, port) = if let Some((h, p)) = host.rsplit_once(':') {
            (h.to_string(), p.parse::<u16>().unwrap_or(22))
        } else {
            (host, 22)
        };
        let hash_path = format!("{}.sha256", remote_path);
        Ok(Self { host, port, remote_path, hash_path, username, password })
    }

    fn session(&self) -> Result<Session, String> {
        let tcp = TcpStream::connect(format!("{}:{}", self.host, self.port))
            .map_err(|e| format!("SFTP connect: {}", e))?;
        let mut sess = Session::new().map_err(|e| format!("SFTP session: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| format!("SFTP handshake: {}", e))?;
        sess.userauth_password(&self.username, &self.password)
            .map_err(|e| format!("SFTP auth: {}", e))?;
        if !sess.authenticated() {
            return Err("SFTP authentication failed".into());
        }
        Ok(sess)
    }
}

impl SyncProvider for SftpProvider {
    fn upload(&self, vault_bytes: &[u8], hash: &str) -> Result<(), String> {
        let sess = self.session()?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem: {}", e))?;

        // Ensure parent directory exists
        let parent = std::path::Path::new(&self.remote_path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "/".to_string());
        let _ = sftp.mkdir(std::path::Path::new(&parent), 0o755);

        // Upload vault file
        let mut file = sftp
            .create(std::path::Path::new(&self.remote_path))
            .map_err(|e| format!("SFTP create vault: {}", e))?;
        file.write_all(vault_bytes)
            .map_err(|e| format!("SFTP write vault: {}", e))?;

        // Upload hash sidecar
        let mut hash_file = sftp
            .create(std::path::Path::new(&self.hash_path))
            .map_err(|e| format!("SFTP create hash: {}", e))?;
        hash_file
            .write_all(hash.as_bytes())
            .map_err(|e| format!("SFTP write hash: {}", e))?;

        Ok(())
    }

    fn download(&self) -> Result<Vec<u8>, String> {
        let sess = self.session()?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem: {}", e))?;
        let mut file = sftp
            .open(std::path::Path::new(&self.remote_path))
            .map_err(|e| format!("SFTP open: {}", e))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| format!("SFTP read: {}", e))?;
        Ok(bytes)
    }

    fn remote_hash(&self) -> Result<Option<String>, String> {
        let sess = self.session()?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem: {}", e))?;
        match sftp.open(std::path::Path::new(&self.hash_path)) {
            Err(_) => Ok(None),
            Ok(mut file) => {
                let mut text = String::new();
                file.read_to_string(&mut text)
                    .map_err(|e| format!("SFTP read hash: {}", e))?;
                Ok(Some(text.trim().to_string()))
            }
        }
    }
}
```

- [ ] **Step 2: Update `trigger_sync` in sync/mod.rs to run SFTP in spawn_blocking**

The `sftp` provider contains a raw TCP connection (not Send across await points). Wrap the SFTP path in `tauri::async_runtime::spawn_blocking`. Find the `"sftp" =>` branch in `trigger_sync` and replace the direct call:

```rust
        "sftp" => {
            let remote_url = config.remote_url.clone();
            let remote_path = config.remote_path.clone();
            let username = config.username.clone();
            let password = config.password.clone();
            let db_path_clone = db_path.clone();
            let last_hash_clone = last_hash.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let provider = sftp::SftpProvider::new(remote_url, remote_path, username, password)?;
                perform_sync(&provider, &db_path_clone, last_hash_clone.as_deref())
            })
            .await
            .map_err(|e| format!("SFTP task error: {}", e))?
        }
```

- [ ] **Step 3: Add `use std::io::Read` import to sftp.rs**

The file already has `use std::io::{Read, Write};` — confirm it's at the top.

- [ ] **Step 4: Verify compiles**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished`. If `ssh2` fails to link on Linux, ensure `libssh2-dev` is installed:
```bash
sudo pacman -S libssh2   # CachyOS/Arch
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/sync/sftp.rs src-tauri/src/sync/mod.rs
git commit -m "feat: add SFTP sync provider"
```

---

### Task 5: SyncStatus Frontend Component

**Files:**
- Create: `src/components/SyncStatus.tsx`

- [ ] **Step 1: Create `src/components/SyncStatus.tsx`**

```tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, RefreshCw, CheckCircle, AlertTriangle, Upload, Download } from "lucide-react";

interface SyncConfig {
    id: string;
    provider: string;
    enabled: boolean;
    interval_secs: number;
    remote_url: string;
    remote_path: string;
    username: string;
    password: string;
    last_synced_at: number | null;
    last_remote_hash: string | null;
}

type SyncResult =
    | { status: "UpToDate" }
    | { status: "Uploaded" }
    | { status: "Downloaded" }
    | { status: "Conflict"; detail: { backup_path: string } }
    | { status: "Error"; detail: string };

interface SyncStatusProps {
    onClose: () => void;
}

const EMPTY_CONFIG = (provider: string): SyncConfig => ({
    id: provider,
    provider,
    enabled: false,
    interval_secs: 300,
    remote_url: "",
    remote_path: "/vaultzero.db",
    username: "",
    password: "",
    last_synced_at: null,
    last_remote_hash: null,
});

function formatTs(ts: number | null): string {
    if (!ts) return "Noch nie";
    return new Date(ts * 1000).toLocaleString("de-DE");
}

function SyncResultBadge({ result }: { result: SyncResult | null }) {
    if (!result) return null;
    const map: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
        UpToDate: { label: "Aktuell", color: "#4CD964", Icon: CheckCircle },
        Uploaded: { label: "Hochgeladen", color: "#5AC8FA", Icon: Upload },
        Downloaded: { label: "Heruntergeladen", color: "#5AC8FA", Icon: Download },
        Conflict: { label: "Konflikt!", color: "#FF9500", Icon: AlertTriangle },
        Error: { label: "Fehler", color: "#FF3B30", Icon: AlertTriangle },
    };
    const { label, color, Icon } = map[result.status] ?? map.Error;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "6px", color, fontSize: "13px" }}>
            <Icon size={14} /> {label}
            {result.status === "Conflict" && (
                <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
                    — Backup: {(result as any).detail.backup_path}
                </span>
            )}
            {result.status === "Error" && (
                <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
                    — {(result as any).detail}
                </span>
            )}
        </div>
    );
}

function ProviderForm({
    title,
    provider,
    urlLabel,
    urlPlaceholder,
    portHint,
}: {
    title: string;
    provider: string;
    urlLabel: string;
    urlPlaceholder: string;
    portHint?: string;
}) {
    const [config, setConfig] = useState<SyncConfig>(EMPTY_CONFIG(provider));
    const [isSaving, setIsSaving] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

    useEffect(() => {
        invoke<SyncConfig[]>("get_sync_configs")
            .then(configs => {
                const found = configs.find(c => c.id === provider);
                if (found) setConfig(found);
            })
            .catch(() => {});
    }, [provider]);

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setIsSaving(true);
        try {
            await invoke("save_sync_config", { config });
            alert("Gespeichert!");
        } catch (err) {
            alert(`Fehler: ${err}`);
        } finally {
            setIsSaving(false);
        }
    }

    async function handleSync() {
        setIsSyncing(true);
        setSyncResult(null);
        try {
            const result = await invoke<SyncResult>("trigger_sync", { configId: provider });
            setSyncResult(result);
        } catch (err) {
            setSyncResult({ status: "Error", detail: String(err) });
        } finally {
            setIsSyncing(false);
        }
    }

    async function handleDelete() {
        if (!confirm(`${title}-Konfiguration löschen?`)) return;
        await invoke("delete_sync_config", { id: provider });
        setConfig(EMPTY_CONFIG(provider));
        setSyncResult(null);
    }

    const field = (label: string, key: keyof SyncConfig, type = "text", placeholder = "") => (
        <div style={{ marginBottom: "16px" }}>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-tertiary)", display: "block", marginBottom: "6px" }}>
                {label}
            </label>
            <input
                type={type}
                value={String(config[key] ?? "")}
                onChange={e => setConfig(c => ({ ...c, [key]: e.target.value }))}
                placeholder={placeholder}
                style={{ width: "100%", padding: "10px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.03)", color: "white" }}
            />
        </div>
    );

    return (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "10px", padding: "24px", marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <h3 style={{ fontSize: "16px", margin: 0 }}>{title}</h3>
                <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" }}>
                    <input
                        type="checkbox"
                        checked={config.enabled}
                        onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))}
                    />
                    Aktiviert
                </label>
            </div>

            <form onSubmit={handleSave}>
                {field(urlLabel, "remote_url", "text", urlPlaceholder)}
                {portHint && (
                    <p style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "-12px", marginBottom: "16px" }}>{portHint}</p>
                )}
                {field("REMOTE-PFAD", "remote_path", "text", "/vaultzero.db")}
                {field("BENUTZERNAME", "username")}
                {field("PASSWORT", "password", "password")}

                <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
                    <button type="submit" disabled={isSaving} style={{ flex: 1, padding: "10px", background: "var(--accent-blue)", color: "white", border: "none", borderRadius: "6px", fontWeight: 600, cursor: "pointer" }}>
                        {isSaving ? "Speichern..." : "Speichern"}
                    </button>
                    <button type="button" onClick={handleSync} disabled={isSyncing} style={{ flex: 1, padding: "10px", background: "transparent", border: "1px solid var(--border-color)", color: "white", borderRadius: "6px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                        <RefreshCw size={14} style={{ animation: isSyncing ? "spin 1s linear infinite" : "none" }} />
                        {isSyncing ? "Syncing..." : "Jetzt sync"}
                    </button>
                    <button type="button" onClick={handleDelete} style={{ padding: "10px 14px", background: "transparent", border: "1px solid var(--danger)", color: "var(--danger)", borderRadius: "6px", cursor: "pointer" }}>
                        Löschen
                    </button>
                </div>
            </form>

            <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                    Zuletzt synchronisiert: {formatTs(config.last_synced_at)}
                </div>
                <SyncResultBadge result={syncResult} />
            </div>
        </div>
    );
}

export function SyncStatus({ onClose }: SyncStatusProps) {
    return (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)", overflow: "auto" }}>
            <div style={{ background: "#1c1c1e", padding: "32px", borderRadius: "12px", width: "520px", maxHeight: "90vh", overflowY: "auto", border: "1px solid var(--border-color)", boxShadow: "0 24px 48px rgba(0,0,0,0.5)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
                    <h2 style={{ fontSize: "18px", margin: 0 }}>Sync-Konfiguration</h2>
                    <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "4px" }}>
                        <X size={20} />
                    </button>
                </div>

                <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "24px", lineHeight: 1.6 }}>
                    Der Tresor wird als verschlüsselte Datei synchronisiert. Das Passwort ist nicht übertragbar — die Datei ist ohne dein Master-Passwort wertlos.
                </p>

                <ProviderForm
                    title="WebDAV (Nextcloud, ownCloud, etc.)"
                    provider="webdav"
                    urlLabel="SERVER-URL"
                    urlPlaceholder="https://nextcloud.example.com/remote.php/dav/files/user"
                />

                <ProviderForm
                    title="SFTP"
                    provider="sftp"
                    urlLabel="HOST"
                    urlPlaceholder="meinserver.de:22"
                    portHint="Format: host:port (Standard-Port: 22)"
                />
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Add the spin animation to App.css**

Find `src/App.css` and add at the end:

```css
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SyncStatus.tsx src/App.css
git commit -m "feat: add SyncStatus component for WebDAV and SFTP"
```

---

### Task 6: Wire SyncStatus into App + Sidebar

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Add SyncStatus to App.tsx**

In `src/App.tsx`, add the import after the Settings import:

```tsx
import { SyncStatus } from "./components/SyncStatus";
```

Add state variable after `showSettings`:

```tsx
const [showSync, setShowSync] = useState(false);
```

In the JSX return (inside the unlocked layout), add after the `{showSettings && <Settings ...>}` line:

```tsx
{showSync && <SyncStatus onClose={() => setShowSync(false)} />}
```

Pass `onSync` to Sidebar (add to the props call):

```tsx
<Sidebar
    selectedCategory={selectedCategory}
    onCategoryChange={setSelectedCategory}
    onSettings={() => setShowSettings(true)}
    onSync={() => setShowSync(true)}
    onLock={lockVault}
/>
```

- [ ] **Step 2: Update Sidebar.tsx to add Sync button**

In `src/components/Sidebar.tsx`, update the `SidebarProps` interface:

```tsx
interface SidebarProps {
    selectedCategory: FilterCategory;
    onCategoryChange: (cat: FilterCategory) => void;
    onSettings: () => void;
    onSync: () => void;
    onLock: () => void;
}
```

Update the function signature:

```tsx
export function Sidebar({ selectedCategory, onCategoryChange, onSettings, onSync, onLock }: SidebarProps) {
```

In the `sidebar-footer` div, add the Sync button between Settings and Lock:

```tsx
<div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <button className="lock-btn" onClick={onSettings} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
        Einstellungen
    </button>
    <button className="lock-btn" onClick={onSync} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
        Sync
    </button>
    <button className="lock-btn" onClick={onLock}>Tresor sperren</button>
</div>
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Build**

```bash
pnpm build 2>&1 | tail -10
```

Expected: successful build.

- [ ] **Step 5: Full Rust build**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error|Finished"
```

Expected: `Finished`.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx
git commit -m "feat: wire SyncStatus into app layout and sidebar"
```

---

## Done

After Plan 2 is complete:
- ✅ WebDAV sync (Nextcloud, ownCloud, any WebDAV server)
- ✅ SFTP sync (any SSH server with password auth)
- ✅ Conflict detection with timestamped local backup
- ✅ SHA-256 hash sidecar for efficient change detection
- ✅ Sync config encrypted with master key
- ✅ "Jetzt sync" button with live status feedback

**Plan 3** will add: Google Drive, Dropbox, OneDrive (OAuth2 flows).
