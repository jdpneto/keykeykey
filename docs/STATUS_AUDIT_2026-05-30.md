# KeyKeyKey — Project Status Audit vs. `implementationplan.md`

**Date:** 2026-05-30
**Auditor:** Claude (full-repo audit)
**Baseline spec:** `implementationplan.md` (16 sections, last touched 2026-04-29)
**Scope:** Every package and app, the test suites, and CI — compared section-by-section against the design.

> This document is a _delta report_: what the spec asked for vs. what the code actually does today, plus
> proposed next steps. It is meant to complement (not replace) the existing `IMPLEMENTATION_STATUS.md`,
> `docs/CODEX_HANDOFF.md`, and `SECURITY_AUDIT.md`.

---

## 0. How this audit was done (and its caveats)

**Directly verified this session (live runs on this machine, 2026-05-30):**

| Check                    | Command                                                      | Result                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build (shared pkgs)      | `pnpm --filter @keykeykey/core --filter @keykeykey/ui build` | ✅ success                                                                                                                                                                                                                  |
| Core unit/property tests | `pnpm --filter @keykeykey/core test`                         | ✅ **989 passed / 65 files**                                                                                                                                                                                                |
| UI tests                 | `pnpm --filter @keykeykey/ui test`                           | ✅ **25 passed / 2 files**                                                                                                                                                                                                  |
| Extension tests          | `pnpm --filter @keykeykey/extension test`                    | ✅ **226 passed / 20 files**                                                                                                                                                                                                |
| Desktop tests            | `pnpm --filter @keykeykey/desktop test`                      | ✅ **111 passed / 14 files**                                                                                                                                                                                                |
| Mobile tests             | `pnpm --filter @keykeykey/mobile test`                       | ✅ **229 passed / 31 suites on Node 26** after `pnpm install --force` repaired a corrupted `node_modules`. Root cause was a stray `package-lock.json`, **not** the Node version (failed the same on 22 & 26). See caveat 1. |

**Verified via read-only exploration subagents:** mobile, desktop, extension, core/ui, and CI/testing each got a
dedicated deep pass; their findings are folded in below.

**Caveats — treat these specifics as "high-confidence but confirm":**

