# SD-Vault

Secure password manager built with Tauri v2 — AES-256-GCM encryption, SQLCipher backend, multi-platform sync.

## Features

- **AES-256-GCM** encryption with SQLCipher database
- **Dual-key security** — master password + secret key (BLAKE3 → Argon2id)
- **TOTP** two-factor code generator
- **Have I Been Pwned** breach check
- **WebDAV / SFTP / Google Drive** sync
- **Drag & Drop** encrypted attachments
- **PDF export** for individual entries
- **Emergency Kit** — printable recovery document
- Quick search (Ctrl+K)
- Import / Export (.sdpx, Bitwarden CSV)
- Password generator (classic + EFF passphrase)
- Dark/Light theme + accent color

## Download

Latest release: **v1.0.1**

| Platform | File |
|----------|------|
| Windows | `SD-Vault_1.0.1_x64-setup.exe` |
| Linux (AppImage) | `SD-Vault_1.0.1_amd64.AppImage` |
| Linux (Flatpak) | `sd-vault_1.0.1.flatpak` |
| Linux (DEB) | `SD-Vault_1.0.1_amd64.deb` |
| Linux (RPM) | `SD-Vault-1.0.1-1.x86_64.rpm` |

## Installation

**Windows** — Run `SD-Vault_1.0.1_x64-setup.exe`

**AppImage**
```sh
chmod +x SD-Vault_1.0.1_amd64.AppImage
./SD-Vault_1.0.1_amd64.AppImage
```

**Flatpak**
```sh
flatpak install sd-vault_1.0.1.flatpak
flatpak run de.shadowdev.sd-vault
```

**DEB**
```sh
sudo dpkg -i SD-Vault_1.0.1_amd64.deb
```

**RPM**
```sh
sudo rpm -i SD-Vault-1.0.1-1.x86_64.rpm
```

## Build from Source

```sh
# Dependencies: Rust, Node.js, pnpm
pnpm install
pnpm tauri build
```

## Tech Stack

[Tauri v2](https://tauri.app) · [React](https://react.dev) · [SQLCipher](https://www.zetetic.net/sqlcipher/) · [Argon2id](https://github.com/P-H-C/phc-winner-argon2) · [BLAKE3](https://github.com/BLAKE3-team/BLAKE3)

## Disclaimer

SD-Vault is provided **as-is** without any warranty, express or implied.

The developer accepts **no liability** for data loss, security vulnerabilities, crashes, failed backups, or any consequential damages arising from use of this software.

Vault security depends on the strength of your master password and the safe storage of your Emergency Kit. The source code is publicly auditable on GitHub.

## License

MIT
