# Mobile E2E — PR-B: Maestro Scaffold + §1–§4 Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Maestro workspace under `e2e/mobile/` with config, helpers, runner script, and four critical flows (setup, CRUD, unlock, generator) that run green on iOS Simulator and Android Emulator.

**Architecture:** A self-contained `e2e/mobile/` directory holds YAML flows, reusable sub-flows (`helpers/`), and Node scripts (`scripts/`). A `scripts/run-mobile-e2e.sh` wrapper at the repo root discovers the booted device (sim or emulator) and invokes `maestro test`. The critical suite is selected via Maestro's `--include-tags=critical` flag. No monorepo package is created — Maestro is a system-level CLI like `pnpm` or `xcrun`.

**Tech Stack:** Maestro CLI, Node 22 (for scripts), zsh (for runner), Expo managed workflow (no native project changes)

**Spec:** `docs/superpowers/specs/2026-04-16-mobile-e2e-pr-b-maestro-scaffold-design.md`

**Depends on:** PR-A merged (testIDs must be live in the installed build).

---

## File Structure

**Created in this PR:**

- `e2e/mobile/config.yaml` — workspace config (appId, timeouts)
- `e2e/mobile/README.md` — quickstart + troubleshooting
- `e2e/mobile/helpers/_create-vault.yaml`
- `e2e/mobile/helpers/_unlock-vault.yaml`
- `e2e/mobile/helpers/_reset-vault.yaml`
- `e2e/mobile/helpers/_add-login.yaml`
- `e2e/mobile/helpers/_add-card.yaml`
- `e2e/mobile/helpers/_add-note.yaml`
- `e2e/mobile/scripts/read-env.js`
- `e2e/mobile/flows/setup-vault.yaml`
- `e2e/mobile/flows/vault-crud.yaml`
- `e2e/mobile/flows/unlock.yaml`
- `e2e/mobile/flows/generator.yaml`
- `scripts/run-mobile-e2e.sh` — runner wrapper (chmod +x)

**Modified:**

- `package.json` (root) — add `e2e:mobile`, `e2e:mobile:ios`, `e2e:mobile:android` scripts
- `base-test-flow.md` — add "Automated:" prefix to §1–§4 + new "Mobile automation — Maestro" section

---

### Task 1: Read Android bundle id + pin Maestro version

**Files:** none modified in this task (research only).

- [ ] **Step 1: Read `app.config.js` for the Android package name**

```bash
grep -nE "package|bundleIdentifier|android" apps/mobile/app.config.js
```

Expected: confirms the Android package name. Record it — it may be `com.keykeykey.mobile` (matching iOS) or differ. If it differs, PR-B needs a second `config-android.yaml` and runner dispatch; otherwise a single `config.yaml` covers both.

- [ ] **Step 2: Install Maestro and record version**

```bash
curl -Ls get.maestro.mobile.dev | bash
maestro --version
```

Record the version string (e.g., `1.39.0`) — pin it in `README.md` in Task 3.

- [ ] **Step 3: Verify Maestro can see a booted device**

Boot an iOS sim (separate terminal):

```bash
cd apps/mobile && npx expo run:ios --device "iPhone 17 Pro"
```

Then:

```bash
maestro test --help
xcrun simctl list devices booted
```

Expected: the sim shows up in `booted` state. This confirms the environment is ready before writing any YAML.

No commit in this task — research only.

---

### Task 2: Create `e2e/mobile/config.yaml`

**Files:**

- Create: `e2e/mobile/config.yaml`

- [ ] **Step 1: Create the config file**

```bash
mkdir -p /Users/davidneto/keykeykey/e2e/mobile
```

Then write `e2e/mobile/config.yaml`:

```yaml
# Maestro workspace configuration for KeyKeyKey mobile E2E.
# All flows inherit this appId unless they override their own frontmatter.
# defaultTimeoutMs: 30000 accommodates the 15-22s Argon2 KDF wait on sim.
appId: com.keykeykey.mobile
```

If Task 1 Step 1 showed the Android package differs, add a comment and create a sibling `config-android.yaml`.

- [ ] **Step 2: Commit**

```bash
git add e2e/mobile/config.yaml
git commit -m "chore(e2e/mobile): add Maestro workspace config"
```

---

### Task 3: Write `e2e/mobile/README.md`

**Files:**

- Create: `e2e/mobile/README.md`

- [ ] **Step 1: Create the README**

````markdown
# Mobile E2E — Maestro

This directory holds Maestro flows that automate §1–§14 of
`base-test-flow.md` on iOS Simulator and Android Emulator.

## Prerequisites

