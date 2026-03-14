# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KeyKeyKey is a cross-platform credential/secret/card manager. One TypeScript core (`packages/core`) is shared across five platforms: iOS/Android (Expo), macOS/Windows/Linux (Tauri), and Chrome/Firefox/Safari (browser extension).

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

## Security Considerations

This is a credential manager — security is paramount:

- Crypto libraries (`@noble/*`) are audited, pure-TypeScript implementations
- Forbidden production licenses: GPL, LGPL, AGPL, SSPL, EUPL, CC-BY-NC
- Secret scanning via gitleaks is enforced in CI
- SAST via Semgrep covers TypeScript, secrets, and OWASP Top 10
