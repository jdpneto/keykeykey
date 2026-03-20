# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KeyKeyKey is a cross-platform credential/secret/card manager. One TypeScript core (`packages/core`) is shared across five platforms: iOS/Android (Expo), macOS/Windows/Linux (Tauri), and Chrome/Firefox/Safari (browser extension).

## Prerequisites

- **Node.js 22+** (pinned via `.node-version`; use `fnm` or `nvm` to manage)
- **pnpm 10+** (managed via `packageManager` field)
- **Apple Team ID** for iOS builds: set `APPLE_TEAM_ID` env var (used by `apps/mobile/app.config.js`)

## Commands

```bash
# Install dependencies
pnpm install

# Build all packages (respects dependency order via Turbo)
pnpm build

# Run all tests
pnpm test

# Test a single package
pnpm --filter @keykeykey/core test
pnpm --filter @keykeykey/mobile test
pnpm --filter @keykeykey/desktop test
pnpm --filter @keykeykey/extension test
pnpm --filter @keykeykey/ui test

# Watch mode (core example)
pnpm --filter @keykeykey/core test:watch

# Test with coverage
pnpm --filter @keykeykey/core test:coverage

# Crypto benchmarks (core only)
pnpm --filter @keykeykey/core bench

# Lint all packages
pnpm lint

# Format (Prettier)
pnpm format          # fix
pnpm format:check    # check only

# E2E tests (always run critical tests before pushing)
cd e2e && npx playwright test --grep @critical      # critical only (CI runs these)
cd e2e && npx playwright test --project=extension   # extension only
cd e2e && npx playwright test --project=desktop     # desktop only (requires: pnpm --filter @keykeykey/desktop dev)
cd e2e && npx playwright test                       # all tests

# Dev mode (all apps)
pnpm dev

# iOS build (requires macOS + Xcode)
cd apps/mobile && npx expo prebuild --platform ios --no-install
# After prebuild, apply Podfile patches (see iOS Build Notes below)
cd ios && pod install
# Then build via Xcode or: npx expo run:ios --device "iPhone 17 Pro"

# Desktop (Tauri) dev
cd apps/desktop && npx tauri dev
```

**Important:** Always run `cd e2e && npx playwright test --grep @critical` before pushing. E2E tests run in CI as non-blocking checks.

**Important:** Turbo tasks `test`, `test:coverage`, and `lint` depend on `^build` — shared packages must be built first. CI builds workspace deps before running app tests (e.g., `pnpm --filter @keykeykey/core --filter @keykeykey/ui build` before desktop tests).

## Monorepo Structure

- **pnpm** (>=10) workspaces with **Turbo** for task orchestration
- Workspace protocol: `workspace:*` for internal deps
- Module system: ESM throughout (`"type": "module"`)

| Package                | Location         | Build        | Test Framework   |
| ---------------------- | ---------------- | ------------ | ---------------- |
| `@keykeykey/core`      | `packages/core`  | tsup         | Vitest           |
| `@keykeykey/ui`        | `packages/ui`    | tsup         | Vitest (jsdom)   |
| `@keykeykey/mobile`    | `apps/mobile`    | Expo         | Jest (jest-expo) |
| `@keykeykey/desktop`   | `apps/desktop`   | Vite + Tauri | Vitest (jsdom)   |
| `@keykeykey/extension` | `apps/extension` | Vite + CRXJS | Vitest (jsdom)   |

## Architecture

### Core Package (`packages/core`)

The core is the heart of the project — all crypto, data models, and state live here and are consumed by every app. It has multiple entry points:

- `@keykeykey/core/crypto` — Argon2id KDF, XChaCha20-Poly1305 encryption, vault header serialization, recovery keys
- `@keykeykey/core/models` — Zod schemas for Credential, Card, SecureNote, VaultItem
- `@keykeykey/core/store` — Zustand vanilla store (platform-agnostic) for vault state: encrypt/decrypt, search, lock/unlock, auto-lock
- `@keykeykey/core/sync` — BYOC sync adapters (WebDAV, Google Drive, local filesystem) with conflict resolution
- `@keykeykey/core/generator` — Password/passphrase generation with entropy estimation

### Encryption Model (Envelope Encryption)

Master Password → Argon2id → KEK → encrypts DEK → DEK encrypts vault items via XChaCha20-Poly1305. Recovery key provides an alternate DEK unwrap path. Crypto uses `@noble/ciphers` and `@noble/hashes` (audited, pure TypeScript).