- **Maestro CLI** — pinned to `<VERSION_FROM_TASK_1>`.
  Install with:
  ```bash
  curl -Ls get.maestro.mobile.dev | bash
  ```
````

If you have a newer version, downgrade to the pinned one to match CI.

- **Node 22+** (matches the rest of the monorepo).
- **iOS toolchain**: Xcode + `iPhone 17 Pro` simulator, iOS 18.
- **Android toolchain**: Android Studio + `Pixel 7` AVD, API 34.
- **WebDAV env vars** (only required for §5–§8 sync flows — landed in
  PR-C):
  ```bash
  export KKK_WEBDAV_URL='https://<host>'
  export KKK_WEBDAV_USER='<user>'
  export KKK_WEBDAV_PASS='<password>'
  ```

## Running

Boot the sim/emulator + install the dev build first:

```bash
# iOS
cd apps/mobile && npx expo run:ios --device "iPhone 17 Pro"

# Android
cd apps/mobile && npx expo run:android
```

Then, from repo root:

```bash
pnpm e2e:mobile:ios                          # all flows, iOS
pnpm e2e:mobile:android                      # all flows, Android
pnpm e2e:mobile:ios -- --include-tags=critical   # critical subset only
pnpm e2e:mobile:ios -- flows/setup-vault.yaml    # single flow
```

The `pnpm e2e:mobile` command without a platform defaults to iOS.

## Troubleshooting

- **"Element not found: setup-password"**
  → The installed build predates PR-A. Rebuild:
  `cd apps/mobile && npx expo run:ios --device "iPhone 17 Pro"`.
- **"Timeout on setup-submit"**
  → Argon2 may take up to 25s on a cold simulator. If it fails
  repeatedly, bump `defaultTimeoutMs` in `config.yaml` to 45000.
- **"No device found"**
  → Confirm a sim/emulator is booted: `xcrun simctl list devices booted`
  or `adb devices`.
- **Simulator is slow**
  → First run of the day is always slower; subsequent runs are fast.

## Directory layout

- `config.yaml` — workspace config
- `flows/` — one YAML per extension spec
- `helpers/` — reusable sub-flows invoked via `runFlow:`
- `scripts/` — Node helpers for `runScript:` (env reading, WebDAV
  reset, etc.)

````

Replace `<VERSION_FROM_TASK_1>` with the real version.

- [ ] **Step 2: Commit**

```bash
git add e2e/mobile/README.md
git commit -m "docs(e2e/mobile): add Maestro quickstart README"
````

---

### Task 4: Create helper sub-flows

**Files:**

- Create: `e2e/mobile/helpers/_create-vault.yaml`
- Create: `e2e/mobile/helpers/_unlock-vault.yaml`
- Create: `e2e/mobile/helpers/_reset-vault.yaml`
- Create: `e2e/mobile/helpers/_add-login.yaml`
- Create: `e2e/mobile/helpers/_add-card.yaml`
- Create: `e2e/mobile/helpers/_add-note.yaml`

- [ ] **Step 1: `helpers/_create-vault.yaml`**

```yaml
appId: com.keykeykey.mobile
---
- launchApp: { clearState: true }
- extendedWaitUntil:
    visible: { id: 'setup-password' }
    timeout: 15000
- tapOn: { id: 'setup-password' }
- inputText: ${MAESTRO_MASTER_PASSWORD:-test1234}
- tapOn: { id: 'setup-confirm' }
- inputText: ${MAESTRO_MASTER_PASSWORD:-test1234}
- tapOn: { id: 'setup-submit' }
- extendedWaitUntil:
    visible: { id: 'recovery-continue' }
    timeout: 30000
- tapOn: { id: 'recovery-continue' }
- extendedWaitUntil:
    visible: { id: 'vault-add-button' }
    timeout: 10000
```

- [ ] **Step 2: `helpers/_unlock-vault.yaml`**

```yaml
appId: com.keykeykey.mobile
---
- tapOn: { id: 'unlock-password' }
- inputText: ${MAESTRO_MASTER_PASSWORD:-test1234}
- tapOn: { id: 'unlock-submit' }
- extendedWaitUntil:
    visible: { id: 'vault-add-button' }
    timeout: 30000
```

- [ ] **Step 3: `helpers/_reset-vault.yaml`**

```yaml
appId: com.keykeykey.mobile
---
- launchApp: { clearState: true }
- extendedWaitUntil:
    visible: { id: 'setup-password' }
    timeout: 15000
