//! macOS Touch ID + Keychain biometric storage.
//!
//! Implementation lands in Tasks 2 and 3.

pub fn is_available() -> bool {
    false
}

pub fn save_dek(_value: String) -> Result<(), String> {
    Err("biometric_cmds::macos not yet implemented".into())
}

pub fn load_dek() -> Result<Option<String>, String> {
    Err("biometric_cmds::macos not yet implemented".into())
}

pub fn clear_dek() -> Result<(), String> {
    Err("biometric_cmds::macos not yet implemented".into())
}
