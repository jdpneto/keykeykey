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
- **Safari OAuth limitation:** Safari web extensions do not support `browser.identity.launchWebAuthFlow`. OAuth-based sync providers (Google Drive, Dropbox, OneDrive) will not work in the Safari extension until a native bridge is implemented using `ASWebAuthenticationSession` via Swift. This requires a Safari-specific native message handler in the Xcode extension wrapper. Until then, Safari extension users can use WebDAV for sync.
- **Architecture:**
  - **Popup:** React UI for quick searching and copying.
  - **Background Worker:** Holds the unlocked DEK in memory while the browser is open. Handles auto-locking timeouts.
  - **Content Scripts:** Injects an autofill UI natively into website login forms.
- **Local Storage:** `chrome.storage.local` (data remains encrypted at rest).

## 6. Cloud Sync Strategy (BYOC - Bring Your Own Cloud)

The Core package will define a generic `ISyncAdapter` interface.

- **Local Adapter:** Sync to a local file/folder (useful for Desktop/Mobile syncing via Syncthing).
- **File Providers:** WebDAV, Google Drive, Dropbox, OneDrive.
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

## 8. Password Import System (`packages/core/import`)

A CSV import pipeline that allows users to migrate from other password managers. The system uses a source-specific strategy pattern with auto-detection.

### Supported Sources

| Source                       | Header Detection                                                                   | Key Columns                                                 | Notes                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Chrome**                   | `name,url,username,password,note`                                                  | Direct mapping                                              | Handles `android://` app URIs — extracts package name, drops URI from URL field                 |
| **Firefox**                  | `"url","username","password","httpRealm","formActionOrigin",...`                   | Quoted fields, timestamps                                   | Skips internal `chrome://FirefoxAccounts` entries and JSON sync metadata blobs                  |
| **Bitwarden**                | `folder,favorite,type,name,...,login_uri,login_username,login_password,login_totp` | Type-filtered (`login` only)                                | Preserves folders (→ tags), favorites, and TOTP seeds. Skips cards/notes/identity types         |
| **iCloud / Apple Passwords** | `Title,URL,Username,Password,Notes,OTPAuth`                                        | Title includes username context                             | Preserves OTPAuth TOTP URIs. Title format: `"site.com (user@email.com)"`                        |
| **1Password**                | Headerless (positional columns)                                                    | Col[3]=Title, Col[4]=Type, Col[5]=Username, Col[6]=Password | Heuristic detection (row starts with comma, no header keywords). Only imports `Login` type rows |

### Architecture

```text
CSV string
    │
    ▼
┌─────────────┐     ┌──────────────────┐
│  parseCsv() │────▶│  detectSource()  │ ── auto-detect from headers
│  (RFC 4180) │     └──────────────────┘
└─────────────┘              │
                             ▼
                 ┌───────────────────────┐
                 │ Source-specific parser │ ── chrome / firefox / bitwarden / icloud / 1password
                 │ → ImportedCredential[]│
                 └───────────────────────┘
                             │
                             ▼
                   ┌───────────────────┐
                   │  toVaultItems()   │ ── normalize to VaultItem shape
                   │  folders → tags   │    (ready for vault.addItem)
                   │  empty → defaults │
                   └───────────────────┘
```

- **CSV Parser:** Custom RFC 4180-compliant parser (no external dependency). Handles quoted fields, escaped quotes (`""`), newlines inside quotes, CRLF/LF, and trailing commas.
- **Source Detection:** Inspects first-line headers for unique column patterns. Falls back to 1Password heuristic for headerless CSVs.
- **Intermediate Representation:** All source parsers produce `ImportedCredential[]` — a normalized shape with `name, url, username, password, notes, totp, folder, favorite`.
- **Conversion:** `toVaultItems()` maps the IR to `Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>` — ready for direct insertion via `vault.addItem()`. Folders become tags; empty optionals become `undefined`.
- **Skip Tracking:** Each parser returns `skipped[]` with row numbers and reasons (no credentials, internal entries, non-login types) for user transparency.

### Testing

- 86 tests across 7 test files covering:
  - CSV parser edge cases (quoted fields, escaped quotes, CRLF, empty fields, JSON-in-fields)
  - Each source parser with representative test data matching real export formats
  - Auto-detection of all 5 sources
  - Full pipeline (`importPasswordsCsv`) with metadata validation
  - Edge cases: empty CSVs, invalid headers, missing fields, non-login types

## 9. Autofill Integration

