# KeyKeyKey Implementation Status

**Last updated:** 2026-04-26
**Reflects:** the implementation audit (initial pass) + the spec reconciliation and code changes from the same session.

> **TL;DR** — The codebase is at ~92% of spec. The latest pass (1) corrected the spec to match reality where the code was ahead of the plan, (2) corrected the spec where reality intentionally diverges from the plan, (3) fixed two small spec-vs-code drifts (password-generator `customSymbols`, Android PSL parity), and (4) deferred the iCloud / Local-sync / Safari-extension cluster behind a shared design question. The remaining backlog is in §6 below.

---

## 1. Status at a Glance

Legend: ✅ Done · 🟡 Partial · ❌ Missing · ⏸ Deferred (needs design)

| §    | Area                                                 | Status | Notes                                                                              |
| ---- | ---------------------------------------------------- | ------ | ---------------------------------------------------------------------------------- |
| 1    | Monorepo (Turborepo + pnpm + 5 workspaces)           | ✅     | + extra `export-import-zip` module                                                 |
| 2    | Shared core (crypto, models, store, sync, generator) | ✅     | Argon2 unified preset across platforms (sync interop — spec now reflects this)     |
| 3    | Mobile app (Expo, biometrics, native Argon2)         | ✅     | Maestro flows exist; CI execution unclear                                          |
| 4    | Tauri desktop app                                    | ✅     | No global shortcut; Touch ID (macOS) shipped; Windows Hello pending                |
| 5    | Browser extension (Chromium + Firefox)               | 🟡     | Safari deferred (see §6)                                                           |
| 6    | Cloud sync core (ISyncAdapter + 4 cloud adapters)    | ✅     | Local/Syncthing adapter deferred (see §6)                                          |
| 7    | Automated testing strategy                           | 🟡     | UI tests, Cargo CI, Maestro CI, size-limit, Storybook still missing                |
| 8    | Password import (5 sources)                          | ✅     | All 5 + bonus `keykeykey` round-trip parser                                        |
| 9.1  | Mobile autofill (iOS + Android)                      | ✅     | Android now PSL-parity with iOS (this session)                                     |
| 9.2  | Extension autofill                                   | 🟡     | Save/fill done; auto-submit not implemented                                        |
| 10   | Password generator                                   | ✅     | `customSymbols` added this session                                                 |
| 11   | Notes field on all entry types                       | ✅     | Search now tab-scoped: shallow on All/Logins, deep on Cards/Notes                  |
| 12   | CSV export                                           | ✅     | RFC 4180, BOM, Chrome round-trip                                                   |
| 13   | TOTP authenticator                                   | ✅     | Core RFC-compliant; ext + mobile UI present                                        |
| 14   | Vault unlock perf (Tier 1/2/3)                       | 🟡     | Mobile Tier 1+2+3 done; desktop Touch ID (macOS) done; Windows Hello pending       |
| 15.1 | Sync settings UI                                     | ✅     | Spec corrected from "in progress"                                                  |
| 15.2 | Google OAuth (+ Dropbox + OneDrive)                  | ✅     | Spec corrected from "not started"                                                  |
| 15.3 | iCloud filesystem (iOS + macOS)                      | ⏸      | Deferred — same design question as Local + Safari                                  |
| 15.4 | Restore from cloud                                   | 🟡     | WebDAV done; OAuth restore needs verification                                      |
| 16   | Password history (view, restore, clear)              | ✅     | Schema + store + restore action + UI on all 3 platforms + E2E + base-test-flow §16 |

---

## 2. Changes Made This Session

### Spec doc (`implementationplan.md`)

