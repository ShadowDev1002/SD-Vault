# SD Passwort Manager — Design Spec
**Datum:** 2026-04-21  
**Status:** Approved

---

## Überblick

Lokaler, vollständig verschlüsselter Passwort-Manager im Stil von 1Password. Keine Cloud-Abhängigkeit für die Kernfunktion — alles läuft lokal. Optionaler verschlüsselter Sync zu Google Drive, Dropbox, OneDrive, WebDAV oder eigenem SFTP-Server.

**Plattformen:** Windows, Linux, Android  
**Stack:** Tauri 2 (Rust + React/TypeScript), SQLite, AES-256-GCM, Argon2id  
**Theme:** Dark Mode only

---

## 1. Architektur

```
┌─────────────────────────────────────────────┐
│           React/TypeScript UI               │
│  (Dark Mode, läuft auf Desktop + Android)   │
└───────────────┬─────────────────────────────┘
                │ Tauri Commands (IPC)
┌───────────────▼─────────────────────────────┐
│              Rust Backend                   │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │  Crypto  │  │    DB    │  │   Sync    │ │
│  │ AES-GCM  │  │ SQLite   │  │  Engine   │ │
│  │  Argon2  │  │(encrypted│  │           │ │
│  │  Zeroize │  │ at rest) │  │           │ │
│  └──────────┘  └──────────┘  └─────┬─────┘ │
└─────────────────────────────────────┼───────┘
                                      │
         ┌──────────────┬─────────────┼──────────────┐
         ▼              ▼             ▼              ▼
    Google Drive    Dropbox        SFTP     OneDrive/WebDAV
```

**Prinzip:** Daten verlassen das Gerät niemals unverschlüsselt. Die SQLite-Datei auf dem Gerät ist verschlüsselt; die Sync-Datei in der Cloud ist dieselbe verschlüsselte Datei.

**Vault-Speicherorte:**
- Linux: `~/.local/share/sd-passwort-manager/vault.db`
- Windows: `%APPDATA%\sd-passwort-manager\vault.db`
- Android: App-privater Speicher (via Tauri Android API)

---

## 2. Verschlüsselung & Sicherheit

### Schlüssel-Ableitung
```
Master-Passwort
      │
      ▼ Argon2id (m=65536 KB, t=3, p=4)
      │
  Master-Key (32 Byte)
      │
      ├──▶ Vault-Encryption-Key (AES-256-GCM) — verschlüsselt alle Einträge
      └──▶ Sync-HMAC-Key — signiert die Sync-Datei
```

### Verschlüsselung
- Algorithmus: AES-256-GCM
- Jeder Eintrag bekommt einen eigenen zufälligen Nonce (96 Bit)
- Crates: `aes-gcm`, `argon2`, `rand_core`, `zeroize` (bereits in `Cargo.toml`)

### Speicher-Sicherheit
- Master-Key wird **nie** auf Disk geschrieben — nur im RAM
- `zeroize` löscht den Key beim Sperren sofort aus dem RAM
- App sperrt sich automatisch nach konfigurierbarem Timeout (Standard: 5 Minuten)
- App sperrt sich sofort wenn sie auf Android in den Hintergrund geht

### Vault-Datei-Struktur
- SQLite-Datei lokal
- Nur Metadaten (`type`, `updated_at`, `vault_id`) liegen unverschlüsselt
- Alle sensitiven Felder stecken im `encrypted_data`-Blob (JSON, AES-256-GCM)

---

## 3. Datenmodell

### SQLite-Schema
```sql
CREATE TABLE vaults (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);

CREATE TABLE entries (
    id             TEXT PRIMARY KEY,
    vault_id       TEXT NOT NULL REFERENCES vaults(id),
    type           TEXT NOT NULL,  -- 'login', 'note', 'card', etc.
    encrypted_data BLOB NOT NULL,  -- AES-256-GCM encrypted JSON
    updated_at     INTEGER NOT NULL,
    is_favorite    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE attachments (
    id              TEXT PRIMARY KEY,
    entry_id        TEXT NOT NULL REFERENCES entries(id),
    filename        TEXT NOT NULL,
    mime_type       TEXT,
    encrypted_bytes BLOB NOT NULL
);

CREATE TABLE tags (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE entry_tags (
    entry_id TEXT NOT NULL REFERENCES entries(id),
    tag_id   TEXT NOT NULL REFERENCES tags(id),
    PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE sync_config (
    id            TEXT PRIMARY KEY,
    provider      TEXT NOT NULL,  -- 'gdrive', 'dropbox', 'onedrive', 'webdav', 'sftp'
    enabled       INTEGER NOT NULL DEFAULT 0,
    interval_secs INTEGER NOT NULL DEFAULT 300,
    remote_path   TEXT NOT NULL,
    encrypted_credentials BLOB NOT NULL,  -- AES-256-GCM encrypted JSON
    last_synced_at        INTEGER,
    last_remote_hash      TEXT
);
```

### Eintrags-Typen & Felder (im `encrypted_data`-JSON)

| Typ | Felder |
|-----|--------|
| `login` | url, username, password, totp_secret, note |
| `note` | title, text |
| `card` | cardholder, number, expiry, cvv, pin, note |
| `bank` | bank_name, iban, bic, account_holder, note |
| `identity` | first_name, last_name, address, phone, email, birthday |
| `id_document` | doc_type, number, issuing_country, expiry, photo_attachment_id |
| `ssh_key` | private_key, public_key, passphrase, note |
| `software_license` | product, license_key, registered_to, note |
| `custom` | fields: [{ label, value, field_type }] |

