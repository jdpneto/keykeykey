# Mobile E2E Testing via Maestro — Design

**Status:** Approved, pre-implementation
**Author:** Brainstormed with Claude, 2026-04-16
**Scope:** Automate the §1–§14 manual mobile regression flow from
`base-test-flow.md` on iOS Simulator and Android Emulator.

## Spec inventory

This design is the umbrella. Each PR has its own spec elaborating
file-level work:

- **PR-A — testID prep:** `2026-04-16-mobile-e2e-pr-a-testid-prep-design.md`
- **PR-B — scaffold + §1–§4:** `2026-04-16-mobile-e2e-pr-b-maestro-scaffold-design.md`
- **PR-C — §5–§14 flows:** `2026-04-16-mobile-e2e-pr-c-remaining-flows-design.md`

All three are written up-front so the full scope is visible now;
implementation is sequential (A → smoke locally → B → smoke → C).

## Motivation

Regression testing the mobile apps via `mobile-mcp` is accurate but slow —
each §1–§14 pass takes an hour-plus and requires a human at the keyboard.
The Chrome and Firefox extensions are covered by a fast Playwright
`@critical` suite (`e2e/extension/*.spec.ts`, ~1m 20s for 21 specs). We
want the same ergonomics for mobile: a tagged YAML suite that runs §1–§14
locally in minutes on both platforms, leaving MCP for the one scenario
(§15 autofill) that actually needs a human or a real device.

## Decision

Adopt **Maestro** as the mobile E2E framework.

**Considered and rejected:**

- **Appium + WebdriverIO** — battle-tested CI story but ~3× the
  boilerplate per spec, and well-known bridge-timing flakiness on
  React Native. The team's "local first, CI later" constraint removes
  Appium's main advantage.
- **Detox** — officially unsupported on Expo managed workflow. Requires
  keeping prebuilt `ios/`/`android/` in sync with Expo's continuous
  native generation; layering that on top of our existing Podfile
  patches is more integration pain than it's worth.

Maestro wins for this project because:

1. Local DX is best-in-class — YAML flows, single binary, fast loop.
2. Zero native-project coupling (works through Expo managed workflow).
3. The same flow file runs against Simulator, Emulator, or real device —
   no config changes when we move to real devices later.
4. Maestro Studio's record-and-replay accelerates writing the initial
   ~12 flows.
5. When we eventually want CI, `maestro test` runs on GitHub Actions
   macOS runners without Maestro Cloud.

## Scope

**In scope:** §1–§14 of `base-test-flow.md`, on iOS Simulator
(`iPhone 17 Pro`, iOS 18) and Android Emulator (`Pixel 7`, API 34).

**Out of scope:**

- §15 autofill — stays MCP/real-device-only. AutoFill Credential
  Provider (iOS) and AutofillService (Android) require host-external
  system UI that simulators don't reliably drive.
- CI integration (GitHub Actions). Local-only for now; revisit later.
- Real-device runs. Deferred until the hardware is available.
- Biometric-unlock flows. Deferred until Tier 1 biometric unlock ships
  in the app (Section 14 of `implementationplan.md`). A
  `_biometric-enroll.yaml` helper is included in this design but not
  wired into the critical suite.
- Visual regression. Separate concern.

## Directory layout

```text
/e2e
  /extension           # existing (Playwright)
  /extension-firefox   # existing (Selenium, parked)
  /desktop             # existing (Playwright)
  /mobile              # NEW
    /flows             # one YAML per extension spec
      setup-vault.yaml
      vault-crud.yaml
      unlock.yaml
      generator.yaml
      search-filter.yaml
      pin.yaml
      persistence.yaml
      clipboard.yaml
      import-export.yaml
      sync-flow.yaml
    /helpers           # shared sub-flows, invoked via runFlow
      _create-vault.yaml
      _unlock-vault.yaml
      _reset-vault.yaml
      _add-login.yaml
      _biometric-enroll.yaml   # deferred usage
    /scripts           # Node scripts for runScript
      webdav-reset.js
      read-env.js
    config.yaml        # Maestro workspace config
    README.md          # quickstart + troubleshooting
  /fixtures            # existing — reused as-is
    /password-imports  # chrome.csv, firefox.csv, bitwarden.csv, icloud.csv, 1password-without-header.csv
```

**Why `e2e/mobile/` and not `apps/mobile/e2e/`:** co-locates all five
platforms' E2E suites under one top-level directory, mirroring the
extension/desktop pattern already in use and reusing
`e2e/fixtures/password-imports/` without symlink gymnastics.

## Test ID strategy

Current state: 4 `testID` props across 2 files in `apps/mobile/`. We
add ~40 more as a dedicated prep commit before any flow lands.

