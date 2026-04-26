//! macOS Touch ID + Keychain biometric storage.
//!
//! Storage model: a single Keychain generic-password item identified by
//! (service, account) = ("com.keykeykey.biometric", "biometric_dek"), with
//! an access-control object that requires biometric authentication on
//! every read AND binds the entry to the *current* set of enrolled
//! fingerprints (`kSecAccessControlBiometryCurrentSet`). Adding or
//! removing a finger automatically invalidates the entry — the next
//! `load_dek` call returns `Ok(None)` and the frontend's adapter maps
//! that to `BiometricResult.invalidated`.
//!
//! `is_available` uses LAContext (no Keychain access) so it never prompts.
//! `save_dek` will prompt at write time — the user is in the unlock flow
//! and has just authenticated, so the second prompt is acceptable.
//! `load_dek` always prompts. `clear_dek` does not prompt.

use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::data::CFData;
use core_foundation::dictionary::CFMutableDictionary;
use core_foundation::string::CFString;
use core_foundation_sys::base::{CFTypeRef, OSStatus};
use core_foundation_sys::error::CFErrorRef;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use security_framework_sys::access_control::{
    kSecAccessControlBiometryCurrentSet, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    SecAccessControlCreateWithFlags,
};
use security_framework_sys::base::{errSecAuthFailed, errSecItemNotFound, errSecSuccess};
use security_framework_sys::item::{
    kSecAttrAccessControl, kSecAttrAccount, kSecAttrService, kSecClass,
    kSecClassGenericPassword, kSecReturnData, kSecValueData,
};
use security_framework_sys::keychain_item::{SecItemAdd, SecItemCopyMatching, SecItemDelete};
use std::ptr;

const SERVICE: &str = "com.keykeykey.biometric";
const ACCOUNT: &str = "biometric_dek";
const LA_POLICY_BIOMETRICS: i64 = 1;

/// errSecUserCanceled — user dismissed the Touch ID prompt.
/// Equivalent to `kUserCanceledErr` from MacErrors.h. (Not exported from
/// `security_framework_sys::base` in v2.17.0.)
const ERR_SEC_USER_CANCELED: OSStatus = -128;

// -- is_available -----------------------------------------------------------

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
        can_evaluate
    }
}

// -- helpers ----------------------------------------------------------------

/// Build a `SecAccessControl` requiring biometry on every access.
///
/// Returns an owned `CFType` wrapper. The +1 retain that
/// `SecAccessControlCreateWithFlags` gives us is consumed via
/// `wrap_under_create_rule` — when the wrapper drops at end of scope (after
/// the dict has retained its own copy), the access control is released and
/// the refcount is balanced.
fn make_access_control() -> Result<CFType, String> {
    // SAFETY: SecAccessControlCreateWithFlags has the documented signature
    // (allocator, protection, flags, error_out). We pass null for the
    // allocator (kCFAllocatorDefault), a CFStringRef for protection, the
    // documented bitfield for flags, and a stack `error` we wrap on the
    // failure path. The returned ref is +1 owned per Apple's "Create Rule".
    unsafe {
        let mut error: CFErrorRef = ptr::null_mut();
        let access = SecAccessControlCreateWithFlags(
            ptr::null(), // kCFAllocatorDefault
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly as CFTypeRef,
            kSecAccessControlBiometryCurrentSet,
            &mut error,
        );
        if access.is_null() {
            let msg = if !error.is_null() {
                // Wrap the +1 error so it gets released on Drop AND we get
                // a useful Debug print instead of a raw pointer address.
                let err = core_foundation::error::CFError::wrap_under_create_rule(error);
                format!("SecAccessControlCreateWithFlags failed: {:?}", err)
            } else {
                "SecAccessControlCreateWithFlags returned null (no error info)".into()
            };
            return Err(msg);
        }
        // Consume the +1 from Create. The wrapper releases on Drop.
        Ok(CFType::wrap_under_create_rule(access as CFTypeRef))
    }
}