---

## 4. Sync-Engine

### Unterstützte Anbieter

| Anbieter | Auth-Methode | Rust-Crate |
|----------|-------------|------------|
| Google Drive | OAuth2 | `google-drive3` |
| Dropbox | OAuth2 | `dropbox-sdk` |
| OneDrive | OAuth2 (Microsoft Graph) | `reqwest` + Graph API |
| WebDAV | Basic Auth / Digest | `reqwest_dav` |
| SFTP | SSH-Key oder Passwort | `ssh2` |

### Sync-Ablauf
```
App startet / Änderung erkannt / Timer abgelaufen
        │
        ▼
  Remote-Hash abrufen
        │
        ├── gleich wie lokal? → nichts tun
        │
        └── unterschiedlich?
              │
              ├── Remote neuer (local_hash == last_known)? → herunterladen, lokal ersetzen
              ├── Lokal neuer (remote_hash == last_known)? → hochladen
              └── Beide verändert (Konflikt)?
                    → Konflikt-Kopie anlegen (vault_conflict_TIMESTAMP.db)
                    → Nutzer benachrichtigen
                    → Nutzer wählt welche Version gewinnt
```

### Sync-Konfiguration pro Anbieter
- Aktiviert/Deaktiviert
- Sync-Intervall (bei Änderung / alle N Minuten / manuell)
- Ziel-Pfad auf dem Anbieter
- Credentials (OAuth-Token oder SSH-Key/Passwort) — verschlüsselt mit Master-Key

---

## 5. UI-Struktur

### Screens
1. **Lock-Screen** — Master-Passwort eingeben, Vault entsperren
2. **Vault-Liste** — Suche, Filter nach Typ/Tag, Einträge anzeigen
3. **Eintrag-Detail** — Felder anzeigen, Passwort ein/ausblenden, kopieren, bearbeiten
4. **Eintrag erstellen/bearbeiten** — Typ wählen, Felder ausfüllen, Tags vergeben
5. **Einstellungen** — Sync-Anbieter konfigurieren, Auto-Lock-Timeout
6. **Sync-Status** — letzter Sync, Verbindungsstatus, manuelle Auslösung, Konflikte

### Navigation (Sidebar)
```
┌─────────────────┐
│   SD Vault      │
├─────────────────┤
│  Alle Einträge  │
│  Favoriten      │
│  Zuletzt genutzt│
├─────────────────┤
│  KATEGORIEN     │
│  Logins         │
│  Kreditkarten   │
│  Identitäten    │
│  Notizen        │
│  SSH-Keys       │
│  ... (alle)     │
├─────────────────┤
│  TAGS           │
│  Benutzerdefiniert│
├─────────────────┤
│  Einstellungen  │
│  Sync-Status    │
└─────────────────┘
```

### Tech-Stack Frontend
- React + TypeScript
- TailwindCSS (Dark Mode, `class`-Strategie)
- React Router (Navigation)
- Tauri IPC (`invoke`) für alle Backend-Calls

---

## 6. Tauri IPC Commands (Rust → Frontend)

```rust
// Vault
unlock_vault(password: String) -> Result<(), Error>
lock_vault() -> ()
is_unlocked() -> bool

// Einträge
get_entries(vault_id, filter) -> Vec<EntryMeta>
get_entry(id: String) -> EntryData
create_entry(data: EntryInput) -> EntryMeta
update_entry(id: String, data: EntryInput) -> EntryMeta
delete_entry(id: String) -> ()

// Anhänge
add_attachment(entry_id, filename, bytes) -> AttachmentMeta
get_attachment(id: String) -> Vec<u8>
delete_attachment(id: String) -> ()

// Sync
get_sync_config() -> Vec<SyncConfig>
save_sync_config(config: SyncConfig) -> ()
trigger_sync(provider: String) -> SyncResult
get_sync_status() -> Vec<SyncStatus>
```

---

## 7. Projektstruktur

```
SD-Passwort_Manager/
├── src/                        # React/TypeScript UI
│   ├── components/
│   │   ├── LockScreen.tsx
│   │   ├── Sidebar.tsx
│   │   ├── EntryList.tsx
│   │   ├── EntryDetail.tsx
│   │   ├── EntryForm.tsx
│   │   ├── Settings.tsx
│   │   └── SyncStatus.tsx
│   ├── hooks/
│   ├── types/
│   └── main.tsx
├── src-tauri/
│   └── src/
│       ├── lib.rs              # Tauri setup, command registration
│       ├── crypto.rs           # AES-GCM, Argon2, Zeroize
│       ├── db.rs               # SQLite, Schema, Queries
│       ├── vault.rs            # Vault-Logik, Lock/Unlock
│       ├── entries.rs          # CRUD für Einträge
│       ├── sync/
│       │   ├── mod.rs          # Sync-Engine, Konflikt-Logik
│       │   ├── gdrive.rs
│       │   ├── dropbox.rs
│       │   ├── onedrive.rs
│       │   ├── webdav.rs
│       │   └── sftp.rs
│       └── main.rs
└── docs/
    └── superpowers/specs/
        └── 2026-04-21-passwort-manager-design.md
```

---

## Nicht im Scope
- Browser-Extension / Autofill
- Biometrie / Hardware-Key
- Passwort-Generator
- Mehrere Nutzer / Sharing
- macOS / iOS
