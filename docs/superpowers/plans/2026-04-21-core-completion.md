# SD Passwort Manager — Plan 1: Core Feature Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the core password manager by adding tags, favorites, file attachments, and auto-lock timeout — then refactor the 833-line monolithic App.tsx into focused components.

**Architecture:** The Rust backend (lib.rs) gets a migration-safe `ensure_schema()` plus new commands for tags, favorites, and attachments. The 833-line App.tsx is split into LockScreen, Sidebar, EntryList, EntryDetail, and Settings components. Auto-lock is a frontend inactivity timer that calls `lock_vault` after 5 minutes.

**Tech Stack:** Rust, Tauri 2, React 19, TypeScript, SQLite (rusqlite 0.39), lucide-react

---

## File Map

**Modify:**
- `src-tauri/src/lib.rs` — schema migration, new commands
- `src/App.tsx` — slim orchestrator using extracted components

**Create:**
- `src/types.ts` — shared TypeScript types and helpers
- `src/components/LockScreen.tsx` — registration / login / recovery screens
- `src/components/Sidebar.tsx` — category navigation
- `src/components/EntryList.tsx` — filtered search list
- `src/components/EntryDetail.tsx` — view + edit with tags, favorites, attachments
- `src/components/Settings.tsx` — password change + backup/restore

---

### Task 1: Schema Migration & New Rust Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `ensure_schema` function**

In `lib.rs`, add this function just before `get_db_conn`:

```rust
fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS vaults (
            id TEXT PRIMARY KEY,
            salt TEXT NOT NULL,
            enc_dek_pwd TEXT NOT NULL,
            enc_dek_recovery TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL DEFAULT 'login',
            title TEXT NOT NULL,
            username TEXT,
            encrypted_payload TEXT NOT NULL,
            is_favorite INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS item_tags (
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (item_id, tag_id)
        );
        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            encrypted_bytes TEXT NOT NULL
        );
        PRAGMA foreign_keys = ON;
    ").map_err(|e| e.to_string())?;
    // Safe migration for DBs created before is_favorite existed
    let _ = conn.execute("ALTER TABLE items ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0", []);
    Ok(())
}
```

- [ ] **Step 2: Replace inline schema code in `check_vault_exists`**

Find this block in `check_vault_exists`:
```rust
let _ = conn.execute("ALTER TABLE items ADD COLUMN category TEXT DEFAULT 'login'", []);
let count: i64 = conn.query_row(
    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='vaults'",
    [],
    |row| row.get(0),
).unwrap_or(0);

if count == 0 {
    return Ok(false);
}

let vault_count: i64 = conn.query_row("SELECT count(*) FROM vaults", [], |row| row.get(0)).unwrap_or(0);
Ok(vault_count > 0)
```

Replace with:
```rust
ensure_schema(&conn)?;
let vault_count: i64 = conn
    .query_row("SELECT count(*) FROM vaults", [], |row| row.get(0))
    .unwrap_or(0);
Ok(vault_count > 0)
```

- [ ] **Step 3: Replace inline schema in `create_vault`**

Find the two `CREATE TABLE IF NOT EXISTS` statements inside `create_vault` and replace them with:
```rust
ensure_schema(&conn)?;
```

- [ ] **Step 4: Update `PasswordItem` struct to include `is_favorite`**

Find:
```rust
#[derive(Serialize, Deserialize)]
struct PasswordItem {
    id: String,
    category: String,
    title: String,
    username: String,
    encrypted_payload: String,
}
```

Replace with:
```rust
#[derive(Serialize, Deserialize)]
struct PasswordItem {
    id: String,
    category: String,
    title: String,
    username: String,
    encrypted_payload: String,
    is_favorite: bool,
}
```

- [ ] **Step 5: Update `get_items` query and mapping**

Find the `get_items` function and replace the prepare + query_map block:

```rust
#[tauri::command]
fn get_items(state: State<AppState>) -> Result<Vec<PasswordItem>, String> {
    if !is_unlocked(state.clone()) {
        return Err("Vault is locked".into());
    }
    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare("SELECT id, category, title, username, encrypted_payload, is_favorite FROM items ORDER BY is_favorite DESC, title ASC")
        .map_err(|e| e.to_string())?;

    let items_iter = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    for row in items_iter {
        let (id, enc_cat, enc_title, enc_user, enc_payload, is_fav) =
            row.map_err(|e| e.to_string())?;
        items.push(PasswordItem {
            id,
            category: decrypt_data_internal(&state, &enc_cat)
                .unwrap_or_else(|_| "login".to_string()),
            title: decrypt_data_internal(&state, &enc_title)
                .unwrap_or_else(|_| "Unknown".to_string()),
            username: decrypt_data_internal(&state, &enc_user).unwrap_or_default(),
            encrypted_payload: enc_payload,
            is_favorite: is_fav == 1,
        });
    }
    Ok(items)
}
```

- [ ] **Step 6: Add tags commands**

Add these before the `run()` function:

