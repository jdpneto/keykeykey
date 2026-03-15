# PIN & Biometric Unlock — Design Spec

## Overview

Add PIN and biometric unlock to mobile (iOS/Android) and desktop (macOS/Windows/Linux) apps. Refactor the extension's existing PIN implementation to share crypto logic via a new core module. Unlock priority on all platforms: biometric → PIN → master password.

## Goals

- Sub-200ms unlock for biometric, sub-2s for PIN (avoid full Argon2id on master password path for daily use)
- Consistent security model across all platforms (same PIN crypto, same lockout rules)
- DRY: one PIN crypto implementation in core, consumed by all three platforms
- Biometric on mobile (iOS Face ID / Touch ID, Android fingerprint/face), macOS Touch ID, Windows Hello. Linux gets PIN only.

## Non-Goals

- Desktop biometric on Linux (inconsistent OS support)
- Changing the master password unlock flow (already works)
- TOTP, sync, or any other feature

---

## 1. Core PIN Module (`packages/core/src/pin`)

### `pin-unlock.ts`

Extracted from the extension's `apps/extension/src/background/pin.ts`. Platform-agnostic crypto logic.

```typescript
interface PinData {
  wrappedDEK: Uint8Array;   // DEK encrypted with PIN-derived KEK
  salt: Uint8Array;          // Argon2id salt for PIN KDF
  attemptsRemaining: number; // Lockout counter (default: 5)
}

/** Validate PIN format: 4-8 digits, no sequential/repeated patterns */
function validatePin(pin: string): { valid: boolean; error?: string };

/** Setup: derive KEK from PIN via Argon2id, wrap DEK */
async function setupPin(pin: string, dek: Uint8Array): Promise<PinData>;

/** Unlock: derive KEK from PIN, unwrap DEK. Returns null DEK on failure. */
async function unwrapDekWithPin(
  pin: string,
  pinData: PinData
): Promise<{ dek: Uint8Array | null; attemptsRemaining: number }>;
```

- Argon2id parameters: uses the platform's preset (passed as argument or uses the adapter's current config). The salt is randomly generated during `setupPin`.
- Attempt tracking: `unwrapDekWithPin` decrements `attemptsRemaining` on failure. Caller is responsible for persisting the updated count and deleting `PinData` when attempts reach 0.
- Maximum attempts: 5 (constant exported from module).

### `pin-validation.ts`

PIN validation rules:
- Must be 4–8 numeric digits
- Rejects sequential patterns: `1234`, `4321`, `2345`, etc.
- Rejects all-same digits: `1111`, `0000`, etc.

---

## 2. Core Biometric Interface (`packages/core/src/biometric`)

### `biometric-adapter.ts`

Defines the contract. Each platform provides its own implementation.

```typescript
interface BiometricAdapter {
  /** Check if biometric hardware is available and enrolled */
  isAvailable(): Promise<boolean>;

  /** Store DEK in secure enclave (requires biometric auth on retrieval) */
  saveDEK(dek: Uint8Array): Promise<void>;

  /** Retrieve DEK from secure enclave (triggers biometric prompt) */
  loadDEK(): Promise<Uint8Array | null>;

  /** Remove stored DEK */
  clearDEK(): Promise<void>;
}
```

Platform implementations:

| Platform | Implementation |
|----------|---------------|
| **iOS** | `expo-secure-store` with `requireAuthentication: true`. FaceID/TouchID prompt handled by OS. |
| **Android** | `expo-secure-store` with `requireAuthentication: true`. Fingerprint/face prompt handled by OS. |
| **macOS** | Tauri Rust command → Keychain with `kSecAccessControlBiometryCurrentSet` access control. |
| **Windows** | Tauri Rust command → Windows Hello via `windows` crate credential APIs. |
| **Linux** | `isAvailable()` returns `false`. No biometric support. |

### DEK Invalidation

The stored biometric DEK is cleared when:
- Master password is changed (DEK itself changes)
- User disables biometric unlock in settings
- Biometric enrollment changes (OS handles this on iOS/Android; macOS invalidates Keychain items tied to biometry)
- Max age exceeded: 14 days (default). A timestamp is stored alongside the DEK in regular (non-secure) storage. On load, check timestamp; if expired, call `clearDEK()` and fall through to PIN/password.

---

## 3. Unlock Priority & Flow

### `packages/core/src/unlock/unlock-methods.ts`

```typescript
type UnlockMethod = 'biometric' | 'pin' | 'password';

interface UnlockAvailability {
  biometric: boolean;  // BiometricAdapter.isAvailable() && DEK stored && not expired
  pin: boolean;        // PinData exists in storage
  password: boolean;   // Always true
}

function getDefaultMethod(availability: UnlockAvailability): UnlockMethod;
// Returns first available: biometric → pin → password
```

### Unlock Screen Behavior (all platforms)

1. On mount: check availability of each method via `getDefaultMethod()`
2. If biometric is default: auto-trigger biometric prompt
3. Show fallback buttons: "Use PIN" / "Use master password"
4. Biometric fail/cancel → user picks fallback manually (no auto-retry)
5. PIN fail (all 5 attempts) → PinData deleted → must use master password
6. Master password success → vault unlocked

### State Diagram

```
[App Launch]
    ↓
[Check Availability]
    ↓
biometric available? ──yes──→ [Biometric Prompt]
    ↓ no                          ↓ success → [Vault Unlocked]
pin available? ──yes──→ [PIN Pad] ↓ fail/cancel
    ↓ no                    ↓         ↓
[Password Input] ←──────────┘    [PIN Pad]
    ↓ success                    ↓ success → [Vault Unlocked]
[Vault Unlocked]                 ↓ 5 failures
                            [Password Input]
                                 ↓ success → [Vault Unlocked]
```

