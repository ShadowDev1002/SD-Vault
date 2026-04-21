# Passwort-Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen kryptographisch sicheren Passwort-Generator als Modal einbauen, der über die Sidebar geöffnet wird und zwei Modi bietet: klassisch (Länge + Zeichensätze) und Passphrase (EFF-Wortliste).

**Architecture:** Reine Frontend-Implementierung ohne Rust-Backend. Die Generierungslogik sitzt in `src/utils/generator.ts` (kein React, nur reine Funktionen mit `crypto.getRandomValues()`). Das Modal `src/components/PasswordGenerator.tsx` konsumiert diese Funktionen. Sidebar und App.tsx werden minimal erweitert.

**Tech Stack:** React 18, TypeScript, `crypto.getRandomValues()` (Web Crypto API, im Browser bereits verfügbar), lucide-react (Icons bereits im Projekt)

---

## Dateistruktur

| Datei | Aktion | Verantwortlichkeit |
|-------|--------|-------------------|
| `src/utils/generator.ts` | Erstellen | Reine Generierungslogik: `generatePassword()`, `generatePassphrase()`, `WORD_LIST` |
| `src/components/PasswordGenerator.tsx` | Erstellen | Modal mit zwei Tabs, Optionen, Ergebnisanzeige |
| `src/components/Sidebar.tsx` | Modifizieren | `onGenerator` Prop + Generator-Button |
| `src/App.tsx` | Modifizieren | `showGenerator` State + PasswordGenerator render |

---

### Task 1: Generator-Utility

**Files:**
- Create: `src/utils/generator.ts`

- [ ] **Schritt 1: Datei erstellen**

Erstelle `src/utils/generator.ts` mit folgendem vollständigen Inhalt:

```typescript
export interface GeneratePasswordOptions {
    length: number;
    upper: boolean;
    lower: boolean;
    digits: boolean;
    symbols: boolean;
}

export interface GeneratePassphraseOptions {
    wordCount: number;
    separator: string;
    capitalize: boolean;
    appendNumber: boolean;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{}|;:,.<>?";

// Gleichmäßige Zufallsverteilung ohne Modulo-Bias
function randomIndex(max: number): number {
    const limit = Math.floor(0x100000000 / max) * max;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
}

export function generatePassword(opts: GeneratePasswordOptions): string {
    let chars = "";
    if (opts.upper) chars += UPPER;
    if (opts.lower) chars += LOWER;
    if (opts.digits) chars += DIGITS;
    if (opts.symbols) chars += SYMBOLS;
    if (!chars) chars = LOWER;
    return Array.from({ length: opts.length }, () => chars[randomIndex(chars.length)]).join("");
}

export function generatePassphrase(opts: GeneratePassphraseOptions): string {
    const words = Array.from({ length: opts.wordCount }, () => {
        const word = WORD_LIST[randomIndex(WORD_LIST.length)];
        return opts.capitalize
            ? word.charAt(0).toUpperCase() + word.slice(1)
            : word;
    });
    let phrase = words.join(opts.separator);
    if (opts.appendNumber) {
        phrase += opts.separator + String(10 + randomIndex(90));
    }
    return phrase;
}

// EFF Large Wordlist (https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt)
// Vollständige Liste einbinden:
//   curl -s https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt \
//     | awk '{print "    \"" $2 "\","}' >> src/utils/generator.ts
// Aktuell: 50-Wort-Beispiel. Für Produktion durch alle 7776 Wörter ersetzen.
const WORD_LIST: string[] = [
    "abacus", "abdomen", "abide", "ability", "ablaze", "aboard", "abode",
    "abrupt", "absence", "absorb", "abyss", "account", "achieve", "acorn",
    "acquire", "action", "adapt", "adobe", "adrift", "advice", "aerial",
    "affirm", "afford", "afoot", "afraid", "again", "agent", "agile",
    "aging", "airy", "alarm", "album", "almond", "alone", "alpine",
    "always", "amber", "ample", "anchor", "ancient", "angel", "anger",
    "ankle", "answer", "anvil", "apple", "apron", "arcade", "arctic",
    "argue",
];
```

- [ ] **Schritt 2: TypeScript prüfen**

```bash
cd /pfad/zum/worktree && ./node_modules/.bin/tsc --noEmit
```

Erwartetes Ergebnis: Keine Fehler.

- [ ] **Schritt 3: Commit**

```bash
git add src/utils/generator.ts
git commit -m "feat: add password/passphrase generator utility"
```

---

### Task 2: PasswordGenerator-Modal

**Files:**
- Create: `src/components/PasswordGenerator.tsx`

- [ ] **Schritt 1: Datei erstellen**

Erstelle `src/components/PasswordGenerator.tsx` mit folgendem vollständigen Inhalt:

```tsx
import { useState, useEffect, useCallback } from "react";
import { X, RefreshCw, Copy } from "lucide-react";
import { generatePassword, generatePassphrase } from "../utils/generator";
import type { GeneratePasswordOptions, GeneratePassphraseOptions } from "../utils/generator";

interface PasswordGeneratorProps {
    onClose: () => void;
}

const DEFAULT_PW_OPTS: GeneratePasswordOptions = {
    length: 20,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
};

const DEFAULT_PP_OPTS: GeneratePassphraseOptions = {
    wordCount: 4,
    separator: "-",
    capitalize: false,
    appendNumber: false,
};

export function PasswordGenerator({ onClose }: PasswordGeneratorProps) {
    const [tab, setTab] = useState<"classic" | "passphrase">("classic");
    const [result, setResult] = useState("");
    const [copied, setCopied] = useState(false);
    const [pwOpts, setPwOpts] = useState<GeneratePasswordOptions>(DEFAULT_PW_OPTS);
    const [ppOpts, setPpOpts] = useState<GeneratePassphraseOptions>(DEFAULT_PP_OPTS);

    const regenerate = useCallback(() => {
        if (tab === "classic") {
            setResult(generatePassword(pwOpts));
        } else {
            setResult(generatePassphrase(ppOpts));
        }
    }, [tab, pwOpts, ppOpts]);

    useEffect(() => { regenerate(); }, [regenerate]);

    async function handleCopy() {
        await navigator.clipboard.writeText(result);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    function setPwOpt<K extends keyof GeneratePasswordOptions>(key: K, value: GeneratePasswordOptions[K]) {
        setPwOpts(prev => {
            const next = { ...prev, [key]: value };
            // Mindestens eine Checkbox aktiv
            if (!next.upper && !next.lower && !next.digits && !next.symbols) return prev;
            return next;
        });
    }

    return (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" }}>
            <div style={{ background: "#1c1c1e", padding: "32px", borderRadius: "12px", width: "480px", border: "1px solid var(--border-color)", boxShadow: "0 24px 48px rgba(0,0,0,0.5)" }}>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                    <h2 style={{ fontSize: "18px", margin: 0 }}>Passwort-Generator</h2>
                    <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "4px" }}>
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
                    {(["classic", "passphrase"] as const).map(t => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            style={{ flex: 1, padding: "8px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "14px", background: tab === t ? "var(--accent-blue)" : "var(--bg-secondary)", color: tab === t ? "#fff" : "var(--text-secondary)" }}
                        >
                            {t === "classic" ? "Klassisch" : "Passphrase"}
                        </button>
                    ))}
                </div>

                {/* Optionen */}
                {tab === "classic" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "14px" }}>
                            <span>Länge: <strong>{pwOpts.length}</strong></span>
                            <input
                                type="range" min={8} max={64} value={pwOpts.length}
                                onChange={e => setPwOpt("length", Number(e.target.value))}
                                style={{ width: "200px" }}
                            />
                        </label>
                        {([
                            { key: "upper" as const, label: "Großbuchstaben (A–Z)" },
                            { key: "lower" as const, label: "Kleinbuchstaben (a–z)" },
                            { key: "digits" as const, label: "Zahlen (0–9)" },
                            { key: "symbols" as const, label: "Sonderzeichen (!@#…)" },
                        ]).map(({ key, label }) => (
                            <label key={key} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", cursor: "pointer" }}>
                                <input
                                    type="checkbox" checked={pwOpts[key]}
                                    onChange={e => setPwOpt(key, e.target.checked)}
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "14px" }}>
                            <span>Wörter: <strong>{ppOpts.wordCount}</strong></span>
                            <input
                                type="range" min={3} max={8} value={ppOpts.wordCount}
                                onChange={e => setPpOpts(prev => ({ ...prev, wordCount: Number(e.target.value) }))}
                                style={{ width: "200px" }}
                            />
                        </label>
                        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "14px" }}>
                            <span>Trennzeichen</span>
                            <select
                                value={ppOpts.separator}
                                onChange={e => setPpOpts(prev => ({ ...prev, separator: e.target.value }))}
                                style={{ background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "4px 8px" }}
                            >
                                <option value="-">Bindestrich (-)</option>
                                <option value="_">Unterstrich (_)</option>
                                <option value=".">Punkt (.)</option>
                                <option value=" ">Leerzeichen ( )</option>
                            </select>
                        </label>
                        {([
                            { key: "capitalize" as const, label: "Ersten Buchstaben groß" },
                            { key: "appendNumber" as const, label: "Zahl anhängen" },
                        ]).map(({ key, label }) => (
                            <label key={key} style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "14px", cursor: "pointer" }}>
                                <input
                                    type="checkbox" checked={ppOpts[key]}
                                    onChange={e => setPpOpts(prev => ({ ...prev, [key]: e.target.checked }))}
                                />
                                {label}
                            </label>
                        ))}
                    </div>
                )}

                {/* Ergebnis */}
                <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <input
                        type="text" readOnly value={result}
                        style={{ width: "100%", padding: "12px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", color: "var(--text-primary)", fontSize: "15px", fontFamily: "monospace", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button
                            onClick={regenerate}
                            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px", background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "6px", color: "var(--text-primary)", cursor: "pointer", fontSize: "14px" }}
                        >
                            <RefreshCw size={14} /> Neu generieren
                        </button>
                        <button
                            onClick={handleCopy}
                            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "10px", background: copied ? "var(--accent-green, #4CD964)" : "var(--accent-blue)", border: "none", borderRadius: "6px", color: "#fff", cursor: "pointer", fontSize: "14px" }}
                        >
                            <Copy size={14} /> {copied ? "Kopiert!" : "Kopieren"}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
```

