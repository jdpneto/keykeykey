# PR-B — Maestro Scaffold + §1–§4 Flows Design

**Parent:** `2026-04-16-mobile-e2e-maestro-design.md`
**Depends on:** PR-A (`2026-04-16-mobile-e2e-pr-a-testid-prep-design.md`)
**Scope:** Land the Maestro workspace under `e2e/mobile/`, the shared
config/helpers/scripts, a root-level convenience runner, and the first
four flows (setup-vault, vault-crud, unlock, generator). Prove the
harness works end-to-end on both iOS Simulator and Android Emulator
before the full sync/import/persistence coverage lands in PR-C.

## Why this is its own PR

- Proves Maestro is viable with minimum sunk cost. If PR-B fails
  (Hermes timing issues, RN bridge flakiness, Maestro version
  regressions), the remaining 5 flows in PR-C never need to be
  written against a dead framework.
- Introduces all scaffolding **once**, so PR-C is pure flow content —
  reviewable by a domain reader, not someone who needs to learn
  Maestro.
- The four flows chosen (setup, CRUD, unlock, generator) exercise the
  most common primitives: text entry, tap, clearState, KDF waits,
  sub-flow invocation, clipboard assertion. If these four work, the
  remaining flows will work.

## Deliverables

### Directory scaffold

```text
/e2e/mobile/
  config.yaml
  README.md
  flows/
    setup-vault.yaml
    vault-crud.yaml
    unlock.yaml
    generator.yaml
  helpers/
    _create-vault.yaml
    _unlock-vault.yaml
    _reset-vault.yaml
    _add-login.yaml
    _add-card.yaml
    _add-note.yaml
  scripts/
    read-env.js
    lock-vault.js       # deferred usage placeholder; returns early if UI path present
```

### `config.yaml`

Top-level Maestro config. Pins the app id and the 30 s default
timeout (Argon2 KDF is 15–22 s on sim).

```yaml
appId: com.keykeykey.mobile
defaultTimeoutMs: 30000
```

For Android the same bundle id is used (`com.keykeykey.mobile`) — if
the actual Android package name differs, `config.yaml` gets a second
Maestro workspace file under `config-android.yaml` and the runner
script selects it based on `--platform`. Verified at implementation
time by reading `apps/mobile/app.config.js`.

### `README.md` — quickstart

- Install Maestro:
  `curl -Ls get.maestro.mobile.dev | bash` (pin to a specific
  version tag when this PR lands — record the pinned version here).
- Boot the simulator/emulator and install the dev build:
  `cd apps/mobile && npx expo run:ios --device "iPhone 17 Pro"`
  / `npx expo run:android`.
- Run the suite:
  `cd e2e/mobile && maestro test flows/`
  or use the convenience wrapper from the repo root:
  `pnpm e2e:mobile` / `pnpm e2e:mobile:ios` / `pnpm e2e:mobile:android`.
- Troubleshooting section:
  - "Element not found" → confirm PR-A testIDs are present on the
    installed build (not a stale build from before the testID PR).
  - "Timeout on setup-submit" → Argon2 is slow; first run of the
    day may need a 60 s warm-up run.
  - "No device found" → `xcrun simctl list devices booted`,
    `adb devices`.

### Root-level runner

Add `scripts/run-mobile-e2e.sh` (mirrors the existing `e2e/` scripts
pattern). Discovers booted device, sets `--device`, forwards extra
args.

```bash
#!/usr/bin/env bash
set -euo pipefail
platform="${1:-ios}"
shift || true
case "$platform" in
  ios)
    udid=$(xcrun simctl list devices booted -j | jq -r '.devices[][0].udid // empty')
    [ -n "$udid" ] || { echo "No iOS sim booted. Run: npx expo run:ios"; exit 1; }
    cd "$(dirname "$0")/../e2e/mobile" && maestro test --device "$udid" "$@"
    ;;
  android)
    serial=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
    [ -n "$serial" ] || { echo "No Android emulator booted. Run: npx expo run:android"; exit 1; }
    cd "$(dirname "$0")/../e2e/mobile" && maestro test --device "$serial" "$@"
    ;;
  *) echo "Unknown platform: $platform"; exit 1 ;;
esac
```