### App Layer

- **Mobile** (`apps/mobile`): Expo Router for navigation, `expo-secure-store` for secure enclave, `expo-local-authentication` for biometrics, `react-native-argon2` for native KDF
- **Desktop** (`apps/desktop`): Tauri 2 (Rust backend in `src-tauri/`, React frontend in `src/`), Vite dev server on port 1420, React Router DOM
- **Extension** (`apps/extension`): Manifest V3, CRXJS Vite plugin, popup UI (`src/popup/`), background service worker (`src/background/`), content scripts for autofill (`src/content/`)

## Code Style

- **TypeScript** 5.7, strict mode, ES2022 target
- **Prettier**: semicolons, single quotes, trailing commas, 100 char print width, 2-space indent
- **ESLint**: flat config (`eslint.config.js`), JS recommended + TS recommended
- Commit style: `type(scope): message` (e.g., `fix(ci):`, `feat:`, `fix(core):`)

## Testing Notes

- Core crypto modules require **100% statement/line coverage, 90% branch, 100% function** coverage
- Core uses property-based testing with `fast-check` for crypto operations
- Mobile tests use Jest with `jest-expo` preset and `moduleNameMapper` for workspace imports
- CI runs 10 parallel jobs including SAST (Semgrep), secret scanning (gitleaks), license compliance, and crypto benchmarks

### Automated UI Testing (Tauri MCP / Desktop)

**CRITICAL: Never use `window.location.href` for navigation.** It causes a full page reload which destroys the React tree and the unlocked vault store. Always use React Router navigation (click links/buttons in the UI). The vault state only persists during client-side navigation.

**Setting input values:** Use the `test-set-value` custom event on `data-testid` elements. This bypasses React controlled input issues with programmatic value setting:

```javascript
// Set a TextInput value (works reliably with React controlled inputs)
document
  .querySelector('[data-testid="setup-password"]')
  .dispatchEvent(new CustomEvent('test-set-value', { detail: 'mypassword' }));
```

**Setting select values:** Use the same `test-set-value` custom event on `data-testid` elements:

```javascript
document
  .querySelector('[data-testid="sync-provider"]')
  .dispatchEvent(new CustomEvent('test-set-value', { detail: 'webdav' }));
```

**Clicking buttons:** Use `document.querySelectorAll('button')` and match by text content.

**Argon2 wait times:** Desktop uses the heavy Argon2 preset (m=65536, 3 iterations). Vault creation and unlock take ~15-20 seconds. Use `sleep 20` after clicking Create Vault or Unlock.

**Note:** All `test-set-value` event listeners are only active in development builds (`import.meta.env.DEV`). They are stripped from production builds.

Available test IDs: `setup-password`, `setup-confirm`, `unlock-password`, `add-name`, `add-url`, `add-username`, `add-password`, `add-cardholder`, `add-cardnumber`, `add-content`, `sync-provider`, `sync-webdav-url`, `sync-webdav-username`, `sync-webdav-password`, `restore-provider`, `restore-webdav-url`, `restore-webdav-username`, `restore-webdav-password`, `restore-master-password`.

## iOS Build Notes

After `expo prebuild --platform ios`, the generated Podfile needs two patches before `pod install`:

1. **Target name resolution**: The `@bacons/apple-targets` Podfile loader uses directory names (`credential-provider`) but the Xcode target is `CredentialProvider`. Patch the Podfile to read the `name` field from `expo-target.config.js`.

2. **Argon2Swift module path**: `RNArgon2` can't find the `argon2` C module from `Argon2Swift`. Add `SWIFT_INCLUDE_PATHS` for `Argon2Swift/Sources/Modules` in the post_install block.

3. **CredentialProvider extension**: Currently excluded from the build scheme due to unresolved `libsodium` xcframework linking. The main app builds and runs without it.

**`@expo/cli` patch**: A pnpm patch (`patches/@expo__cli@0.22.28.patch`) fixes tar v7 interop. Expo's `_interopRequireDefault` wrapping breaks with tar v7's `__esModule: true`. The patch calls `require("tar").extract()` directly.

## Security Considerations

This is a credential manager — security is paramount:

- Crypto libraries (`@noble/*`) are audited, pure-TypeScript implementations
- Forbidden production licenses: GPL, LGPL, AGPL, SSPL, EUPL, CC-BY-NC
- Secret scanning via gitleaks is enforced in CI
- SAST via Semgrep covers TypeScript, secrets, and OWASP Top 10
