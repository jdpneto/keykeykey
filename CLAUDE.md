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
- `@keykeykey/core/sync` — BYOC sync adapters (WebDAV, Google Drive, Dropbox, OneDrive) with conflict resolution
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

Available test IDs: `setup-password`, `setup-confirm`, `unlock-password`, `add-name`, `add-url`, `add-username`, `add-password`, `add-cardholder`, `add-cardnumber`, `add-content`, `sync-provider`, `sync-webdav-url`, `sync-webdav-username`, `sync-webdav-password`, `sync-master-password`, `restore-provider`, `restore-webdav-url`, `restore-webdav-username`, `restore-webdav-password`, `restore-master-password`.

## iOS Build Notes

`pnpm --filter @keykeykey/mobile prebuild` is the canonical flow — it runs `expo prebuild --platform ios --no-install` followed by `scripts/post-prebuild-ios.js`, then you `cd ios && pod install`. `plugins/ios-build-fixes` + the post-prebuild script together apply every patch Xcode 26 / RN 0.76 needs, idempotently. No manual Podfile edits.

**Required env vars:**

- `APPLE_TEAM_ID` — the 10-char Team ID from the cert's OU field (not the parenthesized suffix in the cert's CN). For a Personal Team, find it in the TeamIdentifier of any Xcode-managed `.mobileprovision` (`security cms -D -i <profile> | plutil -extract TeamIdentifier raw -o - -`). Required; if unset, `app.config.js` stamps the placeholder `XXXXXXXXXX` into the pbxproj and device signing fails.
- `APPLE_PAID_TEAM` — set to `true` only if you're enrolled in the Apple Developer Program. Gates the `CredentialProvider` extension + App Groups + Associated Domains (all paid-only Apple capabilities). When unset, `app.config.js` strips `@bacons/apple-targets` from the plugin list and `plugins/credential-provider` skips the paid entitlements, so device builds on a Personal Team succeed. Flip to `true` after enrolling and re-run `prebuild` to restore full fidelity.

**Xcode version gate:** Xcode 26.4.1+ is required (ships the iOS 26.4 SDK). After installing Xcode, `xcodebuild -showdestinations` must list at least one "Available" iOS destination — if it only shows "Ineligible destinations" with "iOS 26.4 is not installed", open Xcode once and install the missing platform component (Xcode → Settings → Components).

**Device builds:** `xcodebuild` from the command line doesn't auto-renew provisioning profiles. Use `-allowProvisioningUpdates`:

```bash
xcodebuild -workspace ios/KeyKeyKey.xcworkspace -scheme KeyKeyKey \
  -configuration Debug -destination 'id=<device-udid>' \
  -allowProvisioningUpdates build
```

Personal Team profiles expire after 7 days — rebuild weekly. On first launch of a dev-signed build, iOS requires manual trust at **Settings → General → VPN & Device Management → (Developer App) → Trust**.

**Patches (automated — reference):**

