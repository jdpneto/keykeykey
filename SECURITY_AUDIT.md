# Security Audit Report — keykeykey

**Date:** 2026-03-05
**Scope:** Full codebase (`packages/core`, `packages/ui`, `apps/mobile`)
**Auditor:** Automated analysis + manual review

---

## Executive Summary

keykeykey is an offline-first password manager built with a strong cryptographic foundation. The core cryptography uses well-audited libraries (Noble hashes/ciphers) with correct algorithm choices (Argon2id, XChaCha20-Poly1305, envelope encryption). Several security hardening improvements were identified and implemented during this audit.

**Overall Assessment:** Solid foundation with appropriate algorithm choices. The fixes applied during this audit address the most critical gaps.

---

## Architecture Review

### Cryptographic Design (packages/core)

| Component         | Implementation                             | Assessment                                                                                      |
| ----------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| KDF               | Argon2id via `@noble/hashes`               | Correct. RFC 9106 compliant. Mobile preset (t=2, m=19MB, p=1) is reasonable for mobile devices. |
| Encryption        | XChaCha20-Poly1305 via `@noble/ciphers`    | Correct. 24-byte nonce eliminates nonce reuse risk. AEAD provides integrity.                    |
| Key Wrapping      | XChaCha20-Poly1305 wrap/unwrap of DEK      | Correct envelope encryption pattern. DEK encrypted by KEK derived from password.                |
| DEK Management    | Closure variable in Zustand store          | Good. DEK never enters serializable state. Zeroed on lock via `.fill(0)`.                       |
| Recovery Key      | 128-bit random, formatted as base32 groups | Correct. Separate salt/KEK for recovery path.                                                   |
| Random Generation | `crypto.getRandomValues()`                 | Correct CSPRNG usage throughout.                                                                |

### Data Storage (apps/mobile)

| Component       | Implementation                                       | Assessment                                               |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Vault Header    | expo-secure-store (iOS Keychain / Android Keystore)  | Correct. Hardware-backed storage for sensitive metadata. |
| Biometric DEK   | expo-secure-store with `requireAuthentication: true` | Correct. Requires biometric auth before read.            |
| Encrypted Items | expo-sqlite with parameterized queries               | Correct. SQL injection prevented via `?` placeholders.   |
| Setup Flag      | expo-secure-store                                    | Acceptable. Boolean flag, not sensitive.                 |

---

## Issues Found & Remediation

### Critical — Fixed

#### 1. No Auto-Lock on App Background

**Risk:** Vault remains unlocked indefinitely if user switches apps.
**Location:** `apps/mobile/lib/vault-context.tsx`
**Fix Applied:** Added `AppState` listener that locks vault after 5 minutes of background time. The lock zeroes the DEK and clears all decrypted items from memory.

#### 2. Corrupted Item Crashes Entire Vault

**Risk:** A single corrupted encrypted item would crash `decryptItems()` via unhandled `JSON.parse` or Zod validation error, preventing access to all vault items.
**Location:** `packages/core/src/store/vault-store.ts:decryptItems()`
**Fix Applied:** Wrapped each item's decrypt/parse in try-catch. Corrupted items are skipped with a warning instead of crashing the vault.

#### 3. Password Bytes Not Zeroed After KDF

**Risk:** UTF-8 encoded password bytes remained in memory after Argon2id derivation.
**Location:** `packages/core/src/crypto/kdf.ts:deriveKEK()`
**Fix Applied:** Added `finally` block that zeros `passwordBytes` after use.

### High — Fixed

#### 4. Base64 Decoding Without Validation

**Risk:** Invalid base64 strings from corrupted storage would throw unhandled `atob()` errors.
**Location:** `apps/mobile/lib/vault-context.tsx:fromBase64()`
**Fix Applied:** Added input type checking, null/empty validation, and try-catch around `atob()`.

#### 5. Unbounded Search Query Length

