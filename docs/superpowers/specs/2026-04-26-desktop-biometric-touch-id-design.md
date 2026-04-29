# Desktop Biometric (Touch ID, macOS) — Design

**Date:** 2026-04-26
**Status:** Approved (brainstorm) — ready for implementation plan
**Owner:** `apps/desktop/src-tauri/src/biometric_cmds.rs` + 1 Cargo dep + manual smoke + docs

## Context

`apps/desktop/src-tauri/src/biometric_cmds.rs` exposes four Tauri commands that the desktop frontend already calls through `apps/desktop/src/lib/desktop-biometric-adapter.ts`:

- `biometric_is_available()` — currently returns hardcoded `false`.
- `biometric_save_dek(value)` — saves a JSON string `{ dek, savedAt }` to the OS keyring.
- `biometric_load_dek()` — loads it back.
- `biometric_clear_dek()` — removes it.

Save/load/clear go through the cross-platform `keyring` crate, which on macOS writes to the standard Keychain _without_ biometric protection. The current `is_available` returns `false` deliberately, with this comment in the source:

> Returning true without real biometric protection would be a security misrepresentation for a credential manager.

Frontend wiring exists — `vault-context.tsx`, `UnlockScreen.tsx`, and `QuickUnlockPrompt.tsx` already render the biometric flow when `biometricAvailable === true`. Today that branch is dead code. This design turns it on by replacing the four commands with a real Touch-ID-gated implementation on macOS.

Mobile (iOS) already does the equivalent via `expo-local-authentication` + `expo-secure-store` with `kSecAccessControlBiometryCurrentSet`. This PR brings desktop macOS to parity. Windows Hello and Linux are out of scope for this design — a Windows follow-up will land separately once the implementer is on Windows hardware to test it.

## Requirements

### Functional

- **R1.** On macOS systems with Touch ID hardware AND at least one enrolled fingerprint, `biometric_is_available()` MUST return `true`. Otherwise (no hardware, no enrollment, hardware temporarily locked) it MUST return `false`. No prompt is shown.
- **R2.** `biometric_save_dek(value)` MUST store `value` (an opaque UTF-8 string the frontend builds via JSON-encoding `{ dek, savedAt }`) in the macOS Keychain such that any subsequent read REQUIRES biometric authentication. The OS prompt MAY fire at save time — the frontend tolerates this (the user is in the unlock flow and has just authenticated with the master password).
- **R3.** `biometric_load_dek()` MUST trigger the macOS Touch ID prompt and return `Ok(Some(value))` on success, `Ok(None)` if the entry has been invalidated (enrollment change, never saved) or removed, `Err("cancel")` if the user cancels the prompt, or `Err(<message>)` for any other OS error.
- **R4.** `biometric_clear_dek()` MUST delete the Keychain entry without any prompt. Deleting a non-existent entry is a success.
- **R5.** On non-macOS targets, all four commands MUST be stubs: `biometric_is_available` returns `false`; the others return `Err("Biometric is not supported on this platform")`. (Windows Hello is intentionally a follow-up.)
- **R6.** Adding or removing a fingerprint in System Settings MUST invalidate the stored entry. The next `load_dek` call returns `Ok(None)` and the frontend's adapter maps that to `BiometricResult.invalidated`. (The OS handles this automatically via `kSecAccessControlBiometryCurrentSet` — no extra code in our adapter.)
- **R7.** A vault reset (existing flow) MUST clear the Keychain entry by calling `clearDEK`. (Already wired in the frontend — no change in this PR.)

### Non-functional

- **N1.** No frontend changes — `desktop-biometric-adapter.ts` already maps the Tauri command results to the cross-platform `BiometricAdapter` interface.
- **N2.** No new Tauri command shapes — the existing four signatures stay the same. A 4-byte UTF-8 stays a 4-byte UTF-8.
- **N3.** The 14-day `MAX_DEK_AGE_MS` auto-clear in `desktop-biometric-adapter.ts` STAYS as defense-in-depth, even though the OS-level invalidation makes it redundant for the enrollment-change case. (Belt and suspenders.)
- **N4.** No new IPC. No new permissions. Cargo deps gated `[target.'cfg(target_os = "macos")'.dependencies]` so non-macOS builds aren't bloated.

## Design

### Cargo dependencies

Add to `apps/desktop/src-tauri/Cargo.toml`:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
security-framework = "3"
core-foundation = "0.10"
```

`security-framework` is the Apple Security.framework binding that the Rust ecosystem standardizes on (used by `rustls`, `cargo`, etc.). `core-foundation` is needed for the low-level CF types (`CFString`, `CFData`, `CFDictionary`) when interacting with `SecAccessControlCreateWithFlags`, which `security-framework` does not yet wrap completely.

### `biometric_cmds.rs` rewrite

Top of file: split into a macOS module and a stub module.

```rust
#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

#[cfg(target_os = "macos")]
use macos::{is_available, save_dek, load_dek, clear_dek};

#[cfg(not(target_os = "macos"))]
use stub::{is_available, save_dek, load_dek, clear_dek};