**Convention:** match the desktop `data-testid` names 1:1 where the
screens overlap. Desktop's list is documented in `CLAUDE.md`:

> `setup-password`, `setup-confirm`, `unlock-password`, `add-name`,
> `add-url`, `add-username`, `add-password`, `add-cardholder`,
> `add-cardnumber`, `add-content`, `sync-provider`, `sync-webdav-url`,
> `sync-webdav-username`, `sync-webdav-password`, `sync-master-password`,
> `restore-provider`, `restore-webdav-url`, `restore-webdav-username`,
> `restore-webdav-password`, `restore-master-password`.

For React Native this becomes `testID="setup-password"` on the
corresponding `<TextInput>` / interactive element.

**Complete testID inventory for §1–§14:**

| Screen                  | testIDs                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Setup / Create Vault    | `setup-password`, `setup-confirm`, `setup-submit`, `setup-restore-cloud`, `recovery-copy`, `recovery-continue`                                                                                                                       |
| Unlock                  | `unlock-password`, `unlock-submit`, `unlock-use-pin`, `unlock-use-password`                                                                                                                                                          |
| Vault list              | `vault-add-button`, `vault-item-{id}`, `vault-lock-button`, `vault-search`                                                                                                                                                           |
| Add / Edit item         | `add-tab-login`, `add-tab-card`, `add-tab-note`, `add-name`, `add-url`, `add-username`, `add-password`, `add-notes`, `add-cardholder`, `add-cardnumber`, `add-month`, `add-year`, `add-cvv`, `add-content`, `add-save`, `add-cancel` |
| Item detail             | `detail-copy-username`, `detail-copy-password`, `detail-edit`, `detail-delete`, `detail-password-history`                                                                                                                            |
| Generator               | `gen-regenerate`, `gen-copy`, `gen-password-output`                                                                                                                                                                                  |
| Sync settings           | same as desktop (`sync-provider`, `sync-webdav-url`, `sync-webdav-username`, `sync-webdav-password`, `sync-master-password`, `sync-connect`, `sync-disconnect`, `sync-now`)                                                          |
| PIN (settings + unlock) | `pin-set`, `pin-confirm`, `pin-submit`, `pin-pad-0` … `pin-pad-9`, `pin-backspace`                                                                                                                                                   |
| Import / Export         | `import-pick-file`, `import-mode-merge`, `import-mode-add-all`, `import-start`, `export-csv`, `export-encrypted`, `export-backup-password`, `export-backup-confirm`, `export-submit`                                                 |
| Settings (top-level)    | `settings-import`, `settings-export`, `settings-security`, `settings-sync`, `settings-reset-vault`                                                                                                                                   |
| Restore from Cloud      | `restore-provider`, `restore-webdav-url`, `restore-webdav-username`, `restore-webdav-password`, `restore-master-password`, `restore-submit`                                                                                          |

**Why `testID` and not accessibility labels:** `testID` is stable across
locales, doesn't collide with VoiceOver/TalkBack users, and is
Maestro's first-class matcher (`tapOn: { id: "…" }`).

## Flow structure & tagged subsets

Every flow starts with a YAML frontmatter declaring the app id and
tags. The `critical` tag mirrors the extension's `@critical` subset:

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
---
- launchApp: { clearState: true }
- tapOn: { id: 'setup-password' }
- inputText: 'test1234'
- tapOn: { id: 'setup-confirm' }
- inputText: 'test1234'
- tapOn: { id: 'setup-submit' }
- extendedWaitUntil:
    visible: { id: 'recovery-continue' }
    timeout: 30000
- tapOn: { id: 'recovery-continue' }
- assertVisible: { id: 'vault-add-button' }
```

**Critical subset** (matches extension `@critical`): §1 setup, §2 CRUD,
§4 unlock, §5–§8 sync, §12 PIN, §13 persistence, §14 clipboard.

**Non-critical tail:** §3 generator, §9 per-vendor CSV import sweep,
§10 CSV round-trip, §11 encrypted backup round-trip.

Running subsets:

```bash
# Critical only
cd e2e/mobile && maestro test --include-tags=critical flows/

# Single spec
cd e2e/mobile && maestro test flows/setup-vault.yaml

# Everything
cd e2e/mobile && maestro test flows/
```

## Device targeting & running locally

Pinned device images in `config.yaml`:

```yaml
# e2e/mobile/config.yaml
appId: com.keykeykey.mobile
defaultTimeoutMs: 30000
executionOrder:
  flowsOrder:
    - setup-vault
    - vault-crud
    - unlock
    - pin
    - generator
    - clipboard
    - persistence
    - search-filter
    - import-export
    - sync-flow