1. **Mobile Jest — RESOLVED. It was a corrupted local `node_modules`, NOT the Node version.** Symptom: all 31
   mobile suites died parsing `@react-native/js-polyfills/error-guard.js` (Flow `type` → "Missing semicolon
   (14:4)", `Tests: 0 total`) at jest-expo's `react-native/jest/setup.js:326` — babel wasn't stripping Flow.
   **Verified NOT a Node issue:** the same test failed _identically_ on Node 22 and Node 26 (my original
   "Node 26 mismatch" claim was wrong), and CI's "Test Mobile App" job is green on the latest main run using the
   same commands on Node 22. **Root cause:** a stray `package-lock.json` (an `npm install` run in this pnpm-only
   repo) had flattened/degraded the `node_modules` so jest-expo couldn't apply `babel-preset-expo`. A _frozen_
   reinstall did NOT repair it (it skips resolution); **`pnpm install --force` did** — it re-added 1,564 packages
   and the suite then passed **229/229 tests across 31 suites on Node 26** (verified this session). There is no
   `babel.config.js` in the repo and none is needed — jest-expo's preset provides the babel config; CI passes
   without one. **Follow-up (cheap):** gitignore `package-lock.json`/`yarn.lock` so a stray `npm install` can't
   silently degrade the pnpm workspace again.

   **Exact mechanism (root-caused & proven by A-B-A experiment):** jest-expo's `jest-preset.js` wires the
   transform to `babel-jest` with a config from `resolveBabelConfig(cwd)`. With no `babel.config.js` in
   `apps/mobile` (there is none, by design), `resolveBabelConfig` falls through to `require.resolve(
'babel-preset-expo')`; on `MODULE_NOT_FOUND` it returns `null`, so babel runs with **no preset** and does not
   strip Flow — RN's `@react-native/js-polyfills/error-guard.js` (`type ErrorHandler = …`) then hits @babel/parser
   raw → "Missing semicolon (14:4)". Crucially, **`jest-expo` does not depend on `babel-preset-expo`** (only
   `expo` does), so jest-expo resolves it solely via the top-level `node_modules/babel-preset-expo` symlink. An
   `npm install` (the root has no `workspaces` field, so npm ignores `pnpm-workspace.yaml`) flattens
   `node_modules` and destroys that symlink. **Proof:** removing only that one symlink reproduces the exact error
   and `Tests: 0`; restoring only it returns 9/9 → 229/229. So `--force` worked because it rebuilds the symlink
   farm; `--frozen-lockfile` into a degraded tree didn't because it skips re-linking.

2. **Shell flakiness during the audit.** The sandbox intermittently dropped tool output, so a few low-level
   specifics (exact Argon2 preset numbers — see §2) lean on subagent reads rather than my own re-read. Where
   that matters, it is called out explicitly as **confirm**.

---

## 1. Executive summary

**Verdict: the project is substantially _ahead_ of the original plan, not behind it.** Every numbered feature
section of `implementationplan.md` (§1–§16) is implemented and tested, on top of which the team shipped several
things that were never in the plan (PIN unlock, encrypted-ZIP backup, a biometric/DEK-protector abstraction
layer, recovery-key flows, an adaptive tablet shell). 1,351 unit/integration tests pass across core+ui+
extension+desktop, with E2E (Playwright + Selenium for Firefox + Maestro for mobile) on top.

What remains is **the "last mile": release/CD automation, a handful of platform-specific gaps (Windows Hello,
iOS autofill master-password path, desktop global shortcuts), and the explicitly-deferred `{iCloud + local-FS
sync + Safari}` cluster** which the plan itself parks pending a shared design decision.

There is **one correctness item worth resolving before any release**: a documented-vs-coded drift in the Argon2
KDF preset (§2). Everything else is polish or scope-completion.

Maturity by area (●●● mature / ●●○ working, gaps / ●○○ stub-or-deferred):

| Area                                        | Maturity | One-line status                                               |
| ------------------------------------------- | -------- | ------------------------------------------------------------- |
| Core crypto / models / store                | ●●●      | Envelope encryption, async KDF adapter, 100%-covered crypto   |
| Sync engine (core)                          | ●●●      | WebDAV + 3 OAuth providers, LWW + tombstones + GC             |
| Password generator / import / export / TOTP | ●●●      | All shipped with RFC vectors + property tests                 |
| Browser extension (Chrome/Firefox)          | ●●●      | Popup + background + autofill + sync, full E2E                |
| Desktop (Tauri/macOS)                       | ●●○      | Full app + Touch ID; no Win Hello, no global shortcut         |
| Mobile (iOS/Android)                        | ●●○      | Full app + native argon2 + autofill; iOS appex MP-unlock stub |
| Testing                                     | ●●○      | Excellent unit/E2E; mobile E2E + Rust tests not in CI         |
| CI security gates                           | ●●●      | Semgrep + gitleaks + osv-scanner + license check              |
| Release / CD automation                     | ●○○      | No changesets / signing / store pipelines                     |
| iCloud + local-FS sync + Safari             | ●○○      | Deferred by design (shared blocker)                           |

---

## 2. Section-by-section conformance to `implementationplan.md`

Legend: ✅ done · 🟡 partial / has gaps · ⏸ deferred by design · ❗ discrepancy to resolve

### §1 Monorepo & technology strategy — ✅

Turborepo + pnpm workspaces (`pnpm-workspace.yaml`), ESM throughout, `workspace:*` internal deps, Turbo task
graph with `^build` ordering (`turbo.json`). Matches the proposed structure exactly (`packages/{core,ui}`,
`apps/{mobile,desktop,extension}`).

### §2 Shared core & encryption model — ✅ with ❗ one drift to confirm

- Envelope encryption (MasterPassword → Argon2id → KEK → wraps DEK; recovery key = alternate unwrap path) is
  implemented in `packages/core/src/crypto/` (`kdf.ts`, `encryption.ts`, `vault-header.ts`, `recovery.ts`,
  `dek.ts`). XChaCha20-Poly1305 via `@noble/ciphers`; Argon2id via `@noble/hashes` fallback.
- The pluggable **`Argon2Adapter`** interface + `setArgon2Adapter()` exists and all vault ops are async;
  `createVaultHeader` parallelizes its two KDF derivations with `Promise.all`. DEK is held in a closure
  (`store/dek-holder.ts`) and zeroed on lock/reset.
- **❗ Argon2 preset — RESOLVED: code is correct, docs had drifted.** I verified `crypto/constants.ts`:
  `ARGON2_PRESETS` defines **all four presets (`desktop`, `mobile`, `browser`, `pin`) identically** at
  `{ t: 2, m: 19_456, p: 1, dkLen: 32 }`, and each app passes its named preset
  (`apps/desktop/.../vault-context.tsx` → `ARGON2_PRESETS.desktop`, mobile → `.mobile`, extension → `.browser`),
  all resolving to the same values. So the plan's "unified preset" claim is **accurate** and there is **no
  cross-platform portability bug** (params are also stored per-vault in the header and read back on unlock).
  The drift was purely **stale documentation that contradicted the code in the same repo**:
  (1) the `constants.ts` file-header comment claimed "Desktop: Strong preset (64 MiB, 3 iterations, 4
  parallelism)"; (2) `crypto/crypto.bench.ts` labelled a benchmark "desktop preset (t=3, m=65536, p=4)" while
  actually feeding it the unified light preset; (3) `CLAUDE.md` repeats the same stale "heavy desktop preset /
  ~15–20 s unlock" claim. **Fixed this session:** the `constants.ts` header comment and the `crypto.bench.ts`
  label. **Still stale (recommend fixing):** the `CLAUDE.md` "Argon2 wait times" note — desktop now uses the
  light preset via native Rust argon2, so its real unlock time should be sub-second, not 15–20 s (the
  `sleep 20` test guidance is over-conservative; measure before changing it). **Nice-to-have:** a cross-platform
  "golden header" test asserting TS / Swift / Kotlin / Rust all unwrap a header created under the shared preset.

