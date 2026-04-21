# Google Drive Sync Design

## Ziel

OAuth2-basierte Synchronisierung mit Google Drive — Vault-Datei wird verschlüsselt im versteckten `appDataFolder` gespeichert. Manueller Sync per Button, erweiterbar für weitere OAuth2-Anbieter.

## Architektur

OAuth2-Flow und Drive-API-Logik liegen in `src-tauri/src/sync/google_drive.rs`. Die `GoogleDriveProvider`-Struct implementiert den bestehenden `SyncProvider`-Trait (Upload, Download, Hash). Kein Schema-Change an der Datenbank — Tokens werden verschlüsselt in `sync_config.encrypted_credentials` gespeichert.

**Neue Dateien:**
- `src-tauri/src/sync/google_drive.rs` — `GoogleDriveProvider` + 3 Tauri-Commands
- `src/components/GoogleDriveSync.tsx` — UI-Komponente

**Modifiziert:**
- `src-tauri/src/sync/mod.rs` — `pub mod google_drive;` + Drive-Arm in `trigger_sync`
- `src-tauri/src/lib.rs` — AppState-Erweiterung + Commands registrieren
- `src-tauri/Cargo.toml` — `json`-Feature für reqwest
- `src/components/Settings.tsx` — `<GoogleDriveSync />` einbinden

**Keine neuen Crates** — `sha2`, `base64`, `std::net::TcpListener`, `reqwest` (blocking) bereits vorhanden.

## Google Cloud Console Voraussetzung

Vor der Nutzung muss ein Google Cloud Projekt mit OAuth2-Credentials erstellt werden:
1. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Desktop App)
2. Google Drive API aktivieren
3. `client_id` und `client_secret` als Konstanten in `google_drive.rs` eintragen

`redirect_uri` ist immer `http://localhost:{PORT}` — kein Eintrag in Cloud Console nötig für Desktop-Apps.

## AppState-Erweiterung

```rust
pub struct GoogleOAuthState {
    pub listener: std::net::TcpListener,
    pub code_verifier: String,
}

// In AppState:
pub google_oauth_state: Mutex<Option<GoogleOAuthState>>,
```

## Token-Speicherung

Kein Schema-Change nötig. `sync_config.encrypted_credentials` speichert verschlüsselt:

```json
{
  "access_token": "ya29...",
  "refresh_token": "1//...",
  "expires_at": 1745123456
}
```

Keine persistente `file_id` — wird pro Sync-Durchlauf in `Mutex<Option<String>>` auf dem Provider gecacht (siehe GoogleDriveProvider).

## OAuth2-Flow (PKCE, RFC 8252)

### Command 1: `start_google_oauth() -> Result<String, String>`
1. Generiert `code_verifier` (32 zufällige Bytes → base64url)
2. `code_challenge = BASE64URL(SHA256(code_verifier))`
3. Bindet `TcpListener` an Port 0 (OS weist Port zu)
4. Speichert `(listener, code_verifier)` in `AppState.google_oauth_state`
5. Gibt Auth-URL zurück → Frontend öffnet per `tauri-plugin-opener`

Auth-URL-Parameter:
```
client_id, redirect_uri=http://localhost:{PORT},
response_type=code, scope=https://www.googleapis.com/auth/drive.appdata,
code_challenge, code_challenge_method=S256, access_type=offline, prompt=consent
```

### Command 2: `complete_google_oauth() -> Result<(), String>` (async)
1. Nimmt `TcpListener` aus AppState
2. Setzt `set_read_timeout(Some(Duration::from_secs(120)))` für 2-Minuten-Timeout
3. Führt `listener.accept()` in `tauri::async_runtime::spawn_blocking` aus (identisch zu SFTP-Pattern)
4. Akzeptiert eine HTTP-Verbindung, parst `code` aus Query-String
3. Sendet HTML-Antwort: "Authentifizierung erfolgreich — du kannst diesen Tab schließen."
4. POST an `https://oauth2.googleapis.com/token` mit `code`, `code_verifier`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`
5. Speichert Tokens verschlüsselt in `sync_config` (legt Eintrag an wenn nicht vorhanden)

### Command 3: `disconnect_google_drive() -> Result<(), String>`
- Löscht `sync_config`-Eintrag mit `provider = "google_drive"`

## Token-Refresh

In `GoogleDriveProvider::new()` vor jedem Drive-API-Aufruf:

```rust
if credentials.expires_at - now_secs() < 60 {
    // POST https://oauth2.googleapis.com/token
    // grant_type=refresh_token, refresh_token, client_id, client_secret
    // → neuer access_token + expires_in → in sync_config speichern
}
```

## GoogleDriveProvider

```rust
struct GoogleDriveProvider {
    access_token: String,
    file_id: Mutex<Option<String>>,  // pro Sync-Durchlauf gecacht
}
```

Implementiert `SyncProvider`:

**`remote_hash()`**
- `GET https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='vault.db'&fields=files(id,md5Checksum)`
- Cacht `file_id` in `self.file_id`
- Gibt `md5Checksum` zurück oder `Ok(None)` wenn keine Datei vorhanden

**`upload(vault_bytes, hash)`**
- Liest `file_id` aus `self.file_id`
- Wenn vorhanden: `PATCH https://www.googleapis.com/upload/drive/v3/files/{id}?uploadType=multipart`
- Sonst (Erstupload): `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` mit `parents=["appDataFolder"]`, cacht neue `file_id`

**`download()`**
- Liest `file_id` aus `self.file_id`
- `GET https://www.googleapis.com/drive/v3/files/{id}?alt=media`

## Integration in `trigger_sync`

Neuer Match-Arm in `sync/mod.rs`:

```rust
"google_drive" => {
    let provider = google_drive::GoogleDriveProvider::new(&config, &state)?;
    perform_sync(&provider, &db_path, last_hash.as_deref())
}
```

`GoogleDriveProvider::new()` entschlüsselt Credentials, refresht Token falls nötig.

## UI — `src/components/GoogleDriveSync.tsx`

**Nicht verbunden:**
```
[ Mit Google Drive verbinden ]
```
Klick:
1. `start_google_oauth()` → URL erhalten
2. `tauri-plugin-opener` öffnet Browser
3. `complete_google_oauth()` läuft (zeigt "Warte auf Browser-Bestätigung...")
4. Bei Erfolg: verbundener Zustand

**Verbunden:**
```
✓ Google Drive verbunden
Letzter Sync: vor 5 Minuten
[ Jetzt synchronisieren ]   [ Trennen ]
```

**Einbindung:** `<GoogleDriveSync />` in `Settings.tsx` nach dem bestehenden Sync-Bereich.

**Kein automatischer Hintergrund-Sync** — nur manuell per Button.

## Nicht im Scope

- Automatischer Intervall-Sync
- Dropbox / OneDrive (spätere Erweiterung)
- Konflikt-Auflösung (nutzt bestehende Logik aus `perform_sync`)
- Multi-Account-Support
