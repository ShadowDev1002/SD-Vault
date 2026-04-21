# SD-Vault — Design Spec
**Datum:** 2026-04-21
**Status:** Approved

---

## Überblick

Neubau eines vollständig verschlüsselten, lokalen Passwort-Managers mit maximalem Sicherheitsanspruch. Keine Kompromisse bei Kryptografie. Optionaler verschlüsselter Sync via SFTP (eigener Server) oder lokalem Backup.

**Plattformen:** Linux, Windows  
**Stack:** Tauri v2 (Rust + React/TypeScript), SQLCipher, XChaCha20-Poly1305, Argon2id  
**Theme:** Dark Mode only

---

## 1. Gesamtarchitektur

```
┌──────────────────────────────────────────────────┐
│              React/TypeScript UI                 │
│  Login-Screen · Vault-View · Settings · PDF-Kit  │
└───────────────────┬──────────────────────────────┘
                    │ Tauri IPC Commands
┌───────────────────▼──────────────────────────────┐
│                 Rust Backend                     │
│                                                  │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐  │
│  │  crypto   │  │      db      │  │   sync    │  │
│  │           │  │              │  │           │  │
│  │ Argon2id  │  │  SQLCipher   │  │  Trait:   │  │
│  │ XChaCha20 │  │  +Per-Entry  │  │ SyncProv  │  │
│  │ -Poly1305 │  │  Encryption  │  │           │  │
│  │ zeroize   │  │              │  │ ┌───────┐  │  │
│  └───────────┘  └──────────────┘  │ │ Local │  │  │
│                                   │ │ SFTP  │  │  │
│  ┌───────────┐  ┌──────────────┐  │ │ Drive │  │  │
│  │ emergency │  │   commands   │  │ │ (stub)│  │  │
│  │  kit PDF  │  │  (IPC layer) │  │ └───────┘  │  │
│  └───────────┘  └──────────────┘  └───────────┘  │
└──────────────────────────────────────────────────┘
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
 ~/Dokumente/SD-Vault/        SFTP-Server
 vault.db (SQLCipher)         (user-owned)
```

**Kernprinzip:** Kein Klartext verlässt jemals den Rust-Layer. Das Frontend empfängt nur entschlüsselte Daten im RAM, niemals auf Disk.

**Vault-Pfade:**
- Linux: `~/Dokumente/SD-Vault/vault.db` (via `dirs::document_dir()`)
- Windows: `C:\Users\<user>\Documents\SD-Vault\vault.db`

---

## 2. Dual-Key System & Schlüssel-Hierarchie

```
Master-Passwort (user input)
         +
Secret Key (128-bit zufällig, einmalig beim Vault-Erstellen generiert)
         │
         │  BLAKE3-Hash(master_pw || secret_key) → Combined Input
         ▼
    Argon2id
    m = 256 MB
    t = 3 Iterationen
    p = 4 Threads
    salt = 32 Byte (gespeichert in vault_meta)
         │
         ▼
   Master Key (32 Byte) — nur im RAM, niemals auf Disk
         │
         ├──▶ SQLCipher-Key (HKDF-SHA256, Label: "sqlcipher")
         │     └── öffnet die verschlüsselte DB-Datei
         │
         └──▶ Entry Encryption Key (HKDF-SHA256, Label: "entries")
                    └── XChaCha20-Poly1305 pro Eintrag
                         └── eigener 192-Bit-Nonce je Eintrag (zufällig)
```

### Secret Key Format
- 128-Bit zufällig generiert via `OsRng`
- Darstellung: `SDVLT-XXXXX-XXXXX-XXXXX-XXXXX` (26 Base32-Zeichen, 5er-Gruppen)
- **Niemals** persistent gespeichert — nur im Emergency Kit PDF und im RAM während der Session

### Memory Protection
- Alle Keys als `Zeroizing<[u8; 32]>` im RAM
- Auto-Lock nach konfigurierbarem Timeout (Standard: 5 Minuten)
- Key wird sofort via `zeroize` aus RAM gelöscht beim Sperren
- Master Key lebt nur in `AppState` hinter `Mutex<Option<Zeroizing<[u8; 32]>>>`

---

## 3. Datenbank-Schema & Verschlüsselung