```

- [ ] **Step 4: `helpers/_add-login.yaml`**

```yaml
appId: com.keykeykey.mobile
---
- tapOn: { id: 'vault-add-button' }
- tapOn: { id: 'add-tab-login' }
- tapOn: { id: 'add-name' }
- inputText: ${ITEM_NAME:-GitHub}
- tapOn: { id: 'add-url' }
- inputText: ${ITEM_URL:-https://github.com}
- tapOn: { id: 'add-username' }
- inputText: ${ITEM_USERNAME:-claude-test}
- tapOn: { id: 'add-password' }
- inputText: ${ITEM_PASSWORD:-hunter2-test-password}
- tapOn: { id: 'add-save' }
- extendedWaitUntil:
    visible: { id: 'vault-add-button' }
    timeout: 10000
```

- [ ] **Step 5: `helpers/_add-card.yaml`**

```yaml
appId: com.keykeykey.mobile
---
- tapOn: { id: 'vault-add-button' }
- tapOn: { id: 'add-tab-card' }
- tapOn: { id: 'add-name' }
- inputText: ${ITEM_NAME:-Test Visa}
- tapOn: { id: 'add-cardholder' }
- inputText: ${ITEM_CARDHOLDER:-Claude Tester}
- tapOn: { id: 'add-cardnumber' }
- inputText: ${ITEM_CARDNUMBER:-4111111111111111}
- tapOn: { id: 'add-month' }
- inputText: ${ITEM_MONTH:-12}
- tapOn: { id: 'add-year' }
- inputText: ${ITEM_YEAR:-2030}
- tapOn: { id: 'add-cvv' }
- inputText: ${ITEM_CVV:-123}
- tapOn: { id: 'add-save' }
- extendedWaitUntil:
    visible: { id: 'vault-add-button' }
    timeout: 10000
```

- [ ] **Step 6: `helpers/_add-note.yaml`**

```yaml
appId: com.keykeykey.mobile
---
- tapOn: { id: "vault-add-button" }
- tapOn: { id: "add-tab-note" }
- tapOn: { id: "add-name" }
- inputText: ${ITEM_NAME:-WiFi Backup Codes}
- tapOn: { id: "add-content" }
- inputText: ${ITEM_CONTENT:-SSID: home-network\nKey: correct horse battery staple}
- tapOn: { id: "add-save" }
- extendedWaitUntil:
    visible: { id: "vault-add-button" }
    timeout: 10000
```

- [ ] **Step 7: Commit**

```bash
git add e2e/mobile/helpers/
git commit -m "chore(e2e/mobile): add reusable Maestro helper sub-flows"
```

---

### Task 5: Create `scripts/read-env.js`

**Files:**

- Create: `e2e/mobile/scripts/read-env.js`

- [ ] **Step 1: Write the script**

```javascript
// Validates that expected env vars are present before a sync/import flow runs.
// Usage from a Maestro flow:
//   - runScript: scripts/read-env.js
// If any REQUIRED var is missing, the script sets output.skipFlow = true and
// logs a skip message. Callers can gate subsequent steps on that signal.

const REQUIRED = (process.env.MAESTRO_REQUIRED_ENV ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const missing = REQUIRED.filter((k) => !process.env[k]);

if (missing.length) {
  console.log(`[read-env] skipping — missing env: ${missing.join(', ')}`);
  output.skipFlow = true;
} else {
  for (const key of REQUIRED) {
    output[key] = process.env[key];
  }
  output.skipFlow = false;
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/mobile/scripts/read-env.js
git commit -m "chore(e2e/mobile): add read-env script for flow gating"
```

---

### Task 6: Write `flows/setup-vault.yaml` (§1) and run red-green

**Files:**

- Create: `e2e/mobile/flows/setup-vault.yaml`

- [ ] **Step 1: Write the flow**

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
---
- runFlow: helpers/_create-vault.yaml
- assertVisible: { id: 'vault-add-button' }
```

- [ ] **Step 2: Run it (red or green — see what happens)**

Boot the iOS sim + dev build, then from `e2e/mobile/`:

```bash
cd e2e/mobile && maestro test flows/setup-vault.yaml
```

Expected outcomes:

- **Pass** → testIDs are wired correctly, move on.
- **"Element not found"** → a testID from PR-A is missing. Fix in PR-A and retry. Do NOT add workarounds here.
- **Timeout on setup-submit** → Argon2 is taking longer than 30s. Bump `config.yaml`'s `defaultTimeoutMs` to 45000 and retry.

Do not commit until the flow passes on iOS.

- [ ] **Step 3: Run on Android**

```bash
cd apps/mobile && npx expo run:android
# wait for install …
cd e2e/mobile && maestro test flows/setup-vault.yaml
```

Expected: PASS. If the Android bundle id differs from iOS, this is where you discover it — update `config.yaml` or use a separate `config-android.yaml`.

- [ ] **Step 4: Commit**

```bash
git add e2e/mobile/flows/setup-vault.yaml e2e/mobile/config.yaml  # config.yaml only if you bumped the timeout
git commit -m "test(mobile): Maestro flow for §1 create vault"
```

---

### Task 7: Write `flows/vault-crud.yaml` (§2) and run red-green

**Files:**

- Create: `e2e/mobile/flows/vault-crud.yaml`

- [ ] **Step 1: Write the flow**

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
---
- runFlow: helpers/_create-vault.yaml

# Login
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: 'GitHub'
      ITEM_URL: 'https://github.com'
      ITEM_USERNAME: 'claude-test'
      ITEM_PASSWORD: 'hunter2-test-password'

# Card
- runFlow:
    file: helpers/_add-card.yaml
    env:
      ITEM_NAME: 'Test Visa'
      ITEM_CARDHOLDER: 'Claude Tester'
      ITEM_CARDNUMBER: '4111111111111111'
      ITEM_MONTH: '12'
      ITEM_YEAR: '2030'
      ITEM_CVV: '123'

# Note
- runFlow:
    file: helpers/_add-note.yaml
    env:
      ITEM_NAME: 'WiFi Backup Codes'
      ITEM_CONTENT: "SSID: home-network\nKey: correct horse battery staple"

# All three visible in the list
- assertVisible: 'GitHub'
- assertVisible: 'Test Visa'
- assertVisible: 'WiFi Backup Codes'
```

- [ ] **Step 2: Run on iOS**

```bash
cd e2e/mobile && maestro test flows/vault-crud.yaml
```

Expected: PASS.

- [ ] **Step 3: Run on Android**

```bash
cd e2e/mobile && maestro test flows/vault-crud.yaml
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/mobile/flows/vault-crud.yaml
git commit -m "test(mobile): Maestro flow for §2 vault CRUD"
```

---

### Task 8: Write `flows/unlock.yaml` (§4) and run red-green

**Files:**

- Create: `e2e/mobile/flows/unlock.yaml`

- [ ] **Step 1: Write the flow**

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
---
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: 'Persistent'

- tapOn: { id: 'vault-lock-button' }
- extendedWaitUntil:
    visible: { id: 'unlock-password' }
    timeout: 10000
- runFlow: helpers/_unlock-vault.yaml
- assertVisible: 'Persistent'
```

- [ ] **Step 2: Run on iOS and Android**

```bash
cd e2e/mobile && maestro test flows/unlock.yaml
```

Repeat for Android emulator. Expected: PASS on both.

- [ ] **Step 3: Commit**

```bash
git add e2e/mobile/flows/unlock.yaml
git commit -m "test(mobile): Maestro flow for §4 lock and unlock"
```

---

### Task 9: Write `flows/generator.yaml` (§3) and run red-green

**Files:**

- Create: `e2e/mobile/flows/generator.yaml`

- [ ] **Step 1: Write the flow**

```yaml
appId: com.keykeykey.mobile
# non-critical — not in the @critical subset
tags: []
---
- runFlow: helpers/_create-vault.yaml
- tapOn: 'Generator'
- extendedWaitUntil:
    visible: { id: 'gen-password-output' }
    timeout: 10000
- copyTextFrom: { id: 'gen-password-output' }
- tapOn: { id: 'gen-regenerate' }
# Allow regenerate to update the display
- extendedWaitUntil:
    notVisible: ${MAESTRO_COPIED_TEXT}
    timeout: 5000
```

If `tapOn: "Generator"` doesn't find the tab (depends on how the RN tab bar labels render), substitute with a testID on the tab bar button in PR-A and update here.

- [ ] **Step 2: Run on iOS and Android**

```bash
cd e2e/mobile && maestro test flows/generator.yaml
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/mobile/flows/generator.yaml
git commit -m "test(mobile): Maestro flow for §3 password generator"
```

---

### Task 10: Add the runner script `scripts/run-mobile-e2e.sh`

**Files:**

- Create: `scripts/run-mobile-e2e.sh` (chmod +x)

- [ ] **Step 1: Write the runner**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Dispatch Maestro runs against whichever simulator/emulator is currently booted.
# Usage:
#   scripts/run-mobile-e2e.sh ios [extra maestro args…]
#   scripts/run-mobile-e2e.sh android [extra maestro args…]

platform="${1:-ios}"
shift || true

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_dir="$repo_root/e2e/mobile"

case "$platform" in
  ios)
    udid=$(xcrun simctl list devices booted -j 2>/dev/null | grep -oE '"udid" : "[^"]+"' | head -n1 | cut -d'"' -f4 || true)
    if [ -z "${udid}" ]; then
      echo "No iOS simulator booted."
      echo "Boot one with: cd apps/mobile && npx expo run:ios --device \"iPhone 17 Pro\""
      exit 1
    fi
    echo "[run-mobile-e2e] iOS sim udid: $udid"
    cd "$mobile_dir" && maestro test --device "$udid" "$@"
    ;;
  android)
    serial=$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}' || true)
    if [ -z "${serial}" ]; then
      echo "No Android emulator booted."
      echo "Boot one with: cd apps/mobile && npx expo run:android"
      exit 1
    fi
    echo "[run-mobile-e2e] Android serial: $serial"
    cd "$mobile_dir" && maestro test --device "$serial" "$@"
    ;;
  *)
    echo "Unknown platform: $platform (use: ios|android)"
    exit 2
    ;;
