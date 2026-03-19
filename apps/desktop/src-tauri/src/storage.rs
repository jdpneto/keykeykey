use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

const HEADER_FILENAME: &str = "vault_header.bin";
const SETUP_FLAG_FILENAME: &str = "vault_initialized";

pub struct AppState {
    pub db: Mutex<Connection>,
    pub app_data_dir: PathBuf,
}

/// Initialize the SQLite database and create the vault_items table.
pub fn init_db(app_data_dir: &Path) -> Result<Connection, String> {
    fs::create_dir_all(app_data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    let db_path = app_data_dir.join("keykeykey.db");
    let conn = Connection::open(db_path).map_err(|e| format!("Failed to open database: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS vault_items (
            id TEXT PRIMARY KEY NOT NULL,
            type TEXT NOT NULL,
            encrypted_data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("Failed to create table: {e}"))?;
    Ok(conn)
}

// --- Vault header (binary file) ---

#[tauri::command]
pub fn save_vault_header(state: State<'_, AppState>, data: String) -> Result<(), String> {
    let path = state.app_data_dir.join(HEADER_FILENAME);
    fs::write(&path, data.as_bytes()).map_err(|e| format!("Failed to save vault header: {e}"))
}

#[tauri::command]
pub fn load_vault_header(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let path = state.app_data_dir.join(HEADER_FILENAME);
    if !path.exists() {
        return Ok(None);
    }
    let data =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read vault header: {e}"))?;
    Ok(Some(data))
}

// --- Setup flag ---

#[tauri::command]
pub fn is_vault_setup_complete(state: State<'_, AppState>) -> Result<bool, String> {
    let path = state.app_data_dir.join(SETUP_FLAG_FILENAME);
    Ok(path.exists())
}

#[tauri::command]
pub fn set_vault_setup_complete(
    state: State<'_, AppState>,
    complete: bool,
) -> Result<(), String> {
    let path = state.app_data_dir.join(SETUP_FLAG_FILENAME);
    if complete {
        fs::write(&path, b"1")
            .map_err(|e| format!("Failed to set vault setup complete: {e}"))?;
    } else if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove vault setup flag: {e}"))?;
    }
    Ok(())
}

// --- Encrypted vault items (SQLite) ---

#[derive(Serialize)]
pub struct StoredItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub encrypted_data: String,
    pub created_at: String,
    pub updated_at: String,
}

#[tauri::command]
pub fn save_encrypted_item(
    state: State<'_, AppState>,
    id: String,
    item_type: String,
    data_b64: String,
    created_at: String,
    updated_at: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;
    db.execute(
        "INSERT OR REPLACE INTO vault_items (id, type, encrypted_data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, item_type, data_b64, created_at, updated_at],
    )
    .map_err(|e| format!("Failed to save item: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn load_all_encrypted_items(state: State<'_, AppState>) -> Result<Vec<StoredItem>, String> {
    let db = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;
    let mut stmt = db
        .prepare("SELECT id, type, encrypted_data, created_at, updated_at FROM vault_items ORDER BY updated_at DESC")
        .map_err(|e| format!("Failed to prepare statement: {e}"))?;
    let items = stmt
        .query_map([], |row| {
            Ok(StoredItem {
                id: row.get(0)?,
                item_type: row.get(1)?,
                encrypted_data: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("Failed to query items: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect items: {e}"))?;
    Ok(items)
}

// --- Sync config (binary file) ---

const SYNC_CONFIG_FILENAME: &str = "sync-config.bin";

#[tauri::command]
pub fn save_sync_config(state: State<'_, AppState>, data_b64: String) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(&data_b64)
        .map_err(|e| format!("Invalid base64: {e}"))?;
    let path = state.app_data_dir.join(SYNC_CONFIG_FILENAME);
    fs::write(&path, &bytes).map_err(|e| format!("Failed to save sync config: {e}"))
}

#[tauri::command]
pub fn load_sync_config(state: State<'_, AppState>) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let path = state.app_data_dir.join(SYNC_CONFIG_FILENAME);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read sync config: {e}"))?;
    Ok(Some(STANDARD.encode(&bytes)))
}

#[tauri::command]
pub fn delete_sync_config(state: State<'_, AppState>) -> Result<(), String> {
    let path = state.app_data_dir.join(SYNC_CONFIG_FILENAME);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete sync config: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_encrypted_item(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;
    db.execute("DELETE FROM vault_items WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete item: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> PathBuf {
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "keykeykey_test_{}_{id}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_init_db_creates_table() {
        let dir = temp_dir();
        let conn = init_db(&dir).unwrap();
        // Verify table exists by running a query
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM vault_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_vault_header_file_roundtrip() {
        let dir = temp_dir();
        let header_path = dir.join(HEADER_FILENAME);

        // Initially no header
        assert!(!header_path.exists());

        // Save
        let data = "dGVzdCBoZWFkZXI="; // base64 of "test header"
        fs::write(&header_path, data.as_bytes()).unwrap();

        // Load
        let loaded = fs::read_to_string(&header_path).unwrap();
        assert_eq!(loaded, data);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_setup_flag() {
        let dir = temp_dir();
        let flag_path = dir.join(SETUP_FLAG_FILENAME);

        assert!(!flag_path.exists());

        fs::write(&flag_path, b"1").unwrap();
        assert!(flag_path.exists());

        fs::remove_file(&flag_path).unwrap();
        assert!(!flag_path.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_encrypted_item_crud() {
        let dir = temp_dir();
        let conn = init_db(&dir).unwrap();

        // Insert
        conn.execute(
            "INSERT INTO vault_items (id, type, encrypted_data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["id1", "credential", "enc_data_b64", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"],
        ).unwrap();

        // Read
        let mut stmt = conn
            .prepare("SELECT id, type, encrypted_data, created_at, updated_at FROM vault_items")
            .unwrap();
        let items: Vec<StoredItem> = stmt
            .query_map([], |row| {
                Ok(StoredItem {
                    id: row.get(0)?,
                    item_type: row.get(1)?,
                    encrypted_data: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "id1");
        assert_eq!(items[0].item_type, "credential");
        assert_eq!(items[0].encrypted_data, "enc_data_b64");

        // Update (INSERT OR REPLACE)
        conn.execute(
            "INSERT OR REPLACE INTO vault_items (id, type, encrypted_data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["id1", "credential", "new_enc_data", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"],
        ).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM vault_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // Delete
        conn.execute("DELETE FROM vault_items WHERE id = ?1", params!["id1"])
            .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM vault_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);

        let _ = fs::remove_dir_all(&dir);
    }
}
