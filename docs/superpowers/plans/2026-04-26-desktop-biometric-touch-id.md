# Desktop Biometric (Touch ID, macOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four hardcoded-stub Tauri commands in `apps/desktop/src-tauri/src/biometric_cmds.rs` with a real macOS Keychain-gated implementation using `kSecAccessControlBiometryCurrentSet`, so the desktop frontend's existing biometric unlock flow (currently dead code) starts working on Macs with Touch ID.

**Architecture:** Single-file restructure into a `biometric_cmds.rs` dispatcher + `biometric_cmds/macos.rs` (real Touch ID + Keychain) + `biometric_cmds/stub.rs` (non-macOS error stubs). Direct FFI through `core-foundation` and `security-framework-sys` for the Keychain calls; `objc2` for the one `LAContext.canEvaluatePolicy` call needed to detect Touch ID hardware. Frontend wiring already exists — `desktop-biometric-adapter.ts`, `vault-context.tsx`, `UnlockScreen.tsx`, `QuickUnlockPrompt.tsx` — and is unchanged.

**Tech Stack:** Rust 2021 + Tauri 2 + Apple `Security.framework` (Keychain APIs) + `LocalAuthentication.framework` (LAContext). Crates: `core-foundation = "0.10"`, `core-foundation-sys = "0.8"`, `security-framework-sys = "2"`, `objc2 = "0.6"` — all gated to `target_os = "macos"`.

**Spec reference:** `docs/superpowers/specs/2026-04-26-desktop-biometric-touch-id-design.md`

---

## File Structure

**Created:**

- `apps/desktop/src-tauri/src/biometric_cmds/macos.rs` — Touch ID detection (LAContext) + Keychain CRUD with biometric access control. ~150 lines.
- `apps/desktop/src-tauri/src/biometric_cmds/stub.rs` — non-macOS stubs. ~15 lines.

**Modified:**

- `apps/desktop/src-tauri/Cargo.toml` — add four cargo deps gated `[target.'cfg(target_os = "macos")'.dependencies]`. Drop the `keyring = { version = "3" }` dep IF nothing else uses it (verify by grepping `keyring::` across the rust source — `keyring_cmds.rs` uses it, so the dep stays at workspace level).
- `apps/desktop/src-tauri/src/biometric_cmds.rs` — slim down from current 49-line keyring-based file to a thin dispatcher (~25 lines): `mod macos` / `mod stub` cfg-gated, four `#[tauri::command]` exports calling into the platform module. The keyring-based code moves out (deleted; the macOS module replaces it; the stub module replaces it for other platforms).
- `base-test-flow.md` — insert §17 "Desktop biometric (Touch ID, macOS only)" after §16, with manual smoke steps. Add a row to the existing E2E coverage table noting "manual-only".
- `IMPLEMENTATION_STATUS.md` — refresh §14 row ("Vault unlock perf"); refresh the Desktop-biometric backlog item under §6 (Question 1) to "✅ macOS done; Windows Hello pending".
- `implementationplan.md` — extend §14 / Tier-3 mention to call out macOS Touch ID gated via `kSecAccessControlBiometryCurrentSet`.

**No changes:**

- Frontend (`desktop-biometric-adapter.ts`, `vault-context.tsx`, `UnlockScreen.tsx`, `QuickUnlockPrompt.tsx`).
- The `lib.rs` Tauri command registration (the four `biometric_cmds::*` exports keep their existing names).
- Any other Rust file in `src-tauri`.

---

## Task 1: Module restructure + non-macOS stubs + Cargo deps

This task lays the new file structure and locks in the non-macOS path so the rest of the work can focus on the macOS implementation.

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/src/biometric_cmds.rs` (becomes a dispatcher)
- Create: `apps/desktop/src-tauri/src/biometric_cmds/stub.rs`
- Create: `apps/desktop/src-tauri/src/biometric_cmds/macos.rs` (placeholder so the `mod macos` line compiles on this Mac dev box during the next task)

- [ ] **Step 1: Add cargo deps**

Open `apps/desktop/src-tauri/Cargo.toml`. After the existing `[dependencies]` block (line 15 onwards), add:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
core-foundation = "0.10"
core-foundation-sys = "0.8"
security-framework-sys = "2"
objc2 = "0.6"
```

