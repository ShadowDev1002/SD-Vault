use async_trait::async_trait;
use chrono::Utc;
use rand::Rng;
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use super::config::{SftpAuth, SftpConfig};
use super::{BackupEntry, SyncProvider};

pub struct SftpProvider {
    config: SftpConfig,
    fingerprint_path: std::path::PathBuf,
}

impl SftpProvider {
    pub fn new(config: SftpConfig, vault_dir: &std::path::Path) -> Self {
        let host_slug = config.host.replace('.', "_").replace(':', "_");
        let fingerprint_path = vault_dir.join(format!("sftp_host_{}.fp", host_slug));
        Self { config, fingerprint_path }
    }

    fn connect(&self) -> Result<Session, String> {
        let addr = format!("{}:{}", self.config.host, self.config.port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| format!("SFTP Verbindung fehlgeschlagen: {}", e))?;

        let mut sess = Session::new().map_err(|e| e.to_string())?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| format!("SSH Handshake fehlgeschlagen: {}", e))?;

        check_host_key(&sess, &self.config.host, &self.fingerprint_path)?;

        match &self.config.auth {
            SftpAuth::Password { password } => {
                sess.userauth_password(&self.config.username, password)
                    .map_err(|e| format!("SFTP Passwort-Auth fehlgeschlagen: {}", e))?;
            }
            SftpAuth::KeyFile { key_path } => {
                sess.userauth_pubkey_file(&self.config.username, None, Path::new(key_path), None)
                    .map_err(|e| format!("SFTP Key-Auth fehlgeschlagen: {}", e))?;
            }
        }

        if !sess.authenticated() {
            return Err("SFTP Authentifizierung fehlgeschlagen".into());
        }
        Ok(sess)
    }

    fn remote_path(&self, filename: &str) -> String {
        format!("{}/{}", self.config.remote_path.trim_end_matches('/'), filename)
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.contains('/') || id.contains('\\') || id.contains("..") || id.is_empty() {
        return Err("Ungültige Backup-ID".into());
    }
    Ok(())
}

fn check_host_key(
    sess: &Session,
    _host: &str,
    fingerprint_path: &std::path::PathBuf,
) -> Result<(), String> {
    let host_key = sess.host_key().ok_or("Server hat keinen Host-Key geliefert")?;
    let fingerprint = sess
        .host_key_hash(ssh2::HashType::Sha256)
        .ok_or("Host-Key Hash konnte nicht berechnet werden")?;
    let fp_hex = hex::encode(fingerprint);

    if fingerprint_path.exists() {
        let stored = std::fs::read_to_string(fingerprint_path).map_err(|e| e.to_string())?;
        let stored = stored.trim();
        if stored != fp_hex {
            return Err(format!(
                "SSH Host-Key stimmt nicht überein! Möglicher MITM-Angriff.\nGespeichert: {}\nAktuell: {}",
                stored, fp_hex
            ));
        }
    } else {
        // Trust on first use (TOFU)
        std::fs::write(fingerprint_path, &fp_hex).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            std::fs::set_permissions(fingerprint_path, perms)
                .map_err(|e| format!("Konnte Fingerprint-Dateiberechtigungen nicht setzen: {}", e))?;
        }
    }

    let _ = host_key; // suppress unused warning
    Ok(())
}

// NOTE: lib.rs currently has only the minimal run() stub (no sync_sftp command),
// so SftpProvider::new does not need updating there. When Task 7 adds the full
// Tauri command, pass &vault_dir as the second argument to SftpProvider::new.

#[async_trait]
impl SyncProvider for SftpProvider {
    async fn upload(&self, data: &[u8], _name: &str) -> Result<(), String> {
        let sess = self.connect()?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let _ = sftp.mkdir(Path::new(&self.config.remote_path), 0o755);
        let suffix: u32 = rand::thread_rng().gen();
        let filename = format!("vault_{}_{:08x}.db", Utc::now().timestamp(), suffix);
        let remote = self.remote_path(&filename);
        let mut file = sftp
            .create(Path::new(&remote))
            .map_err(|e| format!("SFTP Datei erstellen fehlgeschlagen: {}", e))?;
        file.write_all(data)
            .map_err(|e| format!("SFTP Schreiben fehlgeschlagen: {}", e))?;
        Ok(())
    }

    async fn download(&self, id: &str) -> Result<Vec<u8>, String> {
        validate_id(id)?;
        let sess = self.connect()?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let remote = self.remote_path(id);
        let mut file = sftp
            .open(Path::new(&remote))
            .map_err(|e| format!("SFTP Öffnen fehlgeschlagen: {}", e))?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)
            .map_err(|e| format!("SFTP Lesen fehlgeschlagen: {}", e))?;
        Ok(data)
    }

    async fn list_backups(&self) -> Result<Vec<BackupEntry>, String> {
        let sess = self.connect()?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let dir_entries = sftp
            .readdir(Path::new(&self.config.remote_path))
            .map_err(|e| format!("SFTP readdir fehlgeschlagen: {}", e))?;
        let mut backups: Vec<BackupEntry> = dir_entries
            .into_iter()
            .filter(|(path, _)| path.extension().map(|x| x == "db").unwrap_or(false))
            .filter_map(|(path, stat)| {
                let name = path.file_name()?.to_string_lossy().to_string();
                let ts: i64 = name.strip_prefix("vault_")?.split('_').next()?.parse().ok()?;
                Some(BackupEntry {
                    id: name,
                    timestamp: ts,
                    size_bytes: stat.size.unwrap_or(0),
                })
            })
            .collect();
        backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(backups)
    }

    async fn delete_backup(&self, id: &str) -> Result<(), String> {
        validate_id(id)?;
        let sess = self.connect()?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        sftp.unlink(Path::new(&self.remote_path(id)))
            .map_err(|e| format!("SFTP Löschen fehlgeschlagen: {}", e))
    }
}
