# Mobile Autofill — iOS & Android Credential Providers

## Overview

Register KeyKeyKey as a system-level credential provider on iOS (AutoFill Credential Provider Extension) and Android (AutofillService) so it appears in OS autofill prompts inside any app or browser. Users can fill existing credentials, search the vault to associate credentials with new apps, or create new credentials — all from the autofill prompt.

## Scope

- **In scope:** iOS AutoFill Credential Provider, Android AutofillService, core schema changes, shared storage, deep-linking, credential association
- **Out of scope:** Browser extension autofill (separate spec), TOTP autofill, credit card autofill via OS prompts (future), passkey/WebAuthn support
- **Schema evolution:** Adding `appIdentifiers` is a forward-only schema change. The field is credential-specific and will not apply to Card or SecureNote types.

## 1. Core Schema & Domain Matching Changes

### 1.1 Credential Schema

Add `appIdentifiers` to the Credential model in `packages/core/src/models/credential.ts`:

```typescript
appIdentifiers: z.array(
  z
    .string()
    .transform((s) => s.toLowerCase())
    .pipe(z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/)),
).optional();
```

Stores native app bundle IDs (e.g., `com.slack.android`, `com.tinyspeck.chatlyio`). Optional — existing vault data is unaffected. CSV import/export ignores this field (no other password manager exports app IDs).

**Validation:** App identifiers are validated against reverse-DNS format. Both iOS bundle IDs and Android package names follow this convention.

**Case handling:** Zod `.transform()` lowercases input before regex validation. The regex only accepts lowercase. This ensures all stored identifiers are lowercase. Matching also lowercases the input before comparison.

**Schema compatibility:** The `CredentialSchema` currently uses `.strict()` mode, which rejects unknown properties. To support forward compatibility (older app versions syncing with newer vaults), change `.strict()` to `.passthrough()` on all vault item schemas — including `CredentialSchema`, `CardSchema`, `SecureNoteSchema`, and `EncryptedVaultItemSchema`. The encrypted schema is the on-disk/wire format and has the most forward-compatibility exposure; if a future version adds metadata fields to the encrypted envelope, older clients must not reject them. This is a one-way schema evolution — no downgrade path is provided.

### 1.2 Domain Matching Expansion

In `packages/core/src/domain/domain-utils.ts`:

- New function `matchCredentialsByAppIdentifier(appId: string, items: VaultItem[])` — case-insensitive exact match on `appIdentifiers` array (both sides lowercased)
- New combined function `matchCredentials(context: { hostname?: string; appIdentifier?: string }, items: VaultItem[])`:
  1. Try app identifier match first (exact match on `appIdentifiers`)
  2. Fall back to domain match (existing `matchCredentialsByDomain`)
  3. Return deduplicated results (by item ID)

## 2. iOS Credential Provider Extension

### 2.1 Architecture

- Custom Expo config plugin generates an iOS **AutoFill Credential Provider Extension** target
- Uses `ASCredentialProviderViewController` (system API for password autofill)
- **Native Swift UI** — the extension uses SwiftUI for its credential selection interface. React Native is NOT used in the extension due to iOS extension memory limits (~120 MB) and cold-start latency constraints.
- Shares data with the main app via **App Group** shared container (`group.com.keykeykey.shared`)
- Associated Domains entitlement (`webcredentials:`) configured for automatic domain-to-credential matching by the OS

### 2.2 Storage Refactor

The storage layer (`apps/mobile/lib/storage.ts`) must be refactored so both the main app and the extension can access vault data:

