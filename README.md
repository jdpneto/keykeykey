# KeyKeyKey

A cross-platform credential, secret, and card manager. Your credentials, your cloud, your keys.

## Features

- **Vault Management** — Store credentials (logins), payment cards, and secure notes in an encrypted vault
- **Password Import** — Migrate from Chrome, Firefox, Bitwarden, iCloud/Apple Passwords, and 1Password via CSV with auto-detection
- **Password Export** — Export credentials to a standard CSV for portability _(planned)_
- **Password Generator** — Cryptographically secure random passwords and passphrases with entropy estimation _(planned)_
- **TOTP Authenticator** — Built-in 2FA code generation (RFC 6238), replacing apps like Authy or Google Authenticator _(planned)_
- **Autofill** — System-level autofill on iOS/Android and browser extension form filling _(planned)_
- **Biometric Unlock** — FaceID, Touch ID, and fingerprint unlock on mobile
- **BYOC Sync** — Bring Your Own Cloud — sync encrypted blobs to storage you control (WebDAV, Google Drive, local filesystem)
- **Cross-Platform** — One TypeScript core shared across 5 platforms

## Architecture

KeyKeyKey is built as a **Turborepo** monorepo sharing a single TypeScript core across five platforms:

| Platform                | Technology                 | Location         |
| ----------------------- | -------------------------- | ---------------- |
| iOS & Android           | Expo (React Native)        | `apps/mobile`    |
| macOS, Windows, Linux   | Tauri (Rust + React)       | `apps/desktop`   |
| Chrome, Firefox, Safari | Vite + React (Manifest V3) | `apps/extension` |

Shared packages:

| Package           | Purpose                                        | Location        |
| ----------------- | ---------------------------------------------- | --------------- |
| `@keykeykey/core` | Cryptography, data models, state, sync, import | `packages/core` |
| `@keykeykey/ui`   | Design tokens and shared components            | `packages/ui`   |

## Security Model

- **Envelope Encryption** — A random Data Encryption Key (DEK) encrypts all vault items. The DEK itself is encrypted with a Key Encryption Key (KEK) derived from your master password via **Argon2id**.
- **Cipher** — **XChaCha20-Poly1305** (via `@noble/ciphers`, audited pure TypeScript).
- **Recovery** — DEK is also wrapped with a recovery key derivative for account recovery.
- **Zero Knowledge** — No unencrypted data ever leaves your device. BYOC sync means your encrypted blobs go to storage you control.
- **Hardened** — Auto-lock timeout, password byte zeroing after use, Base64 input validation, clipboard auto-clear.

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- **Rust** (for Tauri desktop builds)
- **Xcode** (for iOS builds)
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

```bash
cd apps/extension
pnpm dev
# Load dist/ as unpacked extension in Chrome
```

## Project Structure

```
keykeykey/
  packages/
    core/              # Shared TypeScript core
      src/
        crypto/        # Argon2id KDF, XChaCha20-Poly1305, vault header
        models/        # Zod schemas (Credential, Card, SecureNote)
        store/         # Zustand vault store
        sync/          # Sync adapters and conflict resolution
        import/        # CSV import pipeline (5 source parsers)
    ui/                # Design tokens and shared components
  apps/
    mobile/            # Expo React Native (iOS + Android)
    desktop/           # Tauri desktop (macOS, Windows, Linux)
    extension/         # Browser extension (Chrome, Firefox, Safari)
```

## Testing

**301 tests** across 27 test files:

| Scope         | Framework | Tests | Coverage                                                  |
| ------------- | --------- | ----- | --------------------------------------------------------- |
| Core (crypto) | Vitest    | 231   | Cryptography, models, store, sync, import (17 test files) |
| Mobile        | Jest      | 70    | Screens, components, navigation, vault context (10 files) |

CI runs **10 parallel jobs** on every push:

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

## Password Import

Import from any of these password managers via CSV:

| Source         | Format                                |
| -------------- | ------------------------------------- |
| Chrome         | `name,url,username,password,note`     |
| Firefox        | Quoted fields with timestamps         |
| Bitwarden      | Type-filtered, preserves folders/TOTP |
| iCloud / Apple | Preserves OTPAuth URIs                |
| 1Password      | Headerless positional columns         |

Auto-detection identifies the source from CSV headers. See the [implementation plan](./implementationplan.md#8-password-import-system-packagescoreimport) for details.

## Roadmap

See [implementationplan.md](./implementationplan.md) for the full specification:

- **§9** — Autofill (iOS Credential Provider, Android Autofill Framework, browser extension)
- **§10** — Password Generator (random + passphrase with entropy display)
- **§11** — Notes field surfacing across all platforms
- **§12** — CSV Export for data portability
- **§13** — TOTP Authenticator (RFC 6238, QR scanner, dedicated authenticator view)

## License

TBD
