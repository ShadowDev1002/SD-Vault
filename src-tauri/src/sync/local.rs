use async_trait::async_trait;
use chrono::Utc;
use rand::Rng;
use std::fs;
use std::path::{Path, PathBuf};

use super::{BackupEntry, SyncProvider};

pub struct LocalBackupProvider {
    backup_dir: PathBuf,
    max_backups: usize,
}

impl LocalBackupProvider {
    pub fn new(vault_dir: &Path) -> Result<Self, String> {
        let backup_dir = vault_dir.join("backups");
        fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
        Ok(Self { backup_dir, max_backups: 10 })
    }

    fn prune(&self) -> Result<(), String> {
        let mut entries: Vec<(i64, PathBuf)> = fs::read_dir(&self.backup_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "db").unwrap_or(false))
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let ts: i64 = name.strip_prefix("vault_")?.split('_').next()?.parse().ok()?;
                Some((ts, e.path()))
            })
            .collect();

        entries.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in entries.into_iter().skip(self.max_backups) {
            let _ = fs::remove_file(path);
        }
        Ok(())
    }
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.contains('/') || id.contains('\\') || id.contains("..") || id.is_empty() {
        return Err("Ungültige Backup-ID".into());
    }
    Ok(())
}

#[async_trait]
impl SyncProvider for LocalBackupProvider {
    async fn upload(&self, data: &[u8], _name: &str) -> Result<(), String> {
        let suffix: u32 = rand::thread_rng().gen();
        let filename = format!("vault_{}_{:08x}.db", Utc::now().timestamp(), suffix);
        fs::write(self.backup_dir.join(&filename), data).map_err(|e| e.to_string())?;
        self.prune()
    }

    async fn download(&self, id: &str) -> Result<Vec<u8>, String> {
        validate_id(id)?;
        fs::read(self.backup_dir.join(id)).map_err(|e| e.to_string())
    }

    async fn list_backups(&self) -> Result<Vec<BackupEntry>, String> {
        let mut entries: Vec<BackupEntry> = fs::read_dir(&self.backup_dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "db").unwrap_or(false))
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let size = e.metadata().ok()?.len();
                let ts: i64 = name.strip_prefix("vault_")?.split('_').next()?.parse().ok()?;
                Some(BackupEntry { id: name, timestamp: ts, size_bytes: size })
            })
            .collect();
        entries.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        Ok(entries)
    }

    async fn delete_backup(&self, id: &str) -> Result<(), String> {
        validate_id(id)?;
        fs::remove_file(self.backup_dir.join(id)).map_err(|e| e.to_string())
    }
}
