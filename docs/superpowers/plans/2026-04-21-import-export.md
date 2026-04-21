# Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verschlüsselten Export aller Einträge als `.sdpx`-Datei (eigenes Format) sowie Import von `.sdpx`- und Bitwarden-CSV-Dateien.

**Architecture:** Rust-Backend in `src-tauri/src/import_export.rs` mit 3 Tauri-Commands (`export_items`, `import_sdpx`, `import_bitwarden_csv`). Frontend `src/components/ImportExport.tsx` nutzt FileReader für Import und blob-Download für Export — exakt wie das bestehende Backup in `Settings.tsx`. Keine neuen Crates nötig.

**Tech Stack:** Rust (aes-gcm, argon2, serde_json, hex, base64 — alles bereits in Cargo.toml), React/TypeScript

---

## Dateistruktur

| Datei | Aktion | Verantwortlichkeit |
|-------|--------|--------------------|
| `src-tauri/src/import_export.rs` | Erstellen | 3 Tauri-Commands + Structs + CSV-Parser |
| `src-tauri/src/lib.rs` | Modifizieren | `mod import_export;` + 3 Commands in generate_handler! |
| `src/components/ImportExport.tsx` | Erstellen | Export-UI + .sdpx-Import + Bitwarden-CSV-Import |
| `src/components/Settings.tsx` | Modifizieren | `<ImportExport />` einbinden |

## .sdpx-Dateiformat

```
Äußere JSON-Datei:
{
  "version": 1,
  "salt": "<argon2-SaltString>",
  "data": "<hex-encoded [12-byte nonce][AES-256-GCM ciphertext]>"
}
```

`data` enthält den mit dem Export-Passwort verschlüsselten JSON-Array der Einträge. Encryption identisch zu `encrypt_data_with_key` aus lib.rs.

## JSON-Payload-Struktur (innerhalb .sdpx)

```json
[
  {
    "id": "hex-uuid",
    "category": "login",
    "title": "GitHub",
    "username": "user@example.com",
    "is_favorite": false,
    "fields": [
      { "id": "u1", "label": "Benutzername", "value": "user@example.com", "type": "text" }
    ],
    "notes": ""
  }
]
```

---

### Task 1: Rust-Backend

