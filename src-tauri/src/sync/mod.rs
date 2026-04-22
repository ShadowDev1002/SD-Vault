use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub mod config;
pub mod google_drive;
pub mod local;
pub mod sftp;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BackupEntry {
    pub id: String,
    pub timestamp: i64,
    pub size_bytes: u64,
}

#[async_trait]
pub trait SyncProvider: Send + Sync {
    async fn upload(&self, data: &[u8], name: &str) -> Result<(), String>;
    async fn download(&self, id: &str) -> Result<Vec<u8>, String>;
    async fn list_backups(&self) -> Result<Vec<BackupEntry>, String>;
    async fn delete_backup(&self, id: &str) -> Result<(), String>;
}
