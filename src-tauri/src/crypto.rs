use argon2::{Algorithm, Argon2, Params, Version};
use blake3::Hasher;
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use rand::RngCore;
use rand::rngs::OsRng;
use sha2::Sha256;
use zeroize::Zeroizing;

pub const KEY_LEN: usize = 32;
pub const ARGON2_MEM_KB: u32 = 256 * 1024; // 256 MB
pub const ARGON2_OPS: u32 = 3;
pub const ARGON2_THREADS: u32 = 4;

/// Leitet einen 32-Byte Master Key ab aus: Master-Passwort + Secret Key (via BLAKE3) → Argon2id.
/// `salt` muss in vault.salt neben der DB gespeichert werden (Bootstrap-Lösung).
pub fn derive_master_key(
    master_pw: &str,
    secret_key_bytes: &[u8],
    salt: &[u8; 32],
) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let mut hasher = Hasher::new();
    hasher.update(master_pw.as_bytes());
    hasher.update(b"||");
    hasher.update(secret_key_bytes);
    let combined = hasher.finalize();

    let params = Params::new(ARGON2_MEM_KB, ARGON2_OPS, ARGON2_THREADS, Some(KEY_LEN))
        .map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(combined.as_bytes(), salt, key.as_mut())
        .map_err(|e| e.to_string())?;

    Ok(key)
}

/// Leitet den SQLCipher-Key via HKDF-SHA256 aus dem Master Key ab.
pub fn derive_sqlcipher_key(master_key: &[u8; KEY_LEN]) -> Zeroizing<[u8; KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(None, master_key);
    let mut okm = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(b"sd-vault:sqlcipher:v1", okm.as_mut()).expect("HKDF expand: output length 32 is always valid");
    okm
}

/// Leitet den Entry-Encryption-Key via HKDF-SHA256 aus dem Master Key ab.
pub fn derive_entry_key(master_key: &[u8; KEY_LEN]) -> Zeroizing<[u8; KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(None, master_key);
    let mut okm = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(b"sd-vault:entries:v1", okm.as_mut()).expect("HKDF expand: output length 32 is always valid");
    okm
}

/// Verschlüsselt plaintext mit XChaCha20-Poly1305. Gibt nonce (24 Byte) || ciphertext zurück.
pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|_| "Encryption failed".to_string())?;

    let mut result = Vec::with_capacity(24 + ciphertext.len());
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Entschlüsselt Daten aus `encrypt`. Erwartet nonce (24 Byte) || ciphertext.
pub fn decrypt(key: &[u8; KEY_LEN], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 24 {
        return Err("Ciphertext zu kurz".into());
    }
    let (nonce_bytes, ciphertext) = data.split_at(24);
    let nonce = XNonce::from_slice(nonce_bytes);
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|e| e.to_string())?;
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Entschlüsselung fehlgeschlagen — falscher Key oder korrupte Daten".into())
}

/// Generiert einen 20-Byte (160-Bit) Secret Key.
/// Gibt (raw_bytes, formatted_string) zurück.
/// Format: "SDVLT-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX" (Base32, 4 × 8 Zeichen = 32 Chars)
pub fn generate_secret_key() -> ([u8; 20], String) {
    let mut bytes = [0u8; 20];
    OsRng.fill_bytes(&mut bytes);
    let encoded = base32::encode(base32::Alphabet::RFC4648 { padding: false }, &bytes);
    // 20 Byte × 8 / 5 = 32 Base32-Chars exakt
    let formatted = format!(
        "SDVLT-{}-{}-{}-{}",
        &encoded[0..8],
        &encoded[8..16],
        &encoded[16..24],
        &encoded[24..32]
    );
    (bytes, formatted)
}

/// Parst einen formatierten Secret Key zurück zu raw bytes.
/// Akzeptiert: "SDVLT-XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
pub fn parse_secret_key(formatted: &str) -> Result<[u8; 20], String> {
    let stripped = formatted
        .strip_prefix("SDVLT-")
        .ok_or("Ungültiges Format: fehlendes 'SDVLT-' Präfix")?
        .replace('-', "");

    let bytes = base32::decode(base32::Alphabet::RFC4648 { padding: false }, &stripped)
        .ok_or("Ungültiger Secret Key: kein gültiges Base32")?;

    if bytes.len() != 20 {
        return Err(format!(
            "Ungültige Secret Key Länge: erwartet 20 Bytes, erhalten {}",
            bytes.len()
        ));
    }

    let mut arr = [0u8; 20];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Leitet einen Recovery-Schlüssel aus dem Secret Key ab.
/// Da der Secret Key 160 Bits Entropie hat, reicht HKDF ohne Argon2.
pub fn derive_recovery_key(secret_key: &[u8; 20]) -> Zeroizing<[u8; KEY_LEN]> {
    let hk = Hkdf::<Sha256>::new(None, secret_key);
    let mut okm = Zeroizing::new([0u8; KEY_LEN]);
    hk.expand(b"sd-vault:recovery:v1", okm.as_mut())
        .expect("HKDF expand: output length 32 always valid");
    okm
}

/// Verschlüsselt einen 32-Byte Schlüssel mit einem anderen (Key Wrapping).
pub fn wrap_key(wrapping_key: &[u8; KEY_LEN], key_to_wrap: &[u8; KEY_LEN]) -> Result<Vec<u8>, String> {
    encrypt(wrapping_key, key_to_wrap.as_ref())
}

/// Entschlüsselt einen mit wrap_key gespeicherten Schlüssel.
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
