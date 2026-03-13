use keyring::Entry;

const SERVICE_NAME: &str = "com.keykeykey.desktop";

fn get_entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, key).map_err(|e| format!("Keyring error: {e}"))
}

#[tauri::command]
pub fn save_to_keyring(key: String, value: String) -> Result<(), String> {
    let entry = get_entry(&key)?;
    entry
        .set_password(&value)
        .map_err(|e| format!("Failed to save to keyring: {e}"))
}

#[tauri::command]
pub fn load_from_keyring(key: String) -> Result<Option<String>, String> {
    let entry = get_entry(&key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to load from keyring: {e}")),
    }
}

#[tauri::command]
pub fn delete_from_keyring(key: String) -> Result<(), String> {
    let entry = get_entry(&key)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already deleted — not an error
        Err(e) => Err(format!("Failed to delete from keyring: {e}")),
    }
}
