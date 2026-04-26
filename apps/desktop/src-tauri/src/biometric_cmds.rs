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

#[tauri::command]
pub fn biometric_save_dek(value: String) -> Result<(), String> {
    platform::save_dek(value)
}

#[tauri::command]
pub fn biometric_load_dek() -> Result<Option<String>, String> {
    platform::load_dek()
}

#[tauri::command]
pub fn biometric_clear_dek() -> Result<(), String> {
    platform::clear_dek()
}
