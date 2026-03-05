# Credential Manager Architecture & Specifications

This document outlines the detailed specs and architecture for the cross-platform credential, secret, and card manager.

## 1. Monorepo & Technology Strategy

We will use **Turborepo** with **pnpm** workspaces to share as much code as possible.

- **Why React Native (Expo) over Alternatives (like Flutter/Kotlin/Swift)?**
  - Since our Desktop (Tauri) and Browser Extensions rely on Web Technologies (React), using React Native allows us to write our **Cryptography, State Management, and Sync Logic exactly once** in pure TypeScript and share it across _all 5 platforms_.
  - Expo provides excellent out-of-the-box bindings for Mobile Biometrics (FaceID/Fingerprint) and secure enclaves, handling the heavy lifting of native code.

## 2. Shared Core (`packages/core`)

This package is the brain of the application. It runs in Node, Browsers, and React Native.

- **Cryptography:** `@noble/ciphers` and `@noble/hashes` (audited, fast, pure TypeScript, no native binary dependencies needed).
- **Data Models:** Zod schemas for Cards, Passwords, Secure Notes.
- **State Management:** Zustand (lightweight, easy to share between React and React Native).
- **Encryption Flow:**
  1.  User has a `MasterPassword` and a `RecoveryKey`.
  2.  App generates a random `DataEncryptionKey` (DEK).
  3.  `DEK` is encrypted with an Argon2id derivative of `MasterPassword`.
  4.  `DEK` is _also_ encrypted with an Argon2id derivative of `RecoveryKey`.
  5.  All vault items are encrypted using XChaCha20-Poly1305 with the `DEK`.

## 3. Platform 1: React Native Mobile App (`apps/mobile`)

- **Framework:** Expo (React Native).
- **Navigation:** Expo Router (file-based routing).
- **Local Storage:** `expo-sqlite` and `expo-secure-store`.
- **Biometrics:** `expo-local-authentication`. The app will store the encrypted DEK in the device's secure enclave (Keychain/Keystore), unlockable via FaceID/Fingerprint so the user doesn't have to type their master password every time.
- **Autofill (Future):** Implement iOS AutoFill Credential Provider and Android Autofill Framework.

## 4. Platform 2: Tauri Desktop App (`apps/desktop`)

- **Framework:** Tauri (Rust Backend + Vite/React Frontend).
- **Why Tauri over Electron?** Tauri uses the OS's native webview (WebKit/WebView2/EdgeHTML), resulting in a microscopic binary size (<10MB) and dramatically less RAM usage than Electron.
- **Local Storage:** Tauri SQLite plugin or direct Rust file I/O.
- **Biometrics/Security:** `tauri-plugin-stronghold` or OS keyring integration (macOS Keychain, Windows Credential Manager) via Rust to securely cache the DEK.
- **Global Shortcuts:** Rust bindings for system-wide shortcuts (e.g., `Cmd+Shift+Space` to quick-search credentials).

## 5. Platform 3: Browser Extensions (`apps/extension`)

- **Framework:** React + Vite + CRXJS (Vite plugin for Manifest V3 extensions).
- **Target Browsers:** Chromium (Chrome, Edge, Brave), Firefox, Safari (via Xcode Web Extension converter).
- **Architecture:**
  - **Popup:** React UI for quick searching and copying.
  - **Background Worker:** Holds the unlocked DEK in memory while the browser is open. Handles auto-locking timeouts.
  - **Content Scripts:** Injects an autofill UI natively into website login forms.
- **Local Storage:** `chrome.storage.local` (data remains encrypted at rest).

## 6. Cloud Sync Strategy (BYOC - Bring Your Own Cloud)

The Core package will define a generic `ISyncAdapter` interface.

- **Local Adapter:** Sync to a local file/folder (useful for Desktop/Mobile syncing via Syncthing).
- **File Providers:** WebDAV, Google Drive API, iCloud Drive.
- **Conflict Resolution:** Last-Write-Wins on a per-item basis, using UUIDs and timestamps.

## Proposed Monorepo Structure

```text
/keykeykey
  /packages
    /core        # Cryptography, Zod Models, Sync Adapters, Zustand Store
    /ui          # Shared UI tokens (colors, basic layout math)
  /apps
    /mobile      # Expo React Native App
    /desktop     # Tauri React App
    /extension   # Vite React Extension
```

## 7. Automated Testing Strategy

Given the critical security nature of a credential manager, automated testing is a first-class citizen across the monorepo. Every layer — from raw cryptographic primitives to end-user UI flows — has a dedicated testing approach.

### 7.1 Core Logic (`packages/core`) — Vitest

- **Unit Testing:** `Vitest` for ultra-fast, native TypeScript testing of all cryptographic primitives, Zod schemas, Zustand store logic, and sync adapters.
- **Test Vectors:** Hardcode official IETF test vectors (RFC 7539 for ChaCha20-Poly1305, RFC 9106 for Argon2) to mathematically verify correctness.
- **Property-Based Testing:** `fast-check` for fuzzing crypto and serialization boundaries — generate random payloads and ensure encrypt→decrypt round-trips always succeed and tampered ciphertexts always throw.
- **Coverage:** Enforce 100% statement coverage on `packages/core/crypto/**` via `vitest --coverage` (Istanbul/v8 provider). Enforce ≥90% branch coverage on all other core modules.
- **Mutation Testing:** `Stryker` (optional, CI-only) to verify that the test suite catches meaningful regressions, not just covers lines.

