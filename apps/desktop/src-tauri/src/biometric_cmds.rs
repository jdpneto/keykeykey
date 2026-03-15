/// Desktop biometric support via keyring storage.
///
/// Note: Full Touch ID-gated Keychain with kSecAccessControlBiometryCurrentSet
/// is a future enhancement. Currently uses standard keyring storage with
/// a biometric availability check.

const BIOMETRIC_SERVICE: &str = "com.keykeykey.biometric";
const BIOMETRIC_ACCOUNT: &str = "biometric_dek";

#[tauri::command]
pub async fn biometric_is_available() -> bool {
    // TODO: Implement real Touch ID check via LAContext.
    // Currently disabled because the keyring storage does not provide
    // actual biometric gating (kSecAccessControlBiometryCurrentSet).
    // Returning true without real biometric protection would be a
    // security misrepresentation for a credential manager.
    false
}

#[tauri::command]
pub fn biometric_save_dek(value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(BIOMETRIC_SERVICE, BIOMETRIC_ACCOUNT)
        .map_err(|e| format!("Keyring error: {e}"))?;
    entry
        .set_password(&value)
        .map_err(|e| format!("Failed to save biometric DEK: {e}"))
}

#[tauri::command]
pub fn biometric_load_dek() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(BIOMETRIC_SERVICE, BIOMETRIC_ACCOUNT)
        .map_err(|e| format!("Keyring error: {e}"))?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to load biometric DEK: {e}")),
    }
}

#[tauri::command]
pub fn biometric_clear_dek() -> Result<(), String> {
    let entry = keyring::Entry::new(BIOMETRIC_SERVICE, BIOMETRIC_ACCOUNT)
        .map_err(|e| format!("Keyring error: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to clear biometric DEK: {e}")),
    }
}