/// Build a query dictionary keyed by service + account. Used by save (with
/// extra fields) and by load/delete (as the search criteria).
fn base_query() -> CFMutableDictionary<CFString, CFType> {
    let mut dict: CFMutableDictionary<CFString, CFType> = CFMutableDictionary::new();
    unsafe {
        // kSecClass = kSecClassGenericPassword
        let class_key = CFString::wrap_under_get_rule(kSecClass);
        let class_val = CFType::wrap_under_get_rule(kSecClassGenericPassword as CFTypeRef);
        dict.add(&class_key, &class_val);

        // kSecAttrService = SERVICE
        let svc_key = CFString::wrap_under_get_rule(kSecAttrService);
        let svc_val = CFString::new(SERVICE).as_CFType();
        dict.add(&svc_key, &svc_val);

        // kSecAttrAccount = ACCOUNT
        let acct_key = CFString::wrap_under_get_rule(kSecAttrAccount);
        let acct_val = CFString::new(ACCOUNT).as_CFType();
        dict.add(&acct_key, &acct_val);
    }
    dict
}

// -- save_dek ---------------------------------------------------------------

pub fn save_dek(value: String) -> Result<(), String> {
    // Idempotency: delete first so SecItemAdd never returns errSecDuplicateItem.
    // Ignore the result — errSecItemNotFound is fine; any other error would
    // also be surfaced by the subsequent SecItemAdd.
    let _ = clear_dek();

    unsafe {
        let access = make_access_control()?;

        let mut dict = base_query();

        // kSecValueData = the raw DEK bytes
        let data = CFData::from_buffer(value.as_bytes());
        let value_key = CFString::wrap_under_get_rule(kSecValueData);
        dict.add(&value_key, &data.as_CFType());

        // kSecAttrAccessControl = the biometric-gated access control object
        let ac_key = CFString::wrap_under_get_rule(kSecAttrAccessControl);
        dict.add(&ac_key, &access); // dict retains its own +1; `access` releases on drop.

        let status: OSStatus = SecItemAdd(dict.as_concrete_TypeRef() as _, ptr::null_mut());
        match status {
            x if x == errSecSuccess => Ok(()),
            x if x == ERR_SEC_USER_CANCELED => Err("cancel".into()),
            other => Err(format!("SecItemAdd failed (status {})", other)),
        }
    }
}

// -- load_dek ---------------------------------------------------------------

pub fn load_dek() -> Result<Option<String>, String> {
    unsafe {
        let mut dict = base_query();

        // kSecReturnData = true → return the actual bytes, not just metadata.
        let return_key = CFString::wrap_under_get_rule(kSecReturnData);
        dict.add(&return_key, &CFBoolean::true_value().as_CFType());

        // NOTE: We do NOT set kSecMatchLimit. SecItemCopyMatching returns
        // a single item by default when this attribute is absent. (We also
        // cannot use kSecMatchLimitOne — security-framework-sys 2.17.0
        // does not export it.)
        //
        // We also do NOT set kSecUseAuthenticationUI = kSecUseAuthenticationUISkip.
        // We WANT the Touch ID prompt. (Per the iOS keychain ACL feedback:
        // "never probe a biometric-gated keychain item's existence with
        // kSecUseAuthenticationUISkip" — same principle applies on macOS.)

        let mut result: CFTypeRef = ptr::null();
        let status = SecItemCopyMatching(dict.as_concrete_TypeRef() as _, &mut result);

        match status {
            x if x == errSecSuccess => {
                if result.is_null() {
                    return Ok(None);
                }
                // wrap_under_create_rule takes ownership (no extra retain).
                // CFData is a CFDataRef which is a *const CFData — the result
                // pointer is cast through CFTypeRef (*const c_void).
                let data = CFData::wrap_under_create_rule(result as *const _);
                let bytes = data.bytes().to_vec();
                let s = String::from_utf8(bytes)
                    .map_err(|e| format!("Keychain value was not valid UTF-8: {e}"))?;
                Ok(Some(s))
            }
            x if x == errSecItemNotFound => Ok(None),
            x if x == ERR_SEC_USER_CANCELED => Err("cancel".into()),
            x if x == errSecAuthFailed => Err("Biometric authentication failed".into()),
            other => Err(format!("SecItemCopyMatching failed (status {})", other)),
        }
    }
}

// -- clear_dek --------------------------------------------------------------

pub fn clear_dek() -> Result<(), String> {
    unsafe {
        let dict = base_query();
        let status = SecItemDelete(dict.as_concrete_TypeRef() as _);
        match status {
            x if x == errSecSuccess || x == errSecItemNotFound => Ok(()),
            other => Err(format!("SecItemDelete failed (status {})", other)),
        }
    }
}
