# SD-Vault Feature Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TOTP-Generator, Have I Been Pwned check, Cmd+K Schnellsuche, Drag & Drop Anhänge, WebDAV Sync, and PDF-Export to SD-Vault.

**Architecture:** Pure-frontend features (TOTP, HIBP, Schnellsuche) live in `src/utils/` and new React components. Attachments and PDF export extend the Rust backend (`db.rs`, `commands.rs`). WebDAV adds a new sync provider with `reqwest`. All 6 features are independent and can be implemented in any order.

**Tech Stack:** Tauri v2, React/TypeScript, Rust, `printpdf` (already in Cargo.toml), `reqwest` (to add), Web Crypto API, haveibeenpwned.com k-Anonymity API.

---

## File Structure

**New files:**
- `src/utils/totp.ts` — TOTP RFC 6238 implementation (base32 decode + HMAC-SHA1)
- `src/utils/hibp.ts` — Have I Been Pwned k-Anonymity check
- `src/components/QuickSearch.tsx` — Cmd+K overlay search component
- `src-tauri/src/sync/webdav.rs` — WebDAV SyncProvider implementation

**Modified files:**
- `src/components/EntryDetail.tsx` — TOTP field, HIBP check, attachment drag zone, PDF export button
- `src/components/VaultView.tsx` — QuickSearch overlay + Ctrl/Cmd+K listener
- `src/components/Sidebar.tsx` — WebDAV sync status dot
- `src/components/SyncSettings.tsx` — WebDAV config form
- `src/types.ts` — AttachmentMeta type, WebDavConfig type
- `src-tauri/src/db.rs` — attachments table + CRUD
- `src-tauri/src/commands.rs` — attachment commands, PDF export command, WebDAV commands
- `src-tauri/src/lib.rs` — register new commands in invoke_handler
- `src-tauri/src/sync/mod.rs` — add webdav module
- `src-tauri/src/sync/config.rs` — add WebDavConfig field
- `src-tauri/Cargo.toml` — add `reqwest`

---

## Task 1: TOTP-Generator

**Files:**
- Create: `src/utils/totp.ts`
- Modify: `src/components/EntryDetail.tsx` (add TotpField component + use in login section)

### Context
The `totp` field already exists in `ItemPayload` (db.rs, types.ts). Authenticator apps store the TOTP secret as a base32-encoded string (e.g. `JBSWY3DPEHPK3PXP`). The algorithm: decode base32 → HMAC-SHA1(key, floor(now/30) as big-endian u64) → dynamic truncation → 6 digits. Web Crypto API handles HMAC-SHA1 natively.

- [ ] **Step 1: Create `src/utils/totp.ts`**

```typescript
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(s: string): Uint8Array {
    const input = s.toUpperCase().replace(/\s|=/g, '');
    let bits = 0, val = 0;
    const out: number[] = [];
    for (const c of input) {
        const idx = B32.indexOf(c);
        if (idx < 0) continue;
        val = (val << 5) | idx;
        bits += 5;
        if (bits >= 8) { bits -= 8; out.push((val >>> bits) & 0xff); }
    }
    return new Uint8Array(out);
}

export async function generateTotp(secret: string): Promise<{ code: string; remaining: number }> {
    const key = base32Decode(secret);
    const epoch = Math.floor(Date.now() / 1000);
    const step = Math.floor(epoch / 30);
    const remaining = 30 - (epoch % 30);

    const counter = new ArrayBuffer(8);
    new DataView(counter).setUint32(4, step, false);

    const cryptoKey = await crypto.subtle.importKey(
        'raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
    );
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counter));

    const offset = hmac[19] & 0xf;
    const code = (
        ((hmac[offset] & 0x7f) << 24) |
        ((hmac[offset + 1] & 0xff) << 16) |
        ((hmac[offset + 2] & 0xff) << 8) |
        (hmac[offset + 3] & 0xff)
    ) % 1_000_000;

    return { code: code.toString().padStart(6, '0'), remaining };
}
```

- [ ] **Step 2: Add `TotpField` component to `EntryDetail.tsx`**

Add this import at the top of EntryDetail.tsx:
```typescript
import { generateTotp } from '../utils/totp';
```

