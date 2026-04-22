use async_trait::async_trait;
use chrono::Utc;
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;

use super::config::{SftpAuth, SftpConfig};
use super::{BackupEntry, SyncProvider};

pub struct SftpProvider {
    config: SftpConfig,
}

impl SftpProvider {
    pub fn new(config: SftpConfig) -> Self {
        Self { config }
    }

    fn connect(&self) -> Result<Session, String> {
        let addr = format!("{}:{}", self.config.host, self.config.port);
        let tcp = TcpStream::connect(&addr)
            .map_err(|e| format!("SFTP Verbindung fehlgeschlagen: {}", e))?;

        let mut sess = Session::new().map_err(|e| e.to_string())?;
        sess.set_tcp_stream(tcp);
        sess.handshake()
            .map_err(|e| format!("SSH Handshake fehlgeschlagen: {}", e))?;

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

#[async_trait]
impl SyncProvider for SftpProvider {
    async fn upload(&self, data: &[u8], _name: &str) -> Result<(), String> {
        let sess = self.connect()?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        let _ = sftp.mkdir(Path::new(&self.config.remote_path), 0o755);
        let filename = format!("vault_{}.db", Utc::now().timestamp());
        let remote = self.remote_path(&filename);
        let mut file = sftp
            .create(Path::new(&remote))
            .map_err(|e| format!("SFTP Datei erstellen fehlgeschlagen: {}", e))?;
        file.write_all(data)
            .map_err(|e| format!("SFTP Schreiben fehlgeschlagen: {}", e))?;
        Ok(())
    }

    async fn download(&self, id: &str) -> Result<Vec<u8>, String> {
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
                let ts: i64 = name.strip_prefix("vault_")?.strip_suffix(".db")?.parse().ok()?;
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
        let sess = self.connect()?;
        let sftp = sess.sftp().map_err(|e| e.to_string())?;
        sftp.unlink(Path::new(&self.remote_path(id)))
            .map_err(|e| format!("SFTP Löschen fehlgeschlagen: {}", e))
    }
}