### §3 Mobile app (Expo) — ✅ (one appex stub)

Expo Router with the full screen set (`setup`, `unlock`, `recovery`, `restore`, tabbed vault/authenticator/
generator/settings, item add/edit/detail, QR scan, settings/sync, settings/import, settings/export).
`expo-sqlite` (with the App-Group `directory` parameter + legacy-path migration — the absolute-path trap from
memory is handled), `expo-secure-store`, biometrics via `expo-local-authentication` + native ACL-protected DEK,
and **`react-native-argon2` wired through `setArgon2Adapter()` in `app/_layout.tsx`** at startup.
**Gap:** the iOS AutoFill extension's _master-password_ unlock path is a stub
(`targets/credential-provider/CredentialProviderViewController.swift:187` "Implement master password KDF when
Argon2 is linked"; `VaultAccess.swift:288` "Implement when SQLite write access is available"). Biometric/PIN
autofill works; cold master-password unlock inside the appex does not yet.

### §4 Desktop app (Tauri 2) — 🟡

All 14 React screens present; Rust backend modules for `argon2_cmd` (native KDF, wired via
`src/lib/tauri-argon2-adapter.ts` + `setArgon2Adapter` in `vault-context.tsx`), `biometric_cmds/macos.rs`
(Touch ID, Keychain `kSecAccessControlBiometryCurrentSet`), `oauth_server.rs`, `http_proxy.rs` (SSRF guards,
13 tests), `keyring_cmds.rs`, `storage.rs`, `clipboard_cmds.rs`.
**Gaps vs. plan:** **Windows Hello** is a stub (`biometric_cmds/stub.rs`; design doc exists); **global shortcuts
(`Cmd+Shift+Space` quick search)** are _not implemented_ (no `tauri-plugin-global-shortcut`). Two minor TODOs in
`vault-context.tsx` (auto-lock flag stored in keyring, should be SQLite).
**Security note (good):** no `LOCAL TESTING ONLY` bypasses remain in `http_proxy.rs` or the WebDAV adapter.

### §5 Browser extensions — ✅ (Safari deferred)

MV3 via CRXJS, per-target Chrome/Firefox builds, popup + background service worker (DEK in memory, auto-lock via
`alarms` + keepalive, per-tab credential allowlists, sender guards) + content scripts (form detection,
shadow-DOM autofill icon, OTP detection, save-prompt, HTTPS/iframe guards). Encrypted `storage.local` with
v1→v2 migration. Chrome + Firefox have full Playwright/Selenium E2E.
**Gap vs. plan §5:** the **Safari OAuth-degradation UI is still not wired** — `browser-detect.ts` detects Safari,
but the provider picker does not disable Google/Dropbox/OneDrive or surface the WebDAV-only hint. Safari itself
remains deferred (consumed via the Xcode Chrome-build converter, not a first-class target).

### §6 Cloud sync (BYOC) — ✅ shipped providers; ⏸ deferred cluster

Shipped adapters in `packages/core/src/sync/adapters/`: **WebDAV, Google Drive, Dropbox, OneDrive**
(+ `memory-adapter` for tests, shared `base-http-adapter`). `SyncProvider` =
`none|webdav|google-drive|dropbox|onedrive` — **no `icloud`** (as the plan dictates). Conflict resolution is
Last-Write-Wins per item with tombstones + GC + blob-hash integrity checks (recent hardening: #101, #102).
**Deferred (matches plan):** local/network filesystem (Syncthing-style) adapter and iCloud — parked together
with Safari behind the shared "extensions can't reach the filesystem / iCloud has no REST" design constraint.

### §7 Testing strategy — 🟡 (excellent coverage; some layers not in CI)

- **Core (Vitest):** ✅ 989 tests, RFC test vectors (7539 ChaCha20, 9106 Argon2, 4226 HOTP, 6238 TOTP, 4648
  Base32, 7636 PKCE), `fast-check` property tests (crypto, vault-header, PIN). Crypto coverage thresholds
  enforced (`src/crypto/**`: statements 100 / functions 100 / lines 100 / branches 90).
- **UI / desktop / extension (Vitest+jsdom):** ✅ present and green.
- **Mobile (Jest/jest-expo):** ✅ test files exist (see caveat — local run blocked by Node version).
- **E2E:** ✅ Playwright `extension` + `desktop` projects, Selenium for Firefox, **Maestro mobile flows exist**
  (`e2e/mobile/flows/*.yaml`, 13 flows) — **but mobile E2E is not run in CI.**
- **Missing vs. plan:** Stryker mutation testing, Chromatic/Storybook visual regression, `size-limit` bundle
  budgets — none present (some were marked optional in the plan). **Rust `cargo test` is not a CI job** despite
  26 Rust tests existing.

### §7.9 CI/CD pipeline — 🟡

`.github/workflows/ci.yml` runs ~13 jobs: `lint` (Prettier+ESLint+gitleaks), `sast` (Semgrep:
typescript/secrets/owasp-top-ten), `audit` (osv-scanner + license allowlist — no GPL/LGPL/AGPL/SSPL/EUPL/
CC-BY-NC), `test-core/ui/desktop/extension/mobile`, `bench` (non-blocking), `e2e-extension` (Chromium @critical,
**blocking**) + `e2e-extension-firefox` (serialized, blocking), and a `build` gate. Plus `ios-domain-matcher.yml`
and `psl-staleness.yml`.
**Gaps vs. plan §7.9:** no release automation at all — **no changesets, no signed Tauri builds, no EAS, no
Play/App Store / web-store upload jobs**. No dedicated `test-sync` job (sync is covered only through E2E). No
`cargo test` job. Mobile Maestro not gated. **Time-boxed debt:** GitHub is forcing Node-20 actions to Node 24 by
**2026-06-02** (full removal 2026-09-16) — the pinned actions need bumping.

### §8 Import — ✅

RFC 4180 parser, `detectSource()`, parsers for Chrome / Firefox / Bitwarden / iCloud / 1Password (+ a
`keykeykey` re-import parser), `toVaultItems()` mapping folders→tags. Skip-tracking present.

### §9 Autofill — ✅ (iOS appex MP-unlock stub, per §3)

Mobile iOS AutoFill Credential Provider (12 Swift files) + Android `AutofillService` (17 Kotlin files), both
sharing a PSL-backed `DomainMatcher` cross-validated against `domain/__fixtures__/domain-match.json` (TS/Swift/
Kotlin parity). Extension content-script autofill per §5. Ranking: exact URL > host > base domain.

### §10 Password generator — ✅

Random + passphrase, EFF 7,776-word list, entropy + strength bands, `crypto.getRandomValues()` only. (Note the
fixed passphrase word-count edge case for hyphenated EFF entries, #95.)

### §11 Notes on all entry types — ✅

Notes on Credential/Card, content on SecureNote; tab-aware `search(query, {types, deepFields})` in the store
exactly as specified (All/Logins shallow; Cards/Notes deep). `cvv`/`pin` never indexed.

### §12 CSV export — ✅

`exportToCsv()` with the spec column order, UTF-8 BOM, RFC 4180 quoting, credential-only default, and an
**explicit field allowlist** so `passwordHistory`/`appIdentifiers` never leak.

### §13 TOTP authenticator — ✅

RFC 6238/4226 engine, Base32 decoder, hand-rolled `otpauth://` parser, `getRemainingSeconds()`, SHA-1/256/512.
UI on all platforms incl. mobile camera QR scan and dedicated authenticator views.

### §14 Vault unlock performance — ✅ (with §2 caveat + plan-vs-impl detail)

- **Tier 1 (biometric/cached DEK):** ✅ mobile iOS+Android, desktop **macOS Touch ID**.
- **Tier 2 (native Argon2):** ✅ desktop Rust `argon2` crate; mobile uses **`react-native-argon2`** — note this
  differs from the plan's intent to build a custom `packages/expo-argon2` wrapping `libargon2` (a
  `native-argon2-plan.md` exists). Functionally fine, but it's why the §2 cross-platform bit-identical-KDF
  concern matters.
- **Tier 3 (cloud restore):** ✅ implemented (see §15.4).
- **Pending:** Windows Hello.

### §15 Cloud sync frontend — ✅ mostly

- **Sub-1 Sync Settings UI** ✅ (desktop + mobile + extension).
- **Sub-2 Google OAuth** ✅ — and Dropbox + OneDrive shipped alongside.
- **Sub-3 iCloud filesystem** ⏸ deferred (see §6).
- **Sub-4 Restore from cloud** ✅ — WebDAV path is end-to-end; **the OAuth-provider restore happy-path + refresh-
  token-persists-after-restore still want a deep verification** (open item carried from the plan).

### §16 Password history — ✅

`passwordHistory` (max 20, default `[]`), store logic (credential-only, only on real change, cap enforced),
`restorePasswordFromHistory()` + `rebuildAfterRestore()`, UI on all platforms, excluded from search and CSV
export.

---

## 3. Implemented _beyond_ the plan (scope additions)

These exist in the codebase but were not in `implementationplan.md`:

- **PIN unlock** — `packages/core/src/pin/` with validation + DEK-wrapping + property tests; surfaced on all apps.
- **Encrypted backup (ZIP)** — `packages/core/src/export-import-zip/` (password-protected backup beyond plain CSV).
- **Biometric/DEK abstraction layer** — `packages/core/src/biometric/` + `unlock/` (`OSBiometricStore` +
  `DEKProtector` seam, refactors #89–#91).
- **Recovery-key UX** — dedicated recovery screens on all platforms.
- **Adaptive tablet shell** — recent mobile work (tablet sidebar, orientation handling, #0c0eb4c/#115).

---

## 4. Discrepancies & drift (the actionable list)

| #   | Item                                                                                                                                                                                                                                                                                                                                             | Where             | Severity                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- | -------------------------------------- |
| D1  | **Argon2 preset docs drift (RESOLVED).** Code is correct & unified (`t:2, m:19_456, p:1` everywhere); only stale docs claimed a heavy desktop preset. Fixed `constants.ts` comment + `crypto.bench.ts` label this session; `CLAUDE.md` "15–20 s" note still stale.                                                                               | core + docs       | Low (docs only; mostly fixed)          |
| D2  | Mobile Jest failed locally (all 31 suites; RN polyfill not Flow-stripped) — **RESOLVED.** Root cause: stray `package-lock.json` degraded the pnpm `node_modules`. **NOT Node 26** (failed the same on 22 & 26); CI green on 22. Fixed by `pnpm install --force` → 229/229 pass on Node 26. Follow-up: gitignore `package-lock.json`/`yarn.lock`. | tooling/local-env | Resolved                               |
| D3  | iOS AutoFill appex master-password unlock is a stub.                                                                                                                                                                                                                                                                                             | mobile appex      | Medium                                 |
| D4  | No release/CD automation (changesets, signing, EAS, store uploads).                                                                                                                                                                                                                                                                              | CI                | Medium (ship-blocker for distribution) |
| D5  | Mobile Maestro E2E + Rust `cargo test` exist but aren't gated in CI.                                                                                                                                                                                                                                                                             | CI                | Medium                                 |
| D6  | Safari OAuth-degradation UI not wired; iCloud "Coming Soon" placeholder absent.                                                                                                                                                                                                                                                                  | extension/mobile  | Low (cheap)                            |
| D7  | Desktop global shortcuts (`Cmd+Shift+Space`) not implemented.                                                                                                                                                                                                                                                                                    | desktop           | Low                                    |
| D8  | Windows Hello biometric is a stub.                                                                                                                                                                                                                                                                                                               | desktop           | Low (design doc exists)                |
| D9  | Node-20 GitHub Actions deprecation deadline **2026-06-02**.                                                                                                                                                                                                                                                                                      | CI                | Low but time-boxed                     |
| D10 | `graphify-out/` is stale (Apr 30) and `CLAUDE.md` points to `graphify-out/wiki/index.md`, which does not exist.                                                                                                                                                                                                                                  | docs/tooling      | Low                                    |
| D11 | Status docs sprawl: `IMPLEMENTATION_STATUS.md`, `CODEX_HANDOFF.md`, `CLEANUP.md`, this file, etc. overlap.                                                                                                                                                                                                                                       | docs              | Low                                    |

---

## 5. Proposed next steps (prioritized)

### P0 — correctness / pre-release must-do

1. **Mobile Jest (D2) — done this session** (`pnpm install --force` → 229/229 pass on Node 26; root cause was a
   stray `package-lock.json`, not Node version). Remaining cheap follow-up: gitignore `package-lock.json`/
   `yarn.lock` so a stray `npm install` can't silently degrade the pnpm `node_modules` again.
2. **Finish the iOS AutoFill master-password unlock path** (D3) so autofill survives biometric invalidation /
   first-use-after-reboot.
3. **Finish closing out D1:** correct the stale `CLAUDE.md` Argon2 wait-time note, and (nice-to-have) add the
   cross-platform golden-header test. The code itself is already correct — this is doc hygiene + a guard rail.

### P1 — complete the planned scope

4. **Release/CD automation (D4):** changesets versioning + signed Tauri binaries + EAS iOS/Android +
   extension store packaging. This is the single biggest gap between "feature-complete" and "shippable."
5. **Gate the existing-but-ungated test layers (D5):** wire Maestro mobile flows and `cargo test` into CI.
6. **Verify the OAuth restore happy-path end-to-end** (§15.4 open item), including refresh-token persistence so
   a restored vault can sync immediately.
7. **Windows Hello** (D8) — the design spec already exists under `docs/superpowers/specs/`.

### P2 — deferred-by-design, but cheap wins available now

8. Make the small independent placeholders the plan itself says are cheap: **iCloud "Coming Soon" entry** +
   **Safari OAuth-degradation UI** (D6).
9. Tackle the **`{iCloud + local/network FS sync + Safari}` cluster** as one design effort (native bridge /
   local IPC shim) — per the plan, solving one likely solves all three. Needs a design doc before code.
10. **Desktop global shortcuts** (D7).

### P3 — quality / hygiene

11. Bump Node-20 GitHub Actions ahead of the **2026-06-02** deadline (D9).
12. Add the optional rigor the plan mentioned: Stryker (CI-only), `size-limit` budgets, Storybook/Chromatic for
    `packages/ui`. Consider gating the (currently non-blocking) crypto benchmarks once baselines stabilize.
13. Refresh `graphify-out/` and fix the dangling `wiki/index.md` reference in `CLAUDE.md` (D10); consolidate the
    overlapping status docs into one canonical source (D11).

---

## 6. Appendix — verified numbers

- **Tests passing (live, Node 26):** core 989/65 · ui 25/2 · extension 226/20 · desktop 111/14 · **mobile
  229/31** (after `pnpm install --force` repaired a corrupted local `node_modules` — see caveat 1). Total
  verified green: **1,580** tests across all five packages.
- **Core entry points:** `crypto, models, store, sync, generator, domain, pin, biometric, unlock, utils, export,
import, export-import-zip, totp` (+ `testing`).
- **Sync adapters:** `webdav, google-drive, dropbox, onedrive, memory` (+ `base-http-adapter`); no iCloud.
- **CI workflows:** `ci.yml` (~13 jobs), `ios-domain-matcher.yml`, `psl-staleness.yml`.
- **Security gates:** Semgrep (SAST), gitleaks (secrets), osv-scanner (deps), pnpm-licenses allowlist.
- **Repo scale:** 392 commits; recent history maps cleanly onto plan sections (crypto → sync hardening →
  biometric → autofill → mobile release prep).
