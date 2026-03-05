# KeyKeyKey

A cross-platform credential, secret, and card manager. Your credentials, your cloud, your keys.

## Architecture

KeyKeyKey is built as a Turborepo monorepo sharing a single TypeScript core across five platforms:

| Platform                | Technology                 | Location         |
| ----------------------- | -------------------------- | ---------------- |
| iOS & Android           | Expo (React Native)        | `apps/mobile`    |
| macOS, Windows, Linux   | Tauri (Rust + React)       | `apps/desktop`   |
| Chrome, Firefox, Safari | Vite + React (Manifest V3) | `apps/extension` |

Shared packages:

| Package           | Purpose                                | Location        |
| ----------------- | -------------------------------------- | --------------- |
| `@keykeykey/core` | Cryptography, data models, state, sync | `packages/core` |
| `@keykeykey/ui`   | Design tokens and shared components    | `packages/ui`   |

## Security Model

- **Envelope Encryption**: A random Data Encryption Key (DEK) encrypts all vault items. The DEK itself is encrypted with a Key Encryption Key (KEK) derived from your master password via Argon2id.
- **Cipher**: XChaCha20-Poly1305 (via `@noble/ciphers`, audited pure TypeScript).
- **Recovery**: DEK is also wrapped with a recovery key derivative for account recovery.
- **Zero Knowledge**: No unencrypted data ever leaves your device. BYOC (Bring Your Own Cloud) sync means your encrypted blobs go to storage you control.

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

# Run tests with coverage
pnpm test:coverage

# Build all packages and apps
pnpm build

# Format code
pnpm format

# Security audit
pnpm audit
```

## Project Structure

```
keykeykey/
  packages/
    core/          # Cryptography, Zod models, Zustand store, sync adapters
    ui/            # Shared design tokens and components
  apps/
    mobile/        # Expo React Native app (iOS + Android)
    desktop/       # Tauri desktop app (macOS, Windows, Linux)
    extension/     # Browser extension (Chrome, Firefox, Safari)
```

## Testing

See the [implementation plan](./implementationplan.md#7-automated-testing-strategy) for the full testing strategy covering:

- Unit tests (Vitest / Jest)
- Property-based testing (fast-check)
- E2E tests (Playwright, Maestro)
- Visual regression (Chromatic)
- Security scanning (gitleaks, semgrep, pnpm audit)
- Performance benchmarks (vitest bench)

## License

TBD
