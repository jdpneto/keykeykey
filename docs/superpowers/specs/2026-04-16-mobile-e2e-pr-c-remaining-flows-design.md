# PR-C — Mobile E2E Remaining Flows Design

**Parent:** `2026-04-16-mobile-e2e-maestro-design.md`
**Depends on:** PR-A (testIDs) and PR-B (Maestro scaffold + §1–§4).
**Scope:** The remaining five Maestro flows that cover §5–§14 of
`base-test-flow.md`: sync, import/export, PIN, persistence, clipboard.
Each flow is tagged `critical` and the critical suite must stay under
~10 min per platform.

## Why this is its own PR

- Scaffolding exists. PR-C is pure test content — a domain reviewer
  can read each YAML as a scenario walkthrough without learning
  Maestro infrastructure.
- The five flows can be written + merged independently if any one
  proves harder than expected (sync is the riskiest).
- Keeps each PR under ~500 lines of added YAML.

## Deliverables

### Flows

```text
/e2e/mobile/flows/
  sync-flow.yaml         # §5–§8
  import-export.yaml     # §9 (per-vendor), §10 (round-trip), §11 (encrypted backup)
  pin.yaml               # §12
  persistence.yaml       # §13
  clipboard.yaml         # §14
```

### New scripts

```text
/e2e/mobile/scripts/
  webdav-reset.js        # POST /api/webdav/clear-data — mirrors e2e/extension/sync-flow.spec.ts#wipeRemote
  check-vault.js         # optional — wraps the base-test-flow.md check-vault.mjs utility for assertions
  push-fixture.js        # pushes CSV fixtures into sim/emulator sandbox for document-picker flows
  capture-export.js      # scrapes the saved file path from the platform's export dialog / Files app
  assert-clipboard.js    # xcrun simctl pbpaste / adb shell cmd clipboard get-primary-clip
  sleep.js               # 3-line helper for deterministic waits (e.g. §14 auto-clear)
```

### `sync-flow.yaml` — §5–§8

Covers:
- §5 first-time WebDAV connect (clean remote)
- §6 destroy local + restore from cloud
- §7 merge conflict (same master password)
- §8 replace conflict (different master password)

The full §5–§8 sequence is one long chained flow because each step's
preconditions come from the previous step's postconditions. Splitting
would either duplicate setup or require brittle inter-flow state.

```yaml
appId: com.keykeykey.mobile
tags: [critical]
env:
  KKK_WEBDAV_URL: ${KKK_WEBDAV_URL}
  KKK_WEBDAV_USER: ${KKK_WEBDAV_USER}
  KKK_WEBDAV_PASS: ${KKK_WEBDAV_PASS}
---

# §5 — first-time connect
- runScript: scripts/webdav-reset.js
- runFlow: helpers/_create-vault.yaml
- runFlow: helpers/_add-login.yaml
- tapOn: { id: "settings-sync" }
- tapOn: { id: "sync-provider" }
- tapOn: "WebDAV"
- tapOn: { id: "sync-webdav-url" }
- inputText: ${KKK_WEBDAV_URL}
- tapOn: { id: "sync-webdav-username" }
- inputText: ${KKK_WEBDAV_USER}
- tapOn: { id: "sync-webdav-password" }
- inputText: ${KKK_WEBDAV_PASS}
- tapOn: { id: "sync-master-password" }
- inputText: "test1234"
- tapOn: { id: "sync-connect" }
- extendedWaitUntil:
    visible:
      id: "sync-status"
      text: "Last synced"
    timeout: 30000

# §6 — destroy and restore
- tapOn: { id: "vault-lock-button" }
- tapOn: { id: "settings-reset-vault" }
- tapOn: { id: "settings-reset-confirm" }
- extendedWaitUntil:
    visible: { id: "setup-password" }
- tapOn: { id: "setup-restore-cloud" }
- tapOn: { id: "restore-provider" }
- tapOn: "WebDAV"
- tapOn: { id: "restore-webdav-url" }
- inputText: ${KKK_WEBDAV_URL}
- tapOn: { id: "restore-webdav-username" }
- inputText: ${KKK_WEBDAV_USER}
- tapOn: { id: "restore-webdav-password" }
- inputText: ${KKK_WEBDAV_PASS}
- tapOn: { id: "restore-next" }
- tapOn: { id: "restore-master-password" }
- inputText: "test1234"
- tapOn: { id: "restore-submit" }
- extendedWaitUntil:
    visible: "Vault Restored"
    timeout: 30000
- tapOn: "Continue"
- assertVisible: "GitHub"

# §7 — merge conflict
- tapOn: { id: "vault-lock-button" }
- tapOn: { id: "settings-reset-vault" }
- tapOn: { id: "settings-reset-confirm" }
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: "GitLab"
      ITEM_URL: "https://gitlab.com"
- tapOn: { id: "settings-sync" }
# … configure WebDAV with same password …
- tapOn: { id: "sync-connect" }
- extendedWaitUntil:
    visible: "Remote Vault Detected"
    timeout: 30000
- tapOn: { id: "sync-conflict-merge" }
- extendedWaitUntil:
    visible: { id: "sync-status" }
    timeout: 30000
- assertVisible: "GitHub"
- assertVisible: "GitLab"

# §8 — replace conflict (different master password)
- runScript: scripts/webdav-reset.js     # isolate §8 from §7 state
- tapOn: { id: "vault-lock-button" }
- tapOn: { id: "settings-reset-vault" }
- tapOn: { id: "settings-reset-confirm" }
- runFlow:
    file: helpers/_create-vault.yaml
    env:
      MAESTRO_MASTER_PASSWORD: "testqwer"
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: "LocalOnly"
# … configure WebDAV with master "testqwer" …
- tapOn: { id: "sync-connect" }
- extendedWaitUntil:
    any:
      - visible: { id: "sync-status", text: "Last synced" }
      - visible: "Incompatible Remote Vault"
    timeout: 30000
- runFlow:
    when:
      visible: "Incompatible Remote Vault"
    commands:
      - tapOn: { id: "sync-conflict-replace-remote" }
      - extendedWaitUntil:
          visible: { id: "sync-status", text: "Last synced" }
          timeout: 30000
```