Do NOT remove the `keyring = { version = "3" }` line in the main `[dependencies]` block — `keyring_cmds.rs` still uses it for OAuth refresh tokens. Verify with `grep -rn "use keyring\|keyring::" apps/desktop/src-tauri/src/` — should show `keyring_cmds.rs` as the only consumer after this PR.

- [ ] **Step 2: Replace `biometric_cmds.rs` with the dispatcher**

Replace the entire content of `apps/desktop/src-tauri/src/biometric_cmds.rs` with:

```rust
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
```

- [ ] **Step 3: Create the non-macOS stub module**

Create `apps/desktop/src-tauri/src/biometric_cmds/stub.rs`:

```rust
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
```

- [ ] **Step 4: Create a placeholder `macos.rs` so the dispatcher compiles**

Create `apps/desktop/src-tauri/src/biometric_cmds/macos.rs` with stub bodies — these will be replaced in Tasks 2 and 3:

```rust
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
```

- [ ] **Step 5: Verify `cargo check` passes**

Run from `/Users/davidneto/keykeykey`:

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: clean compile, no errors. The four dispatchers route to `macos::*` on this Mac dev box. The cfg-gated cargo deps download but aren't yet used.

- [ ] **Step 6: Verify the JS test suite still passes**

The frontend `vault-context.test.tsx` mocks `invoke()` so this restructure shouldn't affect it, but confirm:

```bash
cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop test
```

Expected: all desktop tests pass (was 83 before this PR; should still be 83).

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml \
        apps/desktop/src-tauri/Cargo.lock \
        apps/desktop/src-tauri/src/biometric_cmds.rs \
        apps/desktop/src-tauri/src/biometric_cmds/stub.rs \
        apps/desktop/src-tauri/src/biometric_cmds/macos.rs
git commit -m "refactor(desktop/biometric): split into dispatcher + macos/stub modules

The four #[tauri::command] exports stay where lib.rs registers them,
but their bodies now route to a platform-specific module via cfg.
The macOS module is a placeholder that will be filled in by the
next two tasks; the non-macOS stub returns 'Biometric is not
supported on this platform'.

No behavioral change yet — biometric_is_available still returns
false on this Mac because the macOS placeholder also returns false.
The next task wires LAContext for real Touch ID detection."
```

---

## Task 2: macOS — `is_available()` via LAContext

This task makes `biometric_is_available()` return `true` on this Mac (assuming Touch ID hardware + at least one enrolled fingerprint). No Keychain involved yet; just the LAContext capability check.

**Files:**
- Modify: `apps/desktop/src-tauri/src/biometric_cmds/macos.rs`

- [ ] **Step 1: Replace the placeholder `is_available` with the LAContext FFI**

Open `apps/desktop/src-tauri/src/biometric_cmds/macos.rs`. Replace the file content with:

```rust
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
use objc2::{class, msg_send, ClassType};
use std::ptr;

/// LAPolicy.deviceOwnerAuthenticationWithBiometrics
/// (Apple-defined constant; see <Local Authentication / LAPolicy.h>.)
const LA_POLICY_BIOMETRICS: i64 = 1;

