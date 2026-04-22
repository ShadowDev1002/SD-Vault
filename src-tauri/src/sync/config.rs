use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum SftpAuth {
    Password { password: String },
    KeyFile { key_path: String },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SftpConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub remote_path: String,
    pub auth: SftpAuth,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct SyncConfig {
    pub sftp: Option<SftpConfig>,
}

impl SyncConfig {
    pub fn load(config_path: &Path) -> Result<Self, String> {
        if !config_path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(config_path).map_err(|e| e.to_string())?;
        toml::from_str(&content).map_err(|e| e.to_string())
    }

    pub fn save(&self, config_path: &Path) -> Result<(), String> {
        let content = toml::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(config_path, content).map_err(|e| e.to_string())
    }
}