**Skip behavior:** if `KKK_WEBDAV_URL` is unset, `run-mobile-e2e.sh`
filters `sync-flow.yaml` out of the suite before invoking
`maestro test` (simplest path — one check in the runner, no YAML-level
skip gymnastics). The runner prints a clear
`[skip] sync-flow.yaml — KKK_WEBDAV_URL unset` line so the user knows
the flow was intentionally omitted.

**Historical context preserved:** PR #57 (core/sync timer leak), PR
#59 (banner clear), and PR #63 (extension progress race) — these are
regressions that this flow guards against by asserting the banner
clears and the "Remote vault mismatch" error disappears.

### `import-export.yaml` — §9, §10, §11

Five vendor fixtures × import → representative-title check, then
export → re-import round-trip, then encrypted-backup round-trip.

```yaml
appId: com.keykeykey.mobile
tags: [critical]
---

# §9 — per-vendor CSV imports
- runFlow:
    file: helpers/_reset-vault.yaml
- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: "chrome.csv"
      EXPECTED_SOURCE: "Chrome"
      REPRESENTATIVE_TITLE: "9gag.com"

- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: "firefox.csv"
      EXPECTED_SOURCE: "Firefox"
      REPRESENTATIVE_TITLE: "amazon.it"

- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: "bitwarden.csv"
      EXPECTED_SOURCE: "Bitwarden"
      REPRESENTATIVE_TITLE: "1password"

- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: "icloud.csv"
      EXPECTED_SOURCE: "iCloud Keychain"
      REPRESENTATIVE_TITLE: "a1.net"

- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: "1password-without-header.csv"
      EXPECTED_SOURCE: "1Password"
      REPRESENTATIVE_TITLE: "radiopopular.pt"

# §10 — CSV round-trip
- runFlow:
    file: helpers/_reset-vault.yaml
- runFlow: helpers/_add-login.yaml     # GitHub
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: "GitLab"
- tapOn: { id: "settings-export" }
- tapOn: { id: "export-tab-csv" }
- tapOn: { id: "export-csv-submit" }
- runScript: scripts/capture-export.js    # captures saved file path
# Import the just-exported CSV
- tapOn: { id: "settings-reset-vault" }
- tapOn: { id: "settings-reset-confirm" }
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: ${EXPORTED_CSV_PATH}
      EXPECTED_SOURCE: "KeyKeyKey"
      REPRESENTATIVE_TITLE: "GitHub"
- assertVisible: "GitLab"

# §11 — encrypted backup round-trip
- runFlow:
    file: helpers/_reset-vault.yaml
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: "GitHub"
      ITEM_PASSWORD: "encpass1"
- tapOn: { id: "settings-export" }
- tapOn: { id: "export-tab-encrypted" }
- tapOn: { id: "export-backup-password" }
- inputText: "backup1234"
- tapOn: { id: "export-backup-confirm" }
- inputText: "backup1234"
- tapOn: { id: "export-backup-submit" }
- runScript: scripts/capture-export.js
# Reset + import encrypted
- tapOn: { id: "settings-reset-vault" }
- tapOn: { id: "settings-reset-confirm" }
- runFlow: helpers/_create-vault.yaml
- tapOn: { id: "settings-import" }
- tapOn: { id: "import-tab-encrypted" }
- tapOn: { id: "import-pick-file" }
# pick the backup file
- runScript: scripts/push-fixture.js
  env:
    FIXTURE_PATH: ${EXPORTED_BACKUP_PATH}
- tapOn: { id: "import-master-password" }
- inputText: "test1234"
- tapOn: { id: "import-backup-password" }
- inputText: "backup1234"
- tapOn: { id: "import-start" }
- extendedWaitUntil:
    visible: "Imported 1 item"
    timeout: 30000
- tapOn: "Continue"
- assertVisible: "GitHub"
```