Add root `package.json` scripts:
```json
"e2e:mobile": "./scripts/run-mobile-e2e.sh ios",
"e2e:mobile:ios": "./scripts/run-mobile-e2e.sh ios",
"e2e:mobile:android": "./scripts/run-mobile-e2e.sh android"
```

### Helper sub-flows

#### `helpers/_create-vault.yaml`

Reused by every spec that needs a seeded vault. Accepts a
`masterPassword` parameter (default `test1234`).

```yaml
appId: com.keykeykey.mobile
---
- launchApp: { clearState: true }
- extendedWaitUntil:
    visible: { id: "setup-password" }
    timeout: 15000
- tapOn: { id: "setup-password" }
- inputText: ${MAESTRO_MASTER_PASSWORD:-test1234}
- tapOn: { id: "setup-confirm" }
- inputText: ${MAESTRO_MASTER_PASSWORD:-test1234}
- tapOn: { id: "setup-submit" }
- extendedWaitUntil:
    visible: { id: "recovery-continue" }
    timeout: 30000
- tapOn: { id: "recovery-continue" }
- extendedWaitUntil:
    visible: { id: "vault-add-button" }
    timeout: 10000
```

#### `helpers/_unlock-vault.yaml`

Used by §4 and any spec that locks mid-flow. Assumes vault exists.

```yaml
appId: com.keykeykey.mobile
---
- tapOn: { id: "unlock-password" }
- inputText: ${MAESTRO_MASTER_PASSWORD:-test1234}
- tapOn: { id: "unlock-submit" }
- extendedWaitUntil:
    visible: { id: "vault-add-button" }
    timeout: 30000
```

#### `helpers/_reset-vault.yaml`

Used at start of specs that don't use `clearState: true` but need a
known-empty vault. Most specs just use `clearState` — this helper
exists for chained scenarios.

#### `helpers/_add-login.yaml`

Adds one login item. Parameters via env: `ITEM_NAME`, `ITEM_URL`,
`ITEM_USERNAME`, `ITEM_PASSWORD`.

```yaml
appId: com.keykeykey.mobile
---
- tapOn: { id: "vault-add-button" }
- tapOn: { id: "add-tab-login" }
- tapOn: { id: "add-name" }
- inputText: ${ITEM_NAME:-GitHub}
- tapOn: { id: "add-url" }
- inputText: ${ITEM_URL:-https://github.com}
- tapOn: { id: "add-username" }
- inputText: ${ITEM_USERNAME:-claude-test}
- tapOn: { id: "add-password" }
- inputText: ${ITEM_PASSWORD:-hunter2-test-password}
- tapOn: { id: "add-save" }
- extendedWaitUntil:
    visible: { id: "vault-add-button" }
    timeout: 10000
```

#### `helpers/_add-card.yaml` and `helpers/_add-note.yaml`

Analogous, using card/note testIDs.

### Scripts

#### `scripts/read-env.js`

Used by `runScript:` to surface env vars into flow locals. Thin
shim — Maestro 1.35+ supports `env:` directly, but `read-env.js`
future-proofs against older versions and validates presence:

```js
const required = ['KKK_WEBDAV_URL', 'KKK_WEBDAV_USER', 'KKK_WEBDAV_PASS'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.log(`[read-env] missing: ${missing.join(', ')} — skipping`);
  output.skipSync = true;
} else {
  for (const k of required) output[k] = process.env[k];
}
```

`output.skipSync` is then read by `sync-flow.yaml` (PR-C) to gate
the whole flow.

### The four flows

#### `flows/setup-vault.yaml` — §1

```yaml
appId: com.keykeykey.mobile
tags: [critical]
---
- runFlow: helpers/_create-vault.yaml
- assertVisible: { id: "vault-add-button" }
```

#### `flows/vault-crud.yaml` — §2

Exercises all three item types end to end.

```yaml
appId: com.keykeykey.mobile
tags: [critical]
---
- runFlow: helpers/_create-vault.yaml

# Login
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: "GitHub"
      ITEM_URL: "https://github.com"
      ITEM_USERNAME: "claude-test"
      ITEM_PASSWORD: "hunter2-test-password"

# Card
- runFlow:
    file: helpers/_add-card.yaml
    env:
      ITEM_NAME: "Test Visa"
      ITEM_CARDHOLDER: "Claude Tester"
      ITEM_CARDNUMBER: "4111111111111111"
      ITEM_MONTH: "12"
      ITEM_YEAR: "2030"
      ITEM_CVV: "123"

# Note
- runFlow:
    file: helpers/_add-note.yaml
    env:
      ITEM_NAME: "WiFi Backup Codes"
      ITEM_CONTENT: "SSID: home-network\nKey: correct horse battery staple"

# All three visible in the list
- assertVisible: "GitHub"
- assertVisible: "Test Visa"
- assertVisible: "WiFi Backup Codes"
```

