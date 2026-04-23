# SD-Vault

Secure password manager built with Tauri v2 – AES-256-GCM, TOTP, WebDAV sync.

## Features

- **AES-256-GCM** encryption with SQLCipher database
- **TOTP** two-factor code generator
- **Have I Been Pwned** breach check
- **WebDAV / SFTP** sync
- **Drag & Drop** encrypted attachments
- **PDF export** for individual entries
- Quick search (Ctrl+K)
- Import/Export (.sdpx, Bitwarden CSV)
- Password generator (classic + EFF passphrase)

## Download

| Platform | File |
|----------|------|
| Linux (AppImage) | `SD-Vault_0.1.0_amd64.AppImage` |
| Linux (Flatpak) | `SD-Vault_0.1.0.flatpak` |
| Windows | `SD-Vault_0.1.0_x64-setup.exe` |

## Installation

**AppImage**
```sh
chmod +x SD-Vault_0.1.0_amd64.AppImage
./SD-Vault_0.1.0_amd64.AppImage
```

**Flatpak**
```sh
flatpak install SD-Vault_0.1.0.flatpak
flatpak run de.shadowdev.sd-vault
```

**Windows** — Doppelklick auf `SD-Vault_0.1.0_x64-setup.exe`

## Build from Source

```sh
# Dependencies: Rust, Node.js, pnpm
pnpm install
pnpm tauri build
```

## Tech Stack

- [Tauri v2](https://tauri.app) · [React](https://react.dev) · [SQLCipher](https://www.zetetic.net/sqlcipher/)

## Haftungsausschluss

SD-Vault wird **so wie es ist** bereitgestellt — ohne jegliche ausdrückliche oder stillschweigende Garantie.

Der Entwickler übernimmt **keinerlei Haftung** für Datenverlust, Schäden durch Sicherheitslücken, Abstürze, fehlerhafte Backups oder Folgeschäden jeglicher Art, die durch die Nutzung dieser Software entstehen.

Die Sicherheit des Vaults hängt maßgeblich von der Stärke des Master-Passworts und dem sicheren Aufbewahren des Emergency Kits ab. Der Quellcode ist auf GitHub einsehbar und prüfbar.

## License

MIT
