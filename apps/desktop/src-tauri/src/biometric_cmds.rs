//! Desktop biometric Tauri commands.
//!
//! Touch ID-gated DEK storage on macOS via Keychain
//! (`kSecAccessControlBiometryCurrentSet`). All four commands fail safe on
//! non-macOS platforms — `is_available` returns `false` and the others
//! return an error string. Windows Hello is a planned follow-up.
//!
//! The frontend wraps these via `apps/desktop/src/lib/desktop-biometric-adapter.ts`,
//! which translates the OK/Err shapes to the cross-platform `BiometricResult`
//! discriminated union.

#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

#[cfg(target_os = "macos")]
use macos as platform;

#[cfg(not(target_os = "macos"))]
use stub as platform;

#[tauri::command]
pub async fn biometric_is_available() -> bool {
    platform::is_available()
}

// The Keychain calls block until the user answers the Touch ID prompt. Sync
// commands run on the main thread, which froze the window (the unlock screen
// was never even drawn), so they run on a blocking worker thread instead.
async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("Biometric task failed: {e}"))?
}

#[tauri::command]
pub async fn biometric_save_dek(value: String) -> Result<(), String> {
    run_blocking(move || platform::save_dek(value)).await
}

#[tauri::command]
pub async fn biometric_load_dek() -> Result<Option<String>, String> {
    run_blocking(platform::load_dek).await
}

#[tauri::command]
pub async fn biometric_clear_dek() -> Result<(), String> {
    run_blocking(platform::clear_dek).await
}