#[tauri::command]
pub async fn biometric_is_available() -> bool { is_available() }

#[tauri::command]
pub fn biometric_save_dek(value: String) -> Result<(), String> { save_dek(value) }

#[tauri::command]
pub fn biometric_load_dek() -> Result<Option<String>, String> { load_dek() }

#[tauri::command]
pub fn biometric_clear_dek() -> Result<(), String> { clear_dek() }
```

The four `#[tauri::command]` exports stay where they are so `lib.rs` doesn't change.

#### macOS module

```rust
// apps/desktop/src-tauri/src/biometric_cmds/macos.rs

use core_foundation::base::TCFType;
use core_foundation::data::CFData;
use core_foundation::dictionary::CFMutableDictionary;
use core_foundation::error::CFError;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use security_framework::access_control::{ProtectionMode, SecAccessControl};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};
// (Exact API choices depend on what security-framework v3 exposes; see
// "Implementation notes" below for the FFI fallback if a method is missing.)

const SERVICE: &str = "com.keykeykey.biometric";
const ACCOUNT: &str = "biometric_dek";
```

Each function:

**`is_available()` → `bool`**

1. Create an `LAContext` via FFI (objc2 / msg_send! call) — `LAContext::new()`.
2. Call `canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, &error)`.
3. Return `true` iff the call returns `true`. `error` non-nil → `false`.

The `objc2` family of crates is the modern way to call Objective-C from Rust. If pulling `objc2` is too heavy for one call site, a `#[link(name = "LocalAuthentication", kind = "framework")]` `extern "C"` block plus raw `id`/`SEL` calls works too — `security-framework` already pulls in objc dependencies, so adding `objc2` is essentially free in dep weight.

**`save_dek(value: String)` → `Result<(), String>`**

1. Build a `SecAccessControl` via `SecAccessControlCreateWithFlags(kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecAccessControlBiometryCurrentSet, &error)`.
2. Build a `CFMutableDictionary` for the keychain query:
   - `kSecClass = kSecClassGenericPassword`
   - `kSecAttrService = SERVICE`
   - `kSecAttrAccount = ACCOUNT`
   - `kSecValueData = value.as_bytes()` as `CFData`
   - `kSecAttrAccessControl = <the SecAccessControl above>`
3. Call `SecItemDelete` first to handle the "already exists" case, then `SecItemAdd`. macOS will prompt for Touch ID at this point.
4. On success → `Ok(())`. On `errSecUserCanceled` (user dismissed the save prompt) → `Err("cancel")`. On any other status → `Err(format!("SecItemAdd failed: {status}"))`.

**`load_dek()` → `Result<Option<String>, String>`**

1. Build a query dictionary:
   - `kSecClass = kSecClassGenericPassword`
   - `kSecAttrService = SERVICE`, `kSecAttrAccount = ACCOUNT`
   - `kSecReturnData = true`
   - (Do NOT set `kSecUseAuthenticationUI = kSecUseAuthenticationUISkip` — we WANT the prompt. See Feedback memory: "iOS keychain ACL items invisible to UISkip" — same applies here.)
2. Call `SecItemCopyMatching`. macOS shows the Touch ID prompt.
3. Map the OSStatus:
   - `errSecSuccess` → `Ok(Some(String::from_utf8(data)?))`
   - `errSecItemNotFound` → `Ok(None)` (frontend maps to `invalidated`)
   - `errSecUserCanceled` → `Err("cancel")` (frontend maps to `cancelled`)
   - `errSecAuthFailed` (5+ failed Touch ID attempts → biometry temporarily locked) → `Err("Biometric authentication failed")`
   - other → `Err(format!("SecItemCopyMatching failed: {status}"))`

**`clear_dek()` → `Result<(), String>`**

1. Build the same service/account query (no kSecValueData, no access control).
2. Call `SecItemDelete`.
3. `errSecSuccess` or `errSecItemNotFound` → `Ok(())`. Other → `Err(...)`.

#### Non-macOS stub module

```rust
// apps/desktop/src-tauri/src/biometric_cmds/stub.rs

pub fn is_available() -> bool { false }

pub fn save_dek(_: String) -> Result<(), String> {
    Err("Biometric is not supported on this platform".into())
}

pub fn load_dek() -> Result<Option<String>, String> {
    Err("Biometric is not supported on this platform".into())
}

pub fn clear_dek() -> Result<(), String> {
    Err("Biometric is not supported on this platform".into())
}
```

### Frontend

No changes. `apps/desktop/src/lib/desktop-biometric-adapter.ts` already:

- Translates `Ok(None)` (from a `null` IPC return) → `BiometricResult.invalidated`.
- Translates `Err("cancel")` and `Err("Cancel")` → `BiometricResult.cancelled` (case-insensitive substring match).
- Translates other `Err(...)` → `BiometricResult.error`.
- Performs the 14-day age check on the JSON envelope after a successful read.

The `vault-context.tsx`'s `biometricAvailable` boolean is set from the result of `biometric_is_available()` — flips from `false` to `true` on this PR.

