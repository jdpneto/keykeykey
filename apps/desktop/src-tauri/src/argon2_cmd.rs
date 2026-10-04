use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};

/// Runs the KDF on a blocking worker thread: a sync command would run on the
/// main thread and freeze the window for the whole derivation.
#[tauri::command]
pub async fn argon2_hash(
    password_b64: String,
    salt_b64: String,
    t: u32,
    m: u32,
    p: u32,
    dk_len: usize,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        argon2_hash_blocking(password_b64, salt_b64, t, m, p, dk_len)
    })
    .await
    .map_err(|e| format!("Argon2 task failed: {e}"))?
}

fn argon2_hash_blocking(
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

    let params =
        Params::new(m, t, p, Some(dk_len)).map_err(|e| format!("Invalid Argon2 params: {e}"))?;
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

        let result = argon2_hash_blocking(password.clone(), salt.clone(), 1, 64, 1, 32);
        assert!(result.is_ok());

        let hash_b64 = result.unwrap();
        let hash_bytes = B64.decode(&hash_b64).unwrap();
        assert_eq!(hash_bytes.len(), 32);

        // Same input should produce the same output (deterministic)
        let result2 = argon2_hash_blocking(password, salt, 1, 64, 1, 32).unwrap();
        assert_eq!(hash_b64, result2);
    }

    #[test]
    fn test_argon2_hash_invalid_base64() {
        let result = argon2_hash_blocking("!!!invalid".into(), "dGVzdA==".into(), 1, 64, 1, 32);
        assert!(result.is_err());
    }

    /// Known-answer vectors pinning Argon2id output across crate upgrades.
    ///
    /// Existing vaults are unlocked with a KEK derived here; if these bytes
    /// ever change, every existing vault becomes undecryptable. Vectors were
    /// generated with `argon2` 0.5.3 and independently cross-checked against
    /// `@noble/hashes` `argon2id` (the TS core's implementation). The second
    /// vector uses the production preset (t=2, m=19456 KiB, p=1).
    #[test]
    fn test_argon2id_known_answer_vectors() {
        let pw = B64.encode("correct horse battery staple \u{1F511}".as_bytes());
        let salt = B64.encode([
            0x5au8, 0xa5, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
            0x0d, 0x0e,
        ]);
        let cases: [(u32, u32, u32, usize, &str); 3] = [
            (1, 64, 1, 32, "V0L3BBHyEkZxD2VZUewNcgdOFche83oHkV1jIxiFnYU="),
            (2, 19456, 1, 32, "LCfSUbSf2isAQkUaYWjLWWwgOXtI1tz0md1ls0+F/qs="),
            (
                3,
                4096,
                4,
                64,
                "+oX22d8tpsQ5jD1xXQ0a0HB8UuEJRjtzG+ejug5leJVYP3UpTEpS7ZsCB3kq4eeziMptm684BcrfL/1m6gH0ew==",
            ),
        ];
        for (t, m, p, dk_len, expected) in cases {
            let got = argon2_hash_blocking(pw.clone(), salt.clone(), t, m, p, dk_len).unwrap();
            assert_eq!(got, expected, "Argon2id KAT mismatch for t={t} m={m} p={p}");
        }
    }
}
