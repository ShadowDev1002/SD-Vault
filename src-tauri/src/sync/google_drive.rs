use async_trait::async_trait;
use super::{BackupEntry, SyncProvider};

pub struct GoogleDriveProvider;

#[async_trait]
impl SyncProvider for GoogleDriveProvider {
    async fn upload(&self, _data: &[u8], _name: &str) -> Result<(), String> {
        Err("Google Drive Sync noch nicht implementiert".into())
    }
    async fn download(&self, _id: &str) -> Result<Vec<u8>, String> {
        Err("Google Drive Sync noch nicht implementiert".into())
    }
    async fn list_backups(&self) -> Result<Vec<BackupEntry>, String> {
        Err("Google Drive Sync noch nicht implementiert".into())
    }
    async fn delete_backup(&self, _id: &str) -> Result<(), String> {
        Err("Google Drive Sync noch nicht implementiert".into())
    }
}
