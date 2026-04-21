# Import/Export Design

## Ziel

Verschlüsselten Datenexport und -import implementieren, damit Nutzer Backups erstellen und Daten aus Bitwarden migrieren können. Alle exportierten Daten landen in einer einzigen verschlüsselten Datei.

## Architektur

Das gesamte Import/Export läuft im Rust-Backend (Tauri-Commands), da Dateidialoge und Dateizugriff dort nativ verfügbar sind. Das Frontend zeigt nur Status und Passwortfelder.

**Neue Dateien:**
- `src-tauri/src/import_export.rs` — alle Commands + Format-Logik (Export, Import .sdpx, Import Bitwarden CSV)
- `src/components/ImportExport.tsx` — UI-Sektion für die Einstellungen

**Modifiziert:**
- `src-tauri/src/lib.rs` — `mod import_export;` + 3 Commands registrieren
- `src/components/Settings.tsx` — ImportExport-Komponente einbinden

**Keine neuen Rust-Crates** — `serde_json`, `aes-gcm`, `argon2` und `tauri-plugin-dialog` sind bereits im Projekt.

## Export — SD-Passwort Format (.sdpx)

**Dateiformat:** JSON-Array, AES-256-GCM + Argon2id verschlüsselt, identisch zur Vault-Verschlüsselung. Dateiendung `.sdpx`.

**JSON-Struktur vor Verschlüsselung:**
```json
[
  {
    "id": "uuid",
    "category": "login",
    "title": "GitHub",
    "username": "user@example.com",
    "is_favorite": false,
    "fields": [
      { "id": "u1", "label": "Benutzername", "value": "user@example.com", "type": "text" },
      { "id": "p1", "label": "Passwort", "value": "secret123", "type": "password" }
    ],
    "notes": ""
  }
]
```

**Verschlüsselungsformat (identisch zum Vault):**
```
[16 Byte Salt][12 Byte Nonce][verschlüsselter JSON-Blob]
```
Argon2id mit Salt → 32-Byte-Key → AES-256-GCM mit Nonce.

**Flow:**
1. Nutzer gibt Export-Passwort ein (+ Bestätigung)
2. `export_vault(password)` Command: alle Items laden, entschlüsseln, JSON bauen, verschlüsseln
3. Nativer Speichern-Dialog (`tauri-plugin-dialog`) → Datei schreiben

**Sicherheit:** Separates Export-Passwort — das Master-Passwort bleibt geschützt, auch wenn die Export-Datei in falsche Hände gerät.

## Import — SD-Passwort (.sdpx)

**Flow:**
1. Nutzer klickt "SD-Passwort (.sdpx) importieren" → nativer Öffnen-Dialog (Filter: `.sdpx`)
2. Export-Passwort-Eingabe
3. `import_sdpx(path, password)` Command: Datei lesen, entschlüsseln, JSON parsen
4. Jeder Eintrag wird als neues Item gespeichert (keine Duplikaterkennung — einfachste, verlustfreie Lösung)
5. Ergebnis: Anzahl importierter Einträge oder Fehlermeldung

## Import — Bitwarden CSV

**Flow:**
1. Nutzer klickt "Bitwarden CSV importieren" → nativer Öffnen-Dialog (Filter: `.csv`)
2. Warnung: "Bitwarden CSV ist unverschlüsselt — lösche die Datei nach dem Import"
3. `import_bitwarden_csv(path)` Command: CSV parsen, in Items umwandeln, speichern
4. Ergebnis: Anzahl importierter Einträge

**Bitwarden CSV → SD-Passwort Mapping:**

| Bitwarden `type` | SD-Passwort `category` | Felder |
|-----------------|----------------------|--------|
| `login` | `login` | login_username → Benutzername, login_password → Passwort, login_uri → Website, login_totp → Einmalpasswort |
| `card` | `finance` | card_cardholderName → Karteninhaber, card_number → Kartennummer, card_expMonth+card_expYear → Ablaufdatum, card_code → Prüfnummer (CVV) |
| `note` | `note` | notes → notes |
| alle anderen | `note` | name als title, notes als notes |

CSV-Pflichtfelder: `type`, `name`. Alle anderen Felder sind optional (leer = nicht importiert).

## UI

Neuer Abschnitt "Datensicherung" in `src/components/Settings.tsx`, eingebunden über `<ImportExport />` aus `src/components/ImportExport.tsx`.

**Export-Bereich:**
- Eingabefelder: Export-Passwort + Bestätigung
- Button "Exportieren" (deaktiviert wenn Passwörter nicht übereinstimmen oder leer)
- Statusanzeige nach Export

**Import-Bereich:**
- Button "SD-Passwort (.sdpx) importieren" → Datei-Dialog → Passwortfeld → Import
- Button "Bitwarden CSV importieren" → Datei-Dialog → Warnung → Import
- Statusanzeige: "X Einträge importiert" oder Fehlertext

## Nicht im Scope

- KeePass KDBX (Binärformat, separates Crate nötig)
- Plaintext-JSON-Export
- Duplikaterkennung beim Import
- Auswahl einzelner Einträge für Export
