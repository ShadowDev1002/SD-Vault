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
}

#[async_trait]
impl SyncProvider for WebDavProvider {
    async fn upload(&self, data: &[u8], name: &str) -> Result<(), String> {
        self.client
            .put(format!("{}/{}", self.url, name))
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
            .get(format!("{}/{}", self.url, name))
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