### Doppelschicht
1. **SQLCipher** verschlüsselt die gesamte `.db`-Datei (AES-256, kein Metadaten-Leak auf Disk)
2. **XChaCha20-Poly1305** verschlüsselt jeden Eintrag einzeln (Sync-Effizienz)

### Schema

```sql
CREATE TABLE vault_meta (
    id           TEXT PRIMARY KEY,  -- UUID, auch im Emergency Kit
    created_at   INTEGER NOT NULL,
    argon2_salt  BLOB NOT NULL,     -- 32 Byte zufällig
    argon2_ops   INTEGER NOT NULL,
    argon2_mem   INTEGER NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE items (
    id              TEXT PRIMARY KEY,   -- UUID
    category        TEXT NOT NULL,      -- login | card | note | identity
    updated_at      INTEGER NOT NULL,   -- Unix-Timestamp, für Sync
    sync_hash       TEXT NOT NULL,      -- SHA256 des encrypted_blob
    encrypted_blob  BLOB NOT NULL       -- XChaCha20-Poly1305 Ciphertext
);
```

### Eintrag-Plaintext (JSON, vor Verschlüsselung)

```json
{
  "title": "GitHub",
  "username": "user@example.com",
  "password": "hunter2",
  "url": "https://github.com",
  "notes": "",
  "fields": []
}
```

`updated_at` und `sync_hash` liegen unverschlüsselt in SQLite — jedoch ist die gesamte Datei durch SQLCipher geschützt, sodass kein Angreifer ohne den Master Key diese Metadaten lesen kann.

---

## 4. Emergency Kit (PDF)

### Inhalt
- Vault-ID (UUID)
- Secret Key im Format `SDVLT-XXXXX-XXXXX-XXXXX-XXXXX`
- Erstellungsdatum
- Anleitung: "Dieses Dokument sicher aufbewahren. Ohne Secret Key und Master-Passwort kann der Vault nicht geöffnet werden."

### Flow beim ersten Start
1. Kein Vault vorhanden → "Neuen Vault erstellen"
2. Master-Passwort eingeben und bestätigen
3. Secret Key wird via `OsRng` generiert
4. Emergency Kit PDF wird via Tauri `save_file`-Dialog gespeichert
5. UI zeigt Checkbox: "Ich habe das PDF sicher gespeichert" — "Vault erstellen"-Button bleibt deaktiviert bis Checkbox gecheckt
6. Nach Bestätigung → Vault wird auf Disk angelegt
7. Secret Key wird sofort nach Vault-Erstellung via `zeroize` aus dem RAM gelöscht

---

## 5. Sync-Adapter

### Rust Trait Interface

```rust
#[async_trait]
trait SyncProvider: Send + Sync {
    async fn upload(&self, data: &[u8], remote_path: &str) -> Result<()>;
    async fn download(&self, remote_path: &str) -> Result<Vec<u8>>;
    async fn list_backups(&self) -> Result<Vec<BackupEntry>>;
    async fn delete_backup(&self, id: &str) -> Result<()>;
}
```

Was hochgeladen wird ist immer der rohe SQLCipher-Blob — Zero-Knowledge by design.

### Local Backup (vollständig implementiert)
- Kopiert `vault.db` nach `~/Dokumente/SD-Vault/backups/vault_<timestamp>.db`
- Behält maximal 10 Backups, ältere werden automatisch gelöscht
- Kein Netzwerk, kein Risiko

### SFTP (vollständig implementiert, `ssh2`-Crate)
- Authentifizierung: SSH-Key (bevorzugt) oder Passwort
- Verbindungsdetails gespeichert in `~/Dokumente/SD-Vault/sync_config.toml` (neben `vault.db`) — nicht im Vault, nicht verschlüsselt (enthält nur Host/Port/User/Key-Pfad, keine Passwörter wenn SSH-Key genutzt wird)
- Upload: `vault.db` → `/remote/path/vault_<timestamp>.db`
- Sync-Strategie: `updated_at`-Vergleich, neuere Version gewinnt
- Bei Konflikt: beide Versionen lokal behalten, User wird informiert