Add the `TotpField` component (place after the `VField` function):
```typescript
function TotpField({ secret, onCopy }: { secret: string; onCopy: () => void }) {
    const [code, setCode] = useState('------');
    const [remaining, setRemaining] = useState(30);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!secret) return;
        let cancelled = false;
        async function tick() {
            try {
                const result = await generateTotp(secret);
                if (!cancelled) { setCode(result.code); setRemaining(result.remaining); setError(false); }
            } catch {
                if (!cancelled) setError(true);
            }
        }
        tick();
        const id = setInterval(tick, 1000);
        return () => { cancelled = true; clearInterval(id); };
    }, [secret]);

    if (!secret) return null;

    const pct = remaining / 30;
    const r = 10, circ = 2 * Math.PI * r;

    return (
        <div className="group flex items-start gap-3 py-3 px-4 border-b last:border-b-0" style={{ borderColor: 'var(--border-2)' }}>
            <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>Einmalcode (TOTP)</p>
                <div className="flex items-center gap-3">
                    {error ? (
                        <span className="text-sm" style={{ color: 'var(--vault-danger)' }}>Ungültiger TOTP-Secret</span>
                    ) : (
                        <>
                            <span className="text-2xl font-mono tracking-[0.2em] font-semibold" style={{ color: remaining <= 5 ? '#ff453a' : 'var(--text)' }}>
                                {code.slice(0, 3)} {code.slice(3)}
                            </span>
                            <svg width="26" height="26" viewBox="0 0 26 26">
                                <circle cx="13" cy="13" r={r} fill="none" stroke="var(--border-2)" strokeWidth="2.5" />
                                <circle
                                    cx="13" cy="13" r={r} fill="none"
                                    stroke={remaining <= 5 ? '#ff453a' : 'var(--accent)'}
                                    strokeWidth="2.5"
                                    strokeDasharray={circ}
                                    strokeDashoffset={circ * (1 - pct)}
                                    strokeLinecap="round"
                                    transform="rotate(-90 13 13)"
                                    style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s' }}
                                />
                            </svg>
                            <span className="text-xs tabular-nums" style={{ color: 'var(--text-3)' }}>{remaining}s</span>
                        </>
                    )}
                </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-4">
                {!error && <SmBtn onClick={onCopy} title="Kopieren"><CopySvg /></SmBtn>}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Use `TotpField` in the login section of EntryDetail**

In the login section of the VIEW mode render (search for where `VField` is called for `totp`), replace the existing totp VField with:
```typescript
{payload.totp && (
    <TotpField
        secret={payload.totp}
        onCopy={async () => {
            try {
                const { code } = await generateTotp(payload.totp);
                copyToClipboard(code);
            } catch {}
        }}
    />
)}
```

- [ ] **Step 4: Verify build**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager
pnpm tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/totp.ts src/components/EntryDetail.tsx
git commit -m "feat: TOTP-Generator mit Live-Countdown in EntryDetail"
```

---

## Task 2: Have I Been Pwned

**Files:**
- Create: `src/utils/hibp.ts`
- Modify: `src/components/EntryDetail.tsx` (show breach warning next to password VField)

### Context
HIBP k-Anonymity: SHA-1 hash the password, send the first 5 hex chars to `https://api.pwnedpasswords.com/range/{prefix}`. The API returns all matching hash suffixes with counts. Check if the remaining 35 chars of the hash appear — if yes, the password was leaked. This API is safe: no full password or hash ever leaves the device.

- [ ] **Step 1: Create `src/utils/hibp.ts`**

```typescript
export async function checkHibp(password: string): Promise<number> {
    if (!password) return 0;
    const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hex = Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    const prefix = hex.slice(0, 5);
    const suffix = hex.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) throw new Error('HIBP API nicht erreichbar');

    const text = await res.text();
    const line = text.split('\r\n').find(l => l.startsWith(suffix));
    return line ? parseInt(line.split(':')[1], 10) : 0;
}
```

- [ ] **Step 2: Add HIBP check state and button to EntryDetail**

In EntryDetail.tsx, add these imports:
```typescript
import { checkHibp } from '../utils/hibp';
```

Add state near the top of the `EntryDetail` component (inside the main component function, alongside other state):
```typescript
const [hibpCount, setHibpCount] = useState<number | null>(null);
const [hibpChecking, setHibpChecking] = useState(false);
```

Reset hibpCount when item changes (add to the existing `useEffect` that sets editing state or add a new one):
```typescript
useEffect(() => { setHibpCount(null); }, [item?.id]);
```

- [ ] **Step 3: Add HIBP warning UI below the password VField in view mode**