- **Vault header** → shared Keychain access group (`<TEAM_ID>.com.keykeykey.shared`), preserving Keychain-level encryption at rest. The vault header contains the KEK-wrapped DEK and Argon2id salt — while the DEK is encrypted, exposing the salt and encrypted blob in unencrypted storage (e.g., UserDefaults) would weaken the security posture. Using the shared Keychain keeps the same security level as the current `expo-secure-store` implementation.
- **Encrypted items (SQLite DB)** → App Group shared container filesystem, using **raw SQLite with WAL mode** (not `expo-sqlite`) to support concurrent access from the main app and extension processes. The main app's storage adapter wraps this for compatibility.
- **Biometric DEK** → shared Keychain access group (`<TEAM_ID>.com.keykeykey.shared`) with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` + biometric access control (`SecAccessControlCreateFlags.biometryCurrentSet`). The biometric access control flags from the current implementation must be preserved.
- **PIN data** → App Group shared `UserDefaults` suite (the wrapped DEK + salt)

### 2.3 Extension Initialization & Vault Access

The extension cannot use the React Native `VaultProvider` or `createVaultStore()` directly. Instead, a lightweight Swift-native vault access layer:

1. Read the serialized vault header from the shared Keychain access group
2. Authenticate the user (biometric → PIN → master password) to obtain the DEK:
   - **Biometric available:** Read biometric DEK from shared Keychain (requires Face ID/Touch ID)
   - **PIN available:** Read PIN-wrapped DEK from shared UserDefaults, prompt for PIN, unwrap DEK using PBKDF2
   - **Neither available (vault locked):** Prompt for master password, derive KEK via Argon2id (using the C `libargon2` library linked directly into the extension — not `react-native-argon2`), unwrap DEK from vault header
3. Open the shared SQLite database (read-only for fill operations, read-write for association)
4. Decrypt items using XChaCha20-Poly1305 with the DEK via **libsodium** (`crypto_aead_xchacha20poly1305_ietf_*`). Note: Apple's CryptoKit only supports ChaChaPoly (12-byte nonce IETF variant), NOT XChaCha20 (24-byte nonce). libsodium is the only viable native option for XChaCha20-Poly1305.
5. Match credentials using the same domain/app ID matching logic (reimplemented in Swift or via a shared C/Swift library)

**DEK lifecycle in extension:** The DEK is held in memory only for the duration of the autofill request. It is zeroed immediately after filling or when the extension is dismissed. No auto-lock timer is needed — the extension's lifecycle is inherently short-lived.

### 2.4 Extension Flow

1. User taps a login field in any app/browser → iOS shows autofill prompt → user selects KeyKeyKey
2. Extension launches `ASCredentialProviderViewController`
3. **Auth gate** — checks data availability in shared storage:
   - If biometric DEK exists in shared Keychain → Face ID/Touch ID prompt
   - If PIN data exists in shared UserDefaults → PIN pad
   - Otherwise → master password screen (Argon2id via native `libargon2`)
4. After auth, extension reads encrypted items from shared SQLite, decrypts with DEK
5. **Match found** → list matching credentials (name + username), user taps one → fill via `ASPasswordCredential`
6. **No match** → screen with two options:
   - **"Create new"** → write pending creation flag to shared App Group UserDefaults (domain + app identifier), then show "Open KeyKeyKey to add this credential" message and dismiss. The main app checks for this flag on launch and opens the add screen pre-populated. Note: iOS credential provider extensions cannot deep-link to the containing app directly (`extensionContext.open` is not available on `ASCredentialProviderExtensionContext`).
   - **"Search vault"** → search existing credentials, select one → associate current app ID/URL with it → fill
7. On "Search vault" association: update the selected credential's `appIdentifiers` array with the current app's bundle ID, write back to shared SQLite

### 2.5 Config Plugin Responsibilities

- Add App Group entitlement (`group.com.keykeykey.shared`) to both main app and extension targets
- Add AutoFill Credential Provider entitlement
- Add Associated Domains entitlement (`webcredentials:keykeykey.com`) for automatic domain matching
- Generate the native Swift extension target with SwiftUI views
- Configure shared Keychain access group (`<TEAM_ID>.com.keykeykey.shared`)
- Link `libargon2` (C library) into the extension target for master password unlock
- Link `libsodium` into the extension target for XChaCha20-Poly1305 decryption

### 2.6 Error Handling

- If the extension crashes or is killed by the OS mid-operation, the DEK (held only in memory) is automatically lost — no cleanup needed
- If SQLite read fails (corruption, migration mismatch), show an error screen with "Open KeyKeyKey to repair" and dismiss the extension
- If biometric auth fails (3 attempts), fall back to PIN; if PIN fails (5 attempts), fall back to master password

## 3. Android Autofill Service

### 3.1 Architecture

- Custom Expo config plugin registers an `AutofillService` in the Android manifest
- Runs in the **same app process** — no shared container needed (unlike iOS)
- Uses Android's `AutofillManager` API (API level 26+)
- UI is React Native (same process, can reuse existing components)

### 3.2 Autofill Flow

1. User taps a login field in any app/browser → Android shows autofill suggestion → user selects KeyKeyKey
2. Service receives `onFillRequest` with autofill hints, the requesting app's package name, and `webDomain` from `AssistStructure.ViewNode` (for browser autofill)
3. **Auth gate:**
   - If biometric DEK available in Android Keystore → biometric prompt
   - If PIN data available → PIN activity
   - Otherwise → master password activity (Argon2id via `react-native-argon2`)
4. After auth, search vault: by app package name (`appIdentifiers`) first, then by `webDomain` or domain extracted from autofill hints
5. **Match found** → return `FillResponse` with `Dataset` entries (name + username preview). User taps one → Android fills the fields
6. **No match** → launch an activity with two options:
   - **"Create new"** → navigate to add screen, pre-populated with package name / domain
   - **"Search vault"** → search existing credentials, select one → associate current app's package name → fill
7. Association updates `appIdentifiers` just like iOS

### 3.3 Save Flow (`onSaveRequest`)

Android calls `onSaveRequest` after a successful form submission with new credentials:

- Show a notification/prompt: "Save this password to KeyKeyKey?"
- If accepted, pass credentials to the add screen via **in-memory singleton** (not URL parameters — never include passwords in URLs/Intents to avoid logging and interception). The singleton is cleared after the add screen reads it.
- Pre-populate: username, password, app package name, and domain if available
- This is an Android-only feature — iOS credential provider extensions don't support save-on-submission

### 3.4 Config Plugin Responsibilities

- Register `AutofillService` in `AndroidManifest.xml` with `android.permission.BIND_AUTOFILL_SERVICE`
- Add autofill service metadata XML (settings activity, description)
- Add Digital Asset Links verification for automatic domain matching
- Target API 26+ (already the case with Expo)

## 4. Shared Logic & Deep-Linking

### 4.1 Credential Provider UI

**Android:** Shared React Native screens (same process as main app):

- **Unlock screen** — reuses unlock logic from `apps/mobile/app/unlock.tsx` (biometric / PIN / master password)
- **Match list screen** — FlatList showing matching credentials (name + username), tap to select
- **Search screen** — text input + filtered list of all vault credentials, tap to select and associate
- **No-match screen** — two buttons: "Create new" and "Search existing"

**iOS:** Native SwiftUI equivalents of the above screens, with the same UX flow but implemented in Swift for the extension process.

### 4.2 Deep-Linking

For the "Create new" flow, deep-link to the main app's add screen:

```
keykeykey://item/add?appId=com.slack.android&domain=slack.com
```

Only non-sensitive metadata (app ID, domain) is passed via URL. No credentials are included in the URL.

The existing `app/item/add.tsx` screen reads these params and pre-populates:

- `name` → extracted domain brand (e.g., "Slack") using `extractDomainBrand()` from core
- `url` → domain
- `appIdentifiers` → `[appId]`

After saving, the user returns to the requesting app manually (standard OS behavior).

**URL scheme security note:** Custom URL schemes can be hijacked by malicious apps on iOS. For production, consider migrating to Universal Links (iOS) and App Links (Android) which use HTTPS-verified domain ownership. For v1, the custom scheme is acceptable since the deep-link only carries non-sensitive metadata (app ID and domain name).

### 4.3 Association Flow

When user selects "Search existing" and picks a credential:

1. The credential's `appIdentifiers` array is updated to include the current app's bundle ID / package name
2. The updated credential is re-encrypted and persisted to storage
3. The credential is used to fill the requesting form
4. This association persists — next time the same app requests autofill, it matches directly

**Concurrent access (iOS):** The shared SQLite database uses WAL mode, which allows the main app to read while the extension writes (or vice versa). Association writes acquire a brief write lock; if the main app is simultaneously modifying the same credential, the last write wins (consistent with the existing sync conflict resolution strategy).

### 4.4 Add/Edit Screen Changes

- `app/item/add.tsx` — new optional `appIdentifiers` field shown as read-only chips when pre-populated from autofill deep-link
- `app/item/edit.tsx` — `appIdentifiers` editable for manual management (add/remove app IDs)

## 5. Testing Strategy

### 5.1 Core Changes

- Unit tests for `matchCredentialsByAppIdentifier()` — exact match, no match, multiple matches, case insensitivity
- Unit tests for combined `matchCredentials()` — app ID priority over domain, deduplication by item ID
- Schema validation tests for `appIdentifiers` — valid reverse-DNS identifiers, invalid formats rejected, empty arrays, undefined
- Case normalization tests — uppercase input stored/matched as lowercase

### 5.2 iOS Credential Provider

- Unit tests for shared container storage read/write (shared Keychain + App Group SQLite)
- Unit tests for Swift vault access layer (decrypt, match, associate)
- Integration tests for auth gate logic (biometric DEK present → PIN data present → master password fallback)
- E2E: manual test protocol (iOS credential provider extensions cannot be reliably automated in CI)

### 5.3 Android Autofill Service

- Unit tests for `onFillRequest` matching logic (package name → appIdentifiers → webDomain → domain fallback)
- Unit tests for `onSaveRequest` credential extraction and in-memory handoff
- Mock adapter for `AutofillManager` to test service logic in isolation
- E2E: manual test protocol (Android autofill testing requires emulator with service enabled)

### 5.4 Deep-Linking & Association

- Test `keykeykey://item/add?appId=...&domain=...` correctly pre-populates the add screen
- Test association flow updates `appIdentifiers` on existing credentials
- Test that associated credentials match on subsequent autofill requests
- Test concurrent access: main app and extension reading/writing simultaneously (iOS WAL mode)

### 5.5 Manual Test Protocol

Documented for both platforms:

1. Install app on device/emulator
2. Enable KeyKeyKey as credential provider in system settings (iOS: Settings → Passwords → AutoFill Passwords; Android: Settings → Autofill service)
3. Open a third-party app (e.g., Slack) → tap login field → verify KeyKeyKey appears in autofill prompt
4. Test flows: fill existing credential, create new, search and associate
5. Test auth: vault locked requires master password; biometric/PIN when available
6. Test Android-only: `onSaveRequest` prompt after form submission
7. Test error cases: extension crash recovery, SQLite read failure, biometric → PIN → password fallback chain