- [ ] **Schritt 2: TypeScript prüfen**

```bash
cd /pfad/zum/worktree && ./node_modules/.bin/tsc --noEmit
```

Erwartetes Ergebnis: Keine Fehler.

- [ ] **Schritt 3: Commit**

```bash
git add src/components/PasswordGenerator.tsx
git commit -m "feat: add PasswordGenerator modal component"
```

---

### Task 3: In App + Sidebar einbinden

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Schritt 1: Sidebar.tsx modifizieren**

Aktuelle `SidebarProps` interface (Zeile 15–21):
```typescript
interface SidebarProps {
    selectedCategory: FilterCategory;
    onCategoryChange: (cat: FilterCategory) => void;
    onSettings: () => void;
    onSync: () => void;
    onLock: () => void;
}
```

Ersetzen durch:
```typescript
interface SidebarProps {
    selectedCategory: FilterCategory;
    onCategoryChange: (cat: FilterCategory) => void;
    onSettings: () => void;
    onSync: () => void;
    onGenerator: () => void;
    onLock: () => void;
}
```

Aktuelle Funktionssignatur (Zeile 23):
```typescript
export function Sidebar({ selectedCategory, onCategoryChange, onSettings, onSync, onLock }: SidebarProps) {
```

Ersetzen durch:
```typescript
export function Sidebar({ selectedCategory, onCategoryChange, onSettings, onSync, onGenerator, onLock }: SidebarProps) {
```

Aktuelles `sidebar-footer` div (Zeile 46–54):
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

Ersetzen durch:
```tsx
<div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <button className="lock-btn" onClick={onSettings} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
        Einstellungen
    </button>
    <button className="lock-btn" onClick={onSync} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
        Sync
    </button>
    <button className="lock-btn" onClick={onGenerator} style={{ background: 'transparent', color: 'var(--text-secondary)' }}>
        Generator
    </button>
    <button className="lock-btn" onClick={onLock}>Tresor sperren</button>
</div>
```

- [ ] **Schritt 2: App.tsx modifizieren**

Import-Block am Anfang von `src/App.tsx` (Zeile 1–10) — `PasswordGenerator` Import hinzufügen:
```typescript
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LockScreen } from "./components/LockScreen";
import { Sidebar } from "./components/Sidebar";
import { EntryList } from "./components/EntryList";
import { EntryDetail } from "./components/EntryDetail";
import { Settings } from "./components/Settings";
import { SyncStatus } from "./components/SyncStatus";
import { PasswordGenerator } from "./components/PasswordGenerator";
import type { PasswordItem, FilterCategory } from "./types";
import "./App.css";
```

State-Deklarationen (Zeile 23–24) — `showGenerator` ergänzen:
```typescript
const [showSettings, setShowSettings] = useState(false);
const [showSync, setShowSync] = useState(false);
const [showGenerator, setShowGenerator] = useState(false);
```

`<Sidebar>` in der Return-Anweisung (Zeile 97–103) — `onGenerator` Prop ergänzen:
```tsx
<Sidebar
    selectedCategory={selectedCategory}
    onCategoryChange={setSelectedCategory}
    onSettings={() => setShowSettings(true)}
    onLock={lockVault}
    onSync={() => setShowSync(true)}
    onGenerator={() => setShowGenerator(true)}
/>
```

Die letzten zwei Zeilen vor `</div>` (Zeile 121–122) — `PasswordGenerator` render ergänzen:
```tsx
{showSettings && <Settings onClose={() => setShowSettings(false)} />}
{showSync && <SyncStatus onClose={() => setShowSync(false)} />}
{showGenerator && <PasswordGenerator onClose={() => setShowGenerator(false)} />}
```

- [ ] **Schritt 3: TypeScript prüfen**

```bash
cd /pfad/zum/worktree && ./node_modules/.bin/tsc --noEmit
```

Erwartetes Ergebnis: Keine Fehler.

- [ ] **Schritt 4: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx
git commit -m "feat: wire PasswordGenerator into App and Sidebar"
```