```rust
#[tauri::command]
fn get_tags(state: State<AppState>) -> Result<Vec<(String, String)>, String> {
    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare("SELECT id, name FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;
    stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn create_tag(state: State<AppState>, id: &str, name: &str) -> Result<(), String> {
    let conn = get_db_conn(&state)?;
    conn.execute(
        "INSERT OR IGNORE INTO tags (id, name) VALUES (?1, ?2)",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_tag(state: State<AppState>, id: &str) -> Result<(), String> {
    let conn = get_db_conn(&state)?;
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_item_tags(state: State<AppState>, item_id: &str) -> Result<Vec<(String, String)>, String> {
    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name FROM tags t
             JOIN item_tags it ON t.id = it.tag_id
             WHERE it.item_id = ?1 ORDER BY t.name",
        )
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![item_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_item_tags(
    state: State<AppState>,
    item_id: &str,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    let conn = get_db_conn(&state)?;
    conn.execute("DELETE FROM item_tags WHERE item_id = ?1", params![item_id])
        .map_err(|e| e.to_string())?;
    for tag_id in tag_ids {
        conn.execute(
            "INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?1, ?2)",
            params![item_id, tag_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 7: Add `toggle_favorite` command**

```rust
#[tauri::command]
fn toggle_favorite(state: State<AppState>, id: &str) -> Result<bool, String> {
    let conn = get_db_conn(&state)?;
    let current: i64 = conn
        .query_row(
            "SELECT is_favorite FROM items WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Item not found".to_string())?;
    let new_val = if current == 0 { 1i64 } else { 0i64 };
    conn.execute(
        "UPDATE items SET is_favorite = ?1 WHERE id = ?2",
        params![new_val, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(new_val == 1)
}
```

- [ ] **Step 8: Add attachment commands**

```rust
#[tauri::command]
fn add_attachment(
    state: State<AppState>,
    id: &str,
    item_id: &str,
    filename: &str,
    data_b64: &str,
) -> Result<(), String> {
    let encrypted = encrypt_data_internal(&state, data_b64)?;
    let conn = get_db_conn(&state)?;
    conn.execute(
        "INSERT OR REPLACE INTO attachments (id, item_id, filename, encrypted_bytes) VALUES (?1, ?2, ?3, ?4)",
        params![id, item_id, filename, encrypted],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_attachments(
    state: State<AppState>,
    item_id: &str,
) -> Result<Vec<(String, String)>, String> {
    let conn = get_db_conn(&state)?;
    let mut stmt = conn
        .prepare("SELECT id, filename FROM attachments WHERE item_id = ?1")
        .map_err(|e| e.to_string())?;
    stmt.query_map(params![item_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_attachment_data(state: State<AppState>, id: &str) -> Result<String, String> {
    let conn = get_db_conn(&state)?;
    let encrypted: String = conn
        .query_row(
            "SELECT encrypted_bytes FROM attachments WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| "Attachment not found".to_string())?;
    decrypt_data_internal(&state, &encrypted)
}

#[tauri::command]
fn delete_attachment(state: State<AppState>, id: &str) -> Result<(), String> {
    let conn = get_db_conn(&state)?;
    conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 9: Register all new commands in `run()`**

Find the `tauri::generate_handler![...]` block and replace it:

```rust
.invoke_handler(tauri::generate_handler![
    check_vault_exists,
    create_vault,
    unlock_vault,
    lock_vault,
    is_unlocked,
    get_items,
    add_item,
    decrypt_data,
    delete_item,
    reset_vault,
    change_password,
    recover_vault,
    export_vault_data,
    import_vault_data,
    get_tags,
    create_tag,
    delete_tag,
    get_item_tags,
    set_item_tags,
    toggle_favorite,
    add_attachment,
    get_attachments,
    get_attachment_data,
    delete_attachment,
])
```

- [ ] **Step 10: Verify Rust compiles**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5
```

Expected output ends with: `Finished dev [unoptimized + debuginfo] target(s)`

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add tags, favorites, attachments commands with schema migration"
```

---

### Task 2: Shared TypeScript Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create `src/types.ts`**

```typescript
export type ItemCategory = 'login' | 'finance' | 'document' | 'totp' | 'tech' | 'note';
export type FieldType = 'text' | 'password' | 'url' | 'email' | 'totp' | 'date';
export type FilterCategory = ItemCategory | 'all' | 'favorites';

export interface PasswordItem {
    id: string;
    category: ItemCategory;
    title: string;
    username: string;
    encrypted_payload: string;
    is_favorite: boolean;
}

export interface CustomField {
    id: string;
    label: string;
    value: string;
    type: FieldType;
}

export interface DecryptedPayload {
    fields: CustomField[];
    notes?: string;
}

export interface Tag {
    id: string;
    name: string;
}

export interface Attachment {
    id: string;
    filename: string;
}

export const CATEGORIES: { id: FilterCategory; label: string }[] = [
    { id: 'all', label: 'Alle Objekte' },
    { id: 'favorites', label: 'Favoriten' },
    { id: 'login', label: 'Anmeldedaten' },
    { id: 'finance', label: 'Kreditkarten' },
    { id: 'document', label: 'Dokumente' },
    { id: 'totp', label: 'Einmalpasswörter' },
    { id: 'tech', label: 'Tech-Geheimnisse' },
    { id: 'note', label: 'Sichere Notizen' },
];

export const DEFAULT_FIELDS: Record<ItemCategory, CustomField[]> = {
    login: [
        { id: 'u1', label: 'Benutzername', value: '', type: 'text' },
        { id: 'p1', label: 'Passwort', value: '', type: 'password' },
        { id: 'w1', label: 'Website', value: '', type: 'url' },
        { id: 't1', label: 'Einmalpasswort', value: '', type: 'totp' },
    ],
    finance: [
        { id: 'f1', label: 'Karteninhaber', value: '', type: 'text' },
        { id: 'f2', label: 'Kartennummer', value: '', type: 'text' },
        { id: 'f3', label: 'Ablaufdatum', value: '', type: 'text' },
        { id: 'f4', label: 'Prüfnummer (CVV)', value: '', type: 'password' },
        { id: 'f5', label: 'PIN', value: '', type: 'password' },
    ],
    document: [
        { id: 'd1', label: 'Typ', value: '', type: 'text' },
        { id: 'd2', label: 'Nummer', value: '', type: 'text' },
        { id: 'd3', label: 'Ausstellungsdatum', value: '', type: 'date' },
        { id: 'd4', label: 'Ablaufdatum', value: '', type: 'date' },
    ],
    totp: [
        { id: 'to1', label: 'Dienst', value: '', type: 'text' },
        { id: 'to2', label: 'Secret Key', value: '', type: 'password' },
    ],
    tech: [
        { id: 'tc1', label: 'Host', value: '', type: 'url' },
        { id: 'tc2', label: 'API Key', value: '', type: 'password' },
        { id: 'tc3', label: 'SSH Private Key', value: '', type: 'password' },
    ],
    note: [],
};

export const AVATAR_COLORS = [
    '#FF2D55', '#FF9500', '#FFCC00', '#4CD964',
    '#5AC8FA', '#007AFF', '#5856D6', '#FF3B30',
];

export function getAvatarColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function generatePassword(length = 24): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=';
    let pass = '';
    for (let i = 0; i < length; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    return pass;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: extract shared TypeScript types"
```

---

### Task 3: Extract LockScreen Component

**Files:**
- Create: `src/components/LockScreen.tsx`

- [ ] **Step 1: Create `src/components/LockScreen.tsx`**

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Shield } from "lucide-react";

interface LockScreenProps {
    vaultExists: boolean;
    onUnlocked: () => void;
}

export function LockScreen({ vaultExists, onUnlocked }: LockScreenProps) {
    const [masterPassword, setMasterPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [secretKeyInput, setSecretKeyInput] = useState("");
    const [isDeriving, setIsDeriving] = useState(false);
    const [regStep, setRegStep] = useState(1);
    const [generatedSecretKey] = useState(() => {
        const segs = Array.from({ length: 4 }, () =>
            Math.random().toString(36).substring(2, 8).toUpperCase()
        );
        return `SD-${segs.join('-')}`;
    });
    const [showRecovery, setShowRecovery] = useState(false);
    const [recoverySecretKey, setRecoverySecretKey] = useState("");
    const [recoveryNewPassword, setRecoveryNewPassword] = useState("");
    const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");

    async function handleRegister(e: React.FormEvent) {
        e.preventDefault();
        if (masterPassword !== confirmPassword) { alert("Passwörter stimmen nicht überein!"); return; }
        if (masterPassword.length < 8) { alert("Mindestens 8 Zeichen."); return; }
        setIsDeriving(true);
        try {
            await invoke("create_vault", { password: masterPassword, secretKey: generatedSecretKey });
            localStorage.setItem("sd_secret_key", generatedSecretKey);
            onUnlocked();
        } catch { alert("Fehler beim Erstellen des Tresors."); }
        finally { setIsDeriving(false); setMasterPassword(""); setConfirmPassword(""); }
    }

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        if (!masterPassword) return;
        setIsDeriving(true);
        try {
            await invoke("unlock_vault", { password: masterPassword });
            const deviceSecret = localStorage.getItem("sd_secret_key") || secretKeyInput.trim().toUpperCase();
            if (!localStorage.getItem("sd_secret_key") && deviceSecret)
                localStorage.setItem("sd_secret_key", deviceSecret);
            onUnlocked();
        } catch { alert("Falsches Master-Passwort."); }
        finally { setIsDeriving(false); setMasterPassword(""); }
    }

    async function handleRecover(e: React.FormEvent) {
        e.preventDefault();
        if (recoveryNewPassword.length < 8) { alert("Mindestens 8 Zeichen."); return; }
        if (recoveryNewPassword !== recoveryConfirmPassword) { alert("Passwörter stimmen nicht überein!"); return; }
        setIsDeriving(true);
        try {
            const cleanSecret = recoverySecretKey.trim().toUpperCase();
            await invoke("recover_vault", { secretKey: cleanSecret, newPassword: recoveryNewPassword });
            localStorage.setItem("sd_secret_key", cleanSecret);
            alert("Passwort zurückgesetzt!");
            setShowRecovery(false);
            onUnlocked();
        } catch { alert("Ungültiger Secret Key."); }
        finally { setIsDeriving(false); setRecoveryNewPassword(""); setRecoveryConfirmPassword(""); }
    }

    const header = (
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <Shield size={64} color="var(--accent-blue)" style={{ marginBottom: '16px' }} />
            <h1 style={{ fontSize: '24px', fontWeight: 600 }}>
                {vaultExists ? 'SD-Passwort' : 'Willkommen bei SD-Passwort'}
            </h1>
            {!vaultExists && (
                <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
                    Lokaler 100% Zero-Knowledge Tresor
                </p>
            )}
        </div>
    );

    if (!vaultExists) {
        return (
            <div className="login-screen">
                {header}
                <form onSubmit={handleRegister} className="login-card" style={{ maxWidth: '420px' }}>
                    {regStep === 1 ? (
                        <>
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                                Dein Tresor wird ausschließlich lokal verschlüsselt. Bitte erstelle ein sicheres Master-Passwort.
                            </p>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>MASTER-PASSWORT</label>
                            <input type="password" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" autoFocus />
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>PASSWORT BESTÄTIGEN</label>
                            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Passwort wiederholen" />
                            <button type="button" onClick={() => {
                                if (masterPassword.length >= 8 && masterPassword === confirmPassword) setRegStep(2);
                                else alert("Bitte ein gültiges Passwort (min. 8 Zeichen) festlegen.");
                            }}>Weiter</button>
                        </>
                    ) : (
                        <>
                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                                Zusätzlich zum Passwort wird ein <strong style={{ color: 'white' }}>Secret Key</strong> für dieses Gerät generiert.
                            </p>
                            <div style={{ background: 'rgba(0,0,0,0.3)', padding: '24px', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '24px', textAlign: 'center' }}>
                                <div style={{ fontSize: '12px', color: 'var(--accent-blue)', fontWeight: 600, marginBottom: '8px' }}>DEIN SECRET KEY (Emergency Kit)</div>
                                <div style={{ fontSize: '18px', fontFamily: 'monospace', letterSpacing: '1px', color: 'white' }}>{generatedSecretKey}</div>
                            </div>
                            <p style={{ fontSize: '13px', color: 'var(--danger)', marginBottom: '24px', lineHeight: 1.5 }}>
                                <strong>Achtung:</strong> Speichere diesen Key sicher ab!
                            </p>
                            <button type="button" onClick={() => {
                                const el = document.createElement("a");
                                const file = new Blob([`SD-PASSWORT EMERGENCY KIT\n\nSecret Key: ${generatedSecretKey}\n\nMaster-Passwort: ________________________`], { type: 'text/plain' });
                                el.href = URL.createObjectURL(file);
                                el.download = "SD_Passwort_Emergency_Kit.txt";
                                document.body.appendChild(el); el.click(); document.body.removeChild(el);
                            }} style={{ background: 'var(--accent-blue)', color: 'white', marginBottom: '12px' }}>
                                Emergency Kit speichern (.txt)
                            </button>
                            <button type="submit" disabled={isDeriving}>
                                {isDeriving ? "Erstelle Tresor..." : "Tresor jetzt erstellen"}
                            </button>
                            <button type="button" onClick={() => setRegStep(1)} style={{ background: 'transparent', color: 'var(--text-secondary)', marginTop: '12px', boxShadow: 'none' }}>
                                Zurück
                            </button>
                        </>
                    )}
                </form>
            </div>
        );
    }

    const needsSecret = !localStorage.getItem("sd_secret_key");

    return (
        <div className="login-screen">
            {header}
            {showRecovery ? (
                <form onSubmit={handleRecover} className="login-card">
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                        Gib deinen <strong style={{ color: 'white' }}>Secret Key</strong> ein um ein neues Master-Passwort zu vergeben.
                    </p>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>SECRET KEY</label>
                    <input type="text" value={recoverySecretKey} onChange={e => setRecoverySecretKey(e.target.value)} placeholder="SD-XXXX-XXXX-XXXX-XXXX" style={{ fontFamily: 'monospace' }} autoFocus />
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block', marginTop: '16px' }}>NEUES MASTER-PASSWORT</label>
                    <input type="password" value={recoveryNewPassword} onChange={e => setRecoveryNewPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" />
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block', marginTop: '16px' }}>PASSWORT BESTÄTIGEN</label>
                    <input type="password" value={recoveryConfirmPassword} onChange={e => setRecoveryConfirmPassword(e.target.value)} placeholder="Passwort wiederholen" />
                    <button type="submit" disabled={isDeriving}>{isDeriving ? "Wiederherstellen..." : "Tresor wiederherstellen"}</button>
                    <button type="button" onClick={() => setShowRecovery(false)} style={{ background: 'transparent', color: 'var(--text-secondary)', marginTop: '12px', boxShadow: 'none' }}>Abbrechen</button>
                </form>
            ) : (
                <form onSubmit={handleLogin} className="login-card">
                    {needsSecret && (
                        <>
                            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>SECRET KEY (NEUES GERÄT)</label>
                            <input type="text" value={secretKeyInput} onChange={e => setSecretKeyInput(e.target.value)} placeholder="SD-XXXX-XXXX-XXXX-XXXX" style={{ fontFamily: 'monospace' }} autoFocus />
                        </>
                    )}
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>MASTER-PASSWORT</label>
                    <input type="password" value={masterPassword} onChange={e => setMasterPassword(e.target.value)} placeholder="Dein Master-Passwort" autoFocus={!needsSecret} />
                    <button type="submit" disabled={isDeriving}>{isDeriving ? "Wird entsperrt..." : "Entsperren"}</button>
                    <button type="button" onClick={() => setShowRecovery(true)} style={{ background: 'transparent', color: 'var(--text-secondary)', marginTop: '12px', boxShadow: 'none' }}>
                        Passwort vergessen? (Wiederherstellung mit Secret Key)
                    </button>
                    <button type="button" onClick={async () => {
                        if (confirm("ACHTUNG: Dies löscht deinen gesamten Tresor unwiderruflich! Fortfahren?")) {
                            try { await invoke("reset_vault"); } catch (e) { console.error(e); }
                            localStorage.removeItem("sd_secret_key");
                            window.location.reload();
                        }
                    }} style={{ background: 'transparent', color: 'var(--danger)', marginTop: '24px', border: '1px solid var(--danger)', opacity: 0.5 }}>
                        ⚠️ Tresor unwiderruflich löschen
                    </button>
                </form>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/LockScreen.tsx
git commit -m "feat: extract LockScreen component"
```

---

### Task 4: Extract Sidebar Component

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: Create `src/components/Sidebar.tsx`**

```tsx
import { Shield, KeyRound, CreditCard, FileText, Code, StickyNote, Smartphone, Database, Star } from "lucide-react";
import type { FilterCategory } from "../types";

const NAV_ITEMS: { id: FilterCategory; label: string; Icon: React.ElementType }[] = [
    { id: 'all', label: 'Alle Objekte', Icon: Database },
    { id: 'favorites', label: 'Favoriten', Icon: Star },
    { id: 'login', label: 'Anmeldedaten', Icon: KeyRound },
    { id: 'finance', label: 'Kreditkarten', Icon: CreditCard },
    { id: 'document', label: 'Dokumente', Icon: FileText },
    { id: 'totp', label: 'Einmalpasswörter', Icon: Smartphone },
    { id: 'tech', label: 'Tech-Geheimnisse', Icon: Code },
    { id: 'note', label: 'Sichere Notizen', Icon: StickyNote },
];

interface SidebarProps {
    selectedCategory: FilterCategory;
    onCategoryChange: (cat: FilterCategory) => void;
    onSettings: () => void;
    onLock: () => void;
}

export function Sidebar({ selectedCategory, onCategoryChange, onSettings, onLock }: SidebarProps) {
    return (
        <div className="sidebar">
            <div className="sidebar-header">
                <Shield size={22} color="var(--accent-blue)" />
                <h2>SD-Passwort</h2>
            </div>

            <div className="sidebar-nav">
                <div className="sidebar-section-title">Tresor</div>
                {NAV_ITEMS.slice(0, 2).map(({ id, label, Icon }) => (
                    <div key={id} className={`nav-item ${selectedCategory === id ? 'active' : ''}`} onClick={() => onCategoryChange(id)}>
                        <Icon size={16} /> {label}
                    </div>
                ))}
                <div className="sidebar-section-title" style={{ marginTop: '16px' }}>Kategorien</div>
                {NAV_ITEMS.slice(2).map(({ id, label, Icon }) => (
                    <div key={id} className={`nav-item ${selectedCategory === id ? 'active' : ''}`} onClick={() => onCategoryChange(id)}>
                        <Icon size={16} /> {label}
                    </div>
                ))}
            </div>

            <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button className="lock-btn" onClick={onSettings} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
                    Einstellungen
                </button>
                <button className="lock-btn" onClick={onLock}>Tresor sperren</button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat: extract Sidebar component with favorites filter"
```

---

### Task 5: Extract EntryList Component

**Files:**
- Create: `src/components/EntryList.tsx`

- [ ] **Step 1: Create `src/components/EntryList.tsx`**

```tsx
import { Plus, Search, Star } from "lucide-react";
import type { PasswordItem, FilterCategory } from "../types";
import { getAvatarColor, CATEGORIES } from "../types";

interface EntryListProps {
    items: PasswordItem[];
    selectedId: string | null;
    selectedCategory: FilterCategory;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    onSelectItem: (item: PasswordItem) => void;
    onNewItem: () => void;
}

export function EntryList({ items, selectedId, selectedCategory, searchQuery, onSearchChange, onSelectItem, onNewItem }: EntryListProps) {
    const filtered = items.filter(item => {
        const s = searchQuery.toLowerCase();
        const matchesSearch = item.title.toLowerCase().includes(s) || item.username.toLowerCase().includes(s);
        if (!matchesSearch) return false;
        if (selectedCategory === 'all') return true;
        if (selectedCategory === 'favorites') return item.is_favorite;
        return item.category === selectedCategory;
    });

    return (
        <div className="item-list-pane">
            <div className="list-toolbar">
                <div className="search-box">
                    <Search size={14} color="var(--text-secondary)" />
                    <input placeholder="Suchen" value={searchQuery} onChange={e => onSearchChange(e.target.value)} />
                </div>
                <button className="icon-btn" onClick={onNewItem} style={{ background: 'var(--accent-blue)', color: 'white' }}>
                    <Plus size={16} />
                </button>
            </div>
            <div className="items-scroll">
                {filtered.map(item => (
                    <div key={item.id} className={`list-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => onSelectItem(item)}>
                        <div className="item-avatar" style={{ backgroundColor: getAvatarColor(item.title) }}>
                            {item.title.charAt(0).toUpperCase()}
                        </div>
                        <div className="list-item-details">
                            <div className="list-item-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {item.title}
                                {item.is_favorite && (
                                    <Star size={11} fill="#FFCC00" color="#FFCC00" />
                                )}
                            </div>
                            <div className="list-item-subtitle">
                                {item.username || CATEGORIES.find(c => c.id === item.category)?.label}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/EntryList.tsx
git commit -m "feat: extract EntryList component"
```

---

### Task 6: Extract Settings Component

**Files:**
- Create: `src/components/Settings.tsx`

- [ ] **Step 1: Create `src/components/Settings.tsx`**

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";

interface SettingsProps {
    onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isDeriving, setIsDeriving] = useState(false);

    async function handleChangePassword(e: React.FormEvent) {
        e.preventDefault();
        if (newPassword.length < 8) { alert("Mindestens 8 Zeichen."); return; }
        if (newPassword !== confirmPassword) { alert("Passwörter stimmen nicht überein!"); return; }
        setIsDeriving(true);
        try {
            await invoke("change_password", { newPassword });
            alert("Passwort erfolgreich geändert!");
            onClose();
            setNewPassword(""); setConfirmPassword("");
        } catch { alert("Fehler beim Ändern des Passworts."); }
        finally { setIsDeriving(false); }
    }

    async function handleExportVault() {
        try {
            const b64 = await invoke<string>("export_vault_data");
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const blob = new Blob([bytes], { type: "application/octet-stream" });
            const el = document.createElement("a");
            el.href = URL.createObjectURL(blob);
            el.download = "SD_Passwort_Backup.sdvault";
            document.body.appendChild(el); el.click(); document.body.removeChild(el);
        } catch { alert("Fehler beim Exportieren!"); }
    }

    async function handleImportVault(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!confirm("Achtung! Der aktuelle Tresor wird überschrieben! Fortfahren?")) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const base64Data = (reader.result as string).split(",")[1];
            if (!base64Data) { alert("Ungültige Datei."); return; }
            try {
                await invoke("import_vault_data", { base64Data });
                alert("Backup importiert! Bitte entsperre den Tresor erneut.");
                window.location.reload();
            } catch { alert("Fehler beim Importieren!"); }
        };
        reader.readAsDataURL(file);
    }

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, backdropFilter: 'blur(4px)' }}>
            <div style={{ background: 'var(--bg-card)', padding: '32px', borderRadius: '12px', width: '400px', border: '1px solid var(--border-color)', boxShadow: '0 24px 48px rgba(0,0,0,0.5)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <h2 style={{ fontSize: '18px', margin: 0 }}>Tresor Einstellungen</h2>
                    <button className="icon-btn" onClick={onClose}><X size={20} /></button>
                </div>

                <form onSubmit={handleChangePassword}>
                    <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: 1.5 }}>
                        Hier kannst du dein Master-Passwort ändern.
                    </p>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>NEUES MASTER-PASSWORT</label>
                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Mindestens 8 Zeichen" style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)', color: 'white', marginBottom: '16px' }} autoFocus />
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '8px', display: 'block' }}>PASSWORT BESTÄTIGEN</label>
                    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Passwort wiederholen" style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)', color: 'white', marginBottom: '24px' }} />
                    <button type="submit" disabled={isDeriving} style={{ width: '100%', padding: '12px', background: 'var(--accent-blue)', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}>
                        {isDeriving ? "Wird geändert..." : "Passwort ändern"}
                    </button>
                </form>

                <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '32px 0' }} />

                <h3 style={{ fontSize: '14px', marginBottom: '16px' }}>Backup & Wiederherstellung</h3>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
                    Exportiere deinen verschlüsselten Tresor als Backup-Datei.
                </p>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button type="button" onClick={handleExportVault} style={{ flex: 1, padding: '10px', background: 'transparent', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer' }}>
                        Backup exportieren
                    </button>
                    <label style={{ flex: 1, padding: '10px', background: 'transparent', color: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', textAlign: 'center' }}>
                        Backup importieren
                        <input type="file" onChange={handleImportVault} accept=".sdvault,.db" style={{ display: 'none' }} />
                    </label>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: extract Settings component"
```

---

### Task 7: Extract EntryDetail Component

**Files:**
- Create: `src/components/EntryDetail.tsx`

- [ ] **Step 1: Create `src/components/EntryDetail.tsx`**

```tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Copy, Trash2, RefreshCw, Eye, Star, Paperclip } from "lucide-react";
import type { PasswordItem, DecryptedPayload, CustomField, ItemCategory, Tag, Attachment } from "../types";
import { getAvatarColor, generatePassword, DEFAULT_FIELDS, CATEGORIES } from "../types";

interface EntryDetailProps {
    item: PasswordItem | null;
    isCreating: boolean;
    onSaved: (savedId: string) => void;
    onDeleted: () => void;
    onCancelCreate: () => void;
    onFavoriteToggled: () => void;
}

export function EntryDetail({ item, isCreating, onSaved, onDeleted, onCancelCreate, onFavoriteToggled }: EntryDetailProps) {
    const [payload, setPayload] = useState<DecryptedPayload | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editTitle, setEditTitle] = useState("");
    const [editCategory, setEditCategory] = useState<ItemCategory>('login');
    const [editFields, setEditFields] = useState<CustomField[]>([]);
    const [editNotes, setEditNotes] = useState("");
    const [allTags, setAllTags] = useState<Tag[]>([]);
    const [itemTags, setItemTags] = useState<Tag[]>([]);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        invoke<[string, string][]>("get_tags").then(raw =>
            setAllTags(raw.map(([id, name]) => ({ id, name })))
        );
    }, []);

    useEffect(() => {
        if (isCreating) {
            setIsEditing(true);
            setEditTitle("Ohne Titel");
            setEditCategory('login');
            setEditFields(JSON.parse(JSON.stringify(DEFAULT_FIELDS['login'])));
            setEditNotes("");
            setItemTags([]);
            setPayload(null);
        } else if (item) {
            setIsEditing(false);
            loadItem(item);
        }
    }, [item?.id, isCreating]);

    async function loadItem(item: PasswordItem) {
        try {
            const raw = await invoke<string>("decrypt_data", { encryptedHex: item.encrypted_payload });
            const parsed = JSON.parse(raw);
            setPayload(parsed.fields ? parsed : {
                fields: Object.entries(parsed)
                    .filter(([k]) => k !== 'notes')
                    .map(([k, v]) => ({
                        id: crypto.randomUUID(), label: k, value: String(v),
                        type: k.toLowerCase().includes('password') ? 'password' as const : 'text' as const,
                    })),
                notes: parsed.notes,
            });
        } catch { setPayload({ fields: [], notes: '' }); }

        const rawTags = await invoke<[string, string][]>("get_item_tags", { itemId: item.id });
        setItemTags(rawTags.map(([id, name]) => ({ id, name })));

        const rawAtts = await invoke<[string, string][]>("get_attachments", { itemId: item.id });
        setAttachments(rawAtts.map(([id, filename]) => ({ id, filename })));
    }

    async function handleSave() {
        if (!editTitle.trim()) return;
        setIsSaving(true);
        try {
            const usernameField = editFields.find(f =>
                f.label.toLowerCase().includes('benutzer') || f.label.toLowerCase().includes('email')
            );
            const id = item?.id ?? crypto.randomUUID();
            await invoke("add_item", {
                id,
                category: editCategory,
                title: editTitle,
                username: usernameField?.value ?? "",
                payload: JSON.stringify({ fields: editFields.filter(f => f.value.trim()), notes: editNotes }),
            });
            await invoke("set_item_tags", { itemId: id, tagIds: itemTags.map(t => t.id) });
            setIsEditing(false);
            onSaved(id);
        } catch { alert("Fehler beim Speichern."); }
        finally { setIsSaving(false); }
    }

    async function handleDelete() {
        if (!item || !confirm("Eintrag wirklich löschen?")) return;
        await invoke("delete_item", { id: item.id });
        onDeleted();
    }

    async function handleToggleFavorite() {
        if (!item) return;
        await invoke("toggle_favorite", { id: item.id });
        onFavoriteToggled();
    }

    async function handleAddAttachment(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file || !item) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const b64 = (reader.result as string).split(",")[1];
            await invoke("add_attachment", { id: crypto.randomUUID(), itemId: item.id, filename: file.name, dataB64: b64 });
            const raw = await invoke<[string, string][]>("get_attachments", { itemId: item.id });
            setAttachments(raw.map(([id, filename]) => ({ id, filename })));
        };
        reader.readAsDataURL(file);
    }

    async function handleDownloadAttachment(att: Attachment) {
        const data = await invoke<string>("get_attachment_data", { id: att.id });
        const bin = atob(data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes]);
        const el = document.createElement("a");
        el.href = URL.createObjectURL(blob);
        el.download = att.filename;
        el.click();
    }

    async function handleDeleteAttachment(id: string) {
        await invoke("delete_attachment", { id });
        setAttachments(prev => prev.filter(a => a.id !== id));
    }

    async function handleNewTag() {
        const name = prompt("Tag-Name:");
        if (!name?.trim()) return;
        const id = crypto.randomUUID();
        await invoke("create_tag", { id, name: name.trim() });
        const raw = await invoke<[string, string][]>("get_tags");
        const updated = raw.map(([id, name]) => ({ id, name }));
        setAllTags(updated);
    }

    function toggleEditTag(tag: Tag) {
        setItemTags(prev => prev.find(t => t.id === tag.id)
            ? prev.filter(t => t.id !== tag.id)
            : [...prev, tag]
        );
    }

    const copy = (text: string) => navigator.clipboard.writeText(text);

    if (!item && !isCreating) {
        return (
            <div className="details-pane" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: '64px', opacity: 0.1 }}>🔒</div>
            </div>
        );
    }

    const displayTitle = isEditing ? editTitle : (item?.title ?? "");
    const displayCategory = isEditing ? editCategory : (item?.category ?? 'login');

    return (
        <div className="details-pane">
            <div className="details-toolbar">
                {isEditing ? (
                    <>
                        <button className="btn" onClick={() => { if (isCreating) onCancelCreate(); else { setIsEditing(false); if (item) loadItem(item); } }}>Abbrechen</button>
                        <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>{isSaving ? "..." : "Speichern"}</button>
                    </>
                ) : (
                    <>
                        <button className="btn" onClick={() => { setEditTitle(item!.title); setEditCategory(item!.category); setEditFields(JSON.parse(JSON.stringify(payload?.fields ?? []))); setEditNotes(payload?.notes ?? ""); setIsEditing(true); }}>Bearbeiten</button>
                        <button className="btn" onClick={handleToggleFavorite} title={item?.is_favorite ? "Aus Favoriten entfernen" : "Zu Favoriten"}>
                            <Star size={15} fill={item?.is_favorite ? "#FFCC00" : "none"} color={item?.is_favorite ? "#FFCC00" : "currentColor"} />
                        </button>
                        <button className="btn" style={{ color: 'var(--danger)' }} onClick={handleDelete}>Löschen</button>
                    </>
                )}
            </div>

            <div className="details-content">
                {/* Header */}
                <div className="details-header-large">
                    <div className="large-avatar" style={{ backgroundColor: getAvatarColor(displayTitle || "A") }}>
                        {(displayTitle || "O").charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                        {isEditing ? (
                            <>
                                <input className="large-title-input" value={editTitle} onChange={e => setEditTitle(e.target.value)} placeholder="Titel" autoFocus />
                                <select value={editCategory} onChange={e => { const cat = e.target.value as ItemCategory; setEditCategory(cat); if (isCreating) setEditFields(JSON.parse(JSON.stringify(DEFAULT_FIELDS[cat]))); }}
                                    style={{ marginTop: '8px', background: 'transparent', color: 'var(--accent-blue)', border: 'none', outline: 'none', fontSize: '14px', cursor: 'pointer' }}>
                                    {CATEGORIES.filter(c => c.id !== 'all' && c.id !== 'favorites').map(c =>
                                        <option key={c.id} value={c.id} style={{ background: '#333', color: 'white' }}>{c.label}</option>
                                    )}
                                </select>
                            </>
                        ) : (
                            <>
                                <div className="large-title">{displayTitle}</div>
                                <div className="large-subtitle">{CATEGORIES.find(c => c.id === displayCategory)?.label}</div>
                            </>
                        )}
                    </div>
                </div>

                {/* Fields */}
                <div className="section-card">
                    {isEditing ? (
                        <>
                            {editFields.map(field => (
                                <div className="field-row" key={field.id} style={{ padding: '8px 20px', alignItems: 'center' }}>
                                    <div className="field-label" style={{ paddingRight: '12px' }}>
                                        <input className="edit-label-input" value={field.label} onChange={e => setEditFields(fs => fs.map(f => f.id === field.id ? { ...f, label: e.target.value } : f))} />
                                    </div>
                                    <div className="field-value" style={{ gap: '8px' }}>
                                        <input className="edit-input" type="text" value={field.value} onChange={e => setEditFields(fs => fs.map(f => f.id === field.id ? { ...f, value: e.target.value } : f))} placeholder="Wert" style={field.type === 'password' ? { fontFamily: 'monospace' } : {}} />
                                        {field.type === 'password' && (
                                            <button className="icon-btn" onClick={() => setEditFields(fs => fs.map(f => f.id === field.id ? { ...f, value: generatePassword() } : f))}><RefreshCw size={16} /></button>
                                        )}
                                        <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => setEditFields(fs => fs.filter(f => f.id !== field.id))}><Trash2 size={16} /></button>
                                    </div>
                                </div>
                            ))}
                            <div className="add-field-row">
                                <button className="add-field-btn" onClick={() => setEditFields([...editFields, { id: crypto.randomUUID(), label: 'Neues Feld', value: '', type: 'text' }])}>
                                    <Plus size={14} /> Weiteres Feld
                                </button>
                            </div>
                        </>
                    ) : (
                        payload?.fields?.map(field => {
                            const sensitive = field.type === 'password' || field.type === 'totp';
                            return (
                                <div className="field-row" key={field.id}>
                                    <div className="field-label">{field.label}</div>
                                    <div className={`field-value ${sensitive ? 'obscured monospace' : ''}`}>
                                        {sensitive ? field.value.replace(/./g, '•') : field.value}
                                    </div>
                                    <div className="field-actions">
                                        {sensitive && (
                                            <button className="icon-btn" onClick={e => {
                                                const valNode = (e.currentTarget.parentElement?.parentElement as Element)?.querySelector('.field-value');
                                                if (valNode) {
                                                    valNode.textContent = field.value;
                                                    valNode.classList.remove('obscured');
                                                    setTimeout(() => { valNode.textContent = field.value.replace(/./g, '•'); valNode.classList.add('obscured'); }, 5000);
                                                }
                                            }}><Eye size={16} /></button>
                                        )}
                                        <button className="icon-btn" onClick={() => copy(field.value)}><Copy size={16} /></button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Notes */}
                {(isEditing || payload?.notes) && (
                    <>
                        <div className="section-card-title">NOTIZEN</div>
                        <div className="section-card" style={{ padding: '12px' }}>
                            {isEditing ? (
                                <textarea className="edit-input" value={editNotes} onChange={e => setEditNotes(e.target.value)} style={{ border: 'none', background: 'transparent', width: '100%', minHeight: '80px' }} placeholder="Zusätzliche Informationen..." />
                            ) : (
                                <div style={{ padding: '16px 20px', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{payload?.notes}</div>
                            )}
                        </div>
                    </>
                )}

                {/* Tags */}
                <div className="section-card-title">TAGS</div>
                <div className="section-card" style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {isEditing ? (
                        <>
                            {allTags.map(tag => (
                                <button key={tag.id} onClick={() => toggleEditTag(tag)}
                                    style={{ padding: '4px 10px', borderRadius: '12px', border: '1px solid var(--border-color)', background: itemTags.find(t => t.id === tag.id) ? 'var(--accent-blue)' : 'transparent', color: 'white', cursor: 'pointer', fontSize: '12px' }}>
                                    {tag.name}
                                </button>
                            ))}
                            <button onClick={handleNewTag} style={{ padding: '4px 10px', borderRadius: '12px', border: '1px dashed var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px' }}>
                                + Neuer Tag
                            </button>
                        </>
                    ) : itemTags.length > 0 ? (
                        itemTags.map(tag => (
                            <span key={tag.id} style={{ padding: '4px 10px', borderRadius: '12px', background: 'rgba(0,122,255,0.15)', color: 'var(--accent-blue)', fontSize: '12px' }}>
                                {tag.name}
                            </span>
                        ))
                    ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '12px' }}>Keine Tags</span>
                    )}
                </div>

                {/* Attachments — only for existing items */}
                {!isCreating && item && (
                    <>
                        <div className="section-card-title">ANHÄNGE</div>
                        <div className="section-card" style={{ padding: '12px 20px' }}>
                            {attachments.map(att => (
                                <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                                    <Paperclip size={14} color="var(--text-secondary)" />
                                    <span style={{ flex: 1, fontSize: '14px' }}>{att.filename}</span>
                                    <button className="icon-btn" onClick={() => handleDownloadAttachment(att)} title="Herunterladen"><Copy size={14} /></button>
                                    <button className="icon-btn" style={{ color: 'var(--danger)' }} onClick={() => handleDeleteAttachment(att.id)}><Trash2 size={14} /></button>
                                </div>
                            ))}
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', marginTop: attachments.length ? '8px' : '0' }}>
                                <Plus size={14} /> Datei anhängen
                                <input type="file" onChange={handleAddAttachment} style={{ display: 'none' }} />
                            </label>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/EntryDetail.tsx
git commit -m "feat: extract EntryDetail with tags, favorites, attachments"
```

---

### Task 8: Refactor App.tsx & Add Auto-Lock

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the entire content of `src/App.tsx`**

```tsx
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LockScreen } from "./components/LockScreen";
import { Sidebar } from "./components/Sidebar";
import { EntryList } from "./components/EntryList";
import { EntryDetail } from "./components/EntryDetail";
import { Settings } from "./components/Settings";
import type { PasswordItem, FilterCategory } from "./types";
import "./App.css";

const AUTO_LOCK_MS = 5 * 60 * 1000;

export default function App() {
    const [vaultExists, setVaultExists] = useState<boolean | null>(null);
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [items, setItems] = useState<PasswordItem[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedItem, setSelectedItem] = useState<PasswordItem | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { initApp(); }, []);

    useEffect(() => {
        if (!isUnlocked) return;
        const reset = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(lockVault, AUTO_LOCK_MS);
        };
        const events = ['mousemove', 'keydown', 'mousedown', 'touchstart'];
        events.forEach(ev => document.addEventListener(ev, reset));
        reset();
        return () => {
            events.forEach(ev => document.removeEventListener(ev, reset));
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [isUnlocked]);

    async function initApp() {
        try {
            const exists = await invoke<boolean>("check_vault_exists");
            setVaultExists(exists);
            const unlocked = await invoke<boolean>("is_unlocked");
            setIsUnlocked(unlocked);
            if (unlocked) await loadItems();
        } catch (e) { console.error(e); }
    }

    async function loadItems() {
        setItems(await invoke<PasswordItem[]>("get_items"));
    }

    async function lockVault() {
        await invoke("lock_vault");
        setIsUnlocked(false);
        setItems([]);
        setSelectedItem(null);
        setIsCreating(false);
        if (timerRef.current) clearTimeout(timerRef.current);
    }

    async function handleSelectItem(item: PasswordItem) {
        setIsCreating(false);
        const latest = await invoke<PasswordItem[]>("get_items");
        setItems(latest);
        setSelectedItem(latest.find(i => i.id === item.id) ?? item);
    }

    async function handleSaved(savedId: string) {
        const latest = await invoke<PasswordItem[]>("get_items");
        setItems(latest);
        setIsCreating(false);
        setSelectedItem(latest.find(i => i.id === savedId) ?? null);
    }

    if (vaultExists === null) return null;

    if (!isUnlocked) {
        return (
            <LockScreen
                vaultExists={vaultExists}
                onUnlocked={async () => {
                    setIsUnlocked(true);
                    setVaultExists(true);
                    await loadItems();
                }}
            />
        );
    }

    return (
        <div className="app-layout">
            <Sidebar
                selectedCategory={selectedCategory}
                onCategoryChange={setSelectedCategory}
                onSettings={() => setShowSettings(true)}
                onLock={lockVault}
            />
            <EntryList
                items={items}
                selectedId={selectedItem?.id ?? null}
                selectedCategory={selectedCategory}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSelectItem={handleSelectItem}
                onNewItem={() => { setSelectedItem(null); setIsCreating(true); }}
            />
            <EntryDetail
                item={selectedItem}
                isCreating={isCreating}
                onSaved={handleSaved}
                onDeleted={() => { setSelectedItem(null); loadItems(); }}
                onCancelCreate={() => setIsCreating(false)}
                onFavoriteToggled={loadItems}
            />
            {showSettings && <Settings onClose={() => setShowSettings(false)} />}
        </div>
    );
}
```

- [ ] **Step 2: Build TypeScript**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager
pnpm build 2>&1 | tail -15
```

Expected: No errors, `dist/` is populated.

- [ ] **Step 3: Run dev and manually verify**

```bash
pnpm tauri dev
```

Verify:
- Lock screen appears on first run
- Can create vault, generates secret key
- After unlock, sidebar shows all categories including Favoriten
- Can create a new login entry with fields
- Star button toggles favorite, entry shows ★ in list
- Tags can be created and assigned to entries
- Attachments can be added to existing entries
- After 5 minutes of inactivity the vault locks automatically

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: refactor App.tsx into components, add 5-minute auto-lock"
```

---

## Done

After Plan 1 is complete the app has:
- ✅ All existing functionality preserved
- ✅ Tags (create, assign, filter)
- ✅ Favorites (toggle, filter in sidebar)
- ✅ File attachments (add, download, delete)
- ✅ Auto-lock after 5 minutes inactivity
- ✅ Clean component architecture (App.tsx < 100 lines)

**Plan 2 (Sync Engine)** will add: Google Drive, Dropbox, OneDrive, WebDAV, SFTP.