**Files:**
- Create: `src-tauri/src/import_export.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Schritt 1: `src-tauri/src/import_export.rs` erstellen**

```rust
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
    let guard = state.master_key.lock().unwrap();
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
        let category = decrypt_data_with_key(master_key, &enc_cat)
            .unwrap_or_else(|_| "login".into());
        let title = decrypt_data_with_key(master_key, &enc_title)
            .unwrap_or_else(|_| "Unknown".into());
        let username = decrypt_data_with_key(master_key, &enc_user).unwrap_or_default();
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
    let guard = state.master_key.lock().unwrap();
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
    let guard = state.master_key.lock().unwrap();
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
                        id: "u1".into(),
                        label: "Benutzername".into(),
                        value: uname.clone(),
                        field_type: "text".into(),
                    });
                }
                if !pwd.is_empty() {
                    fields.push(CustomField {
                        id: "p1".into(),
                        label: "Passwort".into(),
                        value: pwd,
                        field_type: "password".into(),
                    });
                }
                if !uri.is_empty() {
                    fields.push(CustomField {
                        id: "w1".into(),
                        label: "Website".into(),
                        value: uri,
                        field_type: "url".into(),
                    });
                }
                if !totp.is_empty() {
                    fields.push(CustomField {
                        id: "t1".into(),
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
                        id: "f1".into(),
                        label: "Karteninhaber".into(),
                        value: holder,
                        field_type: "text".into(),
                    });
                }
                if !number.is_empty() {
                    fields.push(CustomField {
                        id: "f2".into(),
                        label: "Kartennummer".into(),
                        value: number,
                        field_type: "text".into(),
                    });
                }
                let exp = format!("{}/{}", exp_m, exp_y);
                if exp != "/" {
                    fields.push(CustomField {
                        id: "f3".into(),
                        label: "Ablaufdatum".into(),
                        value: exp,
                        field_type: "text".into(),
                    });
                }
                if !code.is_empty() {
                    fields.push(CustomField {
                        id: "f4".into(),
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
```

- [ ] **Schritt 2: `src-tauri/src/lib.rs` modifizieren**

Nach `mod sync;` (Zeile 19) folgende Zeile einfügen:
```rust
mod import_export;
```

Im `generate_handler![]`-Block (nach `sync::get_last_sync_status,`) folgende 3 Commands anhängen:
```rust
            import_export::export_items,
            import_export::import_sdpx,
            import_export::import_bitwarden_csv,
```

- [ ] **Schritt 3: Rust kompilieren**

```bash
cd ~/.config/superpowers/worktrees/SD-Passwort_Manager/import-export/src-tauri && cargo check 2>&1
```

Erwartetes Ergebnis: `Finished` ohne Fehler (Warnungen sind OK).

- [ ] **Schritt 4: Commit**

```bash
git add src-tauri/src/import_export.rs src-tauri/src/lib.rs
git commit -m "feat: add import/export Rust backend with sdpx and bitwarden CSV"
```

---

### Task 2: Frontend

**Files:**
- Create: `src/components/ImportExport.tsx`
- Modify: `src/components/Settings.tsx`

- [ ] **Schritt 1: `src/components/ImportExport.tsx` erstellen**

```tsx
import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export function ImportExport() {
    const [exportPwd, setExportPwd] = useState("");
    const [exportPwdConfirm, setExportPwdConfirm] = useState("");
    const [exportStatus, setExportStatus] = useState("");
    const [isExporting, setIsExporting] = useState(false);

    const [sdpxPwd, setSdpxPwd] = useState("");
    const [importStatus, setImportStatus] = useState("");
    const [isImporting, setIsImporting] = useState(false);

    const sdpxRef = useRef<HTMLInputElement>(null);
    const csvRef = useRef<HTMLInputElement>(null);

    async function handleExport() {
        if (exportPwd.length < 1) { setExportStatus("Passwort darf nicht leer sein."); return; }
        if (exportPwd !== exportPwdConfirm) { setExportStatus("Passwörter stimmen nicht überein."); return; }
        setIsExporting(true);
        setExportStatus("");
        try {
            const b64 = await invoke<string>("export_items", { password: exportPwd });
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: "application/octet-stream" });
            const el = document.createElement("a");
            el.href = URL.createObjectURL(blob);
            el.download = `SD_Passwort_Export_${new Date().toISOString().slice(0,10)}.sdpx`;
            document.body.appendChild(el); el.click(); document.body.removeChild(el);
            setExportStatus("Export erfolgreich!");
            setExportPwd(""); setExportPwdConfirm("");
        } catch (err) {
            setExportStatus(`Fehler: ${err}`);
        } finally {
            setIsExporting(false);
        }
    }

    function handleSdpxFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!sdpxPwd) { setImportStatus("Bitte zuerst das Export-Passwort eingeben."); return; }
        setIsImporting(true);
        setImportStatus("");
        const reader = new FileReader();
        reader.onload = async () => {
            const b64 = (reader.result as string).split(",")[1];
            if (!b64) { setImportStatus("Ungültige Datei."); setIsImporting(false); return; }
            try {
                const count = await invoke<number>("import_sdpx", { dataBase64: b64, password: sdpxPwd });
                setImportStatus(`${count} Einträge importiert.`);
                setSdpxPwd("");
            } catch (err) {
                setImportStatus(`Fehler: ${err}`);
            } finally {
                setIsImporting(false);
                if (sdpxRef.current) sdpxRef.current.value = "";
            }
        };
        reader.readAsDataURL(file);
    }

    function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!confirm("Bitwarden CSV ist unverschlüsselt. Bitte die Datei nach dem Import löschen. Fortfahren?")) return;
        setIsImporting(true);
        setImportStatus("");
        const reader = new FileReader();
        reader.onload = async () => {
            const csvText = reader.result as string;
            try {
                const count = await invoke<number>("import_bitwarden_csv", { csvText });
                setImportStatus(`${count} Einträge aus Bitwarden importiert.`);
            } catch (err) {
                setImportStatus(`Fehler: ${err}`);
            } finally {
                setIsImporting(false);
                if (csvRef.current) csvRef.current.value = "";
            }
        };
        reader.readAsText(file);
    }

    const labelStyle: React.CSSProperties = {
        fontSize: "12px", fontWeight: 600, color: "var(--text-tertiary)",
        marginBottom: "8px", display: "block",
    };
    const inputStyle: React.CSSProperties = {
        width: "100%", padding: "10px", borderRadius: "6px",
        border: "1px solid var(--border-color)", background: "rgba(255,255,255,0.03)",
        color: "white", marginBottom: "12px", boxSizing: "border-box",
    };
    const btnStyle: React.CSSProperties = {
        padding: "10px 16px", borderRadius: "6px", border: "1px solid var(--border-color)",
        background: "transparent", color: "white", cursor: "pointer", fontSize: "13px",
    };

    return (
        <div>
            <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "32px 0" }} />
            <h3 style={{ fontSize: "14px", marginBottom: "16px" }}>Import / Export</h3>

            {/* Export */}
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
                Alle Einträge verschlüsselt exportieren (.sdpx). Das Export-Passwort wird zum Importieren benötigt.
            </p>
            <label style={labelStyle}>EXPORT-PASSWORT</label>
            <input type="password" value={exportPwd} onChange={e => setExportPwd(e.target.value)}
                placeholder="Export-Passwort" style={inputStyle} />
            <label style={labelStyle}>PASSWORT BESTÄTIGEN</label>
            <input type="password" value={exportPwdConfirm} onChange={e => setExportPwdConfirm(e.target.value)}
                placeholder="Wiederholen" style={{ ...inputStyle, marginBottom: "16px" }} />
            <button onClick={handleExport} disabled={isExporting || !exportPwd || exportPwd !== exportPwdConfirm}
                style={{ ...btnStyle, background: "var(--accent-blue)", border: "none", width: "100%", opacity: (!exportPwd || exportPwd !== exportPwdConfirm) ? 0.5 : 1 }}>
                {isExporting ? "Exportiere..." : "Exportieren (.sdpx)"}
            </button>
            {exportStatus && (
                <p style={{ fontSize: "12px", marginTop: "8px", color: exportStatus.startsWith("Fehler") ? "var(--danger)" : "#4CD964" }}>
                    {exportStatus}
                </p>
            )}

            {/* Import */}
            <div style={{ marginTop: "24px" }}>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.5 }}>
                    Einträge importieren aus .sdpx-Datei oder Bitwarden CSV.
                </p>
                <label style={labelStyle}>EXPORT-PASSWORT FÜR .SDPX</label>
                <input type="password" value={sdpxPwd} onChange={e => setSdpxPwd(e.target.value)}
                    placeholder="Passwort der .sdpx-Datei" style={inputStyle} />
                <div style={{ display: "flex", gap: "12px" }}>
                    <label style={{ ...btnStyle, flex: 1, textAlign: "center", cursor: isImporting ? "not-allowed" : "pointer", opacity: isImporting ? 0.5 : 1 }}>
                        SD-Passwort (.sdpx)
                        <input ref={sdpxRef} type="file" accept=".sdpx" onChange={handleSdpxFile}
                            disabled={isImporting} style={{ display: "none" }} />
                    </label>
                    <label style={{ ...btnStyle, flex: 1, textAlign: "center", cursor: isImporting ? "not-allowed" : "pointer", opacity: isImporting ? 0.5 : 1 }}>
                        Bitwarden CSV
                        <input ref={csvRef} type="file" accept=".csv" onChange={handleCsvFile}
                            disabled={isImporting} style={{ display: "none" }} />
                    </label>
                </div>
                {importStatus && (
                    <p style={{ fontSize: "12px", marginTop: "8px", color: importStatus.startsWith("Fehler") ? "var(--danger)" : "#4CD964" }}>
                        {importStatus}
                    </p>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Schritt 2: `src/components/Settings.tsx` modifizieren**

Import am Anfang der Datei ergänzen (nach `import { X } from "lucide-react";`):
```typescript
import { ImportExport } from "./ImportExport";
```

Am Ende der Return-Anweisung, direkt vor dem schließenden `</div>` des inneren Containers (nach dem `</div>` der Backup-Sektion), einfügen:
```tsx
<ImportExport />
```

Die komplette modifizierte Settings.tsx sieht dann so aus — nur der Import und die letzte Zeile ändern sich:

Anfang der Datei (Zeilen 1–4):
```typescript
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { ImportExport } from "./ImportExport";
```

Vor dem letzten `</div>` des inneren Containers (nach Zeile 94):
```tsx
                <ImportExport />
            </div>
        </div>
    );
```

- [ ] **Schritt 3: TypeScript prüfen**

```bash
cd ~/.config/superpowers/worktrees/SD-Passwort_Manager/import-export && ./node_modules/.bin/tsc --noEmit 2>&1
```

Erwartetes Ergebnis: Keine Fehler.

- [ ] **Schritt 4: Commit**

```bash
git add src/components/ImportExport.tsx src/components/Settings.tsx
git commit -m "feat: add ImportExport frontend component, wire into Settings"
```