- **§2** — Added a callout explaining that all platforms run the unified Argon2 preset (`t:2, m:19_456, p:1`) intentionally for sync interop, not because the desktop tier upgrade is still pending.
- **§5** — Marked Safari deferred. Documented the two blockers (no `launchWebAuthFlow`; no third-party iCloud REST → sandbox-can't-reach-iCloud-container). Noted that `browser-detect.ts` already detects Safari but the OAuth-degradation UI isn't wired yet.
- **§6** — Removed Local Adapter from the shipped list; moved it to a new "Deferred — needs design" subsection together with iCloud and Safari, with a paragraph explaining the shared sandbox/REST constraint.
- **§9.1** — Updated the "Shared Logic" subsection to document the new Android PSL parity (Kotlin port of the Swift parser, same data file, same fixture). Listed both native parsers and the shared fixture path.
- **§11** — Reframed the search bullet: main vault search is name/url/username/tags/appIdentifiers by design (a search for "amazon" should return the Amazon login, not every credential whose Notes mentions amazon). Note content remains searchable within a future dedicated notes-tab/view (which doesn't exist today).
- **§15.1** — Status changed from "In progress" to ✅ Done. Documented `triggerSync()`, mismatch dialog, and onboarding placeholder integration.
- **§15.2** — Status changed from "Not started" to ✅ Done. Documented the desktop loopback OAuth server (`apps/desktop/src-tauri/src/oauth_server.rs`), the mobile `expo-auth-session`+PKCE flow, and the bonus Dropbox+OneDrive shipping at the same time.
- **§15.3** — Marked deferred with a paragraph explaining the iCloud↔Safari↔Local-sync shared blocker. Documented current code state and noted that adding a "Coming Soon" placeholder to the mobile picker can land independently.
- **§15.4** — Status updated to "Mostly done". Documented core `restoreFromCloud()`, mobile/desktop UIs, onboarding integration, and the two open items (post-restore biometric prompt verification, OAuth-restore refresh-token persistence).

### Code

- **Tab-scoped search (`packages/core/src/store/vault-store.ts` + index.ts)** — `search()` now takes an optional `SearchOptions` with `types?: VaultItemType[]` and `deepFields?: boolean`. Default behavior unchanged (shallow, all types). Cards tab passes `{ types: ['card'], deepFields: true }` to also match `cardholderName`, `number`, `notes`. Notes tab passes `{ types: ['secure-note'], deepFields: true }` to match `content`. `cvv` and `pin` are intentionally never indexed. New types `SearchOptions` and `VaultItemType` exported from `@keykeykey/core`. Wired on all 3 platforms (`apps/desktop/src/screens/VaultListScreen.tsx`, `apps/mobile/app/(tabs)/index.tsx`, `apps/extension/src/popup/screens/VaultListScreen.tsx` + the SEARCH message handler in `background/handlers/items.ts`). 8 new core test cases cover the tab-scoped + deep-field behavior. Tests: core 931/931, desktop 81/81, extension 219/219, mobile 168/168.

- **`packages/core/src/generator/types.ts`** — Added `customSymbols?: string` to `RandomOptions` (only takes effect when `symbols: true` and the string is non-empty).
- **`packages/core/src/generator/generator.ts`** — Added `effectiveSymbolSet()` helper; updated `buildCharPool` and `getEnabledClasses` to honor `customSymbols`. Added a guard that drops empty classes from the rejection-sampling constraint set (e.g. when `customSymbols` is entirely composed of ambiguous chars and `excludeAmbiguous` is on).
- **`packages/core/src/generator/__tests__/generator.test.ts`** — 5 new test cases covering `customSymbols`: restricts to provided set, ignored when `symbols: false`, falls back to default when empty, drops ambiguous chars when `excludeAmbiguous: true`, lower entropy than default. **All 923 core tests pass.**

- **`apps/mobile/plugins/autofill-service/android/PublicSuffixList.kt` (new)** — Kotlin port of `PublicSuffixList.swift`. Same trie algorithm (rule / exception / wildcard, right-to-left walk), same data file format. Pure Kotlin (no Android imports) so it's straightforward to test independently.
- **`apps/mobile/plugins/autofill-service/android/DomainMatcher.kt`** — Replaced the bidirectional-suffix heuristic with the iOS algorithm: exact-host wins, otherwise PSL eTLD+1 equality. Added `initialize(context)` (idempotent, loads PSL from assets) plus test-only accessors. Falls back to exact-host equality when PSL data is missing — same fallback iOS uses.
- **`apps/mobile/plugins/autofill-service/android/DomainMatcherTest.kt` (new)** — Test scaffold matching the project convention (`CryptoBridgeTest.kt`, `TotpEngineTest.kt`). Hardcodes a representative subset of the shared fixture (`packages/core/src/domain/__fixtures__/domain-match.json`) plus PSL eTLD+1 spot-checks. Runnable from a debug build via `DomainMatcherTest.runAll(context)`.
- **`apps/mobile/plugins/autofill-service/android/AutofillServiceImpl.kt`** — Added `onCreate()` override that calls `DomainMatcher.initialize(applicationContext)`.
- **`apps/mobile/plugins/autofill-service/android/AuthActivity.kt`** — Same `DomainMatcher.initialize(applicationContext)` call in its `onCreate` (the cached-DEK path skips `AutofillServiceImpl.onCreate`, so we initialize from both entry points).
- **`apps/mobile/plugins/autofill-service/index.js`** — At prebuild, the plugin now copies `apps/mobile/targets/credential-provider/public_suffix_list.dat` to `android/app/src/main/assets/public_suffix_list.dat`. Single canonical data file lives in the iOS target dir to avoid drift between the two platforms.

---

## 3. Plan vs Reality — Drifts Resolved

Items where the spec was wrong and the spec is now corrected:

- §15.1 sub-project status (in-progress → done)
- §15.2 sub-project status (not-started → done; +Dropbox/OneDrive too)
- §15.3 status (not-started → deferred with reason)
- §15.4 status (not-started → mostly done)
- §6 Local Adapter (planned-but-missing → deferred with reason)
- §5 Safari (planned-but-missing → deferred with reason)
- §2 Argon2 preset (proposed desktop tier upgrade → unified preset is intentional)
- §11 search index (claimed-bug → intentional design: passwords-only main search)

Items where the code is now caught up to the spec:

- §10 `customSymbols` (was missing → implemented this session)
- §9.1 Android PSL parity (heuristic → PSL-aware to match iOS)

---

## 4. Remaining Backlog

Each item below has a one-line "what" and a one-line "shape" (rough effort + approach). Listed roughly in priority order — bug-class first, then capability-class, then testing-debt.

### Bug / parity items (low effort, clear scope)

- **`apple-app-site-association` hosting** — Need to confirm whether this file is hosted at `https://keykeykey.com/.well-known/apple-app-site-association` already. If not, publishing it unblocks autofill auto-domain-match on iOS without users having to add the site manually. Action: confirm hosting status; if it's not up, decide where it lives (this repo's docs site, a separate static-site repo, or a server endpoint).
- **iCloud "Coming Soon" placeholder in the mobile sync picker** — Cosmetic. Two implementation options: (a) extend `SyncProvider` enum with a non-functional `'icloud'` value (changes core; updates the no-icloud test), or (b) keep the enum as-is and special-case a disabled non-selectable "iCloud — coming soon" entry in the picker UI (UI-only). Option (b) is safer.

### Capability items (medium-large effort, deserve their own session)

- **Desktop biometric — Windows Hello** — macOS Touch ID is shipped (Keychain `kSecAccessControlBiometryCurrentSet` via `security-framework-sys` + `objc2` for LAContext, see `apps/desktop/src-tauri/src/biometric_cmds/macos.rs`). Windows Hello path needs the same shape (real biometric gating, not just a prompt) via `windows` crate's `Windows.Security.Credentials.UI.UserConsentVerifier` and DPAPI-encrypted DEK storage. Pickable when the implementer is on Windows hardware to test end-to-end.
- **Global keyboard shortcut on desktop** — `Cmd+Shift+Space` quick search per spec §4. Path forward: `tauri-plugin-global-shortcut`, register in `lib.rs`, route to a "quick-search overlay" window. Estimated half-day.
- **Auto-submit on extension** — Spec §9.2 calls it "optional, default off". Per-site setting in extension storage; content script clicks the submit button if enabled. Estimated half-day.
- **Restore-from-cloud OAuth verification** — Sub-project 4's WebDAV path is solid; the OAuth path is wired but the post-restore refresh-token persistence and the "enable biometric unlock" prompt need a manual end-to-end pass. Estimated half-day.

### Deferred — needs design (NOT pickable until the design question is answered)

- **iCloud sync (§15.3) + Local/network sync (§6) + Safari extension (§5)** — Per your direction, these share a common blocker: extensions are sandboxed, iCloud has no third-party REST API, so any solution that works for one likely needs to work for all. Probable shape: a small native helper that exposes local IPC (HTTP loopback or native messaging) which the extension can talk to, and which knows how to read/write to a filesystem or iCloud container. **Action:** design discussion before any code lands.

### Testing debt

- **Cargo tests not in CI** — `apps/desktop/src-tauri/src/{argon2_cmd,http_proxy,storage,oauth_server}.rs` all have `#[cfg(test)]` blocks that never run in CI. Adding a step needs Tauri system deps on the Ubuntu runner (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, etc.) plus a Rust toolchain action and cache. Recommend a separate `test-desktop-rust` job to keep blast radius small if it breaks. Estimated half-day.
- **`packages/ui` has 0 tests** — Vitest is configured. Either add component tests (and probably Storybook for visual regression as spec calls for) or downgrade the spec expectation if the package is genuinely just tokens/layout primitives. Need a decision on whether `packages/ui` should grow real components.
- **Maestro CI execution** — YAML flows exist in `e2e/mobile/flows/`; `apps/mobile` has a Jest job in CI but no visible Maestro step. Adding it needs an iOS Simulator on a macOS runner (cost) or Android Emulator on Ubuntu (cheaper but slower). Estimated 1 day to wire into CI properly.
- **`size-limit` for extension + desktop bundles** — Add `size-limit` config + CI step that fails on >10% size regression. Spec §7.8. Estimated 2 hours.
- **Stryker mutation testing** — Spec §7.1 marks it optional. Skip unless you specifically want it.
- **Changesets bootstrap** — `@changesets/cli` is installed but `.changeset/` directory was never created. Decide: do you want versioned releases? If yes, run `pnpm changeset init`; if no, remove the dep.
- **Nightly CI cron** — Spec §7.9 mentions nightly E2E. Not present in `.github/workflows/`. Could be added with a `schedule:` trigger.

---

## 5. Confidence Notes

- **Android PSL** — The Kotlin port is a mechanical translation of the Swift parser; both consume the same `public_suffix_list.dat`. I haven't been able to run the Kotlin unit tests in this session (the autofill-service plugin's Kotlin files don't have Gradle test infra; tests are scaffolds runnable via adb on a device). The existing iOS+TS fixture is the spec for behavior; if a case ever fails on Android, it's a port bug (not a fixture bug). I'd recommend running `DomainMatcherTest.runAll(applicationContext)` from a debug build entry point on the next mobile dev cycle.
- **`customSymbols`** — Tested with the full core test suite; 923/923 pass.
- **Spec corrections** — Verified against the per-section findings of the audit agents. If any section's claim feels off, the source-of-truth is the file paths cited in the audit (in the previous turn's agent output).

---

## 6. Questions Outstanding

Down from 12 to 5. Pick whichever you'd like to tackle next:

1. **Desktop biometric — Windows Hello** — same shape as the macOS path (now shipped); needs Windows hardware to test. Estimated 1 day.
2. **iCloud / Local-sync / Safari design** — when you've thought it through, want to brainstorm the bridge architecture together?
3. **`apple-app-site-association`** — is the file already hosted somewhere outside the repo, or does it need a publishing decision?
4. **Cargo CI** — should I add a separate `test-desktop-rust` job that installs Tauri's Linux build deps and runs `cargo test`? (Lower-risk than mixing it into the existing `test-desktop`.)
5. **Changesets** — keep & bootstrap, or remove the unused dep?

Smaller knock-on: the `iCloud "Coming Soon"` mobile-picker placeholder, auto-submit toggle in the extension, global shortcut on desktop, and `size-limit` for bundles are all half-day-each items I can pick up between bigger pieces — say the word and I'll line them up.
