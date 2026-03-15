# Android Autofill Service — Phase 2: Vault Integration & Credential Fill/Save

## Overview

Complete the Android AutofillService by adding native vault access via lazysodium (libsodium JNI), implementing credential fill and save flows, and supporting all three unlock methods (biometric, PIN, master password). The service runs in the same app process as the React Native app, so it accesses the SQLite database and Android Keystore directly — no cross-process sharing needed.

## Scope

- **In scope:** lazysodium integration, Kotlin crypto bridge, vault header parsing, `onFillRequest` with credential matching, `onSaveRequest` with Kotlin-side handoff, biometric/PIN/master password auth Activity, cross-platform test vectors verification, `SaveInfo` configuration
- **Out of scope:** iOS credential provider (separate spec, already implemented), credit card autofill, passkey/WebAuthn

## 1. Dependencies & Crypto Layer

### 1.1 lazysodium-android

Add `com.goterl:lazysodium-android` as a dependency to the Android app via the Expo config plugin (`build.gradle` modification). This provides JNI bindings to libsodium — the same C library used by the iOS extension via `swift-sodium`.

### 1.2 Kotlin Crypto Bridge

Mirrors the Swift `CryptoBridge` from the iOS extension. All operations are decrypt/derive only — no encrypt.

**XChaCha20-Poly1305 decrypt:**

- Input format: `[24-byte nonce][ciphertext][16-byte Poly1305 tag]` (same as TypeScript `@noble/ciphers` managed nonce)
- Strip nonce (first 24 bytes), pass remaining bytes to `crypto_aead_xchacha20poly1305_ietf_decrypt`
- Return decrypted plaintext
- Throw on authentication failure

**Argon2id key derivation:**

- Call `crypto_pwhash` with `crypto_pwhash_ALG_ARGON2ID13`
- Params mapping: `t` → opslimit, `m * 1024` → memlimit (KiB to bytes)
- `p=1` guard (libsodium limitation) — same as iOS
- The service always reads Argon2 params from the vault header or PIN data — never hardcodes them. The header may contain desktop preset (`m:65536` = 64MB) which is supported since Android has no memory constraint for autofill services.
- Zero password bytes after derivation

**DEK unwrap:**

- XChaCha20-Poly1305 decrypt wrappedDEK (72 bytes) with KEK (32 bytes)
- Return 32-byte DEK

### 1.3 Vault Header Parser

Parse the binary vault header format (identical to iOS `VaultHeaderParser`):

```
[1B version][16B masterSalt][16B recoverySalt]
[4B t LE][4B m LE][4B p LE][4B dkLen LE]
[2B masterWrappedDEK.length LE][...masterWrappedDEK]
[2B recoveryWrappedDEK.length LE][...recoveryWrappedDEK]
```

All multi-byte integers little-endian. Version must be 1.

### 1.4 Cross-Platform Verification

Use the existing `packages/core/src/crypto/__tests__/test-vectors.json` to verify the Kotlin crypto produces identical results. Add JVM unit tests using `lazysodium-java` (JVM variant, no Android device required) that:

- Decrypt XChaCha20-Poly1305 ciphertext → expected plaintext
- Unwrap DEK with KEK → expected DEK
- Derive key from PIN via Argon2id → expected derivedKey
- Parse vault header binary → expected fields
- Decrypt full credential (`fullCredential` vector) → expected JSON with all fields validated

### 1.5 Memory Hygiene

Kotlin/JVM does not guarantee memory zeroing due to GC object relocation. Use `Arrays.fill(byteArray, 0)` as defense-in-depth for all sensitive byte arrays:

- DEK bytes after the `FillResponse` is built and returned
- KEK bytes immediately after unwrapping the DEK
- Decrypted credential JSON bytes after extracting username/password
- Password bytes after Argon2id derivation (in `deriveKEK`)
- Intermediate byte arrays from base64 decoding

This matches the iOS approach (Swift `Data.resetBytes`) with the same documented limitation: the JVM may retain copies due to GC.

## 2. Vault Access & Authentication

### 2.1 Database Access

Read the SQLite database directly from Kotlin using `SQLiteDatabase.openDatabase()` with `OPEN_READONLY`. The database is at the app-private path (no App Group needed — same process).

**Path resolution:** `expo-sqlite` on Android places databases in the app's standard database directory. The exact path must be verified by inspecting `expo-sqlite`'s source. Typically: `context.getDatabasePath("keykeykey.db").path` or `context.filesDir.resolve("SQLite/keykeykey.db").path`. Log the path from the TypeScript side during development to confirm: add a temporary `console.log(FileSystem.documentDirectory)` in `storage.ts`.

Query: `SELECT id, type, encrypted_data FROM vault_items WHERE type = 'credential'`

### 2.2 expo-secure-store Storage Access

