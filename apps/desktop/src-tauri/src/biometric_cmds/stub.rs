//! Non-macOS biometric stubs.
//!
//! `is_available` returns `false`, which the frontend uses to gate the
//! biometric UI off on Linux / Windows. The save/load/clear paths return a
//! human-readable error in case anything ever calls them despite
//! `is_available` being false.

const UNSUPPORTED: &str = "Biometric is not supported on this platform";

pub fn is_available() -> bool {
    false
}

pub fn save_dek(_value: String) -> Result<(), String> {
    Err(UNSUPPORTED.into())
}

pub fn load_dek() -> Result<Option<String>, String> {
    Err(UNSUPPORTED.into())
}

pub fn clear_dek() -> Result<(), String> {
    Err(UNSUPPORTED.into())
}