### Google Drive (Stub)
- `GoogleDriveProvider` implementiert `SyncProvider`
- Alle Methoden geben `Err("not implemented")` zurück
- Interface vollständig vorbereitet für spätere OAuth2-Implementierung

---

## 6. Tauri Commands (IPC)

| Command | Parameter | Beschreibung |
|---|---|---|
| `create_vault` | `master_pw`, `secret_key` | Erstellt neuen Vault, gibt Vault-ID zurück |
| `unlock_vault` | `master_pw`, `secret_key` | Leitet Master Key ab, öffnet DB |
| `lock_vault` | — | Zeroized Master Key, sperrt App |
| `get_items` | `category?` | Gibt entschlüsselte Items zurück |
| `add_item` | `category`, `payload` | Verschlüsselt + speichert neuen Eintrag |
| `update_item` | `id`, `payload` | Verschlüsselt + aktualisiert Eintrag |
| `delete_item` | `id` | Löscht Eintrag aus DB |
| `generate_emergency_kit` | — | Generiert PDF-Blob, gibt ihn ans Frontend |
| `sync_backup` | `provider` | Triggert Sync (local/sftp) |
| `get_sync_status` | — | Gibt letzten Sync-Timestamp zurück |

---

## 7. Frontend

### Screen-Struktur

```
App
├── LockScreen                    ← Master PW + Secret Key Eingabe
│   └── FirstRunSetup             ← nur beim ersten Start
│       ├── MasterPasswordForm
│       └── EmergencyKitDownload  ← Download erzwungen vor Vault-Erstellung
├── VaultView                     ← Hauptansicht nach Unlock
│   ├── Sidebar                   ← Kategorien + Suche
│   ├── EntryList                 ← gefilterte Einträge
│   └── EntryDetail               ← Eintrag ansehen/bearbeiten
└── Settings
    ├── SecuritySettings          ← Auto-Lock Timeout, PW ändern
    └── SyncSettings              ← Local Backup + SFTP konfigurieren
```

### UI-Prinzipien
- Dark Mode only, minimalistisch
- Passwörter standardmäßig als `••••••` mit Toggle
- Passwort-Stärke-Anzeige beim Erstellen/Bearbeiten (zxcvbn)
- Auto-Lock-Countdown sichtbar in der UI
- Clipboard: Passwort automatisch nach 30 Sekunden gelöscht
- Kein sensitives Datum in Browser DevTools sichtbar (kein `console.log` mit Passwörtern)

---

## 8. Crate-Abhängigkeiten (Rust)

| Crate | Zweck |
|---|---|
| `tauri` | Desktop-Framework |
| `rusqlite` + `libsqlite3-sys` | SQLite-Bindings |
| `sqlcipher` Feature in `rusqlite` | DB-Verschlüsselung |
| `argon2` | Key Derivation |
| `chacha20poly1305` | XChaCha20-Poly1305 Verschlüsselung |
| `blake3` | BLAKE3 Hash für Dual-Key-Kombination |
| `hkdf` + `sha2` | Key Derivation (SQLCipher-Key + Entry-Key) |
| `zeroize` | Memory Protection |
| `ssh2` | SFTP-Sync |
| `dirs` | Betriebssystem-Pfade (Dokumente-Ordner) |
| `uuid` | UUIDs für Einträge |
| `serde` + `serde_json` | Serialisierung |
| `tokio` | Async Runtime |
| `printpdf` | Emergency Kit PDF-Generierung |
| `base32` | Secret Key Encoding |
| `sha2` | sync_hash Berechnung |

---

## 9. Sicherheits-Zusammenfassung

| Bedrohung | Schutzmaßnahme |
|---|---|
| Gestohlene DB-Datei | SQLCipher (AES-256) + Argon2id m=256MB |
| Geleaktes Master-Passwort | Dual-Key: Secret Key zusätzlich nötig |
| RAM-Dump | `zeroize` für alle Keys, Auto-Lock |
| Server sieht Daten (SFTP) | Nur SQLCipher-Blob wird übertragen |
| Nonce-Wiederholung | XChaCha20 mit 192-Bit-Nonce via `OsRng` |
| Brute-Force auf DB | Argon2id mit 256 MB Speicher, 3 Iterationen |
| Metadaten-Leak auf Disk | SQLCipher verschlüsselt gesamte Datei |
