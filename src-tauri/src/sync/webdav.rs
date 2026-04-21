use super::SyncProvider;

pub struct WebDavProvider {
    vault_url: String,
    hash_url: String,
    username: String,
    password: String,
}

impl WebDavProvider {
    pub fn new(base_url: String, remote_path: String, username: String, password: String) -> Self {
        let base = base_url.trim_end_matches('/');
        let path = remote_path.trim_start_matches('/');
        let vault_url = format!("{}/{}", base, path);
        let hash_url = format!("{}.sha256", vault_url);
        Self { vault_url, hash_url, username, password }
    }

    fn client(&self) -> reqwest::blocking::Client {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .expect("failed to build reqwest client")
    }
}

impl SyncProvider for WebDavProvider {
    fn upload(&self, vault_bytes: &[u8], hash: &str) -> Result<(), String> {
        let client = self.client();

        // Attempt to create parent directory (ignore errors — may already exist)
        if let Some(parent) = self.vault_url.rsplit_once('/').map(|(p, _)| p) {
            let _ = client
                .request(
                    reqwest::Method::from_bytes(b"MKCOL").unwrap(),
                    parent,
                )
                .basic_auth(&self.username, Some(&self.password))
                .send();
        }

        client
            .put(&self.vault_url)
            .basic_auth(&self.username, Some(&self.password))
            .body(vault_bytes.to_vec())
            .send()
            .map_err(|e| format!("WebDAV PUT vault: {}", e))?
            .error_for_status()
            .map_err(|e| format!("WebDAV PUT vault status: {}", e))?;

        client
            .put(&self.hash_url)
            .basic_auth(&self.username, Some(&self.password))
            .body(hash.to_string())
            .send()
            .map_err(|e| format!("WebDAV PUT hash: {}", e))?
            .error_for_status()
            .map_err(|e| format!("WebDAV PUT hash status: {}", e))?;

        Ok(())
    }

    fn download(&self) -> Result<Vec<u8>, String> {
        let resp = self
            .client()
            .get(&self.vault_url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .map_err(|e| format!("WebDAV GET: {}", e))?
            .error_for_status()
            .map_err(|e| format!("WebDAV GET status: {}", e))?;
        resp.bytes()
            .map(|b| b.to_vec())
            .map_err(|e| format!("WebDAV read body: {}", e))
    }

    fn remote_hash(&self) -> Result<Option<String>, String> {
        let resp = self
            .client()
            .get(&self.hash_url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .map_err(|e| format!("WebDAV GET hash: {}", e))?;

        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let text = resp
            .error_for_status()
            .map_err(|e| format!("WebDAV GET hash status: {}", e))?
            .text()
            .map_err(|e| format!("WebDAV read hash: {}", e))?;
        Ok(Some(text.trim().to_string()))
    }
}
