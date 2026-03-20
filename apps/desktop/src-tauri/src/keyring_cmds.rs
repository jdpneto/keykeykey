use crate::storage::AppState;
use keyring::Entry;
use rusqlite::params;
use tauri::State;

const SERVICE_NAME: &str = "com.keykeykey.desktop";

fn get_entry(key: &str) -> Option<Entry> {
    Entry::new(SERVICE_NAME, key).ok()
}

/// Save to OS keyring first. If it doesn't round-trip correctly, fall back to SQLite.
#[tauri::command]
pub fn save_to_keyring(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    // Try OS keyring
    if let Some(entry) = get_entry(&key) {
        if entry.set_password(&value).is_ok() {
            // Verify the write persisted by reading back with a fresh Entry
            if let Some(verify_entry) = get_entry(&key) {
                if let Ok(read_back) = verify_entry.get_password() {
                    if read_back == value {
                        return Ok(());
                    }
                }
            }
        }
    }

    // Keyring failed or didn't persist — fall back to SQLite
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO key_value_store (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| format!("Failed to save: {e}"))?;
    Ok(())
}

/// Load from OS keyring first, then fall back to SQLite.
#[tauri::command]
pub fn load_from_keyring(
    state: State<'_, AppState>,
    key: String,
) -> Result<Option<String>, String> {
    // Try OS keyring
    if let Some(entry) = get_entry(&key) {
        match entry.get_password() {
            Ok(value) => return Ok(Some(value)),
            Err(keyring::Error::NoEntry) => {}
            Err(_) => {}
        }
    }

    // Fall back to SQLite
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT value FROM key_value_store WHERE key = ?1")
        .map_err(|e| format!("Failed to query: {e}"))?;
    let result = stmt
        .query_row(params![key], |row| row.get::<_, String>(0))
        .ok();
    Ok(result)
}

/// Delete from both OS keyring and SQLite to ensure cleanup.
#[tauri::command]
pub fn delete_from_keyring(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    // Try OS keyring
    if let Some(entry) = get_entry(&key) {
        let _ = entry.delete_credential();
    }

    // Also delete from SQLite fallback
    let db = state.db.lock().unwrap();
    let _ = db.execute(
        "DELETE FROM key_value_store WHERE key = ?1",
        params![key],
    );
    Ok(())
}