Autofill is the core UX differentiator of a password manager. Users should never need to manually copy-paste credentials.

### 9.1 Mobile Autofill (`apps/mobile`)

The mobile app must register as a **system-level credential provider** on both platforms so it appears in the OS autofill prompts inside any app or browser.

- **iOS — AutoFill Credential Provider Extension:**
  - Implement a native AutoFill Credential Provider Extension target via Expo config plugin.
  - The extension runs in a separate process. It reads the encrypted vault from the shared App Group container (`expo-secure-store` + shared `UserDefaults` suite) and presents a credential selection UI.
  - Flow: User taps a login field → iOS presents keykeykey as an autofill option → user authenticates (FaceID/Fingerprint via the extension) → extension decrypts the DEK → searches vault by associated domain → fills the credential.
  - **Associated Domains:** Ship an `apple-app-site-association` file so websites can declare trust, enabling automatic credential matching by domain.
  - Uses `ASCredentialProviderViewController` under the hood. Expo config plugin generates the native extension target and wires the entitlements.

- **Android — Autofill Framework:**
  - Implement an `AutofillService` via Expo config plugin (or a custom native module).
  - The service receives autofill requests from the system, matches by package name or web domain (`autofill hints`), and returns `FillResponse` datasets.
  - Flow: User taps a login field → Android shows keykeykey autofill suggestion → user authenticates (biometric prompt) → service decrypts and fills.
  - Target API level 26+ (`AutofillManager`). For apps that don't provide autofill hints, fall back to heuristic field detection (input type, field name, `android:autofillHints`).

- **Shared Logic:**
  - Domain matching logic lives in `packages/core` — given a URL or app identifier, find the best-matching credential(s). Uses hostname comparison with public suffix awareness (e.g., `login.example.com` matches `example.com`).
  - Credential ranking: exact URL match > hostname match > base domain match. If multiple credentials match, present a selection UI.

### 9.2 Browser Extension Autofill (`apps/extension`)

The extension already has content scripts (Section 5). This section details the autofill behavior.

- **Login Form Detection:**
  - Content script scans the DOM for login forms on page load and on dynamic DOM mutations (`MutationObserver`).
  - Detection heuristics: `<input type="password">`, `<input type="email">`, `autocomplete="username"`, `autocomplete="current-password"`, common field `name`/`id` patterns (`user`, `email`, `login`, `pass`).
  - Handles multi-page login flows (e.g., Google: email on page 1, password on page 2) by matching partial credentials.

- **Autofill UI Injection:**
  - When a login form is detected and matching credentials exist, inject a small keykeykey icon inside/beside the username field.
  - Clicking the icon opens a dropdown listing matching credentials (name + username preview).
  - Selecting a credential fills both username and password fields, dispatching `input`, `change`, and `blur` events to satisfy JS frameworks (React, Angular, Vue form bindings).

- **Inline Autofill (Background):**
  - Background worker maintains an in-memory index of `{ hostname → credential[] }` for fast lookup. Updated when the vault changes.
  - Content script sends the current page hostname to the background worker via `chrome.runtime.sendMessage`. Background replies with matching credential count (not the credentials themselves — those are only sent on user action).

- **Auto-submit (Optional, User Setting):**
  - After filling, optionally auto-click the submit/login button. Disabled by default for safety. Configurable per-site in settings.

- **Save New Credentials:**
  - Detect successful login form submissions (form `submit` event + navigation or XHR success).
  - Prompt the user via a notification banner: "Save this password to keykeykey?"
  - If accepted, create a new credential item via the vault store.

- **Security Considerations:**
  - Never inject autofill UI on non-HTTPS pages (except localhost).
  - Content script only receives credentials after explicit user interaction (click on icon or keyboard shortcut).
  - Credentials are never stored in the content script's scope — they are filled and immediately discarded.
  - iframes are handled by checking `window.top` origin. Cross-origin iframes do not receive autofill.

## 10. Password Generator (`packages/core/generator`)

A cryptographically secure password generator that lives in the core package and is surfaced on all platforms.

### 10.1 Generation Strategies

- **Random Password:**
  - Configurable length (default: 20, range: 8–128 characters).
  - Character class toggles: uppercase (`A-Z`), lowercase (`a-z`), digits (`0-9`), symbols (`!@#$%^&*…`).
  - Custom symbol set override (user can restrict to specific symbols for sites with restrictive password policies).
  - Guarantees at least one character from each enabled class (rejection sampling — generate, check, regenerate if constraint not met).
  - Uses `crypto.getRandomValues()` (Web Crypto API) — available in browsers, Node, and React Native.