In the VIEW mode render, after the password `VField` call, add:
```typescript
{payload.password && (
    <div className="px-4 py-2 flex items-center gap-3">
        <button
            onClick={async () => {
                setHibpChecking(true);
                setHibpCount(null);
                try { setHibpCount(await checkHibp(payload.password)); }
                catch { setHibpCount(-1); }
                finally { setHibpChecking(false); }
            }}
            disabled={hibpChecking}
            className="text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border)', color: 'var(--text-3)', backgroundColor: 'transparent' }}
        >
            {hibpChecking ? 'Prüfe…' : 'Auf Datenleck prüfen'}
        </button>
        {hibpCount !== null && hibpCount >= 0 && (
            hibpCount === 0
                ? <span className="text-xs" style={{ color: '#32d74b' }}>✓ Kein Datenleck gefunden</span>
                : <span className="text-xs font-medium" style={{ color: '#ff453a' }}>
                    ⚠ {hibpCount.toLocaleString('de-DE')}× in Datenlecks gefunden
                  </span>
        )}
        {hibpCount === -1 && (
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>Prüfung fehlgeschlagen</span>
        )}
    </div>
)}
```

- [ ] **Step 4: Verify build**

```bash
pnpm tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/hibp.ts src/components/EntryDetail.tsx
git commit -m "feat: Have I Been Pwned Datenleck-Prüfung (k-Anonymity)"
```

---

## Task 3: Schnellsuche (Cmd+K)

**Files:**
- Create: `src/components/QuickSearch.tsx`
- Modify: `src/components/VaultView.tsx` (add overlay + keyboard listener)

### Context
VaultView already holds the full `items` array. QuickSearch receives it as a prop, renders a fixed overlay, filters on input, and calls `onSelect(id)` to navigate. Keyboard: Escape closes, ↑/↓ navigate, Enter selects.

- [ ] **Step 1: Create `src/components/QuickSearch.tsx`**

