# KeyKeyKey

A cross-platform credential, secret, and card manager. Your credentials, your cloud, your keys.

## Features

- **Vault Management** — Store credentials (logins), payment cards, and secure notes in an encrypted vault
- **Password Generator** — Cryptographically secure random passwords and passphrases with entropy estimation and strength indicator
- **Password Import** — Migrate from Chrome, Firefox, Bitwarden, iCloud/Apple Passwords, and 1Password via CSV with auto-detection
- **BYOC Sync** — Bring Your Own Cloud — sync encrypted vaults across devices via your own WebDAV server with tombstone-based conflict resolution
- **Browser Extension** — Full vault management in Chrome, Firefox, and Safari with popup UI, PIN unlock, and auto-lock
- **Biometric Unlock** — FaceID, Touch ID, and fingerprint unlock on mobile
- **PIN Unlock** — Fast PIN-based unlock for the browser extension (Argon2id-derived, 5-attempt lockout)
- **Auto-Lock** — Configurable auto-lock (timed, on browser close, or never) across all platforms
- **Clipboard Security** — Auto-clear clipboard 30 seconds after copying sensitive data on all platforms
- **Domain Matching** — Auto-fill URL and credential name from the active browser tab
- **Cross-Platform** — One TypeScript core shared across 5 platforms
- **Password Export** — Export credentials to a standard CSV for portability _(planned)_
- **TOTP Authenticator** — Built-in 2FA code generation (RFC 6238) _(planned)_
- **Autofill** — System-level autofill on iOS/Android and browser extension form filling _(planned)_

## Architecture

KeyKeyKey is built as a **Turborepo** monorepo sharing a single TypeScript core across five platforms:

| Platform                | Technology                 | Location         |
| ----------------------- | -------------------------- | ---------------- |
| iOS & Android           | Expo (React Native)        | `apps/mobile`    |
| macOS, Windows, Linux   | Tauri (Rust + React)       | `apps/desktop`   |
| Chrome, Firefox, Safari | Vite + React (Manifest V3) | `apps/extension` |

Shared packages:

| Package           | Purpose                                              | Location        |
| ----------------- | ---------------------------------------------------- | --------------- |
| `@keykeykey/core` | Cryptography, data models, state, sync, domain utils | `packages/core` |
| `@keykeykey/ui`   | Design tokens and shared components                  | `packages/ui`   |

## Security Model

- **Envelope Encryption** — A random Data Encryption Key (DEK) encrypts all vault items. The DEK itself is encrypted with a Key Encryption Key (KEK) derived from your master password via **Argon2id**.
- **Cipher** — **XChaCha20-Poly1305** (via `@noble/ciphers`, audited pure TypeScript). Random 24-byte nonce per encryption.
- **Recovery** — DEK is also wrapped with a recovery key derivative for account recovery.
- **Zero Knowledge** — No unencrypted data ever leaves your device. BYOC sync means your encrypted blobs go to storage you control.
- **Hardened** — Auto-lock timeout, DEK zeroing on lock, clipboard auto-clear (30s), PIN attempt lockout (5 tries), HTTPS-enforced WebDAV sync.
- **Sync Security** — Tombstone-aware Last-Write-Wins conflict resolution with 30-day garbage collection. Items are encrypted before upload; sync adapters never see plaintext.

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- **Rust** (for Tauri desktop builds)
- **Xcode** (for iOS builds and Safari extension)
- **Android Studio** (for Android builds)

## Getting Started

```bash
# Install dependencies
pnpm install

# Run all apps in dev mode
pnpm dev

# Run all tests
pnpm test

# Build all packages and apps
pnpm build

# Format code
pnpm format

# Lint
pnpm lint
```

### Mobile (iOS)

```bash
cd apps/mobile
npx expo prebuild --platform ios
cd ios && pod install && cd ..
npx expo run:ios
```

### Desktop (Tauri)

```bash
cd apps/desktop
pnpm dev
```

### Browser Extension

