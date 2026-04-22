// Full implementation added in Task 6
use async_trait::async_trait;
use super::{BackupEntry, SyncProvider};
pub struct SftpProvider;
impl SftpProvider { pub fn new(_c: super::config::SftpConfig) -> Self { Self } }
#[async_trait]
impl SyncProvider for SftpProvider {
    async fn upload(&self, _d: &[u8], _n: &str) -> Result<(), String> { Err("stub".into()) }
    async fn download(&self, _id: &str) -> Result<Vec<u8>, String> { Err("stub".into()) }
    async fn list_backups(&self) -> Result<Vec<BackupEntry>, String> { Err("stub".into()) }
    async fn delete_backup(&self, _id: &str) -> Result<(), String> { Err("stub".into()) }
}