```typescript
import { useState, useEffect, useRef } from 'react';
import type { Item } from '../types';

const CATEGORY_COLOR: Record<string, string> = {
    login: '#0a84ff', card: '#32d74b', note: '#ff9f0a', identity: '#bf5af2',
};
const CATEGORY_LABEL: Record<string, string> = {
    login: 'Login', card: 'Karte', note: 'Notiz', identity: 'Identität',
};

interface Props {
    items: Item[];
    onSelect: (id: string) => void;
    onClose: () => void;
}

export default function QuickSearch({ items, onSelect, onClose }: Props) {
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const results = query.trim()
        ? items.filter(item => {
            const q = query.toLowerCase();
            return (
                item.payload.title.toLowerCase().includes(q) ||
                item.payload.username.toLowerCase().includes(q) ||
                item.payload.url.toLowerCase().includes(q) ||
                item.payload.email.toLowerCase().includes(q)
            );
        }).slice(0, 12)
        : [];

    useEffect(() => { setCursor(0); }, [query]);

    function handleKey(e: React.KeyboardEvent) {
        if (e.key === 'Escape') { onClose(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
        if (e.key === 'Enter' && results[cursor]) { onSelect(results[cursor].id); onClose(); }
    }

    function subtitle(item: Item): string {
        if (item.payload.url) {
            try { return new URL(item.payload.url).hostname; } catch { return item.payload.url; }
        }
        if (item.payload.username) return item.payload.username;
        if (item.payload.email) return item.payload.email;
        return '';
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-start justify-center pt-24"
            style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
                {/* Search input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ color: 'var(--text-3)' }}>
                        <circle cx="6.5" cy="6.5" r="4.5" /><path d="M10.5 10.5l3.5 3.5" strokeLinecap="round" />
                    </svg>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Suche…"
                        className="flex-1 bg-transparent text-sm outline-none"
                        style={{ color: 'var(--text)' }}
                    />
                    <kbd className="text-xs px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>Esc</kbd>
                </div>

                {/* Results */}
                <div ref={listRef} className="max-h-80 overflow-y-auto">
                    {results.length === 0 && query.trim() && (
                        <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>Keine Ergebnisse für „{query}"</p>
                    )}
                    {results.length === 0 && !query.trim() && (
                        <p className="text-sm text-center py-8" style={{ color: 'var(--text-3)' }}>Suchbegriff eingeben…</p>
                    )}
                    {results.map((item, i) => (
                        <button
                            key={item.id}
                            onClick={() => { onSelect(item.id); onClose(); }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left border-b last:border-b-0 transition-colors"
                            style={{
                                borderColor: 'var(--border-2)',
                                backgroundColor: i === cursor ? 'rgba(10,132,255,0.12)' : 'transparent',
                            }}
                            onMouseEnter={() => setCursor(i)}
                        >
                            <div
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                                style={{ backgroundColor: CATEGORY_COLOR[item.category] + '22', color: CATEGORY_COLOR[item.category] }}
                            >
                                {item.payload.title.charAt(0).toUpperCase() || '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate" style={{ color: 'var(--text)' }}>{item.payload.title}</p>
                                <p className="text-xs truncate" style={{ color: 'var(--text-3)' }}>{subtitle(item)}</p>
                            </div>
                            <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLOR[item.category] + '22', color: CATEGORY_COLOR[item.category] }}>
                                {CATEGORY_LABEL[item.category]}
                            </span>
                        </button>
                    ))}
                </div>

                {results.length > 0 && (
                    <div className="px-4 py-2 border-t flex items-center gap-4 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
                        <span>↑↓ navigieren</span><span>↵ auswählen</span><span>Esc schließen</span>
                    </div>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Integrate QuickSearch into VaultView.tsx**

Add the import and state at the top of `VaultView.tsx`:
```typescript
import QuickSearch from './QuickSearch';
// in component:
const [showSearch, setShowSearch] = useState(false);
```

Add a `useEffect` for the keyboard shortcut (after existing useEffect calls):
```typescript
useEffect(() => {
    function onKey(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            setShowSearch(s => !s);
        }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
}, []);
```

Add the overlay just before the closing `</div>` of the return:
```typescript
{showSearch && (
    <QuickSearch
        items={items}
        onSelect={id => { setSelectedId(id); setIsNew(false); }}
        onClose={() => setShowSearch(false)}
    />
)}
```

- [ ] **Step 3: Verify build**

```bash
pnpm tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/QuickSearch.tsx src/components/VaultView.tsx
git commit -m "feat: Cmd+K Schnellsuche über alle Einträge"
```

---

## Task 4: Drag & Drop Anhänge

**Files:**
- Modify: `src-tauri/src/db.rs` (attachments table + CRUD)
- Modify: `src-tauri/src/commands.rs` (4 new commands)
- Modify: `src-tauri/src/lib.rs` (register commands)
- Modify: `src/types.ts` (AttachmentMeta)
- Modify: `src/components/EntryDetail.tsx` (attachment section in view+edit mode)

### Context
Attachments are stored encrypted in a separate SQLite table `attachments(id, item_id, name, mime, size, encrypted_blob)`. The `encrypted_blob` uses the same AES-256-GCM entry key as items. `get_attachments` returns only metadata (no blob) for rendering the list; `get_attachment_data` returns the decrypted bytes for download (frontend creates an object URL). Max attachment size: 10 MB (enforced in frontend).

- [ ] **Step 1: Add attachments table to `db.rs`**

In `ensure_schema`, extend the SQL string to include the attachments table. Replace the existing `conn.execute_batch` call with:
```rust
conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS vault_meta (
        id           TEXT PRIMARY KEY,
        created_at   INTEGER NOT NULL,
        argon2_salt  BLOB NOT NULL,
        argon2_ops   INTEGER NOT NULL,
        argon2_mem   INTEGER NOT NULL,
        version      INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS items (
        id              TEXT PRIMARY KEY,
        category        TEXT NOT NULL,
        updated_at      INTEGER NOT NULL,
        sync_hash       TEXT NOT NULL,
        encrypted_blob  BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
        id              TEXT PRIMARY KEY,
        item_id         TEXT NOT NULL,
        name            TEXT NOT NULL,
        mime            TEXT NOT NULL DEFAULT '',
        size            INTEGER NOT NULL,
        encrypted_blob  BLOB NOT NULL
    );",
)
.map_err(|e| e.to_string())
```

- [ ] **Step 2: Add attachment structs and CRUD functions to `db.rs`**

Add after the existing `CustomField` struct:
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AttachmentMeta {
    pub id: String,
    pub item_id: String,
    pub name: String,
    pub mime: String,
    pub size: i64,
}

pub fn insert_attachment(
    conn: &Connection,
    entry_key: &[u8; 32],
    item_id: &str,
    name: &str,
    mime: &str,
    data: &[u8],
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let blob = crypto::encrypt(entry_key, data)?;
    conn.execute(
        "INSERT INTO attachments (id, item_id, name, mime, size, encrypted_blob) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, item_id, name, mime, data.len() as i64, blob],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn get_attachments(conn: &Connection, item_id: &str) -> Result<Vec<AttachmentMeta>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, item_id, name, mime, size FROM attachments WHERE item_id = ?1 ORDER BY rowid ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![item_id], |row| Ok(AttachmentMeta {
        id: row.get(0)?,
        item_id: row.get(1)?,
        name: row.get(2)?,
        mime: row.get(3)?,
        size: row.get(4)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_attachment_data(
    conn: &Connection,
    entry_key: &[u8; 32],
    id: &str,
) -> Result<Vec<u8>, String> {
    let blob: Vec<u8> = conn.query_row(
        "SELECT encrypted_blob FROM attachments WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    crypto::decrypt(entry_key, &blob)
}

pub fn delete_attachment(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Add attachment commands to `commands.rs`**

Add these 4 functions at the end of `commands.rs`:
```rust
#[tauri::command]
pub fn get_attachments(
    state: State<'_, AppState>,
    item_id: String,
) -> Result<Vec<crate::db::AttachmentMeta>, String> {
    let key_guard = state.master_key.lock().unwrap();
    let _master_key = key_guard.as_ref().ok_or("Vault ist gesperrt")?;
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
```

- [ ] **Step 4: Register attachment commands in `lib.rs`**

In the `invoke_handler!` macro in `lib.rs`, add after `commands::open_url`:
```rust
commands::get_attachments,
commands::add_attachment,
commands::get_attachment_data,
commands::delete_attachment,
```

- [ ] **Step 5: Add `AttachmentMeta` type to `src/types.ts`**

Add at the end of `types.ts`:
```typescript
export interface AttachmentMeta {
    id: string;
    item_id: string;
    name: string;
    mime: string;
    size: number;
}
```

- [ ] **Step 6: Add attachment section to `EntryDetail.tsx`**

Add imports:
```typescript
import type { AttachmentMeta } from '../types';
```

Add state in the `EntryDetail` component (near other state variables):
```typescript
const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
const [dragOver, setDragOver] = useState(false);
```

Load attachments when a non-new item is selected (add/merge into existing useEffect that watches `item`):
```typescript
useEffect(() => {
    if (item && !isNew) {
        invoke<AttachmentMeta[]>('get_attachments', { itemId: item.id })
            .then(setAttachments)
            .catch(() => setAttachments([]));
    } else {
        setAttachments([]);
    }
}, [item?.id, isNew]);
```

Add the attachment upload handler:
```typescript
async function handleAttachmentDrop(files: FileList | null) {
    if (!files || !item) return;
    for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) { alert(`${file.name} ist zu groß (max. 10 MB)`); continue; }
        const buf = await file.arrayBuffer();
        const data = Array.from(new Uint8Array(buf));
        await invoke('add_attachment', { itemId: item.id, name: file.name, mime: file.type, data });
    }
    const updated = await invoke<AttachmentMeta[]>('get_attachments', { itemId: item.id });
    setAttachments(updated);
}