pub fn is_available() -> bool {
    // Safety: every msg_send! invokes a known LAContext method with the
    // documented signature. We retain nothing across function boundaries
    // (the LAContext is autoreleased when the Rust scope ends since we
    // create it via `new` and immediately consume the result).
    unsafe {
        let cls = class!(LAContext);
        let context: *mut AnyObject = msg_send![cls, new];
        if context.is_null() {
            return false;
        }

        let mut error: *mut AnyObject = ptr::null_mut();
        let can_evaluate: bool =
            msg_send![context, canEvaluatePolicy: LA_POLICY_BIOMETRICS error: &mut error];

        // Release the LAContext we just created (we used `new`, not autorelease).
        let _: () = msg_send![context, release];
        // The error object, if non-null, is autoreleased — no manual release.

        // canEvaluatePolicy returns YES iff hardware exists AND user has
        // enrolled at least one fingerprint AND biometry isn't locked out.
        // We don't inspect the error — for our purposes "false + any error"
        // means "no usable Touch ID right now" and the frontend should
        // hide the biometric UI.
        can_evaluate && error.is_null()
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
```

- [ ] **Step 2: Verify `cargo check` passes on macOS**

Run from `/Users/davidneto/keykeykey`:

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: clean compile.

If you get a linker error about `LocalAuthentication` framework not found, add a build-time link directive at the top of `macos.rs`:

```rust
#[link(name = "LocalAuthentication", kind = "framework")]
extern "C" {}
```

(`objc2` should pull in the necessary framework links via its own build script, but the `#[link]` is a safe fallback if not.)

- [ ] **Step 3: Manual sanity check — boot the Tauri dev app and confirm the biometric UI appears**

This Mac has Touch ID hardware. After this task, `is_available()` should return `true` and the existing `biometricAvailable` boolean in `vault-context.tsx` should flip to `true`, which makes `UnlockScreen.tsx` render the "Use Touch ID" affordance.

Run:

```bash
cd apps/desktop && APPLE_TEAM_ID=$APPLE_TEAM_ID pnpm dev
```

(If `APPLE_TEAM_ID` isn't exported, the dev app still boots — the env var is only required for iOS builds.)

In the app: lock the vault if it isn't, then on the unlock screen confirm the "Use Touch ID" button is visible. (Clicking it will fail because save/load aren't wired yet — that's expected, just verify the button shows.)

If you can't run the dev app interactively (e.g., headless environment), report back as DONE_WITH_CONCERNS noting that the LAContext call compiled but visual verification was deferred to the operator.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/biometric_cmds/macos.rs
git commit -m "feat(desktop/biometric): real LAContext is_available() on macOS

Calls LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)
through objc2's msg_send! macro. Returns true iff Touch ID hardware
exists AND at least one fingerprint is enrolled AND biometry isn't
locked out. No Keychain or DEK code yet — that lands in the next
commit. The 'Use Touch ID' affordance in UnlockScreen / QuickUnlockPrompt
should now be visible on Macs with Touch ID."
```

---

## Task 3: macOS — `save_dek` / `load_dek` / `clear_dek` via biometric-gated Keychain

This is the meat of the PR. Three functions that share the same Keychain query dictionary structure.

**Files:**
- Modify: `apps/desktop/src-tauri/src/biometric_cmds/macos.rs`

- [ ] **Step 1: Add the Keychain FFI block + helpers**

Open `apps/desktop/src-tauri/src/biometric_cmds/macos.rs`. Replace the entire file content with the full implementation:

```rust
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

use core_foundation::base::{CFType, TCFType, TCFTypeRef};
use core_foundation::boolean::CFBoolean;
use core_foundation::data::CFData;
use core_foundation::dictionary::CFMutableDictionary;
use core_foundation::error::CFErrorRef;
use core_foundation::string::CFString;
use core_foundation_sys::base::{CFTypeRef, OSStatus};
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use security_framework_sys::access_control::{
    kSecAccessControlBiometryCurrentSet, SecAccessControlCreateWithFlags,
    SecAccessControlRef,
};
use security_framework_sys::base::{
    errSecItemNotFound, errSecSuccess, errSecUserCanceled,
};
use security_framework_sys::item::{
    kSecAttrAccessControl, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    kSecAttrAccount, kSecAttrService, kSecClass, kSecClassGenericPassword,
    kSecMatchLimit, kSecMatchLimitOne, kSecReturnData, kSecValueData,
};
use security_framework_sys::keychain_item::{
    SecItemAdd, SecItemCopyMatching, SecItemDelete,
};
use std::ptr;

const SERVICE: &str = "com.keykeykey.biometric";
const ACCOUNT: &str = "biometric_dek";
const LA_POLICY_BIOMETRICS: i64 = 1;
/// errSecAuthFailed — biometry temporarily locked after 5+ failed attempts.
const ERR_SEC_AUTH_FAILED: OSStatus = -25293;

// -- is_available -----------------------------------------------------------

pub fn is_available() -> bool {
    unsafe {
        let cls = class!(LAContext);
        let context: *mut AnyObject = msg_send![cls, new];
        if context.is_null() {
            return false;
        }
        let mut error: *mut AnyObject = ptr::null_mut();
        let can_evaluate: bool =
            msg_send![context, canEvaluatePolicy: LA_POLICY_BIOMETRICS error: &mut error];
        let _: () = msg_send![context, release];
        can_evaluate && error.is_null()
    }
}

// -- helpers ----------------------------------------------------------------

/// Build a `SecAccessControl` requiring biometry on every access. The
/// caller owns the returned ref and must release it (via `CFRelease` or
/// by holding a `CFType` wrapper).
fn make_access_control() -> Result<SecAccessControlRef, String> {
    unsafe {
        let mut error: CFErrorRef = ptr::null_mut();
        let access = SecAccessControlCreateWithFlags(
            ptr::null(), // kCFAllocatorDefault
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly as *const _ as CFTypeRef,
            kSecAccessControlBiometryCurrentSet,
            &mut error,
        );
        if access.is_null() {
            return Err(format!(
                "SecAccessControlCreateWithFlags returned null (error: {:?})",
                error
            ));
        }
        Ok(access)
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
        dict.add(&svc_key, &CFString::new(SERVICE).as_CFType());
        // kSecAttrAccount = ACCOUNT
        let acct_key = CFString::wrap_under_get_rule(kSecAttrAccount);
        dict.add(&acct_key, &CFString::new(ACCOUNT).as_CFType());
    }
    dict
}

// -- save_dek ---------------------------------------------------------------

pub fn save_dek(value: String) -> Result<(), String> {
    // Idempotency: delete first so SecItemAdd never returns errSecDuplicateItem.
    let _ = clear_dek(); // ignore errSecItemNotFound; any other error is fine
                         // because the next SecItemAdd will surface the real issue.

    unsafe {
        let access = make_access_control()?;

        let mut dict = base_query();

        let data = CFData::from_buffer(value.as_bytes());
        let value_key = CFString::wrap_under_get_rule(kSecValueData);
        dict.add(&value_key, &data.as_CFType());

        let ac_key = CFString::wrap_under_get_rule(kSecAttrAccessControl);
        let ac_val = CFType::wrap_under_get_rule(access as CFTypeRef);
        dict.add(&ac_key, &ac_val);

        let status: OSStatus = SecItemAdd(dict.as_concrete_TypeRef(), ptr::null_mut());
        match status {
            errSecSuccess => Ok(()),
            errSecUserCanceled => Err("cancel".into()),
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

        // kSecMatchLimit = kSecMatchLimitOne → at most one item.
        let limit_key = CFString::wrap_under_get_rule(kSecMatchLimit);
        let limit_val = CFType::wrap_under_get_rule(kSecMatchLimitOne as CFTypeRef);
        dict.add(&limit_key, &limit_val);

        // Do NOT set kSecUseAuthenticationUI = kSecUseAuthenticationUISkip.
        // We WANT the prompt. (Per the iOS keychain ACL feedback memory:
        // "never probe a biometric-gated keychain item's existence with
        // kSecUseAuthenticationUISkip" — same applies here.)

        let mut result: CFTypeRef = ptr::null();
        let status = SecItemCopyMatching(dict.as_concrete_TypeRef(), &mut result);

        match status {
            errSecSuccess => {
                if result.is_null() {
                    return Ok(None);
                }
                let data = CFData::wrap_under_create_rule(result as *const _);
                let bytes = data.bytes().to_vec();
                let s = String::from_utf8(bytes)
                    .map_err(|e| format!("Keychain value was not valid UTF-8: {e}"))?;
                Ok(Some(s))
            }
            errSecItemNotFound => Ok(None),
            errSecUserCanceled => Err("cancel".into()),
            ERR_SEC_AUTH_FAILED => Err("Biometric authentication failed".into()),
            other => Err(format!("SecItemCopyMatching failed (status {})", other)),
        }
    }
}

// -- clear_dek --------------------------------------------------------------

pub fn clear_dek() -> Result<(), String> {
    unsafe {
        let dict = base_query();
        let status = SecItemDelete(dict.as_concrete_TypeRef());
        match status {
            errSecSuccess | errSecItemNotFound => Ok(()),
            other => Err(format!("SecItemDelete failed (status {})", other)),
        }
    }
}
```

> **Implementer notes**:
> - Some constants in `security-framework-sys` (e.g., `kSecAttrAccessControl`, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`) might live under a slightly different module path depending on the crate version (`security_framework_sys::item` vs `::keychain_item`). If a `use` line fails to resolve, run `cargo doc --open -p security-framework-sys` and find the actual path; adjust the import.
> - `SecAccessControlCreateWithFlags`'s second argument is the protection-class string constant; passing it as `*const _ as CFTypeRef` works because the constant is a `CFStringRef` under the hood. If the compiler complains about the cast, use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly as CFTypeRef` directly.
> - The `CFMutableDictionary<CFString, CFType>` typed wrapper from `core-foundation = "0.10"` is the cleanest API. If you hit lifetime errors, fall back to the raw `CFMutableDictionaryCreate` + `CFDictionaryAddValue` pattern from `core_foundation_sys`.
> - `CFData::from_buffer(bytes)` is the convenience constructor in v0.10; older versions called it `CFData::from_buffer_no_copy` or similar. Adjust if needed.
> - `errSecAuthFailed` doesn't appear to be re-exported from `security-framework-sys` in some versions, hence the inlined `const ERR_SEC_AUTH_FAILED: OSStatus = -25293;` (the value is documented in `<Security/SecBase.h>`).

- [ ] **Step 2: Verify `cargo check` passes**

Run from `/Users/davidneto/keykeykey`:

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: clean compile, no errors. If `use` paths fail to resolve (see implementer notes above), debug by:

```bash
cargo doc --open -p security-framework-sys
cargo doc --open -p core-foundation
```

…and find the right module path. Don't proceed to Step 3 until `cargo check` is green.

- [ ] **Step 3: Verify `cargo build --release` succeeds (full Tauri build)**

```bash
cd apps/desktop && npx tauri build --bundles app
```

Expected: compiles to `apps/desktop/src-tauri/target/release/bundle/macos/KeyKeyKey.app` (or similar). Linker error about `Security` or `LocalAuthentication` framework? Add at the top of `macos.rs`:

```rust
#[link(name = "Security", kind = "framework")]
#[link(name = "LocalAuthentication", kind = "framework")]
extern "C" {}
```

(`security-framework-sys` should pull `Security.framework` automatically; the explicit link is a safety net.)

- [ ] **Step 4: Manual round-trip smoke (operator-required)**

This step physically requires Touch ID hardware. If you (the implementer) are running on a Mac with Touch ID:

1. Launch the built app: `open apps/desktop/src-tauri/target/release/bundle/macos/KeyKeyKey.app`.
2. If a vault doesn't exist: create one with master password `test1234`.
3. After unlock, accept the "Enable Touch ID for faster unlock?" prompt → Touch ID prompts (this is the save-side prompt) → confirm with finger.
4. Lock the vault (sidebar → Lock Vault).
5. On the unlock screen, click "Use Touch ID" → Touch ID prompts → confirm with finger → vault unlocks without typing the master password.
6. Lock again. Click "Use Touch ID" → cancel the prompt → confirm fallback to master-password input is still usable.
7. Quit the app entirely (Cmd+Q). Relaunch. Click "Use Touch ID" → confirm it still works (Keychain entry persisted).
8. Open System Settings → Touch ID → add or remove a fingerprint.
9. Return to KeyKeyKey, lock, click "Use Touch ID" → expected: the prompt fires but the result is `errSecItemNotFound` (or similar), the adapter returns `invalidated`, and the UI reverts to master-password input with a "Biometric was disabled (enrollment changed)" message.
10. Reset the vault → Setup → re-enable biometric → confirm a fresh prompt.

If you can't physically run this (subagent without keyboard / no Touch ID hardware), report DONE_WITH_CONCERNS noting that compile + Tauri build succeeded but interactive smoke is pending operator verification — the operator will run §17 of `base-test-flow.md` (added in Task 4) before merge.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/biometric_cmds/macos.rs
git commit -m "feat(desktop/biometric): biometric-gated Keychain DEK on macOS

save_dek / load_dek / clear_dek now persist the DEK in the macOS
Keychain with a SecAccessControl object requiring biometric
authentication on every read (kSecAccessControlBiometryCurrentSet).
Adding or removing a fingerprint auto-invalidates the entry — the
next load returns Ok(None), which the frontend's adapter maps to
BiometricResult.invalidated.

The OS shows the Touch ID prompt at save time and again on every
load. clear_dek does not prompt.

Frontend wiring (desktop-biometric-adapter.ts, vault-context.tsx,
UnlockScreen.tsx, QuickUnlockPrompt.tsx) is unchanged — it already
handles success / cancelled / invalidated / error from the four
commands.

Manual smoke covered by base-test-flow.md §17 (added in the next
commit)."
```

---

## Task 4: Documentation pass — base-test-flow §17 + IMPLEMENTATION_STATUS + implementationplan

**Files:**
- Modify: `base-test-flow.md` — insert §17 between §16 and "Known issues / quirks"
- Modify: `IMPLEMENTATION_STATUS.md` — refresh §14 row + the §6 Question 1 backlog item
- Modify: `implementationplan.md` — extend §14 / Tier-3 mention

- [ ] **Step 1: Add §17 to `base-test-flow.md`**

Open `base-test-flow.md`. Find the §16 block (added in PR #84). After it ends and before "## Known issues / quirks", insert:

```md
### §17. Desktop biometric (Touch ID, macOS only)

**Automated:** none — Touch ID requires physical interaction; not
covered by Vitest, Playwright, or Maestro. Manual smoke only.

This section is macOS-only. Linux and Windows desktop builds report
biometric as unavailable (the `Use Touch ID` button does not render).
Windows Hello is a planned follow-up.

The DEK is persisted in the macOS Keychain with
`kSecAccessControlBiometryCurrentSet`, so adding or removing a
fingerprint in System Settings auto-invalidates the entry — the next
biometric unlock attempt cleanly falls back to the master password.

- **Enable**: from a freshly unlocked vault (or right after Setup),
  the "Enable Touch ID for faster unlock?" prompt should appear in
  `QuickUnlockPrompt`. Click "Enable". A native Touch ID prompt fires.
  Authenticate with a finger. Confirm no error appears.
- **Lock + biometric unlock**: sidebar → Lock Vault → on the unlock
  screen the "Use Touch ID" button is now visible above the master
  password field. Click it. Touch ID prompt fires. Authenticate.
  Vault unlocks without typing the password.
- **Cancel path**: lock again. Click "Use Touch ID" → cancel the
  prompt → the unlock screen stays usable; type the master password
  → unlocks normally.
- **Persistence across app restart**: Cmd+Q the app, relaunch,
  click "Use Touch ID" → still works (the Keychain entry survives).
- **Enrollment-change invalidation**: System Settings → Touch ID &
  Password → add or remove a fingerprint → return to KeyKeyKey, lock,
  click "Use Touch ID" → expected: prompt fires, then unlocks
  fails with a "Biometric was disabled (enrollment changed). Please
  enter your master password." message. The "Use Touch ID" button
  goes away (since the entry was auto-cleared); the user can re-enable
  from settings after a successful master-password unlock.
- **Reset vault clears the entry**: Reset Vault → confirm → Setup a
  new vault → after unlock, accept the Touch ID enable prompt again
  → confirm a fresh Touch ID prompt fires (NOT silently re-using the
  old entry).

**Cross-platform notes:**
- **Mobile**: equivalent flow is automated in
  `e2e/mobile/flows/pin.yaml` (the pin flow exercises the
  same QuickUnlockPrompt path); biometric on mobile is fully covered
  there since `expo-local-authentication` is mockable.
- **Linux / Windows desktop**: `biometric_is_available()` returns
  `false`, so the "Use Touch ID" button never renders. No further
  testing needed on those platforms.

**Implementation notes:**
- Hardware required: any Apple Silicon Mac with Touch ID, or an Intel
  Mac with Touch Bar.
- The Keychain entry is at service `com.keykeykey.biometric`,
  account `biometric_dek`. Inspectable via Keychain Access.app or
  `security find-generic-password -s com.keykeykey.biometric -a biometric_dek` — but reading the value requires
  Touch ID, so the CLI invocation will prompt.
```

In the **"E2E automation — what's covered where"** table near the end of the file, add a row:

```md
| §17 desktop biometric (Touch ID)               | _manual only — physical Touch ID required_ |
```

- [ ] **Step 2: Refresh `IMPLEMENTATION_STATUS.md`**

Open `IMPLEMENTATION_STATUS.md`. Find the §14 row in the status table. It currently reads (or similar):

```md
| 14   | Vault unlock perf (Tier 1/2/3)                       | 🟡     | Mobile Tier 1+2+3 done; desktop biometric stubbed                              |
```

Replace with:

```md
| 14   | Vault unlock perf (Tier 1/2/3)                       | 🟡     | Mobile Tier 1+2+3 done; desktop Touch ID (macOS) done; Windows Hello pending   |
```

Find the §6 / Question 1 backlog item under "Capability items". It currently reads:

```md
- **Desktop biometric (Touch ID + Windows Hello)** — `apps/desktop/src-tauri/src/biometric_cmds.rs` returns hardcoded `false`. Path forward: small Tauri plugin wrapping `LocalAuthentication.framework` (macOS) and Windows Hello API; cargo features per platform. Frontend already calls into this via `desktop-biometric-adapter.ts`. Estimated 1–2 days.
```

Replace with:

```md
- **Desktop biometric — Windows Hello** — macOS Touch ID is shipped (Keychain `kSecAccessControlBiometryCurrentSet` via `security-framework-sys` + `objc2` for LAContext, see `apps/desktop/src-tauri/src/biometric_cmds/macos.rs`). Windows Hello path needs the same shape (real biometric gating, not just a prompt) via `windows` crate's `Windows.Security.Credentials.UI.UserConsentVerifier` and DPAPI-encrypted DEK storage. Pickable when the implementer is on Windows hardware to test end-to-end.
```

Find the §6 / Question 1 short-list at the bottom (the numbered "Pick whichever you'd like to tackle next" list). Update item 1 to drop "Touch ID":

```md
1. **Desktop biometric — Windows Hello** — same shape as the macOS path (now shipped); needs Windows hardware to test. Estimated 1 day.
```

- [ ] **Step 3: Extend `implementationplan.md`**

Open `implementationplan.md`. Search for the §14 / Tier 3 (biometric) section. Append to the desktop bullet:

```md
- macOS Touch ID is shipped: DEK persisted in Keychain with
  `kSecAccessControlBiometryCurrentSet` so the OS itself enforces
  biometric authentication on every read AND auto-invalidates on
  enrollment change. Implementation in
  `apps/desktop/src-tauri/src/biometric_cmds/macos.rs`. Windows Hello
  remains a follow-up.
```

- [ ] **Step 4: Format**

Run from `/Users/davidneto/keykeykey`:

```bash
pnpm format && pnpm format:check
```

Expected: no warnings.

- [ ] **Step 5: Commit**

```bash
git add base-test-flow.md IMPLEMENTATION_STATUS.md implementationplan.md
git commit -m "docs: §17 desktop biometric (Touch ID, macOS) + status

Adds the manual smoke section for desktop Touch ID, updates the
IMPLEMENTATION_STATUS row to reflect macOS done / Windows pending,
and refreshes the implementationplan §14 Tier 3 bullet."
```

---

## Task 5: Final build + handoff for manual smoke

This task is the bridge from implementation to operator verification.

- [ ] **Step 1: Rebuild the desktop app for the operator**

```bash
cd /Users/davidneto/keykeykey
pnpm --filter @keykeykey/core --filter @keykeykey/ui build
cd apps/desktop && npx tauri build --bundles app
```

Expected: builds to `apps/desktop/src-tauri/target/release/bundle/macos/KeyKeyKey.app`. No warnings about missing frameworks. Note the build duration — if it's significantly slower than the prior baseline (~2 min on Apple Silicon), flag it.

- [ ] **Step 2: Run the full project test suite to confirm no regression**

```bash
pnpm test
```

Expected: all 7 workspaces pass. The desktop test count should be unchanged (still 83 — no frontend changes in this PR).

Also run the @critical Playwright suite to confirm the extension didn't break:

```bash
cd e2e && npx playwright test --project=extension --grep @critical
```

Expected: all 22 @critical tests pass.

- [ ] **Step 3: Open the PR**

Push the branch and open a PR. Body should reference both the spec (`docs/superpowers/specs/2026-04-26-desktop-biometric-touch-id-design.md`) and this plan (`docs/superpowers/plans/2026-04-26-desktop-biometric-touch-id.md`), and explicitly call out the manual-smoke requirement:

```
**Manual smoke required before merge** — see `base-test-flow.md` §17.
This PR cannot be fully validated by CI because Touch ID requires
physical interaction. The operator should run the §17 steps on a
Mac with Touch ID hardware and confirm:
- Enable + biometric unlock works
- Cancel falls back to master password
- Persistence across app restart
- Enrollment-change invalidation cleanly falls back
- Reset vault clears the Keychain entry
```

- [ ] **Step 4: Hand off to operator**

Report DONE_WITH_CONCERNS to the controller noting:
- All Rust code compiles (`cargo check` + `tauri build` both green).
- All workspace tests pass.
- The `Use Touch ID` UI is now exposed via `is_available()` returning true on this Mac.
- **Operator must run `base-test-flow.md` §17 on a Mac with Touch ID** before merging the PR. The implementer cannot physically authenticate.

---

## Final verification (done by the operator after Task 5)

The operator runs:

- [ ] **Step 1: Manual smoke per `base-test-flow.md` §17**

Walks through all 5 sub-checks. Reports any failures.

- [ ] **Step 2: Approve and merge the PR**

If §17 passes end-to-end on a real Mac with Touch ID, squash-merge.

---

## Self-review notes (post-write)

- **Spec coverage:** R1 (is_available true on enrolled Mac — Task 2). R2 (save with kSecAccessControlBiometryCurrentSet — Task 3). R3 (load with discriminated returns — Task 3). R4 (clear no prompt — Task 3). R5 (non-macOS stubs return errors — Task 1). R6 (enrollment-change invalidation — Task 3 implicit via the access control flag, verified in Task 4 manual smoke). R7 (reset-vault clears — relies on existing frontend wiring, verified in §17 step 5). N1-N4 all maintained (no frontend change, no IPC change, 14-day belt-and-suspenders kept, deps gated to macOS).
- **Placeholders:** none. The implementer notes in Task 3 Step 1 list specific debugging steps for plausible API-path mismatches, not "TODO" or "TBD".
- **Type consistency:** `is_available`, `save_dek`, `load_dek`, `clear_dek` use the same names across stub.rs, macos.rs, the dispatcher, and the frontend's Tauri command names (with the `biometric_` prefix preserved on the dispatcher). The `value: String` parameter type matches what the frontend sends. The `Result<Option<String>, String>` return shape on `load_dek` matches what `desktop-biometric-adapter.ts` expects.
- **Subagent capability gap acknowledged:** Task 3 Step 4 and Task 5 explicitly account for the subagent's inability to physically authenticate Touch ID. Hand-off to operator is documented and the PR body template flags it.
