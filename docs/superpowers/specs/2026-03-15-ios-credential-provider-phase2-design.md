# iOS Credential Provider — Phase 2: Crypto Integration & Build Infrastructure

## Overview

Complete the iOS AutoFill Credential Provider extension by linking native crypto libraries (libsodium), creating a proper Xcode extension target (via `@bacons/apple-targets`), and implementing the vault access stubs (decrypt items, PIN unlock, credential matching). The extension will support biometric and PIN unlock only — master password unlock requires the main app due to iOS extension memory constraints.

## Scope

- **In scope:** Xcode extension target creation, libsodium integration, XChaCha20-Poly1305 decryption, Argon2id for PIN unlock, vault header deserialization, SQLite credential search, cross-platform compatibility test vectors
- **Out of scope:** Master password unlock in extension (memory risk with desktop Argon2 params), credential association/write from extension, encrypt operations, Android autofill (separate spec)

## 1. Dependencies & Build Infrastructure

### 1.1 Xcode Extension Target

Use `@bacons/apple-targets` (Evan Bacon's Expo plugin) to create a proper iOS extension target:

- Add as dev dependency in `apps/mobile`
- Configure in `app.json` to create a credential provider extension target
- Bundle ID: `com.keykeykey.app.credential-provider`
- The existing config plugin (`plugins/credential-provider/index.js`) continues to handle entitlements, Info.plist, and Swift file copying
- `@bacons/apple-targets` handles target creation, build settings, and framework linking

### 1.2 SPM Dependencies

Single SPM dependency linked to the extension target only (not the main app):

- **`jedisct1/swift-sodium`** — official Swift wrapper for libsodium. Provides both:
  - `crypto_aead_xchacha20poly1305_ietf_decrypt` (vault item decryption, DEK unwrap)
  - `crypto_pwhash` with `crypto_pwhash_ALG_ARGON2ID13` (PIN-based KEK derivation)

No separate Argon2 package needed — libsodium includes Argon2id natively.

## 2. Swift Crypto Layer

A thin Swift crypto module that matches the TypeScript `@noble/ciphers` binary format exactly. **Read/decrypt only** — no encrypt operations needed in the extension.

### 2.1 XChaCha20-Poly1305 Decrypt

Input format (from TypeScript `@noble/ciphers` `managedNonce` wrapper):
```
[24-byte nonce][ciphertext][16-byte Poly1305 tag]
```

Implementation:
- Extract nonce (first 24 bytes) and ciphertext+tag (remaining bytes)
- Call libsodium `crypto_aead_xchacha20poly1305_ietf_decrypt`
- Return decrypted plaintext
- Throw on authentication failure (wrong key or tampered data)

### 2.2 Argon2id Key Derivation (PIN only)

- Input: PIN string (UTF-8 encoded), salt (16 bytes), params (t, m, p, dkLen)
- Call libsodium `crypto_pwhash` with `crypto_pwhash_ALG_ARGON2ID13`
- Params mapping: `t` → opslimit, `m` (KiB) → memlimit (bytes = m * 1024)
- Output: 32-byte derived key
- PIN uses mobile preset: `t:2, m:19456 (19 MiB), p:1, dkLen:32`

**Parallelism limitation:** libsodium's `crypto_pwhash` does not expose the Argon2id `p` (parallelism) parameter — it always uses `p=1` internally. The PIN preset uses `p:1`, so this is compatible. The Swift wrapper **must** include a precondition check:

```swift
guard params.p == 1 else {
    throw CryptoError.unsupportedParallelism(
        "libsodium only supports p=1; vault uses p=\(params.p)"
    )
}
```

If a vault header or PIN data contains `p != 1`, the extension must fail with a clear error rather than producing incorrect derived keys. This cannot happen with the current PIN preset but guards against future parameter changes.

**Compatibility note:** Verify the opslimit/memlimit mapping produces identical output to `@noble/hashes/argon2` using the cross-platform test vectors (Section 4). libsodium maps `opslimit` to Argon2's `t` (time cost) and `memlimit` to `m * 1024` (memory in bytes). Confirm this 1:1 mapping with test vectors before shipping.

### 2.3 DEK Unwrap

- Input: wrapped DEK (72 bytes = 24 nonce + 32 encrypted DEK + 16 tag), KEK (32 bytes)
- Call XChaCha20-Poly1305 decrypt with KEK as key
- Output: 32-byte DEK
- Zero KEK after use

### 2.4 Vault Header Deserialization

Parse the binary format stored in Keychain (base64-encoded):

```
[1B version]
[16B masterSalt]
[16B recoverySalt]
[4B argon2.t LE][4B argon2.m LE][4B argon2.p LE][4B argon2.dkLen LE]
[2B masterWrappedDEK.length LE][...masterWrappedDEK bytes]
[2B recoveryWrappedDEK.length LE][...recoveryWrappedDEK bytes]
```

All multi-byte integers are little-endian. Return a Swift struct:

```swift
struct VaultHeader {
    let version: UInt8
    let masterSalt: Data          // 16 bytes
    let recoverySalt: Data        // 16 bytes
    let argon2Params: Argon2Params // t, m, p, dkLen
    let masterWrappedDEK: Data    // ~72 bytes
    let recoveryWrappedDEK: Data  // ~72 bytes
}
```

Only `masterSalt`, `argon2Params`, and `masterWrappedDEK` are used for master password unlock (out of scope for extension). PIN unlock uses separate salt/wrappedDEK from Keychain `pin_data`.

## 3. Vault Access Implementation

### 3.1 findCredentials

Fill the existing stub in `VaultAccess.swift`:

1. Open SQLite database at App Group container path (`group.com.keykeykey.shared/keykeykey.db`) — **read-only** using `sqlite3_open_v2` with `SQLITE_OPEN_READONLY` flag. This prevents accidental writes and avoids WAL journal creation by the extension (which could corrupt data if the main app writes simultaneously).
2. Query: `SELECT id, type, encrypted_data FROM vault_items WHERE type = 'credential'` (only credential type — card and secure note autofill are out of scope)

**Error handling:**
- Database not found → show "Set up your vault in KeyKeyKey first"
- Database open failure / corruption → show "Unable to read vault. Please open KeyKeyKey to repair."
- Empty vault (no credential rows) → show "No credentials stored"
3. For each row:
   - Base64-decode `encrypted_data`
   - XChaCha20-Poly1305 decrypt with DEK
   - JSON-parse the decrypted bytes into a credential struct
   - Extract `name`, `username`, `password`, `url`, `appIdentifiers`
4. Filter matches:
   - If `appIdentifier` provided: case-insensitive check if credential's `appIdentifiers` array contains it
   - If `domain` provided: basic domain extraction from credential's `url` (strip protocol, extract hostname, compare base domain). No `tldts` needed — a simple hostname comparison covers 95% of cases
5. Return `[MatchedCredential]`
6. Zero all decrypted data for non-matching credentials

### 3.2 handlePinUnlock

Fill the existing stub in `CredentialProviderViewController.swift`:

1. Read PIN data from Keychain (`pin_data` key) — JSON: `{ "wrappedDEK": "<base64>", "salt": "<base64>" }`
2. Base64-decode `salt` (16 bytes) and `wrappedDEK` (~72 bytes)
3. Argon2id derive KEK from PIN + salt using mobile preset (`t:2, m:19456, p:1, dkLen:32`)
4. XChaCha20-Poly1305 decrypt `wrappedDEK` with KEK → DEK (32 bytes)
5. On auth failure (wrong PIN → tag verification fails):
   - Show error message
   - Decrement attempt counter in shared Keychain
   - After 5 failed attempts: delete PIN data, fall back to "open main app" message
6. On success: store DEK in `self.dek`, call `showCredentialList()`
7. Zero KEK and intermediate buffers

### 3.3 handlePasswordUnlock

Keep the existing "Please open KeyKeyKey" alert. Master password unlock is not supported in the extension due to iOS extension memory constraints (~120MB limit). Desktop-created vaults use Argon2id with `m:65536` (64MB), leaving insufficient memory for the extension runtime.

### 3.4 associateAppIdentifier

Keep as stub. The "Search existing" flow requires decrypt→modify→re-encrypt→write, which is complex. Credential association is handled by the main app via the UserDefaults `pending_create_credential` flag.

### 3.5 Domain Matching (Simplified)

The extension uses a simplified domain comparison (no `tldts` dependency) that compares the **last two domain segments** (registrable domain) rather than a single segment:

```swift
func extractRegistrableDomain(_ urlString: String) -> String? {
    guard let url = URL(string: urlString),
          let host = url.host?.lowercased() else { return nil }
    let parts = host.split(separator: ".")
    guard parts.count >= 2 else { return host }
    // Return last two segments: e.g., "login.github.com" → "github.com"
    return parts.suffix(2).joined(separator: ".")
}
```

Matching compares the registrable domain of the credential's URL against the query domain's registrable domain (e.g., `github.com` == `github.com`). This prevents `evil-github.com` from matching `github.com` (which single-segment extraction would allow).

**Known limitation:** Multi-level TLDs (`.co.uk`, `.com.br`) will not match correctly — `bbc.co.uk` extracts as `co.uk` instead of `bbc.co.uk`. This is acceptable because:
1. App identifier matching is prioritized over domain matching
2. The main app's `matchCredentialsByDomain` with `tldts` is the authoritative matcher
3. Users in `.co.uk` regions can use the main app for those credentials

## 4. Cross-Platform Compatibility Testing

### 4.1 Test Vector File

Create `packages/core/src/crypto/__tests__/test-vectors.json` containing:

- **XChaCha20-Poly1305:** known plaintext + key → ciphertext (hex-encoded, with embedded nonce+tag)
- **DEK unwrap:** known wrappedDEK + KEK → unwrapped DEK
- **Argon2id PIN:** known PIN + salt + mobile preset params → derived key
- **Vault header:** known binary (hex) → expected parsed fields
- **Full credential:** known base64 encrypted_data + DEK → expected decrypted JSON

### 4.2 TypeScript Tests (Vitest)

Generate test vectors using **fixed, hardcoded inputs** (keys, nonces, salts, plaintexts) — not randomly generated. The vectors file is committed and serves as the cross-platform compatibility contract. The TypeScript test verifies that the current `@noble/ciphers` implementation produces these exact outputs.

### 4.3 Swift Tests (XCTest)

In the extension target's test scheme:
- Read the same `test-vectors.json` file
- Verify libsodium XChaCha20-Poly1305 decrypt matches expected output
- Verify Argon2id with PIN preset produces same derived key
- Verify vault header binary deserialization matches expected fields
- Verify full flow: base64 → decrypt → JSON parse → credential extraction

### 4.4 Manual Test Protocol

Extends the existing `autofill-testing.md`:
- Build app with extension target via `expo prebuild && xcodebuild`
- Install on simulator/device, enable in Settings → Passwords → AutoFill
- Biometric unlock → credential list populates with real vault items
- PIN unlock → correct PIN decrypts, shows credentials
- Wrong PIN → error, attempt counter decrements
- Master password → "open main app" message
- Desktop-created vault → extension reads vault header params correctly

## 5. Memory & Security Considerations

### 5.1 Extension Memory Budget (~120MB)

- libsodium: ~300KB binary
- Argon2id PIN derivation: ~19MB (mobile preset `m:19456`)
- SQLite + decrypted items: ~5-10MB for typical vault (200 items)
- SwiftUI runtime: ~20-30MB
- **Total: ~55MB** — well within the 120MB limit

Master password with desktop preset (`m:65536` = 64MB) would push to ~115MB — too close to the limit. This is why master password is excluded from the extension.

### 5.2 DEK Lifecycle

- DEK held in memory only for the duration of the autofill request
- Zeroed on dismiss (`viewDidDisappear`), cancel, and credential selection
- Best-effort zeroing via `Data.resetBytes` (Swift CoW limitation documented)

### 5.3 PIN Attempt Limiting

- 5 attempts max, then PIN data deleted
- User must re-enable PIN in the main app after lockout
- **Storage migration required:** The main app currently stores `pin_attempts` via `expo-secure-store` **without** the shared Keychain access group options (`savePinAttempts`/`loadPinAttempts` in `storage.ts` lines 70-81 do not pass `SHARED_KEYCHAIN_OPTIONS`). This means the attempt counter is in the app's private Keychain, invisible to the extension. Phase 2 must migrate `savePinAttempts`, `loadPinAttempts`, and `deletePinAttempts` to use `SHARED_KEYCHAIN_OPTIONS` so both the main app and extension share a single counter. Without this, an attacker could exhaust 5 attempts in the extension, then try 5 more in the main app.
