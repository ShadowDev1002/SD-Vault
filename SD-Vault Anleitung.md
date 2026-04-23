# SD-Vault – Vollständige Anleitung

---

## Was ist SD-Vault?

SD-Vault ist ein **lokaler, verschlüsselter Passwort-Manager**.
Alle Daten liegen ausschließlich auf deinem PC – kein Cloud-Zwang, kein Server, kein Dritter.

---

## Installation

| System | Datei | So installieren |
|--------|-------|-----------------|
| Linux | `SD-Vault_0.1.0_amd64.AppImage` | `chmod +x SD-Vault_*.AppImage` → Doppelklick |
| Linux | `SD-Vault_0.1.0.flatpak` | `flatpak install SD-Vault_*.flatpak` |
| Windows | `SD-Vault_0.1.0_x64-setup.exe` | Doppelklick → Installer folgen |

---

## Erster Start – Vault erstellen

Beim ersten Start wirst du aufgefordert, einen neuen Vault anzulegen.

1. **Master-Passwort wählen** – Dein Hauptpasswort. Mindestens 12 Zeichen, stark und einzigartig.
2. **Emergency Kit speichern** – Die App erstellt automatisch eine PDF-Datei mit deinem **Secret Key**.
   → Diese PDF sofort ausdrucken oder an einem sicheren Ort speichern (z. B. USB-Stick, Tresor).

---

## Die zwei Schlüssel

SD-Vault verwendet ein **Zwei-Schlüssel-System** für maximale Sicherheit.

### 1. Master-Passwort
- Kennst nur du
- Wird niemals gespeichert
- Brauchst du zum täglichen Entsperren

### 2. Secret Key
- Wird beim Erstellen des Vaults automatisch generiert
- Liegt als Datei auf deinem PC (`~/Dokumente/SD-Vault/vault.secret`)
- Steht im **Emergency Kit PDF**
- Brauchst du NUR wenn du dein Master-Passwort vergessen hast

> **Merke:** Zum normalen Entsperren reicht das Master-Passwort.
> Den Secret Key brauchst du nur im Notfall.

---

## Verschlüsselung (Technisch)

| Schicht | Algorithmus | Zweck |
|---------|-------------|-------|
| Schlüsselableitung | Argon2id | Master-Passwort + Secret Key → Vault-Schlüssel |
| Datenbankschutz | AES-256-GCM + SQLCipher | Verschlüsselte SQLite-Datenbank |
| Eintrags-Verschlüsselung | AES-256-GCM (HKDF) | Jeder Eintrag einzeln verschlüsselt |
| Anhänge | AES-256-GCM | Verschlüsselt in der Datenbank gespeichert |

Ohne Master-Passwort ist der Vault **mathematisch nicht zu öffnen**.
Selbst mit Zugriff auf die Datenbankdatei kommt niemand an deine Daten.

---

## Auf einen neuen PC umziehen

### Schritt-für-Schritt

1. **Alter PC:** SD-Vault öffnen → Einstellungen → Synchronisation
2. **„Vault exportieren (.sdpx)"** klicken → Speicherort wählen
3. Die `.sdpx`-Datei auf den neuen PC übertragen (USB-Stick, verschlüsselter Cloud-Ordner, etc.)
4. **Neuer PC:** SD-Vault installieren → Einstellungen → Synchronisation
5. **„Vault importieren (.sdpx)"** klicken → Datei auswählen
6. App neu starten → Mit **Master-Passwort** entsperren

### Was steckt in der .sdpx-Datei?

Die `.sdpx`-Datei ist ein verschlüsseltes Paket mit allen nötigen Vault-Dateien:

| Datei | Inhalt |
|-------|--------|
| `vault.db` | Deine verschlüsselte Datenbank |
| `vault.secret` | Dein Secret Key (als Datei) |
| `vault.salt` | Kryptografisches Salt |
| `vault.recovery` | Wrapped Master-Key (für Passwort-Reset) |
| `vault.kdf` | Parameter der Schlüsselableitung |

> Die Datenbank ist bereits verschlüsselt – ohne dein Master-Passwort kann niemand die .sdpx-Datei nutzen.

---

## Master-Passwort vergessen?

Wenn du dein Master-Passwort vergessen hast, kannst du es mit dem **Secret Key** zurücksetzen.

1. SD-Vault öffnen → „Passwort zurücksetzen" wählen
2. Secret Key aus dem **Emergency Kit PDF** eingeben
3. Neues Master-Passwort festlegen

> **Ohne Secret Key und ohne Master-Passwort gibt es keinen Zugang mehr.**
> Das ist Absicht – Zero-Knowledge bedeutet: Nur du hast Zugriff.

---

## Features

| Feature | Beschreibung |
|---------|-------------|
| Einträge | Login, Kreditkarte, Notiz, Identität |
| TOTP | Zwei-Faktor-Codes direkt in der App |
| HIBP-Prüfung | Prüft ob dein Passwort in einem Datenleck war |
| Schnellsuche | Ctrl+K öffnet sofortige Suche |
| Anhänge | Verschlüsselte Dateien pro Eintrag (max. 10 MB) |
| PDF-Export | Einzelnen Eintrag als PDF exportieren |
| Passwort-Generator | Klassisch oder EFF-Passphrase |
| WebDAV-Sync | Nextcloud, ownCloud, etc. |
| SFTP-Sync | Eigener Server |
| Lokales Backup | Automatische lokale Kopien |

---

## Wo liegen meine Daten?

| System | Pfad |
|--------|------|
| Linux | `~/Dokumente/SD-Vault/` |
| Windows | `C:\Users\<Name>\Documents\SD-Vault\` |

Diese Dateien solltest du regelmäßig sichern (oder die .sdpx-Export-Funktion nutzen).

---

## Sicherheits-Empfehlungen

- [ ] Emergency Kit PDF ausdrucken und sicher aufbewahren (nicht digital!)
- [ ] Regelmäßig Vault-Export (.sdpx) auf USB-Stick speichern
- [ ] Master-Passwort niemals aufschreiben oder digital speichern
- [ ] Master-Passwort mindestens 16 Zeichen lang wählen
- [ ] WebDAV/SFTP-Sync nur über verschlüsselte Verbindungen (HTTPS/SSH)

---

## Häufige Fragen

**Kann SD-Vault gehackt werden wenn jemand meine vault.db klaut?**
Nein. Die Datenbank ist AES-256-GCM-verschlüsselt. Ohne Master-Passwort ist sie wertlos.

**Was passiert wenn ich die App deinstalliere?**
Deine Daten bleiben in `~/Dokumente/SD-Vault/` erhalten. Einfach neu installieren und wieder entsperren.

**Kann ich SD-Vault auf mehreren PCs gleichzeitig nutzen?**
Ja – über WebDAV oder SFTP-Sync. Empfehlung: Nextcloud auf eigenem Server.

**Wird mein Master-Passwort irgendwo gespeichert?**
Nein. Es wird nur zur Laufzeit im Arbeitsspeicher gehalten und nach dem Sperren sofort gelöscht (Zeroize).

---

*SD-Vault v0.1.0 – ShadowDev*