- **Passphrase:**
  - Generates a sequence of random words from a bundled word list (EFF large wordlist — 7,776 words, ~12.9 bits of entropy per word).
  - Configurable word count (default: 5, range: 3–10).
  - Configurable separator (default: `-`, options: `-`, `.`, `_`, ` `, custom).
  - Optional capitalize first letter of each word.
  - Optional append a random digit and symbol for compatibility with sites that require mixed character types.
  - Example output: `correct-horse-battery-staple-bloom`

### 10.2 Entropy Calculation

- Display estimated entropy (bits) for the generated password in real-time.
- Entropy formula:
  - Random: `length × log₂(charset_size)` — e.g., 20 chars from 94-char set = ~131 bits.
  - Passphrase: `word_count × log₂(wordlist_size)` — e.g., 5 words from 7,776 = ~64.6 bits.
- Visual strength indicator: Weak (<40 bits) / Fair (40–60) / Strong (60–80) / Very Strong (>80).

### 10.3 API Surface

```typescript
interface PasswordGeneratorOptions {
  mode: 'random' | 'passphrase';
  // Random mode
  length?: number; // default: 20
  uppercase?: boolean; // default: true
  lowercase?: boolean; // default: true
  digits?: boolean; // default: true
  symbols?: boolean; // default: true
  customSymbols?: string; // override default symbol set
  excludeAmbiguous?: boolean; // exclude 0/O, 1/l/I, etc.
  // Passphrase mode
  wordCount?: number; // default: 5
  separator?: string; // default: '-'
  capitalize?: boolean; // default: true
  appendNumberSymbol?: boolean; // default: false
}

function generatePassword(options: PasswordGeneratorOptions): string;
function calculateEntropy(password: string, options: PasswordGeneratorOptions): number;
function estimateStrength(entropy: number): 'weak' | 'fair' | 'strong' | 'very-strong';
```

### 10.4 UI Integration

- **Add/Edit Credential Screen:** A "Generate" button beside the password field opens a generator popover/modal.
- **Customization:** User can tweak options and preview the generated password before accepting.
- **History:** Keep the last 5 generated passwords in memory (cleared on lock) so the user can recover a password they generated but forgot to save.
- **Copy:** One-tap copy to clipboard with auto-clear after 30 seconds (matches the existing clipboard security behavior).

### 10.5 Testing

- Verify character class constraints (each enabled class appears at least once).
- Verify length constraints.
- Verify entropy calculation matches expected values.
- Verify passphrase word count and separator.
- Property-based testing: generate 1,000 passwords and assert all satisfy the constraints.
- Verify `crypto.getRandomValues()` is used (no `Math.random()`).

## 11. Notes Field on All Entry Types

### Current State

The `notes` field **already exists** in the data model:

- **Credential** (`credential.ts`): `notes: z.string().optional()`
- **Card** (`card.ts`): `notes: z.string().optional()`
- **SecureNote** (`secure-note.ts`): `content: z.string()` (the note _is_ the content)

No schema changes are needed. This section covers ensuring the notes field is properly surfaced and usable across all platforms.

### UI Requirements

- **All Platforms (Mobile, Desktop, Extension):**
  - The Add/Edit form for Credentials and Cards must include a **Notes** text area — multiline, expandable, with no character limit enforced in the UI (the encrypted blob handles arbitrary length).
  - The detail/view screen must render notes with preserved whitespace and line breaks (use `white-space: pre-wrap` on web, `Text` with `\n` handling on mobile).
  - Notes should be searchable in the vault search — the search index includes the `notes` field alongside `name`, `username`, and `url`.

- **Placeholder Text:** "Add notes (API keys, recovery codes, security questions…)" — hints at use cases without being prescriptive.

- **Import/Export:** The import pipeline (Section 8) already maps notes from all 5 CSV sources. The export pipeline (Section 12) must include notes in the output CSV.

## 12. Password CSV Export (`packages/core/export`)

Allow users to export their vault to a standard CSV format, consistent with what all major password managers support. This is critical for data portability and user trust.

### 12.1 Export Format

Produce a standard CSV with these columns:

```
name,url,username,password,notes,totp,folder,favorite
```