#### `flows/unlock.yaml` — §4

```yaml
appId: com.keykeykey.mobile
tags: [critical]
---
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: "Persistent"

- tapOn: { id: "vault-lock-button" }
- extendedWaitUntil:
    visible: { id: "unlock-password" }
    timeout: 10000
- runFlow: helpers/_unlock-vault.yaml
- assertVisible: "Persistent"
```

#### `flows/generator.yaml` — §3

```yaml
appId: com.keykeykey.mobile
tags: []  # non-critical
---
- runFlow: helpers/_create-vault.yaml
- tapOn: "Generator"   # bottom tab; substitute testID if present
- assertVisible: { id: "gen-password-output" }
- copyTextFrom: { id: "gen-password-output" }
- tapOn: { id: "gen-regenerate" }
- assertNotVisible:
    text: ${MAESTRO_COPIED_TEXT}
```

`copyTextFrom` + `assertNotVisible` proves the output changed after
regenerate.

### `base-test-flow.md` edits

Prepend an "Automated:" line to §1, §2, §3, §4:

- §1: **Automated:** `e2e/mobile/flows/setup-vault.yaml`
- §2: **Automated:** `e2e/mobile/flows/vault-crud.yaml`
- §3: **Automated:** `e2e/mobile/flows/generator.yaml`
- §4: **Automated:** `e2e/mobile/flows/unlock.yaml`

Also add the new top-level section after **Prerequisites**:

> ## Mobile automation — Maestro
>
> §1–§14 on iOS Simulator and Android Emulator are automated via
> Maestro flows in `e2e/mobile/flows/`. Run the critical subset with:
>
> ```bash
> pnpm e2e:mobile:ios -- --include-tags=critical
> pnpm e2e:mobile:android -- --include-tags=critical
> ```
>
> See `e2e/mobile/README.md` for setup. §15 autofill stays
> MCP/real-device-only.

## Acceptance criteria

1. Fresh clone → `pnpm install` → `pnpm --filter @keykeykey/mobile
   build` → `pnpm e2e:mobile:ios` passes all four flows with a
   booted simulator.
2. `pnpm e2e:mobile:android` passes all four flows with a booted
   emulator.
3. Critical subset (`--include-tags=critical`) runs in <3 min per
   platform. Generator is non-critical, so the critical run is
   setup-vault + vault-crud + unlock = 3 flows.
4. No changes to `apps/mobile/` source (PR-A owns that).
5. Maestro version pinned in `e2e/mobile/README.md`.

## Out of scope for PR-B

- §5–§8 sync flows.
- §9 CSV imports (all 5 vendors).
- §10 CSV round-trip.
- §11 encrypted backup round-trip.
- §12 PIN.
- §13 persistence (warm-start).
- §14 clipboard + auto-clear.
- Biometric enrollment helper usage (file can be stubbed, wiring deferred).
- CI integration.

All covered by PR-C.

## Risk checklist

| Risk                                              | Mitigation                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Argon2 slower than 30s on first sim run           | `defaultTimeoutMs: 30000` + `extendedWaitUntil` with 30s explicit. Bump to 45s if repeatedly fails. |
| Android bundle id mismatch                        | Read `apps/mobile/app.config.js` during implementation; split `config-android.yaml` if needed.      |
| `copyTextFrom` not supported on older Maestro     | Pin Maestro ≥ 1.35 in README. Fall back to `assertVisible` pattern if needed.                       |
| Expo dev build doesn't pick up testIDs            | PR-A acceptance criteria include a manual smoke confirming the installed build exposes testIDs.    |
| Fixtures path from `e2e/mobile/` to `e2e/fixtures/` | Relative path `../fixtures/password-imports/` — verified in PR-C when it needs them.               |

## Rollback plan

`git revert <sha>`. No side effects outside `e2e/mobile/`,
`scripts/run-mobile-e2e.sh`, root `package.json` scripts, and
`base-test-flow.md`.