1. `@bacons/apple-targets` Podfile loader uses the directory basename (`credential-provider`) but Xcode uses the PascalCase target (`CredentialProvider`). `scripts/post-prebuild-ios.js` rewrites the loader to read the `name` from `expo-target.config.js`.
2. Fmt 11.0.2 bundled by Folly breaks under Xcode 26 Clang's consteval. `plugins/ios-build-fixes` injects `FMT_USE_CONSTEVAL=0` and patches `Pods/fmt/include/fmt/base.h` to respect the predefine.
3. `RNArgon2` / `Argon2Swift` need `${PODS_ROOT}/Argon2Swift/Sources/Modules` on `SWIFT_INCLUDE_PATHS` for the Swift `import argon2` to resolve.
4. Xcodeproj 1.27's object-version table doesn't know `objectVersion = 70` (Xcode 26's pbxproj format). The Podfile prepends a Ruby monkey-patch that teaches the gem the new version at load time.
5. `Pods-CredentialProvider.{debug,release}.xcconfig` patch — replaces `-l"sodium"` with the explicit path `"${PODS_XCFRAMEWORKS_BUILD_DIR}/Sodium/libsodium.a"`. APFS is case-insensitive, so on a stock pod install `-lsodium` collides with `libSodium.a` (the Swift wrapper built from the Sodium pod's sources, living at `${PODS_CONFIGURATION_BUILD_DIR}/Sodium/libSodium.a`) and the real C library inside `Clibsodium.xcframework` is never linked — every libsodium symbol is then reported as "Undefined symbols for architecture arm64". The explicit path skips `-L` search. Only runs when the CredentialProvider target exists (paid team).

**`@expo/cli` patch**: A pnpm patch (`patches/@expo__cli@0.22.28.patch`) fixes tar v7 interop. Expo's `_interopRequireDefault` wrapping breaks with tar v7's `__esModule: true`. The patch calls `require("tar").extract()` directly.

## Local Network Testing (WebDAV)

When testing sync against a local network WebDAV server (e.g., `http://192.168.1.217:8080`), two security guards must be temporarily bypassed:

1. **`packages/core/src/sync/webdav-adapter.ts`** — Add `http://192.168.` to the allowed URL prefixes in the constructor
2. **`apps/desktop/src-tauri/src/http_proxy.rs`** — Comment out the `192.168.0.0/16` block in `is_blocked_ip()`

**IMPORTANT:** Always revert these changes before committing. They must NEVER be merged to main. Search for `LOCAL TESTING ONLY` to find the changes.

## Security Considerations

This is a credential manager — security is paramount:

- Crypto libraries (`@noble/*`) are audited, pure-TypeScript implementations
- Forbidden production licenses: GPL, LGPL, AGPL, SSPL, EUPL, CC-BY-NC
- Secret scanning via gitleaks is enforced in CI
- SAST via Semgrep covers TypeScript, secrets, and OWASP Top 10

## Context Navigation

When you need to understand the codebase, docs, or any files in this project:

- ALWAYS query the knowledge graph first: `graphify query "your question". Only if you don't get an answer, do you try to find it
- Only read raw files if I explicitely say "read the file" or "look at the raw file".
- Use `graphify-out/wiki/index.md`as your navigation entrypoint for browsing the structure of the project.

After each pull request completion, update the graph. These are the commands that can be used, depending on the need:

```
/graphify                          # run on current directory
/graphify ./raw                    # run on a specific folder
/graphify ./raw --mode deep        # more aggressive INFERRED edge extraction
/graphify ./raw --update           # re-extract only changed files, merge into existing graph
/graphify ./raw --directed          # build directed graph (preserves edge direction: source→target)
/graphify ./raw --cluster-only     # rerun clustering on existing graph, no re-extraction
/graphify ./raw --no-viz           # skip HTML, just produce report + JSON
/graphify ./raw --obsidian                          # also generate Obsidian vault (opt-in)
/graphify ./raw --obsidian --obsidian-dir ~/vaults/myproject  # write vault to a specific directory

/graphify add https://arxiv.org/abs/1706.03762        # fetch a paper, save, update graph
/graphify add https://x.com/karpathy/status/...       # fetch a tweet
/graphify add <video-url>                              # download audio, transcribe, add to graph
/graphify add https://... --author "Name"             # tag the original author
/graphify add https://... --contributor "Name"        # tag who added it to the corpus
```

## Anoyances

- If I tell you to fix something or about a problem it is never EVER the right answer to say it's pre-existing. If I tell you about it, it means I plan you to fix it.
- If I tell you to monitor the github pipeline, you only merge if everything is green, if you weren't the one introducing the issue
- If a recent commit caused a test to fail, unless the code is actually wrong, the priority is to fix the test. Don't undo code because now the test fails
- Always rebuild the application once you finish developing something so I can just run it or install it.
