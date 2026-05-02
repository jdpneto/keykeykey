#[tauri::command]
pub fn clear_clipboard() -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Failed to access clipboard: {e}"))?;
    clipboard
        .set_text(String::new())
        .map_err(|e| format!("Failed to clear clipboard: {e}"))
}
