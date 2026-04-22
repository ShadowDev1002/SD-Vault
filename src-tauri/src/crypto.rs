use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use blake3::Hasher;
use hkdf::Hkdf;
use rand::RngCore;
use rand::rngs::OsRng;
use sha2::Sha256;
use zeroize::Zeroizing;

pub const KEY_LEN: usize = 32;
pub const ARGON2_THREADS: u32 = 4;

// Debug: schnelle Parameter (~0.5s) / Release: sichere Parameter (~3s)
#[cfg(debug_assertions)]
pub const ARGON2_MEM_KB: u32 = 32 * 1024;
#[cfg(debug_assertions)]
pub const ARGON2_OPS: u32 = 1;

#[cfg(not(debug_assertions))]
pub const ARGON2_MEM_KB: u32 = 256 * 1024;
#[cfg(not(debug_assertions))]
pub const ARGON2_OPS: u32 = 3;

/// Leitet einen 32-Byte Master Key ab: BLAKE3(masterPw || secretKey) → Argon2id.
pub fn derive_master_key(
    master_pw: &str,
    secret_key_bytes: &[u8],
    salt: &[u8; 32],
    mem_kb: u32,
    ops: u32,
    threads: u32,
) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let mut hasher = Hasher::new();
    hasher.update(master_pw.as_bytes());
    hasher.update(b"||");
    hasher.update(secret_key_bytes);
    let combined = hasher.finalize();

    let params = Params::new(mem_kb, ops, threads, Some(KEY_LEN))
        .map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(combined.as_bytes(), salt, key.as_mut())
        .map_err(|e| e.to_string())?;

    Ok(key)
}

/// Leitet den SQLCipher-Key via HKDF-SHA256 ab (SQLCipher nutzt intern AES-256-CBC).
pub fn derive_sqlcipher_key(master_key: &[u8; KEY_LEN]) -> Zeroizing<[u8; KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(None, master_key);
    let mut okm = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(b"sd-vault:sqlcipher:v1", okm.as_mut())
        .expect("HKDF expand: output length 32 always valid");
    okm
}

/// Leitet den Entry-Encryption-Key via HKDF-SHA256 ab.
pub fn derive_entry_key(master_key: &[u8; KEY_LEN]) -> Zeroizing<[u8; KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(None, master_key);
    let mut okm = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(b"sd-vault:entries:v1", okm.as_mut())
        .expect("HKDF expand: output length 32 always valid");
    okm
}

/// Verschlüsselt mit AES-256-GCM. Gibt nonce (12 Byte) || ciphertext+tag zurück.
pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| "Verschlüsselung fehlgeschlagen".to_string())?;

    let mut result = Vec::with_capacity(12 + ciphertext.len());
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Entschlüsselt Daten aus `encrypt`. Erwartet nonce (12 Byte) || ciphertext+tag.
pub fn decrypt(key: &[u8; KEY_LEN], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("Ciphertext zu kurz".into());
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Entschlüsselung fehlgeschlagen — falscher Key oder korrupte Daten".into())
}

/// Generiert einen 20-Byte Secret Key.
/// Format: "SDVLT-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
pub fn generate_secret_key() -> ([u8; 20], String) {
    let mut bytes = [0u8; 20];
    OsRng.fill_bytes(&mut bytes);
    let encoded = base32::encode(base32::Alphabet::RFC4648 { padding: false }, &bytes);
    let formatted = format!(
        "SDVLT-{}-{}-{}-{}",
        &encoded[0..8], &encoded[8..16], &encoded[16..24], &encoded[24..32]
    );
    (bytes, formatted)
}

/// Parst einen formatierten Secret Key zurück zu raw bytes.
pub fn parse_secret_key(formatted: &str) -> Result<[u8; 20], String> {
    let stripped = formatted
        .strip_prefix("SDVLT-")
        .ok_or("Ungültiges Format: fehlendes 'SDVLT-' Präfix")?
        .replace('-', "");

    let bytes = base32::decode(base32::Alphabet::RFC4648 { padding: false }, &stripped)
        .ok_or("Ungültiger Secret Key: kein gültiges Base32")?;

    if bytes.len() != 20 {
        return Err(format!("Ungültige Secret Key Länge: erwartet 20, erhalten {}", bytes.len()));
    }

    let mut arr = [0u8; 20];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Leitet einen Recovery-Key aus dem Secret Key ab (HKDF, 160-Bit Entropie → kein Argon2 nötig).
pub fn derive_recovery_key(secret_key: &[u8; 20]) -> Zeroizing<[u8; KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(None, secret_key);
    let mut okm = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(b"sd-vault:recovery:v1", okm.as_mut())
        .expect("HKDF expand: output length 32 always valid");
    okm
}

/// Verschlüsselt einen 32-Byte Schlüssel mit AES-256-GCM (Key Wrapping).
pub fn wrap_key(wrapping_key: &[u8; KEY_LEN], key_to_wrap: &[u8; KEY_LEN]) -> Result<Vec<u8>, String> {
    encrypt(wrapping_key, key_to_wrap.as_ref())
}

/// Entschlüsselt einen gewrappten Schlüssel.
pub fn unwrap_key(wrapping_key: &[u8; KEY_LEN], wrapped: &[u8]) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let bytes = decrypt(wrapping_key, wrapped)?;
    if bytes.len() != KEY_LEN {
        return Err("Ungültige Schlüssellänge nach Entschlüsselung".into());
    }
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    key.as_mut().copy_from_slice(&bytes);
    Ok(key)
}

/// Generiert einen zufälligen 32-Byte Argon2-Salt.
pub fn generate_salt() -> [u8; 32] {
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}