**Risk:** Extremely long search strings could cause performance degradation.
**Location:** `packages/core/src/store/vault-store.ts:search()`
**Fix Applied:** Search query truncated to 256 characters before processing.

### Medium — Noted (Not Yet Addressed)

#### 6. SQLite Database Not Encrypted at Rest

**Risk:** If device filesystem is compromised, encrypted items' ciphertext (and metadata like type, timestamps) is readable from the SQLite database.
**Mitigation:** Items are individually encrypted with XChaCha20-Poly1305. An attacker gains only item count and timestamps, not content.
**Recommendation:** Consider `sqlcipher` or `expo-sqlite` encryption extension for defense-in-depth.

#### 7. No Rate Limiting on Unlock Attempts

**Risk:** An attacker with physical device access can brute-force the master password.
**Mitigation:** Argon2id with m=19MB makes each attempt expensive (~300ms on mobile).
**Recommendation:** Add exponential backoff after failed attempts (e.g., 5 failures = 30s lockout).

#### 8. Clipboard Not Auto-Cleared

**Risk:** Copied passwords/card numbers remain in system clipboard indefinitely.
**Location:** `apps/mobile/app/item/[id].tsx`, `apps/mobile/app/(tabs)/generator.tsx`
**Recommendation:** Auto-clear clipboard after 30-60 seconds using `setTimeout` + `Clipboard.setStringAsync('')`.

#### 9. No Memory Protection for JavaScript Strings

**Risk:** JavaScript strings are immutable — password strings cannot be zeroed from memory.
**Mitigation:** This is an inherent limitation of the JS runtime. The DEK (Uint8Array) is properly zeroed. Password strings exist only transiently during the unlock flow.
**Recommendation:** Accept this as a platform limitation. Document it for users.

#### 10. Card Number Input Validation

**Risk:** No Luhn algorithm check or format validation for credit card numbers.
**Location:** `apps/mobile/app/item/add.tsx`
**Recommendation:** Add client-side Luhn validation and card number length checks.

---

## Positive Findings

1. **Envelope encryption (DEK/KEK)** is correctly implemented. Password changes only re-wrap the DEK, not re-encrypt all items.
2. **DEK zeroing on lock** properly fills the Uint8Array with zeros and nullifies the reference.
3. **Parameterized SQL queries** in all SQLite operations prevent SQL injection.
4. **Separate recovery key salt** prevents attacks that compromise master password from also compromising recovery path.
5. **No plaintext secrets in state** — the Zustand store never serializes the DEK.
6. **24-byte nonces** (XChaCha20) virtually eliminate nonce collision risk.
7. **Zod schema validation** on decrypted items ensures type safety at the trust boundary.
8. **SecureStore with biometric auth** uses hardware-backed keystores (iOS Keychain / Android Keystore).

---

## Test Coverage

| Package         | Test Files | Tests | Status      |
| --------------- | ---------- | ----- | ----------- |
| `packages/core` | 10         | 145   | All passing |
| `apps/mobile`   | 10         | 70    | All passing |

### Mobile Test Coverage Areas

- Storage layer (SecureStore + SQLite CRUD, biometric auth, parameterized queries)
- Theme system (light/dark mapping, token consistency)
- Vault context (initialization flow, setup, unlock, lock, add/remove items)
- UI components (Button, TextInput, ItemCard, EmptyState)
- Screens (setup validation, unlock flow, generator CSPRNG, settings)

---

## Recommendations Priority

| Priority | Item                               | Effort |
| -------- | ---------------------------------- | ------ |
| High     | Add unlock attempt rate limiting   | Low    |
| High     | Auto-clear clipboard after timeout | Low    |
| Medium   | Encrypt SQLite at rest (sqlcipher) | Medium |
| Medium   | Luhn validation for card numbers   | Low    |
| Low      | Expiration date range validation   | Low    |
| Low      | Add integrity HMAC to stored items | Medium |