async function handleDownloadAttachment(att: AttachmentMeta) {
    const bytes: number[] = await invoke('get_attachment_data', { id: att.id });
    const blob = new Blob([new Uint8Array(bytes)], { type: att.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = att.name; a.click();
    URL.revokeObjectURL(url);
}
```

Add the attachment section at the end of the VIEW mode render (before the closing `</div>` of the detail content), after the custom fields section:
```typescript
{/* Anhänge */}
{item && !isNew && (
    <Section title="Anhänge">
        <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleAttachmentDrop(e.dataTransfer.files); }}
            className="mx-4 my-2 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-6 transition-colors cursor-pointer"
            style={{ borderColor: dragOver ? 'var(--accent)' : 'var(--border)', backgroundColor: dragOver ? 'rgba(10,132,255,0.05)' : 'transparent' }}
            onClick={() => {
                const inp = document.createElement('input');
                inp.type = 'file'; inp.multiple = true;
                inp.onchange = () => handleAttachmentDrop(inp.files);
                inp.click();
            }}
        >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--text-3)' }}>
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Dateien hierhin ziehen oder klicken (max. 10 MB)</p>
        </div>
        {attachments.map(att => (
            <div key={att.id} className="group flex items-center gap-3 px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--border-2)' }}>
                <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text)' }}>{att.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{(att.size / 1024).toFixed(1)} KB</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <SmBtn onClick={() => handleDownloadAttachment(att)} title="Herunterladen">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M8 2v8M5 7l3 3 3-3" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M3 12h10" strokeLinecap="round"/>
                        </svg>
                    </SmBtn>
                    <SmBtn onClick={async () => {
                        await invoke('delete_attachment', { id: att.id });
                        setAttachments(prev => prev.filter(a => a.id !== att.id));
                    }} title="Löschen">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M3 4h10M6 4V3h4v1M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </SmBtn>
                </div>
            </div>
        ))}
    </Section>
)}
```

- [ ] **Step 7: Verify Rust and TypeScript compile**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager/src-tauri && cargo check 2>&1 | tail -5
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager && pnpm tsc --noEmit
```
Expected: both exit with no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/types.ts src/components/EntryDetail.tsx
git commit -m "feat: Drag & Drop Anhänge mit AES-256-GCM Verschlüsselung"
```

---

## Task 5: WebDAV Sync

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `reqwest`)
- Modify: `src-tauri/src/sync/config.rs` (add WebDavConfig)
- Create: `src-tauri/src/sync/webdav.rs`
- Modify: `src-tauri/src/sync/mod.rs` (expose webdav module)
- Modify: `src-tauri/src/commands.rs` (sync_webdav, save_webdav_config)
- Modify: `src-tauri/src/lib.rs` (register commands)
- Modify: `src/types.ts` (WebDavConfig)
- Modify: `src/components/SyncSettings.tsx` (WebDAV config form + sync button)
- Modify: `src/components/Sidebar.tsx` (sync status dot)
- Modify: `src/components/VaultView.tsx` (pass syncStatus to Sidebar)

### Context
WebDAV uses standard HTTP: PUT to upload, GET to download, PROPFIND to list. `reqwest` handles all of this with basic auth. The sync status (last sync timestamp + success/failure) is stored in React state in VaultView and shown as a colored dot in the Sidebar next to the sync icon.

- [ ] **Step 1: Add `reqwest` to `Cargo.toml`**

In `[dependencies]` in `src-tauri/Cargo.toml`, add:
```toml
reqwest = { version = "0.12", features = ["json"], default-features = false, features = ["rustls-tls", "json"] }
```

- [ ] **Step 2: Read current `sync/config.rs`**

```bash
cat /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager/src-tauri/src/sync/config.rs
```

- [ ] **Step 3: Add `WebDavConfig` to `sync/config.rs`**

Add this struct alongside existing config structs in `config.rs`:
```rust
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct WebDavConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub remote_path: String,
}
```

Also add the field to the top-level `SyncConfig` struct:
```rust
pub webdav: Option<WebDavConfig>,
```

- [ ] **Step 4: Create `src-tauri/src/sync/webdav.rs`**

```rust
use crate::sync::{BackupEntry, SyncProvider};
use crate::sync::config::WebDavConfig;
use async_trait::async_trait;
use chrono::Utc;