```

Commands (documented in `e2e/mobile/README.md`):

```bash
# iOS — boot sim, build + install the app, then run Maestro
cd apps/mobile && npx expo run:ios --device "iPhone 17 Pro"
cd e2e/mobile && maestro test flows/

# Android — boot AVD, build + install, then run
cd apps/mobile && npx expo run:android
cd e2e/mobile && maestro test flows/

# Convenience wrapper
pnpm e2e:mobile           # root-level script, runs both in sequence
pnpm e2e:mobile -- --include-tags=critical
```

The `scripts/run-mobile-e2e.sh` wrapper discovers the booted
sim/emulator udid (`xcrun simctl list devices booted`,
`adb devices`), sets `--device`, and forwards extra args.

## Argon2 timing

Every operation that runs the KDF (§1 create, §4 unlock, §5 connect,
§6 restore, §7/§8 conflict resolution) takes 15–22s on desktop and can
be slower on the simulator. Maestro's default action timeout is 10s —
too short. We globally bump it via `config.yaml`:

```yaml
defaultTimeoutMs: 30000
```

And every post-KDF assertion uses `extendedWaitUntil` with an explicit
30s timeout. The 22s wait from `base-test-flow.md` is not a fixed
`sleep` — Maestro polls for the next visible element and returns as
soon as it appears.

## Vault reset between specs

Each flow starts with `launchApp: { clearState: true }`. This wipes
`expo-secure-store`, AsyncStorage, and the app's sandbox — equivalent
to a fresh install. Every spec starts from **Create Your Vault**,
mirroring the extension's fresh-profile pattern.

**Exception: §13 persistence.** That flow deliberately does **not** use
`clearState`. It calls `stopApp` + `launchApp` (warm start) to cold-boot
with storage intact and assert the vault header survives.

## WebDAV env vars & sync flow

Sync tests (§5–§8) need WebDAV credentials. They live in the user's
local shell env (same convention as `base-test-flow.md`):

```bash
export KKK_WEBDAV_URL='https://<host>'
export KKK_WEBDAV_USER='<user>'
export KKK_WEBDAV_PASS='<password>'
```

Maestro's `env:` block reads them at flow start and passes them through
to `inputText` / `runScript`:

```yaml
# flows/sync-flow.yaml
appId: com.keykeykey.mobile
env:
  KKK_WEBDAV_URL: ${KKK_WEBDAV_URL}
  KKK_WEBDAV_USER: ${KKK_WEBDAV_USER}
  KKK_WEBDAV_PASS: ${KKK_WEBDAV_PASS}
tags: [critical]
---
- runScript: scripts/webdav-reset.js
- runFlow: helpers/_create-vault.yaml
- runFlow: helpers/_add-login.yaml
- tapOn: { id: 'settings-sync' }
- tapOn: { id: 'sync-provider' }
- tapOn: 'WebDAV'
- tapOn: { id: 'sync-webdav-url' }
- inputText: ${KKK_WEBDAV_URL}
- tapOn: { id: 'sync-webdav-username' }
- inputText: ${KKK_WEBDAV_USER}
- tapOn: { id: 'sync-webdav-password' }
- inputText: ${KKK_WEBDAV_PASS}
- tapOn: { id: 'sync-master-password' }
- inputText: 'test1234'
- tapOn: { id: 'sync-connect' }
- extendedWaitUntil:
    visible: 'Last synced'
    timeout: 30000
```

**`webdav-reset.js`** runs under Node (Maestro's `runScript` engine).
It calls the same `POST /api/webdav/clear-data` endpoint the
extension's `sync-flow.spec.ts` uses via `wipeRemote()`. If the env
vars are missing, it logs a skip message and returns — so
`sync-flow.yaml` will no-op on a local run without WebDAV creds
rather than failing loudly.

**Missing-env behavior:** the flow uses a Maestro `runFlow` with a
`when:` gate that checks for `KKK_WEBDAV_URL`. If absent, the flow
short-circuits with a clear log. This matches how the extension's
sync-flow spec is gated in `e2e/extension/sync-flow.spec.ts`.

## Fixture handling

CSV fixtures for §9 live in `e2e/fixtures/password-imports/` and are
reused as-is. Maestro's `runFlow` for import looks like:

```yaml
- tapOn: { id: 'settings-import' }
- tapOn: { id: 'import-pick-file' }
- runScript: scripts/pick-file.js
  env:
    FIXTURE_PATH: ${MAESTRO_APP_DIR}/../../fixtures/password-imports/chrome.csv
```

**Document-picker handling:** iOS Simulator and Android Emulator both
require pushing the fixture into the app's sandbox first
(`xcrun simctl openurl booted file://…` on iOS, `adb push` on
Android). `scripts/pick-file.js` handles that, then dispatches a tap
on the picker's shown file. We may alternatively wire a
development-only "Import from bundled fixture" affordance in the
import screen (gated on `__DEV__`) if the picker proves flaky —
decided during PR-C based on what we observe.