esac
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/run-mobile-e2e.sh
```

- [ ] **Step 3: Verify the runner works**

```bash
./scripts/run-mobile-e2e.sh ios flows/setup-vault.yaml
```

Expected: invokes maestro, runs the flow, PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/run-mobile-e2e.sh
git commit -m "chore(scripts): add run-mobile-e2e.sh dispatcher"
```

---

### Task 11: Wire up root `package.json` scripts

**Files:**

- Modify: `package.json` (root)

- [ ] **Step 1: Read current scripts**

```bash
grep -A1 '"scripts"' package.json | head -30
```

- [ ] **Step 2: Add the three new entries**

Edit `package.json`'s `"scripts"` block:

```json
"e2e:mobile": "./scripts/run-mobile-e2e.sh ios",
"e2e:mobile:ios": "./scripts/run-mobile-e2e.sh ios",
"e2e:mobile:android": "./scripts/run-mobile-e2e.sh android"
```

Pass-through args work because `npm`/`pnpm` forward `--`.

- [ ] **Step 3: Verify**

```bash
pnpm e2e:mobile:ios -- flows/setup-vault.yaml
```

Expected: runs setup-vault.yaml via the dispatcher. PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add pnpm e2e:mobile[:ios|:android] scripts"
```

---

### Task 12: Update `base-test-flow.md`

**Files:**

- Modify: `base-test-flow.md`

- [ ] **Step 1: Add the "Mobile automation — Maestro" section after **Prerequisites\*\*\*\*

Insert after line that ends the Prerequisites block:

````markdown
## Mobile automation — Maestro

§1–§14 on iOS Simulator and Android Emulator are automated via
Maestro flows in `e2e/mobile/flows/`. Run the critical subset with:

```bash
pnpm e2e:mobile:ios -- --include-tags=critical
pnpm e2e:mobile:android -- --include-tags=critical
```
````

See `e2e/mobile/README.md` for setup. §15 autofill stays
MCP/real-device-only.

````

- [ ] **Step 2: Add "Automated:" prefix to §1, §2, §3, §4**

For §1: add the line immediately under the heading:

```markdown
### §1. Create vault