`UnlockScreen.tsx` (lines 17, 39, 246, 295) and `QuickUnlockPrompt.tsx` already gate their biometric UI on `biometricAvailable`. The opt-in flow (post-unlock prompt → "Enable Touch ID for faster unlock?") already exists.

### Test surface

- **Rust unit tests** (in `biometric_cmds.rs` or sibling `tests.rs`): assert that on non-macOS, all stubs return the expected values. (We can use `#[cfg(all(test, not(target_os = "macos")))]` to gate.) The macOS Keychain path requires real hardware and an interactive Touch ID prompt — not unit-testable.
- **Manual smoke** (`base-test-flow.md` §17 — new): cover enable → unlock-via-biometric → enrollment-change-invalidates → clear → reset-vault-clears.
- **Existing screen tests** (`UnlockScreen.test.tsx` etc.): no change. They mock `biometricAvailable` and don't actually exercise the Tauri command.
- **CI**: no new step needed. The Rust code typechecks via `cargo check` locally + `Build All` runs `pnpm build` which invokes `tauri build` (which compiles the Rust). No Cargo CI step exists today (per IMPLEMENTATION_STATUS §6 backlog) — out of scope here.

### Documentation

- **`base-test-flow.md`** — insert §17 "Desktop biometric (Touch ID, macOS only)" between §16 (Password history) and "Known issues / quirks". Cover:
  - Enable: from Unlock screen, click "Enable Touch ID" → Touch ID prompt → confirms.
  - Lock + biometric unlock: Lock Vault → Unlock screen now shows "Use Touch ID" → click → prompt → vault unlocks without master password.
  - Cancel path: click Touch ID → cancel the prompt → fallback to master password remains visible.
  - Enrollment-change invalidation: Settings → Touch ID → add a new fingerprint → return to KeyKeyKey → biometric unlock attempt now falls through (`invalidated`); user enters master password and is offered to re-enable biometric.
  - Reset Vault clears the entry: Reset Vault → Setup → enable biometric again → confirm fresh prompt.
- **`IMPLEMENTATION_STATUS.md`** — update §14 row ("Vault unlock perf") to reflect "Tier 3 biometric: macOS done, Windows pending"; update §6 backlog to mark Touch ID done with a Windows Hello sub-bullet remaining.
- **`implementationplan.md`** — extend §14 / Tier-3 wording to mention macOS biometric is shipped via Keychain `kSecAccessControlBiometryCurrentSet`.

## Failure modes & recovery

- **Touch ID prompt errors out at save** (e.g. user dismissed) → save returns `Err("cancel")` → frontend's `saveDEK` rejects → opt-in flow falls back to "use master password each time" without setting `biometricEnabled`. User can retry from settings.
- **Touch ID prompt errors out at load** → adapter returns `cancelled` or `error` → unlock screen falls back to master password input.
- **Touch ID locked** (5+ failed attempts) → adapter returns `error` with a message containing "auth failed" → user must enter system password in System Settings to unlock biometry, then can use master password to unlock vault.
- **Keychain unreachable** (extremely rare — typically only during a corrupted user profile) → adapter returns `error` → fallback to master password.
- **Adding/removing a finger** → next `load_dek` returns `Ok(None)` → adapter returns `invalidated` → unlock screen shows "Biometric was disabled (enrollment changed). Please enter your master password" message and clears the local "biometric enabled" flag automatically.

## Out of scope (explicit)

- **Windows Hello** — follow-up PR once on Windows hardware to test.
- **Linux** — no equivalent biometric API on Linux desktop without distro-specific PolicyKit hacks. `is_available` stays `false`.
- **Apple Watch unlock** (`deviceOwnerAuthenticationWithWatch`) — separate policy, not requested.
- **Custom prompt text** — accept the macOS default ("KeyKeyKey is requesting access to a Keychain item"). Not worth the FFI gymnastics for v1.
- **Cargo CI for the new code** — Cargo CI is missing in general (IMPLEMENTATION_STATUS §6) and out of scope here. The new Rust code is exercised by manual smoke + `cargo check` locally.
- **Replacing the existing keyring crate dep** — `keyring` is still used by `keyring_cmds.rs` for OAuth refresh tokens etc. We're only swapping the biometric path.

## Implementation notes

- The exact API surface of `security-framework` v3 may not expose `SecAccessControlCreateWithFlags` directly. If not, drop to `extern "C"` FFI calls (the function is in the `Security.framework` C interface and is straightforward to declare). `core-foundation` already gives us the CF types we need.
- The `objc2` crate is the cleanest way to call `LAContext.canEvaluatePolicy`. If we prefer to avoid pulling it (it's ~40k LoC), a small `extern "C"` wrapper over `LAContext`'s ObjC class also works (~30 lines). Decision deferred to implementation: prefer `objc2` if it's already an indirect dep, otherwise FFI.
- Per the existing memory note ("never probe a biometric-gated keychain item's existence with `kSecUseAuthenticationUISkip`"): we do NOT use `UISkip` anywhere. The `is_available` check uses LAContext, which doesn't touch the Keychain at all. The `load_dek` call always allows the prompt.

## Open questions

None. Brainstorm signed off.