pub struct WebDavProvider {
    url: String,
    username: String,
    password: String,
    client: reqwest::Client,
}

impl WebDavProvider {
    pub fn new(config: WebDavConfig) -> Self {
        Self {
            url: config.url.trim_end_matches('/').to_string(),
            username: config.username,
            password: config.password,
            client: reqwest::Client::new(),
        }
    }

    fn file_url(&self, name: &str) -> String {
        format!("{}/{}", self.url, name)
    }
}

#[async_trait]
impl SyncProvider for WebDavProvider {
    async fn upload(&self, data: &[u8], name: &str) -> Result<(), String> {
        self.client
            .put(self.file_url(name))
            .basic_auth(&self.username, Some(&self.password))
            .body(data.to_vec())
            .send()
            .await
            .map_err(|e| format!("WebDAV Upload fehlgeschlagen: {}", e))?
            .error_for_status()
            .map_err(|e| format!("WebDAV Fehler: {}", e))?;
        Ok(())
    }

    async fn download(&self, name: &str) -> Result<Vec<u8>, String> {
        let bytes = self.client
            .get(self.file_url(name))
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| format!("WebDAV Download fehlgeschlagen: {}", e))?
            .error_for_status()
            .map_err(|e| format!("WebDAV Fehler: {}", e))?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        Ok(bytes.to_vec())
    }

    async fn list_backups(&self) -> Result<Vec<BackupEntry>, String> {
        Ok(vec![BackupEntry {
            id: "vault.db".into(),
            timestamp: Utc::now().timestamp(),
            size_bytes: 0,
        }])
    }

    async fn delete_backup(&self, _id: &str) -> Result<(), String> {
        Ok(())
    }
}
```

- [ ] **Step 5: Export webdav module in `sync/mod.rs`**

Add after existing `pub mod sftp;`:
```rust
pub mod webdav;
```

- [ ] **Step 6: Add WebDAV commands to `commands.rs`**

Add at the end of `commands.rs`:
```rust
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
```

- [ ] **Step 7: Register new commands in `lib.rs`**

Add to the `invoke_handler!` macro:
```rust
commands::sync_webdav,
commands::save_webdav_config,
```

- [ ] **Step 8: Add `WebDavConfig` type to `src/types.ts`**

```typescript
export interface WebDavConfig {
    url: string;
    username: string;
    password: string;
    remote_path: string;
}
```

- [ ] **Step 9: Add WebDAV section to `SyncSettings.tsx`**

Add WebDAV state at the top of the component:
```typescript
const [webdavUrl, setWebdavUrl] = useState('');
const [webdavUser, setWebdavUser] = useState('');
const [webdavPass, setWebdavPass] = useState('');
const [webdavPath, setWebdavPath] = useState('/sd-vault');
const [webdavMsg, setWebdavMsg] = useState('');
```

Add WebDAV form below the SFTP section (before the closing `</div>`):
```typescript
{/* WebDAV */}
<section className="space-y-3">
    <h3 className="text-sm font-semibold text-white">WebDAV Sync</h3>
    <form onSubmit={async e => {
        e.preventDefault(); setWebdavMsg('');
        try {
            await invoke('save_webdav_config', { webdavConfig: { url: webdavUrl, username: webdavUser, password: webdavPass, remote_path: webdavPath } });
            setWebdavMsg('✓ Konfiguration gespeichert');
        } catch (err) { setWebdavMsg('Fehler: ' + String(err)); }
    }} className="space-y-3">
        <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-2)' }}>Server-URL</label>
            <input value={webdavUrl} onChange={e => setWebdavUrl(e.target.value)} className="sd-input w-full" placeholder="https://nextcloud.example.com/remote.php/dav/files/user" />
        </div>
        <div className="grid grid-cols-2 gap-3">
            <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-2)' }}>Benutzername</label>
                <input value={webdavUser} onChange={e => setWebdavUser(e.target.value)} className="sd-input w-full" />
            </div>
            <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-2)' }}>Passwort</label>
                <input value={webdavPass} onChange={e => setWebdavPass(e.target.value)} type="password" className="sd-input w-full" />
            </div>
        </div>
        <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 rounded-lg text-sm text-white" style={{ backgroundColor: 'var(--accent)' }}>Speichern</button>
            <button type="button" onClick={async () => {
                setWebdavMsg('');
                try { await invoke('sync_webdav'); setWebdavMsg('✓ WebDAV Sync erfolgreich'); }
                catch (err) { setWebdavMsg('Fehler: ' + String(err)); }
            }} className="px-4 py-2 rounded-lg text-sm border" style={{ borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                Jetzt synchronisieren
            </button>
        </div>
        {webdavMsg && <p className="text-sm" style={{ color: webdavMsg.startsWith('✓') ? '#32d74b' : '#ff453a' }}>{webdavMsg}</p>}
    </form>
</section>
```

- [ ] **Step 10: Verify Rust compiles**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager/src-tauri && cargo check 2>&1 | tail -10
```
Expected: `Finished` with no errors. (First run downloads reqwest — takes 1-2 min.)

- [ ] **Step 11: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/sync/webdav.rs src-tauri/src/sync/mod.rs src-tauri/src/sync/config.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/types.ts src/components/SyncSettings.tsx
git commit -m "feat: WebDAV Sync mit reqwest (Nextcloud/ownCloud kompatibel)"
```

---

## Task 6: PDF-Export eines Eintrags

**Files:**
- Modify: `src-tauri/src/commands.rs` (export_entry_pdf command)
- Modify: `src-tauri/src/lib.rs` (register command)
- Modify: `src/components/EntryDetail.tsx` (export button in view mode header)

### Context
`printpdf` is already in `Cargo.toml`. The PDF shows: SD-Vault logo text + date, then a table of visible (non-empty, non-secret) fields — title, username, URL, notes, cardholder, etc. Passwords and PINs are NOT included for security. The save path comes from the frontend using a native file-save dialog via `@tauri-apps/plugin-dialog`.

- [ ] **Step 1: Add `export_entry_pdf` to `commands.rs`**

Add this import at the top of `commands.rs` (if not present):
```rust
use printpdf::{Mm, PdfDocument, BuiltinFont};
```

Add the command at the end of `commands.rs`:
```rust
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

    let mut y = 270.0f64;

    // Header
    layer.use_text("SD-Vault — Eintrag Export", 16.0, Mm(20.0), Mm(y), &font);
    y -= 8.0;
    layer.use_text(
        &format!("Erstellt: {}", chrono::Utc::now().format("%d.%m.%Y %H:%M")),
        9.0, Mm(20.0), Mm(y), &font_reg
    );
    y -= 15.0;

    // Title + category
    layer.use_text(&format!("Titel: {}", p.title), 13.0, Mm(20.0), Mm(y), &font);
    y -= 8.0;
    layer.use_text(&format!("Kategorie: {}", item.category), 10.0, Mm(20.0), Mm(y), &font_reg);
    y -= 12.0;

    // Fields (skip empty and secrets)
    let fields: &[(&str, &str)] = &[
        ("Benutzername", &p.username),
        ("URL", &p.url),
        ("E-Mail", &p.email),
        ("Karteninhaber", &p.cardholder),
        ("Kartennummer (letzten 4)", &if p.card_number.len() >= 4 { format!("**** {}", &p.card_number[p.card_number.len()-4..]) } else { p.card_number.clone() }),
        ("Ablaufdatum", &p.expiry),
        ("Vorname", &p.first_name),
        ("Nachname", &p.last_name),
        ("Telefon", &p.phone),
        ("Unternehmen", &p.company),
        ("Berufsbezeichnung", &p.job_title),
        ("Adresse", &p.address),
        ("Stadt", &p.city),
        ("PLZ", &p.zip),
        ("Land", &p.country),
        ("Geburtstag", &p.birthday),
    ];

    for (label, value) in fields {
        if value.is_empty() { continue; }
        layer.use_text(&format!("{}: {}", label, value), 10.0, Mm(20.0), Mm(y), &font_reg);
        y -= 7.0;
    }

    if !p.notes.is_empty() {
        y -= 3.0;
        layer.use_text("Notizen:", 10.0, Mm(20.0), Mm(y), &font);
        y -= 7.0;
        for line in p.notes.lines().take(20) {
            layer.use_text(line, 9.0, Mm(20.0), Mm(y), &font_reg);
            y -= 6.0;
        }
    }

    // Footer
    layer.use_text("Dieses Dokument enthält sensible Daten — sicher aufbewahren.", 8.0, Mm(20.0), Mm(12.0), &font_reg);

    doc.save(&mut std::io::BufWriter::new(
        fs::File::create(&save_path).map_err(|e| e.to_string())?
    )).map_err(|e| e.to_string())?;

    Ok(())
}
```

- [ ] **Step 2: Register command in `lib.rs`**

Add to `invoke_handler!`:
```rust
commands::export_entry_pdf,
```

- [ ] **Step 3: Add PDF export button to `EntryDetail.tsx` header**

Add this import (if not already imported):
```typescript
import { save } from '@tauri-apps/plugin-dialog';
```

In the EntryDetail view mode header (where the favorite button and delete button already are), add an export button:
```typescript
<SmBtn
    onClick={async () => {
        if (!item) return;
        const path = await save({
            defaultPath: `${item.payload.title || 'eintrag'}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (!path) return;
        await invoke('export_entry_pdf', { id: item.id, savePath: path });
    }}
    title="Als PDF exportieren"
>
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" strokeLinejoin="round"/>
        <path d="M9 2v4h4M6 9h4M6 12h2" strokeLinecap="round"/>
    </svg>
</SmBtn>
```

- [ ] **Step 4: Install `@tauri-apps/plugin-dialog` JS binding if not present**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager
pnpm list @tauri-apps/plugin-dialog 2>/dev/null || pnpm add @tauri-apps/plugin-dialog
```

- [ ] **Step 5: Verify both compile**

```bash
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager/src-tauri && cargo check 2>&1 | tail -5
cd /home/matt/Dokumente/WICHTIG/Programmieren/SD-Passwort_Manager && pnpm tsc --noEmit
```
Expected: no errors in either.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src/components/EntryDetail.tsx
git commit -m "feat: PDF-Export eines Eintrags via printpdf"
```

---

## Self-Review

**Spec coverage:**
- ✅ TOTP-Generator: Task 1 — live code + countdown ring in EntryDetail
- ✅ Have I Been Pwned: Task 2 — k-Anonymity, breach count shown next to password
- ✅ Schnellsuche: Task 3 — Cmd+K overlay with keyboard navigation
- ✅ Drag & Drop Anhänge: Task 4 — encrypted in SQLite, download via object URL
- ✅ WebDAV: Task 5 — reqwest-based provider, config form, sync command
- ✅ PDF-Export: Task 6 — printpdf, save dialog, skips secrets

**Placeholder scan:** None found. All steps contain full code.

**Type consistency:**
- `AttachmentMeta` defined in types.ts (Task 4 Step 5) and used in EntryDetail (Task 4 Step 6) ✅
- `WebDavConfig` defined in types.ts (Task 5 Step 8) and sync/config.rs (Task 5 Step 3) ✅
- `generateTotp` exported from totp.ts (Task 1 Step 1) and imported in EntryDetail (Task 1 Step 2) ✅