**Helper needed:** `helpers/_import-csv.yaml` — wraps the
pick-fixture + source-badge assertion + import-start pattern.

**Platform note for file pickers:** iOS Simulator's
`expo-document-picker` requires pushing the fixture via `xcrun simctl
openurl booted file://…` or to the sandboxed Documents directory.
Android uses `adb push`. `scripts/push-fixture.js` abstracts this.

**Fallback:** if `expo-document-picker` proves hard to drive via
Maestro, add a dev-only "Import from bundled fixture" button gated
behind `__DEV__` in `apps/mobile/app/settings/import.tsx`. The flow
uses that button instead. The production picker stays untouched.

### `pin.yaml` — §12

```yaml
appId: com.keykeykey.mobile
tags: [critical]
---
- runFlow: helpers/_create-vault.yaml
- tapOn: { id: "settings-security" }
- tapOn: { id: "pin-set-input" }
- inputText: "135790"
- tapOn: { id: "pin-confirm-input" }
- inputText: "135790"
- tapOn: { id: "pin-set-submit" }
- assertVisible: { id: "pin-change-submit" }

# Lock → unlock via PIN
- tapOn: { id: "vault-lock-button" }
- tapOn: { id: "unlock-use-pin" }
- tapOn: { id: "unlock-pin-pad-1" }
- tapOn: { id: "unlock-pin-pad-3" }
- tapOn: { id: "unlock-pin-pad-5" }
- tapOn: { id: "unlock-pin-pad-7" }
- tapOn: { id: "unlock-pin-pad-9" }
- tapOn: { id: "unlock-pin-pad-0" }
- extendedWaitUntil:
    visible: { id: "vault-add-button" }
    timeout: 30000

# Lock → wrong PIN → counter → fall back to master password
- tapOn: { id: "vault-lock-button" }
- tapOn: { id: "unlock-use-pin" }
- repeat:
    times: 6
    commands:
      - tapOn: { id: "unlock-pin-pad-0" }
- assertVisible: "Wrong PIN. 4 attempts remaining."
- tapOn: { id: "unlock-use-password" }
- tapOn: { id: "unlock-password" }
- inputText: "test1234"
- tapOn: { id: "unlock-submit" }
- extendedWaitUntil:
    visible: { id: "vault-add-button" }
    timeout: 30000
```

### `persistence.yaml` — §13

```yaml
appId: com.keykeykey.mobile
tags: [critical]
---
- runFlow: helpers/_create-vault.yaml
- runFlow: helpers/_add-login.yaml
- tapOn: { id: "vault-lock-button" }
- stopApp
- launchApp                     # NO clearState
- extendedWaitUntil:
    visible: { id: "unlock-password" }
    timeout: 15000
- runFlow: helpers/_unlock-vault.yaml
- assertVisible: "GitHub"
```

### `clipboard.yaml` — §14