### 7.2 UI Components (`packages/ui`) — Vitest + React Testing Library

- **Unit/Integration:** `React Testing Library` with `@testing-library/jest-dom` matchers to verify component renders, accessibility attributes (ARIA roles/labels), and user interactions.
- **Visual Regression:** `Chromatic` (Storybook-based) or `Playwright` screenshot comparison to catch unintended visual changes across themes and responsive breakpoints.
- **Storybook:** Each shared component gets a story. Stories serve as living documentation and as the source for visual regression snapshots.

### 7.3 Mobile App (`apps/mobile`) — Jest + Detox/Maestro

- **Unit/Integration:** `Jest` + `@testing-library/react-native` for screen components, navigation flows, and Zustand store integration.
- **E2E (Device):** `Maestro` (YAML-driven, no flaky selectors) for critical user flows:
  - Onboarding → create vault → add credential → lock → biometric unlock → autofill.
  - Run on iOS Simulator and Android Emulator in CI via GitHub Actions macOS runners.
- **Biometric Mocking:** Use `expo-local-authentication`'s test helpers to simulate FaceID/Fingerprint success and failure without real hardware.

### 7.4 Desktop App (`apps/desktop`) — Vitest + Playwright + Cargo Test

- **Frontend Unit/Integration:** `Vitest` + `React Testing Library` for the Vite/React frontend layer.
- **Rust Backend:** `cargo test` for all Tauri command handlers, SQLite operations, and keyring integrations. Use `mockall` for mocking OS keychain APIs.
- **E2E (Desktop):** `Playwright` (with `@playwright/test`) or `WebdriverIO` for full app flows:
  - Launch the Tauri app via `tauri dev`, drive the webview, verify vault CRUD, lock/unlock, and global shortcut registration.

### 7.5 Browser Extension (`apps/extension`) — Vitest + Playwright

- **Unit/Integration:** `Vitest` for popup components, background worker logic (DEK lifecycle, auto-lock timers), and content script DOM injection.
- **E2E (Browser):** `Playwright` with Chromium extension loading (`--load-extension` flag):
  - Install the unpacked extension → open popup → unlock vault → navigate to a login form → verify autofill injection → submit credentials.
  - Test on Chromium and Firefox (via `web-ext` for Firefox addon loading).
- **Manifest Validation:** A CI script that validates `manifest.json` against the Chrome Web Store and Firefox AMO linting rules (`chrome-webstore-upload` + `web-ext lint`).

### 7.6 Sync Engine E2E

- **Conflict Simulation:** Node scripts that instantiate two separate in-memory Core engine instances, simulate concurrent edits (create, update, delete on the same item), and assert Last-Write-Wins resolution preserves data integrity.
- **Adapter Integration Tests:** For each `ISyncAdapter` (Local, WebDAV, Google Drive), run integration tests against:
  - A local filesystem mock (in-memory `memfs`).
  - A local WebDAV server (`webdav-server` npm package) spun up in CI.
  - A Google Drive API mock (MSW or `nock`).

### 7.7 Security-Focused Testing

- **Dependency Auditing:** `pnpm audit` runs on every CI build. Any `critical` or `high` severity vulnerability fails the pipeline.
- **Secret Scanning:** `gitleaks` pre-commit hook and CI step to prevent accidental commits of API keys, tokens, or master passwords.
- **SAST (Static Analysis):** `semgrep` with security-focused rulesets for TypeScript (XSS, injection, unsafe crypto usage).
- **License Compliance:** `license-checker` to ensure no GPL-incompatible dependencies leak into the project.

### 7.8 Performance Benchmarks

- **Crypto Benchmarks:** `vitest bench` (or `tinybench`) for:
  - Argon2id key derivation (target: <500ms on modern hardware at chosen parameters).
  - XChaCha20-Poly1305 encrypt/decrypt throughput (target: >100MB/s for bulk note encryption).
- **Startup Time:** Measure cold-start time for each platform and track regressions in CI.
- **Bundle Size:** `size-limit` for the extension and desktop frontend bundles. Alert on >10% size increase.

### 7.9 CI/CD Pipeline (GitHub Actions)

```yaml
# Conceptual pipeline stages:
on: [push, pull_request]
jobs:
  lint:        # ESLint + Prettier + Semgrep + gitleaks
  test-core:   # vitest run --coverage (packages/core)
  test-ui:     # vitest run (packages/ui) + Chromatic visual regression
  test-mobile: # jest + maestro (iOS Simulator on macOS runner)
  test-desktop:# vitest + cargo test + playwright (Tauri)
  test-ext:    # vitest + playwright --load-extension
  test-sync:   # Node conflict simulation scripts
  audit:       # pnpm audit + license-checker
  bench:       # vitest bench (crypto perf, bundle size)
  build:       # turbo build (all apps)
```

- **Branch Protection:** All jobs must pass before merging to `main`.
- **Nightly Runs:** Full E2E suite (including device tests) runs nightly on `main` to catch flaky tests and upstream breakages.
- **Release:** `changesets` for versioning. Tauri builds produce signed platform binaries. Expo EAS builds produce iOS/Android artifacts.

## Next Steps

Once you approve this detailed specification, we will:

1. Initialize the monorepo structure (Turborepo).
2. Setup the empty packages and apps.
3. Begin implementing the Core cryptography logic.
