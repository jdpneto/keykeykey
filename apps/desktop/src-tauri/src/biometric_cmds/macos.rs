//! macOS Touch ID + Keychain biometric storage.
//!
//! `is_available` uses LocalAuthentication.framework's LAContext to detect
//! whether Touch ID hardware exists AND at least one fingerprint is enrolled.
//! Returns `false` for everything else (no hardware, no enrollment, hardware
//! locked after too many failed attempts, etc.).
//!
//! save / load / clear remain placeholders — Task 3 will replace them with
//! Keychain-backed implementations using `kSecAccessControlBiometryCurrentSet`.

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use std::ptr;

/// LAPolicy.deviceOwnerAuthenticationWithBiometrics
/// (Apple-defined constant; see <Local Authentication / LAPolicy.h>.)
const LA_POLICY_BIOMETRICS: i64 = 1;

pub fn is_available() -> bool {
    // Safety: every msg_send! invokes a known LAContext method with the
    // documented signature. We retain nothing across function boundaries
    // (the LAContext is released manually at the end of this function since
    // it was created via `new` which transfers ownership to us).
    unsafe {
        let cls = class!(LAContext);
        let context: *mut AnyObject = msg_send![cls, new];
        if context.is_null() {
            return false;
        }

        let mut error: *mut AnyObject = ptr::null_mut();
        let can_evaluate: bool =
            msg_send![context, canEvaluatePolicy: LA_POLICY_BIOMETRICS, error: &mut error];

        // Release the LAContext we just created (we used `new`, not autorelease).
        let _: () = msg_send![context, release];
        // The error object, if non-null, is autoreleased — no manual release.

        // canEvaluatePolicy returns YES iff hardware exists AND user has
        // enrolled at least one fingerprint AND biometry isn't locked out.
        // Apple's docs only guarantee `error` is set when this returns NO,
        // so trust `can_evaluate` directly — adding `error.is_null()` would
        // create a false-negative path on the YES side.
        can_evaluate
    }
}

pub fn save_dek(_value: String) -> Result<(), String> {
    Err("biometric_cmds::macos::save_dek not yet implemented".into())
}

pub fn load_dek() -> Result<Option<String>, String> {
    Err("biometric_cmds::macos::load_dek not yet implemented".into())
}

pub fn clear_dek() -> Result<(), String> {
    Err("biometric_cmds::macos::clear_dek not yet implemented".into())
}
