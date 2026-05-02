use crate::storage::AppState;
use keyring::Entry;
use rusqlite::{params, Connection};
use tauri::State;

const SERVICE_NAME: &str = "com.keykeykey.desktop";
const KEY_PIN_DATA: &str = "keykeykey_pin_data";
const KEY_PIN_ATTEMPTS: &str = "keykeykey_pin_attempts";
const KEY_BIOMETRIC_DEK: &str = "keykeykey_biometric_dek";

fn get_entry(key: &str) -> Option<Entry> {
    Entry::new(SERVICE_NAME, key).ok()
}

fn allows_sqlite_fallback(key: &str) -> bool {
    !matches!(key, KEY_PIN_DATA | KEY_PIN_ATTEMPTS | KEY_BIOMETRIC_DEK)
}

fn save_to_sqlite_fallback(db: &Connection, key: &str, value: &str) -> Result<(), String> {
    if !allows_sqlite_fallback(key) {
        let _ = delete_from_sqlite_fallback(db, key);
        return Err("OS keyring unavailable for sensitive key".to_string());
    }

    db.execute(
        "INSERT OR REPLACE INTO key_value_store (key, value) VALUES (?1, ?2)",
        params![key, value],
    )
    .map_err(|e| format!("Failed to save: {e}"))?;
    Ok(())
}

fn load_from_sqlite_fallback(db: &Connection, key: &str) -> Result<Option<String>, String> {
    if !allows_sqlite_fallback(key) {
        let _ = delete_from_sqlite_fallback(db, key);
        return Ok(None);
    }

    let mut stmt = db
        .prepare("SELECT value FROM key_value_store WHERE key = ?1")
        .map_err(|e| format!("Failed to query: {e}"))?;
    let result = stmt
        .query_row(params![key], |row| row.get::<_, String>(0))
        .ok();
    Ok(result)
}

fn delete_from_sqlite_fallback(db: &Connection, key: &str) -> Result<(), String> {
    db.execute("DELETE FROM key_value_store WHERE key = ?1", params![key])
        .map_err(|e| format!("Failed to delete: {e}"))?;
    Ok(())
}

/// Save to OS keyring first. If it doesn't round-trip correctly, fall back to
/// SQLite only for non-secret keys.
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

    // Keyring failed or didn't persist — fall back to SQLite only for non-secret keys.
    let db = state
        .db
        .lock()
        .map_err(|e| format!("Database lock failed: {e}"))?;
    save_to_sqlite_fallback(&db, &key, &value)
}

/// Load from OS keyring first, then fall back to SQLite only for non-secret keys.
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

    // Fall back to SQLite only for non-secret keys.
    let db = state
        .db
        .lock()
        .map_err(|e| format!("Database lock failed: {e}"))?;
    load_from_sqlite_fallback(&db, &key)
}

/// Delete from both OS keyring and SQLite to ensure cleanup.
#[tauri::command]
pub fn delete_from_keyring(state: State<'_, AppState>, key: String) -> Result<(), String> {
    // Try OS keyring
    if let Some(entry) = get_entry(&key) {
        let _ = entry.delete_credential();
    }

    // Also delete from SQLite fallback
    let db = state
        .db
        .lock()
        .map_err(|e| format!("Database lock failed: {e}"))?;
    delete_from_sqlite_fallback(&db, &key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn test_db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute(
            "CREATE TABLE key_value_store (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        db
    }

    fn stored_value(db: &Connection, key: &str) -> Option<String> {
        db.query_row(
            "SELECT value FROM key_value_store WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_keyring_round_trips_between_fresh_entries() {
        let key = format!("keykeykey_test_roundtrip_{}", std::process::id());
        let value = "native-keychain-roundtrip";
        let entry = get_entry(&key).expect("test keyring entry");
        let _ = entry.delete_credential();

        entry.set_password(value).expect("save test keyring value");

        let fresh_entry = get_entry(&key).expect("fresh test keyring entry");
        let loaded = fresh_entry.get_password().expect("load test keyring value");
        let _ = fresh_entry.delete_credential();

        assert_eq!(loaded, value);
    }

    #[test]
    fn sqlite_fallback_rejects_sensitive_quick_unlock_keys() {
        let db = test_db();

        for key in [KEY_PIN_DATA, KEY_PIN_ATTEMPTS, KEY_BIOMETRIC_DEK] {
            db.execute(
                "INSERT INTO key_value_store (key, value) VALUES (?1, ?2)",
                params![key, "legacy-sensitive"],
            )
            .unwrap();

            let result = save_to_sqlite_fallback(&db, key, "sensitive");

            assert!(result
                .unwrap_err()
                .contains("OS keyring unavailable for sensitive key"));
            assert_eq!(stored_value(&db, key), None);
        }
    }

    #[test]
    fn sqlite_fallback_does_not_load_legacy_sensitive_quick_unlock_entries() {
        let db = test_db();

        for key in [KEY_PIN_DATA, KEY_PIN_ATTEMPTS, KEY_BIOMETRIC_DEK] {
            db.execute(
                "INSERT INTO key_value_store (key, value) VALUES (?1, ?2)",
                params![key, "legacy-sensitive"],
            )
            .unwrap();
            assert_eq!(stored_value(&db, key).as_deref(), Some("legacy-sensitive"));

            let result = load_from_sqlite_fallback(&db, key).unwrap();

            assert_eq!(result, None);
            assert_eq!(stored_value(&db, key), None);
        }
    }

    #[test]
    fn sqlite_fallback_still_supports_non_secret_keys() {
        let db = test_db();

        save_to_sqlite_fallback(&db, "keykeykey_quick_unlock_prompt", "dismissed").unwrap();
        let result = load_from_sqlite_fallback(&db, "keykeykey_quick_unlock_prompt").unwrap();

        assert_eq!(result.as_deref(), Some("dismissed"));
    }
}
