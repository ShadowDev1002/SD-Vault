# Passwort-Generator Design

## Ziel

Ein Modal-Passwort-Generator, der über die Sidebar geöffnet wird und kryptographisch sichere Passwörter in zwei Modi erzeugt: klassisch (Länge + Zeichensätze) und Passphrase (EFF-Wortliste).

## Architektur

Zwei neue Dateien, minimale Änderungen an bestehenden:

- **`src/utils/generator.ts`** — reine Generierungslogik ohne React. Exportiert `generatePassword(options)` und `generatePassphrase(options)`. Nutzt `crypto.getRandomValues()` für kryptographische Sicherheit.
- **`src/components/PasswordGenerator.tsx`** — Modal mit zwei Tabs (Klassisch / Passphrase). Ruft Funktionen aus `generator.ts` auf.
- **`src/components/Sidebar.tsx`** — neuer "Generator"-Button im `sidebar-footer`, analog zum bestehenden Sync-Button. Prop `onGenerator: () => void`.
- **`src/App.tsx`** — `showGenerator` State, `onGenerator` Prop an Sidebar, `<PasswordGenerator>` render.

Kein Rust, keine neuen Tauri-Commands.

## Klassisch-Modus

**Optionen:**
- Länge: Slider 8–64, Standard 20
- Großbuchstaben (A–Z): Checkbox, Standard an
- Kleinbuchstaben (a–z): Checkbox, Standard an
- Zahlen (0–9): Checkbox, Standard an
- Sonderzeichen (`!@#$%^&*()-_=+[]{}|;:,.<>?`): Checkbox, Standard an

**Verhalten:**
- Mindestens eine Checkbox muss aktiv sein; alle deaktivieren ist nicht möglich
- Passwort wird automatisch neu generiert bei jeder Optionsänderung
- Anzeige im read-only Textfeld

## Passphrase-Modus

**Optionen:**
- Wortanzahl: Slider 3–8, Standard 4
- Trennzeichen: `-` | `_` | `.` | ` ` (Leerzeichen), Standard `-`
- Ersten Buchstaben groß: Checkbox, Standard aus
- Zahl anhängen: Checkbox, Standard aus (hängt eine zufällige 2-stellige Zahl an)

**Wortliste:**
- EFF Large Wordlist (7776 Wörter) als eingebettete TypeScript-Konstante in `src/utils/generator.ts`
- Auswahl per `crypto.getRandomValues()` mit gleichmäßiger Verteilung (rejection sampling bei Modulo-Bias)

## UI

- Sidebar-Button "Generator" öffnet Modal
- Modal hat zwei Tabs: "Klassisch" / "Passphrase"
- Generiertes Ergebnis in read-only `<input>`-Feld
- Button "Neu generieren" — erzeugt neues Passwort mit gleichen Einstellungen
- Button "Kopieren" — `navigator.clipboard.writeText()`
- Passwort wird automatisch beim Tab-Wechsel neu generiert

## Nicht im Scope

- Kein automatisches Kopieren in die Zwischenablage
- Keine Integration in das Eintragsformular (kein Inline-Button im Passwortfeld)
- Kein Passwort-Stärke-Anzeiger
- Kein Verlauf generierter Passwörter
