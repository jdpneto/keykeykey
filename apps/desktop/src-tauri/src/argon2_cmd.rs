use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};

#[tauri::command]
pub fn argon2_hash(
    password_b64: String,
    salt_b64: String,
    t: u32,
    m: u32,
    p: u32,
    dk_len: usize,
) -> Result<String, String> {
    let password = B64
        .decode(&password_b64)
        .map_err(|e| format!("Invalid password base64: {e}"))?;
    let salt = B64
        .decode(&salt_b64)
        .map_err(|e| format!("Invalid salt base64: {e}"))?;

    let params = Params::new(m, t, p, Some(dk_len))
        .map_err(|e| format!("Invalid Argon2 params: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut output = vec![0u8; dk_len];
    argon2
        .hash_password_into(&password, &salt, &mut output)
        .map_err(|e| format!("Argon2 hash failed: {e}"))?;

    Ok(B64.encode(&output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_argon2_hash_basic() {
        // Use minimal params for a fast test
        let password = B64.encode(b"test-password");
        let salt = B64.encode(b"0123456789abcdef"); // 16 bytes

        let result = argon2_hash(password.clone(), salt.clone(), 1, 64, 1, 32);
        assert!(result.is_ok());

        let hash_b64 = result.unwrap();
        let hash_bytes = B64.decode(&hash_b64).unwrap();
        assert_eq!(hash_bytes.len(), 32);

        // Same input should produce the same output (deterministic)
        let result2 = argon2_hash(password, salt, 1, 64, 1, 32).unwrap();
        assert_eq!(hash_b64, result2);
    }

    #[test]
    fn test_argon2_hash_invalid_base64() {
        let result = argon2_hash("!!!invalid".into(), "dGVzdA==".into(), 1, 64, 1, 32);
        assert!(result.is_err());
    }
}
