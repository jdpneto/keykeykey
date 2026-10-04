//! Keychain service names, derived from the bundle identifier.
//!
//! The direct-download build (`com.keykeykey.desktop`) and the Mac App Store
//! build (`com.keykeykey.app`) can be installed side by side, each with its own
//! vault. They must not share keychain items: the other build's PIN data or
//! biometric DEK belongs to a different vault, and reading it triggers a
//! keychain access prompt because the item's ACL names the other app.

use std::sync::OnceLock;

/// Identifier of the original desktop build. Its service names predate this
/// module and are kept verbatim so existing keychain entries stay readable.
const LEGACY_IDENTIFIER: &str = "com.keykeykey.desktop";
const LEGACY_BIOMETRIC_SERVICE: &str = "com.keykeykey.biometric";

static IDENTIFIER: OnceLock<String> = OnceLock::new();

/// Record the running app's bundle identifier. Called once from `setup`;
/// until then (e.g. in unit tests) the legacy names are used.
pub fn init(identifier: &str) {
    let _ = IDENTIFIER.set(identifier.to_owned());
}

fn identifier() -> &'static str {
    IDENTIFIER.get().map_or(LEGACY_IDENTIFIER, String::as_str)
}

/// Service for generic keyring entries (PIN data, settings flags, …).
pub fn keyring_service() -> &'static str {
    identifier()
}

/// Service for the Touch ID-gated DEK item.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn biometric_service() -> String {
    biometric_service_for(identifier())
}

fn biometric_service_for(identifier: &str) -> String {
    if identifier == LEGACY_IDENTIFIER {
        LEGACY_BIOMETRIC_SERVICE.to_owned()
    } else {
        format!("{identifier}.biometric")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_build_keeps_existing_service_names() {
        assert_eq!(
            biometric_service_for("com.keykeykey.desktop"),
            "com.keykeykey.biometric"
        );
    }

    #[test]
    fn app_store_build_gets_its_own_service_names() {
        assert_eq!(
            biometric_service_for("com.keykeykey.app"),
            "com.keykeykey.app.biometric"
        );
        assert_ne!(
            biometric_service_for("com.keykeykey.app"),
            LEGACY_BIOMETRIC_SERVICE
        );
    }

    #[test]
    fn defaults_to_legacy_identifier_before_init() {
        // Unit tests never call init(), so the legacy names apply.
        assert_eq!(keyring_service(), LEGACY_IDENTIFIER);
    }
}
