use super::SyncProvider;
pub struct SftpProvider;
impl SftpProvider {
    pub fn new(_host: String, _path: String, _user: String, _pass: String) -> Result<Self, String> { Ok(Self) }
}
impl SyncProvider for SftpProvider {
    fn upload(&self, _: &[u8], _: &str) -> Result<(), String> { Err("not implemented".into()) }
    fn download(&self) -> Result<Vec<u8>, String> { Err("not implemented".into()) }
    fn remote_hash(&self) -> Result<Option<String>, String> { Ok(None) }
}
