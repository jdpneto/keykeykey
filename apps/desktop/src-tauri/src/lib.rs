/// KeyKeyKey Desktop — Tauri backend.
/// Handles native OS integrations: keyring, Argon2id KDF, SQLite storage.
mod argon2_cmd;
mod keyring_cmds;
mod storage;

use storage::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let db = storage::init_db(&app_data_dir)
                .expect("failed to initialize database");
            app.manage(AppState {
                db: std::sync::Mutex::new(db),
                app_data_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Storage
            storage::save_vault_header,
            storage::load_vault_header,
            storage::save_encrypted_item,
            storage::load_all_encrypted_items,
            storage::delete_encrypted_item,
            storage::is_vault_setup_complete,
            storage::set_vault_setup_complete,
            // Keyring
            keyring_cmds::save_to_keyring,
            keyring_cmds::load_from_keyring,
            keyring_cmds::delete_from_keyring,
            // Argon2
            argon2_cmd::argon2_hash,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