`expo-secure-store` on Android uses `EncryptedSharedPreferences` from AndroidX Security, backed by Android Keystore with AES-256-GCM encryption. The Kotlin service must read values using the same encryption setup.

**Initialization:**

```kotlin
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()

val sharedPreferences = EncryptedSharedPreferences.create(
    context,
    "SecureStore",  // Verify: expo-secure-store's SharedPreferences file name
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)
```

**Important:** The `SharedPreferences` file name (`"SecureStore"` above) and encryption schemes must be verified against the expo-secure-store source for the installed SDK version. Inspect `node_modules/expo-secure-store/android/src/main/java/expo/modules/securestore/SecureStoreModule.kt` to confirm. If the names or schemes don't match, values will be unreadable.

**Storage keys** (must match TypeScript constants exactly):

| Key             | Contents                | Format                                                                                                                                                                                  |
| --------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vault_header`  | Serialized vault header | Base64-encoded binary                                                                                                                                                                   |
| `biometric_dek` | Cached DEK + timestamp  | JSON: `{ "dek": "<base64>", "savedAt": "<ISO8601>" }`                                                                                                                                   |
| `pin_data`      | PIN-wrapped DEK + salt  | JSON: `{ "wrappedDEK": "<base64>", "salt": "<base64>" }`                                                                                                                                |
| `pin_attempts`  | Remaining PIN attempts  | String integer (e.g., `"5"`). Not a secret — plain SharedPreferences is acceptable, but stored in EncryptedSharedPreferences for consistency with the existing expo-secure-store usage. |

### 2.3 Authentication Flow

All three unlock methods supported (no memory constraint on Android):

**Biometric:**

1. Read `biometric_dek` from EncryptedSharedPreferences
2. Parse JSON, check 14-day expiry
3. On Android, `expo-secure-store` with `requireAuthentication: true` uses Android Keystore with `setUserAuthenticationRequired(true)`. The key is bound to biometric auth at the Keystore level. To read the value from Kotlin:
   - Create a `BiometricPrompt` with a `CryptoObject` wrapping the Keystore `Cipher` used for decryption
   - On biometric success, the `CryptoObject` becomes usable and the value can be decrypted
   - Alternatively, if expo-secure-store handles the biometric prompt internally when the value is accessed, the service can call through expo-secure-store's API (same process) rather than re-implementing the Keystore CryptoObject flow
4. Parse DEK from the decrypted JSON, return DEK

**PIN:**

1. Read `pin_data` from EncryptedSharedPreferences (JSON with wrappedDEK + salt) — this does NOT require biometric auth
2. Read `pin_attempts` — check remaining > 0
3. Launch auth Activity with PIN pad
4. Derive KEK via Argon2id using params from the PIN preset. Note: PIN always uses the `pin` preset (`t:2, m:19456, p:1, dkLen:32`) — the params are implicit, not stored in `pin_data`. If the preset changes in the future, store params alongside the wrapped DEK.
5. Unwrap DEK from wrappedDEK
6. On failure: decrement attempts, lockout after 5 failures, delete PIN data
7. On success: reset attempts to 5, return DEK

**Master password:**

1. Read `vault_header` from EncryptedSharedPreferences — does NOT require biometric auth
2. Base64-decode, parse binary vault header (extract `masterSalt`, `argon2Params`, `masterWrappedDEK`)
3. Launch auth Activity with password input + "Deriving key..." progress
4. Derive KEK via Argon2id using header's `masterSalt` and `argon2Params` (NOT hardcoded — uses whatever params the vault was created with)
5. Unwrap DEK from `masterWrappedDEK`
6. On failure: show "Incorrect password" error
7. On success: return DEK

### 2.4 Auth UI

Launch a themed Activity for authentication prompts:

- Biometric: use `BiometricPrompt` system dialog (no custom UI needed)
- PIN: simple PIN pad layout
- Master password: password input field with progress indicator during KDF

**Activity ↔ Service communication:** Use a `CompletableDeferred<ByteArray>` (Kotlin coroutines) held in a companion object. The service sets up the deferred before launching the Activity, the Activity completes it with the DEK, and the service awaits it. This avoids `startActivityForResult` complexity while staying same-process.

### 2.5 DEK Caching

Hold the DEK in a singleton (`AutofillDEKCache`). Clear when:

- The vault locks (auto-lock timeout — 5 minutes of backgrounding)
- The app process is killed (automatic — in-memory only)
- The user explicitly locks the vault from the main app

This avoids re-authenticating for every autofill request within the same session.

### 2.6 Cancellation Handling

Register a `CancellationSignal.OnCancelListener` in `onFillRequest`. If the system cancels the request (e.g., user navigates away), dismiss the auth Activity and call `callback.onSuccess(null)`.

## 3. Fill & Save Flows

### 3.1 onFillRequest

1. Receive `FillRequest` — existing code already parses `AssistStructure` for username/password fields, webDomain, and packageName
2. Check if DEK is cached in `AutofillDEKCache`
3. If no DEK → launch auth Activity, await `CompletableDeferred<ByteArray>`
4. Read all credential rows from SQLite, base64-decode, decrypt with DEK
5. Match credentials:
   - By `appIdentifiers` (package name, case-insensitive) — priority
   - By domain (`webDomain` from AssistStructure vs credential's URL, last-two-segment comparison) — fallback
6. Build `FillResponse`:
   - One `Dataset` per matching credential
   - Presentation: `RemoteViews` showing credential name + username
   - Values: `AutofillValue.forText(username)` and `AutofillValue.forText(password)`
   - Include `SaveInfo` with `SaveInfo.SAVE_DATA_TYPE_USERNAME | SaveInfo.SAVE_DATA_TYPE_PASSWORD` and the detected field IDs — this tells Android to trigger `onSaveRequest` after form submission
7. Return `FillResponse` via callback
8. If no matches: return `null` (no suggestions shown, but still include `SaveInfo` to enable save-on-submit)

**Concurrency:** `onFillRequest` runs on a binder thread. Use `CoroutineScope(Dispatchers.IO)` for database reads and crypto operations. Call `callback.onSuccess(response)` from the coroutine. Never use `Dispatchers.Main` for crypto work.

### 3.2 onSaveRequest

1. Receive `SaveRequest` after successful form submission
2. Parse `AssistStructure` to extract filled username and password values from the saved nodes
3. Extract package name and webDomain

**Handoff mechanism:** Use a **Kotlin-side singleton** (`AutofillSaveData`) instead of the TypeScript `AutofillHandoff` singleton. This avoids depending on the React Native bridge being initialized.

```kotlin
object AutofillSaveData {
    data class PendingCredential(
        val username: String,
        val password: String,
        val packageName: String,
        val domain: String?
    )