- **Why this format?** It's a superset of what Chrome, Firefox, and iCloud export. Users can re-import this CSV into any other password manager. The columns are self-describing and match the `ImportedCredential` intermediate representation from Section 8.
- Only `credential` type items are exported (Cards and SecureNotes are excluded — they don't map to standard password CSV formats).
- **Encoding:** UTF-8 with BOM (`\uFEFF`) for Excel compatibility. RFC 4180 quoting (fields containing commas, quotes, or newlines are double-quoted; internal quotes escaped as `""`).

### 12.2 API Surface

```typescript
interface ExportOptions {
  /** Which item types to include. Default: ['credential'] */
  types?: Array<'credential' | 'card' | 'secure-note'>;
  /** Include items from specific folders/tags only. Default: all */
  tags?: string[];
  /** Include favorites only. Default: false */
  favoritesOnly?: boolean;
}

/** Exports vault items to CSV string. Requires unlocked vault (DEK in memory). */
function exportToCsv(items: VaultItem[], options?: ExportOptions): string;
```

### 12.3 Architecture

```text
VaultItem[]
    │
    ▼
┌────────────────┐
│  Filter items  │ ── by type, tags, favorites
│  (credentials) │
└────────────────┘
    │
    ▼
┌────────────────┐
│  Map to rows   │ ── extract name, url, username, password, notes, totp, tags→folder, favorite
└────────────────┘
    │
    ▼
┌────────────────┐
│  Serialize CSV │ ── RFC 4180 quoting, UTF-8 BOM
└────────────────┘
    │
    ▼
  CSV string (returned to caller — platform handles file save dialog)
```

- The export function **only produces the CSV string**. File saving is platform-specific:
  - **Mobile:** `expo-file-system` → `Sharing.shareAsync()` (share sheet) or save to Files app.
  - **Desktop:** Tauri `dialog.save()` → write to filesystem via Rust.
  - **Extension:** `chrome.downloads.download()` with a `blob:` URL or `URL.createObjectURL()`.

### 12.4 Security Considerations

- **Export requires vault unlock:** The function takes decrypted `VaultItem[]`, not encrypted blobs. The caller must have an unlocked vault.
- **User confirmation:** All platforms must show a confirmation dialog before exporting: "You are about to export all passwords in plaintext. This file will not be encrypted. Continue?"
- **No auto-export:** Export is always user-initiated, never triggered by sync, backup, or automation.
- **Clipboard warning:** If the user copies the CSV content instead of saving to file, warn that clipboard contents may be accessible to other apps.
- **Audit log (future):** Record export events with timestamp for security auditing.

### 12.5 Testing

- Verify CSV output matches RFC 4180 (proper quoting, escaping, CRLF line endings).
- Verify UTF-8 BOM is present.
- Verify only credential items are exported by default.
- Verify filtering by tags, favorites.
- Round-trip test: export → re-import via the Chrome parser (Section 8) → verify all fields match.
- Verify fields containing commas, quotes, and newlines are properly escaped.
- Verify empty fields produce correct CSV (no missing columns).

## 13. TOTP Authenticator (`packages/core/totp`)

Built-in authenticator functionality so users can manage 2FA codes alongside their passwords — eliminating the need for a separate app like Authy or Google Authenticator.

### 13.1 Current State

The data model already supports TOTP:

- **Credential** (`credential.ts`): `totp: z.string().optional()` — stores the `otpauth://` URI.
- **Import pipeline** (Section 8): Already preserves TOTP seeds from Bitwarden (`login_totp`) and iCloud (`OTPAuth`).
- **Export pipeline** (Section 12): Already includes `totp` in the CSV output.

What's missing is the **code generation engine** and **UI** to actually display and use the codes.

### 13.2 TOTP Code Generation (RFC 6238)

Implement TOTP (Time-Based One-Time Password) per [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238), built on HOTP ([RFC 4226](https://datatracker.ietf.org/doc/html/rfc4226)).

- **Algorithm:**
  1. Parse the `otpauth://totp/...` URI to extract: `secret` (Base32-encoded), `algorithm` (default: SHA-1), `digits` (default: 6), `period` (default: 30s), `issuer`.
  2. Compute the time counter: `T = floor((current_unix_time - T0) / period)` where `T0 = 0`.
  3. HMAC the counter with the decoded secret: `HMAC-{algorithm}(secret, T)`.
  4. Dynamic truncation: extract a 4-byte segment from the HMAC output using the low-order nibble of the last byte as an offset.
  5. Reduce modulo `10^digits` to produce the final code (zero-padded).

- **Supported Algorithms:** SHA-1 (default, most common), SHA-256, SHA-512. Use `@noble/hashes` (already a project dependency) for HMAC computation.

- **No External Dependencies:** The TOTP engine is pure TypeScript using `@noble/hashes` for HMAC — no additional packages needed.

### 13.3 OTPAuth URI Parsing

Parse the standard `otpauth://totp/` URI format ([Key URI Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format)):

```
otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30
```

```typescript
interface TotpParams {
  /** The raw secret (decoded from Base32) */
  secret: Uint8Array;
  /** Display label (e.g., "Example:user@example.com") */
  label: string;
  /** Issuer name (e.g., "Example") */
  issuer: string;
  /** Hash algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512' */
  algorithm: string;
  /** Number of digits in the code */
  digits: number;
  /** Time step in seconds */
  period: number;
}

function parseTotpUri(uri: string): TotpParams;
function generateTotpCode(params: TotpParams, timestamp?: number): string;
function getRemainingSeconds(period: number, timestamp?: number): number;
```

### 13.4 Base32 Decoder

Implement a minimal Base32 (RFC 4648) decoder for TOTP secrets. Most TOTP secrets are Base32-encoded (e.g., `JBSWY3DPEHPK3PXP`). The decoder must:

- Handle both uppercase and lowercase input.
- Ignore spaces and hyphens (common in user-copied secrets).
- Ignore `=` padding (optional in many implementations).
- Throw a clear error for invalid characters.

### 13.5 UI Integration

- **Credential Detail Screen:**
  - If a credential has a `totp` field, display a live TOTP code with a countdown timer.
  - The code is shown in large monospace font, grouped as `XXX XXX` (3+3) for readability.
  - Circular or linear progress indicator showing seconds remaining before the code rotates.
  - Code auto-refreshes every `period` seconds (typically 30s). The timer uses `setInterval` with drift correction.
  - Tap/click the code to copy to clipboard (with auto-clear after 30 seconds).

- **Vault List View:**
  - Credentials with TOTP show a small authenticator icon/badge so users can quickly identify which entries have 2FA.

- **Add/Edit Credential Screen:**
  - A "TOTP / 2FA" section with:
    - Text input for pasting `otpauth://` URIs or raw Base32 secrets.
    - **QR Scanner (Mobile only):** Camera-based QR code scanner using `expo-camera` or `expo-barcode-scanner` to scan the QR code shown by websites during 2FA setup. Parses the QR content as an `otpauth://` URI.
    - **QR Scanner (Extension):** Scan QR codes visible on the current page by capturing a screenshot region and decoding with a JS QR library (e.g., `jsQR`).
  - Preview: After entering/scanning a TOTP secret, immediately show the current code as confirmation that it's working.

- **Dedicated Authenticator View (Optional):**
  - A tab or screen that shows all credentials with TOTP codes in a single scrollable list — similar to the Authy/Google Authenticator home screen.
  - Each row shows: issuer/account label, live 6-digit code, countdown timer.
  - Sorted by issuer name, with a search bar for quick filtering.

### 13.6 Security Considerations

- **TOTP secrets are encrypted at rest** as part of the credential's `totp` field — they are only available when the vault is unlocked.
- **Codes are computed on-demand** from the secret + current time. No codes are cached or stored.
- **Clock drift:** TOTP is sensitive to clock accuracy. If the device clock is significantly off, codes won't match. Consider showing a warning if the device time appears to be out of sync (compare against an NTP check or server timestamp during sync).
- **Clipboard auto-clear:** TOTP codes copied to clipboard are auto-cleared after 30 seconds, consistent with password clipboard behavior.
- **Screen lock:** When the app locks (auto-lock timeout or manual), all displayed TOTP codes are immediately cleared from the UI. The `setInterval` timers are stopped.

### 13.7 Testing

- **RFC 6238 Test Vectors:** Validate against the official test vectors from the RFC (SHA-1, SHA-256, SHA-512 at specific timestamps).
- **RFC 4226 Test Vectors:** Validate HOTP (the underlying algorithm) against RFC 4226 Appendix D test values.
- **URI Parsing:** Test with various `otpauth://` URI formats — minimal (secret only), full (all parameters), missing issuer, non-standard algorithms, different digit counts (6, 7, 8).
- **Base32 Decoding:** Test standard strings, lowercase, with spaces/hyphens, with/without padding, invalid characters.
- **Countdown Timer:** Verify `getRemainingSeconds()` returns correct values at period boundaries.
- **Edge Cases:** Empty secret, invalid URI scheme, `otpauth://hotp/` (not supported — should return clear error), period of 0, digits outside 6–8 range.

## 14. Vault Unlock Performance Strategy

### The Problem

Argon2id key derivation using `@noble/hashes` runs in pure JavaScript. On mobile (Hermes engine), the mobile preset (`t: 2, m: 19_456, p: 1`) takes **10–30 seconds** — far too slow for daily unlock. Desktop (V8/SpiderMonkey) fares better at 1–3 seconds, but is still noticeable.

This is a fundamental tension: Argon2id _must_ be slow (that's its security purpose — it resists brute-force attacks), but users expect sub-second vault access for everyday use.

### Strategy: Two-Tier Unlock

Separate the "daily unlock" path (fast) from the "master password unlock" path (slow but secure).

#### Tier 1 — Biometric / Cached DEK (Target: <200ms)

After the user unlocks with their master password for the first time, offer to enable biometric unlock:

1. Derive the DEK via Argon2id (slow, one-time).
2. Store the DEK in the platform's secure enclave:
   - **iOS:** Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` + biometric access control (`SecAccessControlCreateFlags.biometryCurrentSet`), via `expo-secure-store` with `requireAuthentication: true`.
   - **Android:** Android Keystore with `setUserAuthenticationRequired(true)` + biometric prompt.
   - **Desktop (Tauri):** OS keyring (macOS Keychain, Windows Credential Manager) via `tauri-plugin-stronghold`.
3. On subsequent launches, retrieve the DEK directly from the secure enclave after biometric authentication — **no Argon2id needed**.
4. Invalidate the cached DEK when: biometric enrollment changes, user disables biometric unlock, master password is changed, or after a configurable maximum age (default: 14 days).

This is the primary daily unlock path. Most users will never wait for Argon2id after initial setup.

#### Tier 2 — Master Password with Native Argon2id (Target: <2s on mobile)

For the master password path (first unlock on a new device, biometric disabled, re-authentication after timeout), Argon2id cannot be avoided. To bring the time down from 10–30s to <2s on mobile:

1. **Async Argon2 adapter (✅ IMPLEMENTED):** The core KDF layer now uses a platform-pluggable `Argon2Adapter` interface. All vault operations (`deriveKEK`, `createVaultHeader`, `unlockVault`, `unlockVaultWithRecovery`, `changeMasterPassword`) are fully async. The two KDF calls in `createVaultHeader` run in parallel via `Promise.all` for ~2x speedup.

   ```typescript
   // packages/core/src/crypto/argon2-adapter.ts
   export interface Argon2Adapter {
     hash(password: Uint8Array, salt: Uint8Array, params: Argon2Params): Promise<Uint8Array>;
   }

   // Set native adapter at app startup (one-time):
   setArgon2Adapter(nativeAdapter);
   // If never called, the JS fallback (@noble/hashes/argon2) is used automatically.
   ```

   - Mobile: native module (async, runs on native thread — doesn't block JS/UI).
   - Desktop (Tauri): Rust `argon2` crate called via Tauri command (native speed).
   - Browser extension: `@noble/hashes/argon2` (still fast enough in V8).
   - Tests: `@noble/hashes/argon2` (zero-config fallback).

2. **Native Argon2id module (TODO):** Create an Expo native module (`packages/expo-argon2`) wrapping the reference C implementation (`libargon2`). Compile via CocoaPods (iOS) and CMake (Android). Expose a single async function: `nativeArgon2id(password, salt, params) → Uint8Array`. Wire it up in the mobile app via `setArgon2Adapter()` at startup.

3. **UX during derivation:** Show a progress indicator with messaging ("Deriving encryption key…") so the user knows the app isn't frozen. Since native Argon2id runs on a background thread, the UI remains responsive.

#### Tier 3 — Cloud Sync / New Device (Acceptable: 2–5s)

When restoring a vault from a cloud backup onto a new device, the user must enter their master password. This is the one scenario where a multi-second wait is acceptable and expected:

1. Download encrypted vault blob from cloud storage.
2. Derive DEK via Argon2id (native module — ~1–2s).
3. Decrypt all items.
4. Prompt to enable biometric unlock for future sessions.
5. All subsequent unlocks use Tier 1 (biometric).

#### Parameter Tuning

The current mobile preset (`t: 2, m: 19_456, p: 1`) was chosen for OWASP compliance in pure JS. With a native module, we can potentially increase parameters for better security while maintaining acceptable speed:

| Implementation   | Preset            | Expected Time | Notes                        |
| ---------------- | ----------------- | ------------- | ---------------------------- |
| Pure JS (Hermes) | t:2, m:19456, p:1 | 10–30s        | Current — too slow           |
| Native C (iOS)   | t:2, m:19456, p:1 | 0.3–0.8s      | Same params, native speed    |
| Native C (iOS)   | t:3, m:65536, p:4 | 1–2s          | Desktop params on mobile     |
| Rust (Tauri)     | t:3, m:65536, p:4 | 0.3–0.5s      | Desktop is already fast      |
| Pure JS (V8)     | t:2, m:19456, p:1 | 1–3s          | Browser extension — adequate |

The vault header already stores Argon2id parameters per-vault, so parameter upgrades are backward-compatible.

### Implementation Priority

1. **✅ DONE:** Async Argon2 adapter pattern — all core crypto functions are async, adapter interface is defined, JS fallback works automatically, `createVaultHeader` parallelizes the two KDF calls.
2. **Immediate (v0.1):** Ship biometric unlock (Tier 1). This solves 95% of the daily UX problem with no Argon2id changes needed.
3. **Next (v0.2):** Build native Argon2id Expo module (`packages/expo-argon2`) wrapping `libargon2` C for iOS/Android. Wire via `setArgon2Adapter()`. Unlocks master-password path for acceptable speed + ability to increase security parameters.
4. **Later (v0.3):** Cloud sync integration (Tier 3). By this point both fast-path and slow-path are optimized.

## 15. Cloud Sync Frontend Integration

The cloud sync frontend work is split into sub-projects with clear dependency ordering:

### Sub-project 1: Sync Settings UI (Desktop + Mobile)

**Status:** In progress — see `docs/superpowers/specs/2026-03-17-sync-settings-ui-design.md`

Build dedicated sync settings screens for desktop and mobile. Provider picker (WebDAV functional; Google Drive and iCloud show "Coming Soon" disabled state), connection management, sync status display, and manual sync trigger. Add `triggerSync()` to vault contexts. Add disabled "Restore from Cloud" placeholder to setup screens.

### Sub-project 2: Google OAuth (Desktop + Mobile)

**Status:** Not started — depends on Sub-project 1

**Desktop:** Implement `createDesktopGoogleAuth()` in `apps/desktop/src/lib/google-auth.ts`. Requires a localhost HTTP callback server (likely via Tauri Rust backend) to capture the OAuth redirect. Must handle token exchange and refresh token storage.

**Mobile:** Implement `createMobileGoogleAuth()` in `apps/mobile/lib/google-auth.ts`. Use `expo-auth-session` for the OAuth flow with PKCE. Handle token exchange and secure refresh token storage via `expo-secure-store`.

Both platforms already have stub files that throw "not implemented" errors. The sync settings UI (Sub-project 1) already shows Google Drive in the provider picker — this sub-project enables it by removing the disabled state and wiring the OAuth flow into the Connect handler.

### Sub-project 3: iCloud Filesystem (iOS + macOS)

**Status:** Not started — depends on Sub-project 1

**iOS (Mobile):** Implement iCloud Drive file operations using `expo-file-system` pointed at the iCloud container path (`~/Library/Mobile Documents/iCloud~com.keykeykey/`). Requires iCloud entitlement and container identifier in `app.json`. The sync adapter already supports iCloud config (`SyncConfig.icloud.containerPath`).

**macOS (Desktop):** Implement iCloud Drive access via Tauri filesystem commands. macOS can access `~/Library/Mobile Documents/` directly. Requires iCloud Drive enabled in System Preferences and the app's entitlements.

This sub-project enables the iCloud option in the sync settings UI by removing the disabled state.

### Sub-project 4: Restore from Cloud

**Status:** Not started — depends on Sub-projects 2 and 3

Build the "Restore from Cloud" onboarding flow, replacing the disabled placeholder from Sub-project 1:

1. User taps "Restore from Cloud" on the setup screen
2. Provider selection (WebDAV, Google Drive, iCloud) with authentication
3. Download encrypted vault from cloud storage
4. Enter master password → Argon2id derivation → decrypt vault
5. Import all items into local storage
6. Prompt to enable biometric unlock
7. Redirect to vault

This flow must handle: provider authentication (reuses OAuth from Sub-project 2), vault download, decryption failure (wrong password), and partial/corrupt downloads.

## 16. Password History (`packages/core` + all apps)

When a user changes a credential's password, the old password is preserved in a per-credential history list. This lets users recover previous passwords (e.g., after a site revert, or when a service still uses an old password elsewhere).

### 16.1 Data Model

Add `passwordHistory` to the `Credential` Zod schema:

```typescript
passwordHistory: z.array(
  z.object({
    password: z.string(),
    changedAt: z.string().datetime(), // when this password was replaced (not when it was set)
  }),
)
  .max(20)
  .default([]);
```

- **Stores:** old password string + ISO 8601 timestamp of when the password was replaced by a new one.
- **Cap:** 20 entries per credential. When the 21st is added, the oldest (index 0) is dropped.
- **Default:** `[]` — backward-compatible with existing credential blobs (Zod's `.default()` fills in the empty array when the field is missing on parse). No migration required.
- **Storage order:** Chronological — oldest at index 0, newest at the end. UI displays in reverse.

### 16.2 Store Logic

In `updateItem()`, when a credential's `password` field changes:

1. Read the current `password` from the existing credential.
2. Compute `now` — the same timestamp used for `updatedAt`.
3. Push `{ password: currentPassword, changedAt: now }` onto `passwordHistory`.
4. If `passwordHistory.length > 20`, drop the oldest entry (index 0). Cap must be enforced **before** Zod validation (`.max(20)` is a safety net).
5. Apply the new password and updated history together.

**Guards:**

- Only triggers for `credential` type items.
- Only triggers when the new password differs from the current one (no duplicates on no-op saves).
- `addItem()` (including imports) does **not** trigger history — fresh inserts start with `[]`.

### 16.3 UI Integration

All platforms (desktop, mobile, extension):

- **Credential detail screen:** A "Password History (N)" button/link as the **last item** on the screen, below notes. Hidden when `N === 0`.
- **Expanding/opening** shows entries in reverse chronological order (newest first):
  - Each row: masked password (dots) + "Changed on [date]"
  - Reveal toggle (eye icon) to show the actual password, with the same auto-hide timeout as the current password reveal
  - Copy button per entry
- **Clear History:** A "Clear History" action (with confirmation) to purge all history entries for security hygiene (e.g., after a breach rotation).
- **Clipboard auto-clear:** Copying a historical password follows the same 30-second auto-clear as the current password.
- **Search exclusion:** `passwordHistory` entries must **not** be included in the vault search index.

### 16.4 Import, Export & Sync

- **Import:** Imported credentials start with `passwordHistory: []`. No CSV format includes history.
- **Export:** `passwordHistory` is **not** included in CSV export. Export must use an explicit field allowlist (not spread the whole object) to prevent leakage via `.passthrough()`. Keeps the CSV compatible with other password managers.
- **Sync:** No special handling. History is part of the credential blob — encrypts, syncs, and merges like any other field. Last-Write-Wins on the whole credential applies.
  - **Known limitation:** LWW at the item level means concurrent edits on different devices can silently drop history entries. This is accepted as a trade-off of the current item-level merge strategy.

### 16.5 Security Considerations

- **Encrypted at rest:** History is part of the credential blob — encrypted with the DEK.
- **Search exclusion:** Historical passwords are never indexed or searchable.
- **Export exclusion:** Historical passwords are never included in CSV exports.
- **Memory surface:** Password history increases in-memory password strings when the vault is unlocked (up to 20 additional per credential). This extends the existing limitation that decrypted items in the JS heap cannot be reliably zeroed. Bounded by the 20-entry cap.

### 16.6 Testing

- **Schema:** Verify `passwordHistory` defaults to `[]` when missing (backward compat). Verify `.max(20)` rejects arrays over 20.
- **Store logic:** Verify history is pushed when password changes. Verify history is **not** pushed when password stays the same. Verify oldest entry is dropped at the 21-entry boundary. Verify non-credential items (Card, SecureNote) are unaffected. Verify `changedAt` matches the `updatedAt` timestamp.
- **Round-trip:** Create credential → update password 3 times → verify history has 3 entries with correct passwords and timestamps in order.
- **Cap enforcement:** Update password 25 times → verify only the 20 most recent are kept.
- **Export:** Verify `passwordHistory` is not included in CSV output.
- **Import:** Verify imported credentials have empty history.
- **Search:** Verify old passwords in history are not returned by vault search.
- **Clear history:** Verify clearing history sets `passwordHistory` to `[]`.

## Next Steps

Once you approve this detailed specification, we will:

1. Initialize the monorepo structure (Turborepo).
2. Setup the empty packages and apps.
3. Begin implementing the Core cryptography logic.