See [`apps/extension/README.md`](./apps/extension/README.md) for detailed step-by-step instructions for Chrome, Firefox, and Safari.

```bash
# Build shared packages first
pnpm --filter @keykeykey/core --filter @keykeykey/ui build

# Build extension (produces dist-chrome/ and dist-firefox/)
pnpm --filter @keykeykey/extension build

# Load apps/extension/dist-chrome/ (Chrome) or apps/extension/dist-firefox/ (Firefox)
# as unpacked extension in your browser
```

## Project Structure

```
keykeykey/
  packages/
    core/              # Shared TypeScript core
      src/
        crypto/        # Argon2id KDF, XChaCha20-Poly1305, vault header, recovery
        models/        # Zod schemas (Credential, Card, SecureNote)
        store/         # Zustand vault store (DEK lifecycle, encrypt/decrypt)
        sync/          # SyncEngine, WebDAV adapter, tombstones
        import/        # CSV import pipeline (5 source parsers)
        generator/     # Password/passphrase generator with entropy estimation
        domain/        # URL domain extraction and credential matching
    ui/                # Design tokens (colors, spacing, typography, radii)
  apps/
    mobile/            # Expo React Native (iOS + Android)
    desktop/           # Tauri desktop (macOS, Windows, Linux)
    extension/         # Browser extension (Chrome, Firefox, Safari)
```

## Testing

**567 tests** across 52 test files:

| Scope             | Framework | Tests | Test Files | Coverage                                               |
| ----------------- | --------- | ----- | ---------- | ------------------------------------------------------ |
| Core              | Vitest    | 378   | 27         | Crypto, models, store, sync, import, domain, generator |
| Browser Extension | Vitest    | 83    | 9          | Background worker, storage, auto-lock, PIN, screens    |
| Desktop           | Vitest    | 36    | 6          | Screens, components, vault context                     |
| Mobile            | Jest      | 70    | 10         | Screens, components, navigation, vault context         |

CI runs **10 parallel jobs** on every push and PR:

| Job                            | What it checks                               |
| ------------------------------ | -------------------------------------------- |
| Lint, Format & Secret Scan     | ESLint, Prettier, gitleaks                   |
| SAST (Semgrep)                 | Static analysis for security vulnerabilities |
| Security Audit & License Check | `pnpm audit`, license compliance             |
| Crypto Benchmarks              | Argon2id and XChaCha20 performance           |
| Test Core Package              | `vitest run` on `packages/core`              |
| Test UI Package                | `vitest run` on `packages/ui`                |
| Test Mobile App                | `jest` on `apps/mobile`                      |
| Test Desktop App               | `vitest run` on `apps/desktop`               |
| Test Extension                 | `vitest run` on `apps/extension`             |
| Build All                      | `turbo build` — all packages and apps        |

## Cloud Sync

Sync your encrypted vault across devices using your own cloud storage:

| Provider | Platforms            | Auth       |
| -------- | -------------------- | ---------- |
| WebDAV   | All (HTTPS enforced) | Basic Auth |

Sync uses a per-item file layout with a manifest. Conflict resolution is Last-Write-Wins per item using timestamps. Deleted items are tracked as tombstones with 30-day garbage collection.

## Password Import

Import from any of these password managers via CSV:

| Source         | Format                                |
| -------------- | ------------------------------------- |
| Chrome         | `name,url,username,password,note`     |
| Firefox        | Quoted fields with timestamps         |
| Bitwarden      | Type-filtered, preserves folders/TOTP |
| iCloud / Apple | Preserves OTPAuth URIs                |
| 1Password      | Headerless positional columns         |

Auto-detection identifies the source from CSV headers.

## Roadmap

See [implementationplan.md](./implementationplan.md) for the full specification:

- **§9** — Autofill (iOS Credential Provider, Android Autofill Framework, browser extension content scripts)
- **§12** — CSV Export for data portability
- **§13** — TOTP Authenticator (RFC 6238, QR scanner, dedicated authenticator view)

## License

TBD
