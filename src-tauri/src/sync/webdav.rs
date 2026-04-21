use super::SyncProvider;
pub struct WebDavProvider;
impl WebDavProvider {
    pub fn new(_base_url: String, _remote_path: String, _username: String, _password: String) -> Self { Self }
}
impl SyncProvider for WebDavProvider {
    fn upload(&self, _: &[u8], _: &str) -> Result<(), String> { Err("not implemented".into()) }
    fn download(&self) -> Result<Vec<u8>, String> { Err("not implemented".into()) }
    fn remote_hash(&self) -> Result<Option<String>, String> { Ok(None) }
}
