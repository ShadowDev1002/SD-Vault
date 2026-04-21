use super::SyncProvider;
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;

pub struct SftpProvider {
    host: String,
    port: u16,
    remote_path: String,
    hash_path: String,
    username: String,
    password: String,
}

impl SftpProvider {
    pub fn new(
        host: String,
        remote_path: String,
        username: String,
        password: String,
    ) -> Result<Self, String> {
        let (host, port) = if let Some((h, p)) = host.rsplit_once(':') {
            (h.to_string(), p.parse::<u16>().unwrap_or(22))
        } else {
            (host, 22)
        };
        let hash_path = format!("{}.sha256", remote_path);
        Ok(Self { host, port, remote_path, hash_path, username, password })
    }

    fn session(&self) -> Result<Session, String> {
        let tcp = TcpStream::connect(format!("{}:{}", self.host, self.port))
            .map_err(|e| format!("SFTP connect: {}", e))?;
        let mut sess = Session::new().map_err(|e| format!("SFTP session: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| format!("SFTP handshake: {}", e))?;
        sess.userauth_password(&self.username, &self.password)
            .map_err(|e| format!("SFTP auth: {}", e))?;
        if !sess.authenticated() {
            return Err("SFTP authentication failed".into());
        }
        Ok(sess)
    }
}

impl SyncProvider for SftpProvider {
    fn upload(&self, vault_bytes: &[u8], hash: &str) -> Result<(), String> {
        let sess = self.session()?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem: {}", e))?;

        if let Some(parent) = std::path::Path::new(&self.remote_path).parent() {
            let _ = sftp.mkdir(parent, 0o755);
        }

        let mut file = sftp
            .create(std::path::Path::new(&self.remote_path))
            .map_err(|e| format!("SFTP create vault: {}", e))?;
        file.write_all(vault_bytes)
            .map_err(|e| format!("SFTP write vault: {}", e))?;

        let mut hash_file = sftp
            .create(std::path::Path::new(&self.hash_path))
            .map_err(|e| format!("SFTP create hash: {}", e))?;
        hash_file
            .write_all(hash.as_bytes())
            .map_err(|e| format!("SFTP write hash: {}", e))?;

        Ok(())
    }

    fn download(&self) -> Result<Vec<u8>, String> {
        let sess = self.session()?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem: {}", e))?;
        let mut file = sftp
            .open(std::path::Path::new(&self.remote_path))
            .map_err(|e| format!("SFTP open: {}", e))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| format!("SFTP read: {}", e))?;
        Ok(bytes)
    }

    fn remote_hash(&self) -> Result<Option<String>, String> {
        let sess = self.session()?;
        let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem: {}", e))?;
        match sftp.open(std::path::Path::new(&self.hash_path)) {
            Err(_) => Ok(None),
            Ok(mut file) => {
                let mut text = String::new();
                file.read_to_string(&mut text)
                    .map_err(|e| format!("SFTP read hash: {}", e))?;
                Ok(Some(text.trim().to_string()))
            }
        }
    }
}