---

## 4. Setup Flow & Settings

### First-Unlock Prompt

After the first successful master password unlock on a device, a one-time prompt appears:

- **If biometric hardware available:** "Enable [Face ID / Touch ID / Fingerprint] for faster unlock?" → if accepted, also offer PIN as fallback
- **If no biometric:** "Set up a PIN for faster unlock?"
- **Skip** dismisses permanently (flag: `quickUnlockPromptShown` persisted in platform storage)

### Settings Screen

- **Biometric unlock** (toggle) — only visible if hardware available
  - Enable: requires master password confirmation → stores DEK via `BiometricAdapter.saveDEK()`
  - Disable: calls `BiometricAdapter.clearDEK()`
- **PIN unlock** (toggle + "Change PIN")
  - Enable: requires master password confirmation → PIN entry + confirm → calls `setupPin()`
  - Disable: deletes PinData from storage
  - Change PIN: requires current PIN or master password → new PIN entry + confirm
- **Auto-lock timeout** — already exists, unchanged

### Master Password Change Side Effects

When the master password changes, the DEK is re-generated:
1. `BiometricAdapter.clearDEK()` — biometric DEK invalidated
2. Delete PinData from storage — PIN invalidated
3. On next unlock, user must use new master password
4. Post-unlock, re-trigger the quick unlock setup prompt

---

## 5. Extension Refactor

### What Moves to Core

- `wrapDekWithPin()` → `setupPin()` in `@keykeykey/core/pin`
- `unwrapDekWithPin()` → `unwrapDekWithPin()` in `@keykeykey/core/pin`
- PIN validation logic → `validatePin()` in `@keykeykey/core/pin`

### What Stays in Extension

- PinData persistence in `browser.storage.local` (serialization to/from base64)
- Message handler cases: `SETUP_PIN`, `UNLOCK_WITH_PIN`, `DISABLE_PIN`
- PinPad UI component
- Attempt tracking persistence (updating `attemptsRemaining` in storage)

### Migration

- Extension's `pin.ts` becomes a thin wrapper importing from `@keykeykey/core/pin`
- No behavioral changes — all existing extension PIN behavior is preserved
- Existing extension tests updated to verify the wiring; core PIN module gets its own comprehensive tests

---

## 6. Platform Storage Map

| Data | Mobile | Desktop | Extension |
|------|--------|---------|-----------|
| **PinData** (wrappedDEK, salt, attempts) | `expo-secure-store` | Tauri keyring (`save_to_keyring`) | `browser.storage.local` |
| **Biometric DEK** | `expo-secure-store` (`requireAuthentication: true`) | macOS Keychain / Windows Hello (Rust) | N/A |
| **Biometric DEK timestamp** | `expo-secure-store` (separate key) | Tauri keyring (separate key) | N/A |
| **quickUnlockPromptShown** | `expo-secure-store` | Tauri key-value storage | `browser.storage.local` |

Desktop uses the existing Tauri keyring commands (`save_to_keyring`, `load_from_keyring`, `delete_from_keyring` in `keyring_cmds.rs`) for PinData storage — more secure than SQLite or filesystem.

---

## 7. Desktop Biometric (macOS / Windows)

### macOS — Touch ID via Keychain

Tauri Rust command that:
1. Creates a Keychain item with access control: `kSecAccessControlBiometryCurrentSet`
2. On save: stores DEK bytes in Keychain, gated by Touch ID
3. On load: OS triggers Touch ID prompt; success returns DEK bytes
4. Uses the `security-framework` Rust crate

### Windows — Windows Hello

Tauri Rust command that:
1. Uses the `windows` crate to access `KeyCredentialManager`
2. On save: encrypts DEK with a Windows Hello-protected key
3. On load: OS triggers Windows Hello prompt (fingerprint/face/PIN); success returns DEK
4. Note: untestable by the developer (no Windows hardware) — implementation is best-effort, verified via CI if a Windows runner is available

### Linux

`BiometricAdapter.isAvailable()` returns `false`. PIN is the only quick-unlock method.

---

## 8. Testing Strategy

### Core PIN Module

- Unit tests: `setupPin` → `unwrapDekWithPin` round-trip with valid PIN
- Unit tests: wrong PIN returns null DEK, decrements attempts
- Unit tests: `validatePin` rejects invalid formats, sequential, repeated
- Property-based tests (`fast-check`): random valid PINs always round-trip successfully
- Coverage: 100% statement/line (crypto module standard)

### Core Biometric Adapter

- Interface only in core — no tests at core level
- Each platform tests its own implementation

### Mobile

- Integration tests: unlock flow with mocked `expo-secure-store` and `expo-local-authentication`
- Test: biometric available → auto-prompt → success → vault unlocked
- Test: biometric fail → PIN fallback → success
- Test: PIN lockout → password required
- Test: setup prompt appears once, respects `quickUnlockPromptShown`

### Desktop

- Vitest: frontend unlock flow with mocked Tauri commands
- `cargo test`: Rust keyring and biometric commands with mocked OS APIs (`mockall`)
- Test: Touch ID available → prompt → success (macOS)
- Test: PIN via keyring storage round-trip

### Extension

- Updated integration tests verifying core PIN import wiring
- All existing PIN behavior tests must continue to pass
- No new extension-specific tests needed (behavior unchanged)

### E2E

- Mobile/Desktop: PIN entry → vault access
- Mobile/Desktop: PIN lockout → forced password unlock
- Mobile: biometric mock → vault access (using `expo-local-authentication` test helpers)
