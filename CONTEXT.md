# Domain Glossary

Project-specific vocabulary used in code, tests, and architecture discussion.
Terms here are referenced when designing seams (see `CLEANUP.md` and
`~/.claude/skills/improve-codebase-architecture/LANGUAGE.md`). Add an entry
when a refactor names a deepened module after a concept that wasn't defined
yet — keep the definition short.

---

## Vault

### DEK — Data Encryption Key

The 32-byte symmetric key (XChaCha20-Poly1305) that encrypts every vault
item. The DEK is held in core's `dek-holder.ts` as a closure variable when
the vault is unlocked, never in serialised state. `lock()` zeroes the
buffer.

### KEK — Key Encryption Key

Argon2id-derived from the master password. Wraps the DEK at rest. Caller
never sees the KEK directly.

### MEK — Master Encryption Key

Sync-side analogue of the KEK: Argon2id-derived from the master password
plus a sync salt, used only to encrypt the sync config blob and (in some
flows) per-item ciphertext for cross-device parity.

### Vault Header

The fixed-shape struct on disk that holds the wrapped DEK, Argon2id
parameters, recovery wrapping, and version. Vault items are stored
separately, encrypted with the DEK.

### Recovery Key

A separate KDF input that wraps a duplicate DEK envelope, so the user can
unlock a vault even if they forget the master password.

---

## Biometric Unlock

### BiometricDEKProtector

The cross-platform _module_ that protects the DEK behind the OS biometric
gate. Owns the JSON+base64 envelope, the 14-day age policy, the
auto-clear-and-invalidate handshake, and the mapping from
`LoadBytesResult` → `BiometricResult`. Constructed via
`createBiometricAdapter(store)` in `packages/core/src/biometric/`.

### OSBiometricStore

The platform-specific seam: read/write opaque bytes to a biometric-gated
location, with the OS-level disposition surfaced as a discriminated
`LoadBytesResult` (`ok` / `absent` / `cancelled` / `invalidated` /
`error`). Each platform (mobile via expo-secure-store + iOS Keychain ACL,
desktop via Tauri + macOS Keychain Touch ID) implements this interface;
the cross-platform invariants live in `BiometricDEKProtector`, not here.

### DEK fingerprint (mobile)

A SHA-256 truncation of the DEK bytes, written to a NON-protected sibling
key in the iOS Keychain. Used for silent identity checks during a
master-password unlock reconcile, since reading the biometric-gated DEK
item directly would trigger a Face ID prompt. Fingerprints are not
secrets.

---

## Sync

### PlatformStorage

The narrow sync-state contract (`packages/core/src/sync/lifecycle/`):
vault header, encrypted items, sync config blob, vault-setup flag.
Conformance-tested across all three apps. Non-sync state (PIN data,
biometric DEK, settings) is stored per-platform with no shared seam.

### Sync Adapter

A concrete cloud-storage backend (currently WebDAV) implementing
`ISyncAdapter`. Blob-style cloud adapters extend
`TemplateHttpAdapter` (4 primitives: download/upload/delete/list);
WebDAV extends `BaseHttpAdapter` directly because PROPFIND/MKCOL doesn't
fit the blob-template shape.

### Provider

User-facing name for a sync adapter. The `SyncProvider` discriminator on
`SyncConfig` controls which adapter is constructed.

---

## Apps

The five platforms (iOS, Android, macOS, Windows, Linux, Chrome, Firefox,
Safari) ship from three apps:

- `@keykeykey/mobile` — Expo (iOS + Android)
- `@keykeykey/desktop` — Tauri 2 (macOS / Windows / Linux)
- `@keykeykey/extension` — Manifest V3 (Chrome / Firefox / Safari)

All three consume `@keykeykey/core` and `@keykeykey/ui`.