**Automated:** `e2e/mobile/flows/setup-vault.yaml` (iOS + Android).
````

Do the same for §2 (`vault-crud.yaml`), §3 (`generator.yaml`),
§4 (`unlock.yaml`).

- [ ] **Step 3: Run the full critical subset on iOS as the acceptance check**

```bash
pnpm e2e:mobile:ios -- --include-tags=critical
```

Expected: 3 flows pass (setup-vault, vault-crud, unlock — generator is non-critical).
Record wall-clock time. Target: under 3 minutes.

- [ ] **Step 4: Run all four flows (including generator) on iOS**

```bash
pnpm e2e:mobile:ios
```

Expected: 4 flows pass.

- [ ] **Step 5: Run the full critical subset on Android**

```bash
pnpm e2e:mobile:android -- --include-tags=critical
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add base-test-flow.md
git commit -m "docs(base-test-flow): mark §1-§4 automated via Maestro"
```

---

## Self-Review Checklist

- [ ] All four flows pass on iOS sim (`iPhone 17 Pro`, iOS 18).
- [ ] All four flows pass on Android emulator (`Pixel 7`, API 34).
- [ ] `--include-tags=critical` runs 3 flows in under 3 minutes.
- [ ] `README.md` has a pinned Maestro version.
- [ ] `package.json` has the three new scripts.
- [ ] `base-test-flow.md` references all four flows correctly.
- [ ] No changes under `apps/mobile/` (PR-A owns that).

When all confirmed, push and request review.