    private var pending: PendingCredential? = null

    fun setPending(credential: PendingCredential) { pending = credential }
    fun consume(): PendingCredential? { val r = pending; pending = null; return r }
    fun clear() { pending = null }
}
```

4. Store via `AutofillSaveData.setPending()`
5. Launch the main app's Activity (intent to the add screen route)
6. The TypeScript add screen checks `AutofillSaveData` via a React Native native module on mount, falling back to `AutofillHandoff.consume()` for deep-link initiated flows

### 3.3 Domain Matching

Same logic as iOS — last-two-segment hostname comparison. Use `android.net.Uri.parse()` instead of `java.net.URI` for more lenient URL parsing (handles spaces, special characters):

```kotlin
fun extractRegistrableDomain(urlString: String): String? {
    val normalized = if ("://" in urlString) urlString else "https://$urlString"
    val host = android.net.Uri.parse(normalized).host?.lowercase() ?: return null
    val parts = host.split(".")
    return if (parts.size >= 2) parts.takeLast(2).joinToString(".") else host
}
```

Note: bare domains (from AssistStructure's `webDomain`) are normalized with `https://` prefix before parsing, matching the iOS `DomainMatcher` behavior.

Same known limitation with multi-level TLDs (`.co.uk`).

## 4. Testing Strategy

### 4.1 Kotlin JVM Unit Tests

Using `lazysodium-java` (JVM variant, no emulator required):

- XChaCha20-Poly1305 decrypt against `test-vectors.json` ciphertext
- DEK unwrap against stored wrappedDEK vector
- Argon2id PIN derivation against stored derivedKey vector
- Vault header binary deserialization against stored header vector
- Full credential decrypt → JSON parse → field extraction (`fullCredential` vector)
- Domain matching: exact match, subdomain match, no match, bare domain normalization
- `AutofillSaveData` singleton: set/consume/clear lifecycle

### 4.2 Android Instrumented Tests

Require emulator:

- `EncryptedSharedPreferences` read matches expo-secure-store format
- `BiometricPrompt` / CryptoObject integration
- Full `onFillRequest` → auth → `FillResponse` construction
- `onSaveRequest` → credential extraction → `AutofillSaveData.setPending()`

### 4.3 Manual Test Protocol

Extends `autofill-testing.md`:

1. Enable KeyKeyKey as autofill service (Settings → System → Autofill service)
2. Open Chrome → login page → verify KeyKeyKey suggestion appears
3. Select credential → verify fields fill correctly
4. Test all three auth flows (biometric, PIN, master password)
5. Login with new credentials on a site → verify "Save to KeyKeyKey?" prompt → add screen opens pre-populated
6. Native app autofill (Slack, etc.) → match by package name
7. Wrong PIN → error + attempt counter
8. 5 wrong PINs → lockout message, PIN disabled
9. Navigate away during auth → verify cancellation cleans up
