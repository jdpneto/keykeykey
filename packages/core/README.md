# @keykeykey/core

Shared core library for KeyKeyKey. Contains all platform-agnostic logic that runs in Node.js, browsers, and React Native.

## Modules

### `crypto`

Cryptographic primitives for vault encryption.

- **Key Derivation**: Argon2id via platform-pluggable `Argon2Adapter` (defaults to `@noble/hashes` JS fallback; mobile/desktop can inject native implementations via `setArgon2Adapter()`)
- **Symmetric Encryption**: XChaCha20-Poly1305 (via `@noble/ciphers`)
- **Envelope Encryption**: DEK/KEK pattern with master password and recovery key support
- **Async KDF**: All vault operations (`createVaultHeader`, `unlockVault`, etc.) are async to support native KDF implementations that run off the JS thread

### `models`

Zod schemas for all vault data types:

- `Credential` — website logins (URL, username, password, TOTP)
- `Card` — payment cards
- `SecureNote` — encrypted freeform text
- `VaultItem` — discriminated union of all item types
- `Vault` — the top-level encrypted container

### `store`

Zustand state management shared across React and React Native platforms.

### `sync`

BYOC (Bring Your Own Cloud) synchronization:

- `ISyncAdapter` interface
- Local filesystem adapter
- WebDAV adapter
- Conflict resolution (Last-Write-Wins per item)

## Development

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage (100% required for crypto/)
pnpm test:coverage

# Build
pnpm build

# Watch mode
pnpm dev
```

## Testing Philosophy

Crypto modules require 100% statement coverage. All cryptographic functions are verified against official IETF test vectors (RFC 7539, RFC 9106). Property-based tests via `fast-check` ensure encrypt/decrypt round-trip correctness and tamper detection.