```yaml
appId: com.keykeykey.mobile
tags: [critical]
---
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_PASSWORD: "clipboard-test-pass"
- tapOn: "GitHub"
- tapOn: { id: "detail-copy-password" }
- runScript: scripts/assert-clipboard.js
  env:
    EXPECTED: "clipboard-test-pass"
# Wait for auto-clear (30s default)
- runScript: scripts/sleep.js
  env:
    SECONDS: "35"
- runScript: scripts/assert-clipboard.js
  env:
    EXPECTED: ""
```

**Clipboard assertion:** Maestro doesn't expose clipboard directly on
mobile. `scripts/assert-clipboard.js` shells out to:
- iOS sim: `xcrun simctl pbpaste` (booted device id resolved from the
  environment the runner set).
- Android: `adb shell cmd clipboard get-primary-clip` (requires the
  emulator Google-Play image; if unavailable, use an in-app dev-only
  "Dump clipboard" affordance gated on `__DEV__`).

The extension spec (`e2e/extension/clipboard.spec.ts`) uses Playwright's
`navigator.clipboard` API directly — mobile needs the platform-native
path above.

### `base-test-flow.md` edits

Prepend "Automated:" lines to §5, §6, §7, §8, §9, §10, §11, §12, §13,
§14:

- §5: **Automated:** `e2e/mobile/flows/sync-flow.yaml`
- §6: **Automated:** `e2e/mobile/flows/sync-flow.yaml` (chained)
- §7: **Automated:** `e2e/mobile/flows/sync-flow.yaml` (chained)
- §8: **Automated:** `e2e/mobile/flows/sync-flow.yaml` (chained)
- §9: **Automated:** `e2e/mobile/flows/import-export.yaml`
- §10: **Automated:** `e2e/mobile/flows/import-export.yaml`
- §11: **Automated:** `e2e/mobile/flows/import-export.yaml`
- §12: **Automated:** `e2e/mobile/flows/pin.yaml`
- §13: **Automated:** `e2e/mobile/flows/persistence.yaml`
- §14: **Automated:** `e2e/mobile/flows/clipboard.yaml`

## Acceptance criteria

1. All five new flows pass on iOS Simulator (`iPhone 17 Pro`, iOS 18)
   with `KKK_WEBDAV_*` env vars exported.
2. All five pass on Android Emulator (`Pixel 7`, API 34).
3. Running with unset WebDAV env vars: `sync-flow.yaml` skips cleanly
   (no failure, log shows "skipped — missing WebDAV creds"); the
   other four still pass.
4. Full critical subset (`pnpm e2e:mobile -- --include-tags=critical`)
   runs in <10 min per platform with WebDAV available.
5. `base-test-flow.md` has the "Automated:" prefixes on §5–§14.

## Out of scope for PR-C

- §15 autofill (deferred to real-device MCP).
- Biometric-unlock flow (deferred to when Tier 1 biometric ships).
- `search-filter.yaml` and `settings.yaml` flows — the extension has
  specs for these but they're not base-test-flow sections; optional
  future work if the manual flow expands.
- CI integration.
- Maestro Studio-recorded flow additions.

## Risk checklist

| Risk                                                      | Mitigation                                                                                         |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| WebDAV flakiness on §7/§8 (engine timer races — PR #57)    | Use `extendedWaitUntil` with `any:` matcher + explicit assertions on the banner-clear state.       |
| File picker unreliable in §9/§10/§11                       | Fall back to the dev-only "Import from bundled fixture" affordance.                                |
| Clipboard introspection varies by emulator API level       | Pin Pixel 7 API 34 Google APIs image in `e2e/mobile/README.md`.                                    |
| Sync flow chaining: §7 state leaks into §8                | Run `scripts/webdav-reset.js` between §7 and §8 — explicit, no guessing.                           |
| §7 / §8 master-password switching (`testqwer` → `test1234`) | Use `MAESTRO_MASTER_PASSWORD` env override on `_create-vault.yaml`; helper already supports it.   |
| Maestro `repeat:` not supported                            | Unroll the 6-tap loop in `pin.yaml` if version pinned in PR-B lacks `repeat`.                      |

## Rollback plan

`git revert <sha>`. No knock-on effects beyond removing the
"Automated:" markers from `base-test-flow.md` §5–§14.