## PIN, biometric

**§12 PIN:** pure in-app flow. The PinPad renders a grid of buttons
with `testID="pin-pad-{0-9}"`. `_set-pin.yaml` helper taps the digits
in sequence.

**Biometric (deferred):** a `_biometric-enroll.yaml` helper exists but
is not called by any flow in this spec. When Tier 1 biometric unlock
ships, the helper will:

- iOS sim: `runScript: scripts/ios-biometric-enroll.js` →
  `xcrun simctl privacy <udid> grant face-id com.keykeykey.mobile`
  plus `xcrun simctl ui <udid> biometric enrollment true`.
- Android emulator: `adb -s <serial> emu finger touch 1`.

## `base-test-flow.md` integration

Two additions:

1. A new top-level section after **Prerequisites**:

   > ## Mobile automation — Maestro
   >
   > §1–§14 are automated via Maestro flows in `e2e/mobile/flows/`.
   > Run the critical subset with:
   >
   > ```bash
   > cd e2e/mobile && maestro test --include-tags=critical flows/
   > ```
   >
   > MCP-driven manual testing remains authoritative for **§15
   > (autofill)** and any test requiring OS-level settings changes.

2. Each of §1–§14 gets a one-line prefix mirroring the extension
   pattern at the bottom of `base-test-flow.md`:

   > **Automated:** `e2e/mobile/flows/setup-vault.yaml` (iOS + Android)

## Rollout

Three PRs, chained, each independently mergeable. Incremental so a
failed prep commit doesn't block the whole effort — after PR-A, the
user can smoke-test locally and revert if anything regresses before
PR-B lands.

### PR-A — testID prep (mobile app)

Adds the ~40 `testID` props to `apps/mobile/` screens per the
inventory table above. No Maestro code. No behavior change. Mechanical,
reviewable as a unit.

**Exit criteria:** app boots, all existing `apps/mobile` Jest tests
pass, no visual regression in manual smoke.

**Rollback:** `git revert` the single PR.

### PR-B — Maestro scaffold + §1–§4 flows

- Install Maestro locally (`curl -Ls get.maestro.mobile.dev | bash`).
  Document the install in `e2e/mobile/README.md`.
- Land `e2e/mobile/` directory structure: `config.yaml`, `helpers/`,
  `scripts/`, `README.md`.
- Add `pnpm e2e:mobile` + `scripts/run-mobile-e2e.sh` wrapper.
- Flows: `setup-vault.yaml`, `vault-crud.yaml`, `unlock.yaml`,
  `generator.yaml`.
- Sub-flows: `_create-vault.yaml`, `_unlock-vault.yaml`,
  `_reset-vault.yaml`, `_add-login.yaml`.
- Update `base-test-flow.md` §1–§4 with the **Automated:** prefix.

**Exit criteria:** four flows pass on iOS Simulator (`iPhone 17 Pro`,
iOS 18) and Android Emulator (`Pixel 7`, API 34). Critical suite runs
in under 3 minutes per platform.

### PR-C — §5–§14 flows

- `sync-flow.yaml` (§5–§8) — gated on `KKK_WEBDAV_*` env vars.
  Reuses `webdav-reset.js` logic from the extension suite.
- `import-export.yaml` (§9, §10, §11) — exercises each vendor fixture
  - CSV round-trip + encrypted backup round-trip.
- `pin.yaml` (§12).
- `persistence.yaml` (§13).
- `clipboard.yaml` (§14).
- Update `base-test-flow.md` §5–§14 with the **Automated:** prefix.

**Exit criteria:** all five remaining flows pass on iOS + Android.
`pnpm e2e:mobile -- --include-tags=critical` runs the full critical
subset end-to-end under 10 minutes per platform.

## Dependencies & environment

- **Maestro CLI:** `curl -Ls get.maestro.mobile.dev | bash`. Pinned
  version recorded in `e2e/mobile/README.md` + documented in root
  `CLAUDE.md`.
- **Node 22+:** already a project prerequisite.
- **iOS toolchain:** Xcode + iOS 18 simulator runtime already used
  by the team for manual testing.
- **Android toolchain:** Android Studio + Pixel 7 API 34 system image.
- **WebDAV env vars:** same `KKK_WEBDAV_URL` / `KKK_WEBDAV_USER` /
  `KKK_WEBDAV_PASS` documented in `base-test-flow.md`.

No new npm dependencies inside the monorepo. Maestro is a system-level
CLI (like `pnpm` or `xcrun`).

## Open questions

None. Deferred items (CI, §15, biometric, real-device, visual
regression) are explicitly out of scope and called out above.
