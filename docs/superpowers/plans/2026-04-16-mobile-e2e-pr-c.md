# Mobile E2E — PR-C: Remaining Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the five remaining Maestro flows that cover §5–§14 of `base-test-flow.md`: sync, import/export, PIN, persistence, clipboard.

**Architecture:** Each flow is a standalone YAML under `e2e/mobile/flows/`. `sync-flow.yaml` chains §5–§8 to preserve state between steps. `import-export.yaml` chains §9–§11. `pin.yaml`, `persistence.yaml`, `clipboard.yaml` are each single scenarios. New Node helpers under `scripts/` handle WebDAV reset, file-picker fixture pushing, clipboard introspection, and deterministic sleeps. All scripts use `execFileSync` with argument arrays (never shell interpolation) to avoid injection even in test-only code. The runner script (PR-B) gets a filter to skip `sync-flow.yaml` when `KKK_WEBDAV_URL` is unset.

**Tech Stack:** Maestro, Node 22 (`execFileSync` + `fetch`), zsh, `xcrun simctl` + `adb` for platform-level operations (clipboard, file push)

**Spec:** `docs/superpowers/specs/2026-04-16-mobile-e2e-pr-c-remaining-flows-design.md`

**Depends on:** PR-B merged (scaffold + helpers).

---

## File Structure

**Created in this PR:**

- `e2e/mobile/scripts/webdav-reset.js`
- `e2e/mobile/scripts/push-fixture.js`
- `e2e/mobile/scripts/capture-export.js`
- `e2e/mobile/scripts/assert-clipboard.js`
- `e2e/mobile/scripts/sleep.js`
- `e2e/mobile/scripts/_platform.js` (shared device-detection helper)
- `e2e/mobile/helpers/_import-csv.yaml`
- `e2e/mobile/flows/sync-flow.yaml`
- `e2e/mobile/flows/import-export.yaml`
- `e2e/mobile/flows/pin.yaml`
- `e2e/mobile/flows/persistence.yaml`
- `e2e/mobile/flows/clipboard.yaml`

**Modified:**

- `scripts/run-mobile-e2e.sh` — add a filter to skip `sync-flow.yaml` when `KKK_WEBDAV_URL` is unset
- `base-test-flow.md` — add "Automated:" prefix to §5–§14

**Conditional dev-only app change (only if the picker proves unreliable in Task 4):**

- `apps/mobile/app/settings/import.tsx` — add a `__DEV__`-gated "Import from bundled fixture" button

---

### Task 1: Add `scripts/_platform.js` shared helper

**Files:**

- Create: `e2e/mobile/scripts/_platform.js`

- [ ] **Step 1: Write the helper**

```javascript
// Shared platform/device detection for test scripts.
// All exec calls use execFileSync with argument arrays — never shell interpolation —
// since these scripts run on developer machines where a stray shell metacharacter
// in a device udid or filename would be a real problem.

import { execFileSync } from 'node:child_process';

export function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

export function runAllowFail(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function iosBootedUdid() {
  const raw = runAllowFail('xcrun', ['simctl', 'list', 'devices', 'booted', '-j']);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    for (const devices of Object.values(parsed.devices)) {
      if (Array.isArray(devices) && devices.length > 0) {
        return devices[0].udid;
      }
    }
  } catch {}
  return '';
}

export function androidBootedSerial() {
  const raw = runAllowFail('adb', ['devices']);
  if (!raw) return '';
  const lines = raw.split('\n').slice(1);
  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts[1] === 'device') return parts[0];
  }
  return '';
}

export function iosAppContainerPath(udid, bundleId) {
  return run('xcrun', ['simctl', 'get_app_container', udid, bundleId, 'data']);
}
```

- [ ] **Step 2: Syntax-check**

```bash
node --check e2e/mobile/scripts/_platform.js
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add e2e/mobile/scripts/_platform.js
git commit -m "chore(e2e/mobile): add _platform.js shared helpers"
```

---

### Task 2: Add `scripts/webdav-reset.js`

**Files:**

- Create: `e2e/mobile/scripts/webdav-reset.js`

- [ ] **Step 1: Write the script**

```javascript
// Wipes the WebDAV remote by hitting the server's clear-data endpoint.
// Mirrors e2e/extension/sync-flow.spec.ts → wipeRemote().
// Env vars: KKK_WEBDAV_URL, KKK_WEBDAV_USER, KKK_WEBDAV_PASS (all required).
// If any are missing, the script logs a skip and sets output.skipped so
// chained Maestro flows can detect the condition.

const url = process.env.KKK_WEBDAV_URL;
const user = process.env.KKK_WEBDAV_USER;
const pass = process.env.KKK_WEBDAV_PASS;

if (!url || !user || !pass) {
  console.log('[webdav-reset] skipping — KKK_WEBDAV_* env vars not set');
  output.skipped = true;
  return;
}

const endpoint = url.replace(/\/+$/, '') + '/api/webdav/clear-data';
const auth = Buffer.from(`${user}:${pass}`).toString('base64');

const res = await fetch(endpoint, {
  method: 'POST',
  headers: { Authorization: `Basic ${auth}` },
});

if (!res.ok) {
  throw new Error(`[webdav-reset] failed: ${res.status} ${await res.text()}`);
}

console.log('[webdav-reset] remote cleared');
output.skipped = false;
```

Maestro's `runScript` supports top-level `await` and exposes a global `output` object. The `fetch` global is available on Node 22.

- [ ] **Step 2: Syntax-check**

```bash
node --check e2e/mobile/scripts/webdav-reset.js
```

- [ ] **Step 3: Smoke test against the real server**

```bash
cd e2e/mobile && node scripts/webdav-reset.js
```

Expected: `[webdav-reset] remote cleared` (requires `KKK_WEBDAV_*` exported).

- [ ] **Step 4: Commit**

```bash
git add e2e/mobile/scripts/webdav-reset.js
git commit -m "chore(e2e/mobile): add webdav-reset script"
```

---

### Task 3: Add `scripts/push-fixture.js`, `capture-export.js`, `assert-clipboard.js`, `sleep.js`

**Files:**

- Create: `e2e/mobile/scripts/push-fixture.js`
- Create: `e2e/mobile/scripts/capture-export.js`
- Create: `e2e/mobile/scripts/assert-clipboard.js`
- Create: `e2e/mobile/scripts/sleep.js`

All four use `execFileSync` with argument arrays and the shared `_platform.js` helpers.

- [ ] **Step 1: `push-fixture.js`**

```javascript
// Pushes a fixture file into the currently booted sim/emulator so that
// expo-document-picker can find it.
// Env var: FIXTURE_PATH (absolute path)

import { iosBootedUdid, androidBootedSerial, iosAppContainerPath, run } from './_platform.js';
import { basename } from 'node:path';

const fixture = process.env.FIXTURE_PATH;
if (!fixture) throw new Error('[push-fixture] FIXTURE_PATH env var required');
const fileName = basename(fixture);

const iosUdid = iosBootedUdid();
if (iosUdid) {
  const container = iosAppContainerPath(iosUdid, 'com.keykeykey.mobile');
  const target = `${container}/Documents/${fileName}`;
  run('cp', [fixture, target]);
  console.log(`[push-fixture] iOS → ${target}`);
  output.pushedPath = target;
  return;
}

const serial = androidBootedSerial();
if (!serial) {
  throw new Error('[push-fixture] no booted iOS sim or Android emulator');
}

const remote = `/sdcard/Download/${fileName}`;
run('adb', ['-s', serial, 'push', fixture, remote]);
console.log(`[push-fixture] Android → ${remote}`);
output.pushedPath = remote;
```

- [ ] **Step 2: `capture-export.js`**

```javascript
// Captures the path of the most-recently exported file.
// iOS: reads from the app's tmp/ directory (expo-sharing stages files there).
// Android: reads from /sdcard/Download, pulls the file to /tmp for host-side access.

import { iosBootedUdid, androidBootedSerial, iosAppContainerPath, run } from './_platform.js';
import { basename } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function newestMatching(dir, prefixes) {
  let best = { mtimeMs: 0, name: '' };
  let entries;
  try { entries = readdirSync(dir); } catch { return ''; }
  for (const name of entries) {
    if (!prefixes.some((p) => name.startsWith(p))) continue;
    const st = statSync(join(dir, name));
    if (st.mtimeMs > best.mtimeMs) best = { mtimeMs: st.mtimeMs, name };
  }
  return best.name ? join(dir, best.name) : '';
}

const iosUdid = iosBootedUdid();
if (iosUdid) {
  const container = iosAppContainerPath(iosUdid, 'com.keykeykey.mobile');
  const tmp = join(container, 'tmp');
  const found = newestMatching(tmp, ['keykeykey-export-', 'keykeykey-backup-']);
  if (!found) throw new Error('[capture-export] no exported file in ' + tmp);
  output.EXPORTED_PATH = found;
  if (found.endsWith('.csv')) output.EXPORTED_CSV_PATH = found;
  if (found.endsWith('.keykeykey')) output.EXPORTED_BACKUP_PATH = found;
  console.log(`[capture-export] iOS → ${found}`);
  return;
}

const serial = androidBootedSerial();
if (!serial) throw new Error('[capture-export] no booted device');

// List /sdcard/Download and pick newest matching
const listing = run('adb', ['-s', serial, 'shell', 'ls', '-t', '/sdcard/Download']);
const match = listing
  .split('\n')
  .map((s) => s.trim())
  .find((n) => n.startsWith('keykeykey-export-') || n.startsWith('keykeykey-backup-'));

if (!match) throw new Error('[capture-export] no exported file in /sdcard/Download');

const localTmp = `/tmp/${match}`;
run('adb', ['-s', serial, 'pull', `/sdcard/Download/${match}`, localTmp]);

output.EXPORTED_PATH = localTmp;
if (localTmp.endsWith('.csv')) output.EXPORTED_CSV_PATH = localTmp;
if (localTmp.endsWith('.keykeykey')) output.EXPORTED_BACKUP_PATH = localTmp;
console.log(`[capture-export] Android → ${localTmp}`);
```

- [ ] **Step 3: `assert-clipboard.js`**

```javascript
// Asserts clipboard content matches EXPECTED env var.
// iOS: xcrun simctl pbpaste <udid>
// Android: adb shell cmd clipboard get-primary-clip (some AVD images lack this
//         service; see the DEV-only fallback in Task 7 Step 3)

import { iosBootedUdid, androidBootedSerial, run } from './_platform.js';

const expected = process.env.EXPECTED ?? '';

let actual = '';
const iosUdid = iosBootedUdid();
if (iosUdid) {
  actual = run('xcrun', ['simctl', 'pbpaste', iosUdid]).replace(/\n$/, '');
} else {
  const serial = androidBootedSerial();
  if (!serial) throw new Error('[assert-clipboard] no booted device');
  actual = run('adb', ['-s', serial, 'shell', 'cmd', 'clipboard', 'get-primary-clip']).trim();
}

if (actual !== expected) {
  throw new Error(`[assert-clipboard] expected "${expected}", got "${actual}"`);
}
console.log(`[assert-clipboard] OK — matches "${expected}"`);
```

- [ ] **Step 4: `sleep.js`**

```javascript
// Deterministic sleep for use in Maestro flows (e.g. §14 auto-clear).
// Env var: SECONDS (required).
const sec = Number(process.env.SECONDS);
if (!Number.isFinite(sec) || sec <= 0) {
  throw new Error(`[sleep] SECONDS must be a positive number, got "${process.env.SECONDS}"`);
}
console.log(`[sleep] waiting ${sec}s`);
await new Promise((resolve) => setTimeout(resolve, sec * 1000));
```

- [ ] **Step 5: Syntax-check all four**

```bash
for f in e2e/mobile/scripts/{push-fixture,capture-export,assert-clipboard,sleep}.js; do
  node --check "$f"
done
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add e2e/mobile/scripts/push-fixture.js e2e/mobile/scripts/capture-export.js e2e/mobile/scripts/assert-clipboard.js e2e/mobile/scripts/sleep.js
git commit -m "chore(e2e/mobile): add push-fixture, capture-export, assert-clipboard, sleep scripts"
```

---

### Task 4: Add `helpers/_import-csv.yaml`

**Files:**

- Create: `e2e/mobile/helpers/_import-csv.yaml`

- [ ] **Step 1: Write the helper**

```yaml
appId: com.keykeykey.mobile
---
# Import a CSV fixture. Caller sets env FIXTURE (file name),
# EXPECTED_SOURCE (badge text), REPRESENTATIVE_TITLE (title to assert after import).

- runScript: scripts/push-fixture.js
  env:
    # push-fixture.js reads FIXTURE_PATH. The helper resolves it from the caller's FIXTURE env.
    # If caller passes an already-absolute path (round-trip scenarios), that's passed through.
    FIXTURE_PATH: ${FIXTURE}

- tapOn: { id: "settings-import" }
- tapOn: { id: "import-tab-csv" }
- tapOn: { id: "import-pick-file" }

# Pick the file in the system picker. The filename (basename) should appear.
- tapOn:
    text: ${FIXTURE_BASENAME}
    optional: true

- extendedWaitUntil:
    visible:
      id: "import-source-badge"
      text: ${EXPECTED_SOURCE}
    timeout: 15000

- tapOn: { id: "import-start" }

- extendedWaitUntil:
    visible: ${REPRESENTATIVE_TITLE}
    timeout: 30000
```

The caller is responsible for setting both `FIXTURE` (full path for push) and `FIXTURE_BASENAME` (just the file name for the picker tap). Keeps the helper simple.

- [ ] **Step 2: Commit**

```bash
git add e2e/mobile/helpers/_import-csv.yaml
git commit -m "chore(e2e/mobile): add _import-csv helper sub-flow"
```

---

### Task 5: Write `flows/import-export.yaml` (§9, §10, §11)

**Files:**

- Create: `e2e/mobile/flows/import-export.yaml`

- [ ] **Step 1: Write the flow**

For each vendor fixture, compute the absolute path. Assume the repo root is resolvable via an env var exported in `run-mobile-e2e.sh` — `KKK_REPO_ROOT`. Update `scripts/run-mobile-e2e.sh` in Task 10 Step 1 to export it before `maestro test`.

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
---

# §9 — per-vendor CSV imports

- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: ${KKK_REPO_ROOT}/e2e/fixtures/password-imports/chrome.csv
      FIXTURE_BASENAME: chrome.csv
      EXPECTED_SOURCE: Chrome
      REPRESENTATIVE_TITLE: 9gag.com

- runFlow: helpers/_reset-vault.yaml
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: ${KKK_REPO_ROOT}/e2e/fixtures/password-imports/firefox.csv
      FIXTURE_BASENAME: firefox.csv
      EXPECTED_SOURCE: Firefox
      REPRESENTATIVE_TITLE: amazon.it

- runFlow: helpers/_reset-vault.yaml
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: ${KKK_REPO_ROOT}/e2e/fixtures/password-imports/bitwarden.csv
      FIXTURE_BASENAME: bitwarden.csv
      EXPECTED_SOURCE: Bitwarden
      REPRESENTATIVE_TITLE: 1password

- runFlow: helpers/_reset-vault.yaml
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: ${KKK_REPO_ROOT}/e2e/fixtures/password-imports/icloud.csv
      FIXTURE_BASENAME: icloud.csv
      EXPECTED_SOURCE: iCloud Keychain
      REPRESENTATIVE_TITLE: a1.net

- runFlow: helpers/_reset-vault.yaml
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: ${KKK_REPO_ROOT}/e2e/fixtures/password-imports/1password-without-header.csv
      FIXTURE_BASENAME: 1password-without-header.csv
      EXPECTED_SOURCE: 1Password
      REPRESENTATIVE_TITLE: radiopopular.pt

# §10 — CSV round-trip
- runFlow: helpers/_reset-vault.yaml
- runFlow: helpers/_create-vault.yaml
- runFlow: helpers/_add-login.yaml
- runFlow:
    file: helpers/_add-login.yaml
    env:
      ITEM_NAME: "GitLab"
      ITEM_URL: "https://gitlab.com"
- tapOn: { id: "settings-export" }
- tapOn: { id: "export-tab-csv" }
- tapOn: { id: "export-csv-submit" }
- runScript: scripts/capture-export.js
- runFlow: helpers/_reset-vault.yaml
- runFlow: helpers/_create-vault.yaml
- runFlow:
    file: helpers/_import-csv.yaml
    env:
      FIXTURE: ${EXPORTED_CSV_PATH}
      FIXTURE_BASENAME: keykeykey-export
      EXPECTED_SOURCE: KeyKeyKey
      REPRESENTATIVE_TITLE: GitHub
- assertVisible: "GitLab"

# §11 — encrypted backup round-trip
- runFlow: helpers/_reset-vault.yaml
- runFlow: helpers/_create-vault.yaml
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
- runFlow: helpers/_reset-vault.yaml
- runFlow: helpers/_create-vault.yaml
- tapOn: { id: "settings-import" }
- tapOn: { id: "import-tab-encrypted" }
- tapOn: { id: "import-pick-file" }
- runScript: scripts/push-fixture.js
  env:
    FIXTURE_PATH: ${EXPORTED_BACKUP_PATH}
- tapOn:
    text: keykeykey-backup
    optional: true
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

- [ ] **Step 2: Run on iOS — expect to iterate on the picker**

```bash
pnpm e2e:mobile:ios -- flows/import-export.yaml
```

Iterate until green. Common debug paths:
- Picker shows a different label → update the `text:` match (both in `_import-csv.yaml` and inline).
- Picker doesn't surface the pushed file → fall back to Task 8 (DEV-only bundled-fixture button).
- `${KKK_REPO_ROOT}` resolves empty → Task 10 will fix the runner to export it; for initial dev, hardcode the path and revert before commit.

- [ ] **Step 3: Run on Android**

```bash
pnpm e2e:mobile:android -- flows/import-export.yaml
```

- [ ] **Step 4: Commit**

```bash
git add e2e/mobile/flows/import-export.yaml
git commit -m "test(mobile): Maestro flow for §9/§10/§11 import-export round-trip"
```

---

### Task 6: Write `flows/pin.yaml` (§12)

**Files:**

- Create: `e2e/mobile/flows/pin.yaml`

- [ ] **Step 1: Write the flow**

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
---
- runFlow: helpers/_create-vault.yaml

# Set PIN
- tapOn: { id: "settings-security" }
- tapOn: { id: "pin-set-input" }
- inputText: "135790"
- tapOn: { id: "pin-confirm-input" }
- inputText: "135790"
- tapOn: { id: "pin-set-submit" }
- assertVisible: { id: "pin-change-submit" }

# Lock, unlock via PIN
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

# Lock, enter wrong PIN (6 zeros), assert counter, fall back to master
- tapOn: { id: "vault-lock-button" }
- tapOn: { id: "unlock-use-pin" }
- tapOn: { id: "unlock-pin-pad-0" }
- tapOn: { id: "unlock-pin-pad-0" }
- tapOn: { id: "unlock-pin-pad-0" }
- tapOn: { id: "unlock-pin-pad-0" }
- tapOn: { id: "unlock-pin-pad-0" }
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

- [ ] **Step 2: Run on iOS and Android**

```bash
pnpm e2e:mobile:ios -- flows/pin.yaml
pnpm e2e:mobile:android -- flows/pin.yaml
```

Expected: PASS on both.

- [ ] **Step 3: Commit**

```bash
git add e2e/mobile/flows/pin.yaml
git commit -m "test(mobile): Maestro flow for §12 PIN unlock"
```

---

### Task 7: Write `flows/persistence.yaml` (§13) and `flows/clipboard.yaml` (§14)

**Files:**

- Create: `e2e/mobile/flows/persistence.yaml`
- Create: `e2e/mobile/flows/clipboard.yaml`

- [ ] **Step 1: `persistence.yaml`**

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
---
- runFlow: helpers/_create-vault.yaml
- runFlow: helpers/_add-login.yaml
- tapOn: { id: "vault-lock-button" }

- stopApp
- launchApp
- extendedWaitUntil:
    visible: { id: "unlock-password" }
    timeout: 15000
- runFlow: helpers/_unlock-vault.yaml
- assertVisible: "GitHub"
```

- [ ] **Step 2: `clipboard.yaml`**

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
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

- runScript: scripts/sleep.js
  env:
    SECONDS: "35"

- runScript: scripts/assert-clipboard.js
  env:
    EXPECTED: ""
```

- [ ] **Step 3: Run both on iOS**

```bash
pnpm e2e:mobile:ios -- flows/persistence.yaml flows/clipboard.yaml
```

Expected: PASS. Clipboard takes ~40s due to the sleep.

- [ ] **Step 4: Run both on Android**

```bash
pnpm e2e:mobile:android -- flows/persistence.yaml flows/clipboard.yaml
```

If `adb shell cmd clipboard get-primary-clip` fails on the AVD (some images lack the clipboard service), add a DEV-only fallback: a hidden `<Text testID="dev-clipboard-dump">` on the item detail screen gated on `__DEV__` that renders `await Clipboard.getStringAsync()`. Update `assert-clipboard.js` to read that element via `maestro hierarchy` as a fallback. Scope that change to a separate commit so it's obvious.

- [ ] **Step 5: Commit**

```bash
git add e2e/mobile/flows/persistence.yaml e2e/mobile/flows/clipboard.yaml
git commit -m "test(mobile): Maestro flows for §13 persistence and §14 clipboard"
```

---

### Task 8 (conditional): DEV-only bundled-fixture button

**Only land if Task 5 can't reliably drive `expo-document-picker`.**

**Files:**

- Modify: `apps/mobile/app/settings/import.tsx`

- [ ] **Step 1: Add the button gated on `__DEV__`**

Inside the CSV tab of the import screen, add a button that lists files in the app's Documents directory (where `push-fixture.js` dropped them on iOS, and after an `adb pull` equivalent on Android), letting the user pick one directly:

```typescript
import * as FileSystem from 'expo-file-system';

{__DEV__ && (
  <Button
    testID="import-pick-bundled-fixture"
    title="Import bundled fixture (DEV)"
    variant="secondary"
    onPress={async () => {
      const dir = FileSystem.documentDirectory!;
      const files = await FileSystem.readDirectoryAsync(dir);
      const csv = files.find((f) => f.endsWith('.csv') || f.endsWith('.keykeykey'));
      if (!csv) return;
      const content = await FileSystem.readAsStringAsync(dir + csv);
      handleImportContent(content, csv);  // existing import handler
    }}
  />
)}
```

- [ ] **Step 2: Update `_import-csv.yaml` to tap this button**

Replace the native-picker interaction:

```yaml
- tapOn: { id: "import-pick-bundled-fixture" }
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/settings/import.tsx e2e/mobile/helpers/_import-csv.yaml
git commit -m "feat(mobile): DEV-only bundled-fixture import for E2E"
```

Skip to Task 9 if Task 5 worked without the fallback.

---

### Task 9: Write `flows/sync-flow.yaml` (§5–§8) — the big one

**Files:**

- Create: `e2e/mobile/flows/sync-flow.yaml`

- [ ] **Step 1: Verify env vars**

```bash
echo "$KKK_WEBDAV_URL" "$KKK_WEBDAV_USER" "$KKK_WEBDAV_PASS" | wc -w
```

Expected: `3`.

- [ ] **Step 2: Smoke the reset script**

```bash
cd e2e/mobile && node scripts/webdav-reset.js
```

Expected: `[webdav-reset] remote cleared`.

- [ ] **Step 3: Write the flow**

```yaml
appId: com.keykeykey.mobile
tags:
  - critical
---

# §5 — first-time WebDAV connect, clean remote
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
    timeout: 40000

# §6 — destroy local + restore from cloud
- tapOn: { id: "vault-lock-button" }
- tapOn: { id: "settings-reset-vault" }
- tapOn: { id: "settings-reset-confirm" }
- extendedWaitUntil:
    visible: { id: "setup-password" }
    timeout: 10000
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
    timeout: 40000
- tapOn: "Continue"
- assertVisible: "GitHub"

# §7 — merge conflict (same master password)
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
    visible: "Remote Vault Detected"
    timeout: 40000
- tapOn: { id: "sync-conflict-merge" }
- extendedWaitUntil:
    visible:
      id: "sync-status"
      text: "Last synced"
    timeout: 40000
- back
- assertVisible: "GitHub"
- assertVisible: "GitLab"

# §8 — replace conflict (different master password)
# DO NOT wipe the WebDAV remote here — we need §7's remote to trigger
# "Incompatible Remote Vault" in the new-password branch.
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
      ITEM_PASSWORD: "testqwer-local"
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
- inputText: "testqwer"
- tapOn: { id: "sync-connect" }
- extendedWaitUntil:
    visible: "Incompatible Remote Vault"
    timeout: 40000
- tapOn: { id: "sync-conflict-replace-remote" }
- extendedWaitUntil:
    visible:
      id: "sync-status"
      text: "Last synced"
    timeout: 40000
- back
- assertVisible: "LocalOnly"
```

- [ ] **Step 4: Run on iOS, iterate until green**

```bash
pnpm e2e:mobile:ios -- flows/sync-flow.yaml
```

Expect ~3–4 minutes runtime. Debug as needed; common pitfalls noted in the spec.

- [ ] **Step 5: Run on Android**

```bash
pnpm e2e:mobile:android -- flows/sync-flow.yaml
```

- [ ] **Step 6: Commit**

```bash
git add e2e/mobile/flows/sync-flow.yaml
git commit -m "test(mobile): Maestro flow for §5-§8 WebDAV sync scenarios"
```

---

### Task 10: Update `run-mobile-e2e.sh` — KKK_REPO_ROOT export + sync skip

**Files:**

- Modify: `scripts/run-mobile-e2e.sh`

- [ ] **Step 1: Export `KKK_REPO_ROOT` for Maestro flows**

Near the top of the runner, after `repo_root=...`:

```bash
export KKK_REPO_ROOT="$repo_root"
```

This lets `flows/import-export.yaml` reference `${KKK_REPO_ROOT}/e2e/fixtures/...`.

- [ ] **Step 2: Filter out `sync-flow.yaml` when WebDAV env is unset**

Insert after platform dispatch and before `maestro test`:

```bash
skip_sync=0
if [ -z "${KKK_WEBDAV_URL:-}" ] || [ -z "${KKK_WEBDAV_USER:-}" ] || [ -z "${KKK_WEBDAV_PASS:-}" ]; then
  skip_sync=1
fi

# Rewrite argv, dropping any explicit sync-flow.yaml if we're skipping
args=()
dropped_sync=0
for a in "$@"; do
  if [ "$skip_sync" -eq 1 ] && [[ "$a" == *"sync-flow.yaml" ]]; then
    echo "[run-mobile-e2e] skipping sync-flow.yaml — KKK_WEBDAV_* unset"
    dropped_sync=1
    continue
  fi
  args+=("$a")
done

# If the user invoked with no path args at all, build the full list ourselves
# so we can leave out sync-flow.yaml when skipping.
if [ ${#args[@]} -eq 0 ]; then
  if [ "$skip_sync" -eq 1 ]; then
    args=(flows/setup-vault.yaml flows/vault-crud.yaml flows/unlock.yaml flows/generator.yaml flows/pin.yaml flows/persistence.yaml flows/clipboard.yaml flows/import-export.yaml)
    echo "[run-mobile-e2e] skipping sync-flow.yaml — KKK_WEBDAV_* unset"
  else
    args=(flows/)
  fi
fi
```

Then `cd "$mobile_dir" && maestro test --device "$device" "${args[@]}"` (replace the existing invocation).

- [ ] **Step 3: Verify the skip path**

```bash
unset KKK_WEBDAV_URL
pnpm e2e:mobile:ios -- --include-tags=critical
```

Expected: runs all critical flows except sync-flow; "[run-mobile-e2e] skipping sync-flow.yaml …" appears in output.

- [ ] **Step 4: Verify the non-skip path**

```bash
source ~/.zshrc  # re-exports KKK_WEBDAV_*
pnpm e2e:mobile:ios -- --include-tags=critical
```

Expected: runs all critical flows including sync-flow.

- [ ] **Step 5: Commit**

```bash
git add scripts/run-mobile-e2e.sh
git commit -m "chore(scripts): export KKK_REPO_ROOT and skip sync-flow.yaml without WebDAV env"
```

---

### Task 11: Update `base-test-flow.md`

**Files:**

- Modify: `base-test-flow.md`

- [ ] **Step 1: Add "Automated:" prefixes to §5–§14**

For each section, immediately under the heading:

- §5: `**Automated:** `e2e/mobile/flows/sync-flow.yaml` (iOS + Android, requires `KKK_WEBDAV_*` env).`
- §6: `**Automated:** `e2e/mobile/flows/sync-flow.yaml` (chained).`
- §7: `**Automated:** `e2e/mobile/flows/sync-flow.yaml` (chained).`
- §8: `**Automated:** `e2e/mobile/flows/sync-flow.yaml` (chained).`
- §9: `**Automated:** `e2e/mobile/flows/import-export.yaml` (per-vendor).`
- §10: `**Automated:** `e2e/mobile/flows/import-export.yaml` (round-trip).`
- §11: `**Automated:** `e2e/mobile/flows/import-export.yaml` (encrypted backup).`
- §12: `**Automated:** `e2e/mobile/flows/pin.yaml`.`
- §13: `**Automated:** `e2e/mobile/flows/persistence.yaml`.`
- §14: `**Automated:** `e2e/mobile/flows/clipboard.yaml`.`

- [ ] **Step 2: Final critical-subset acceptance run**

```bash
pnpm e2e:mobile:ios -- --include-tags=critical
pnpm e2e:mobile:android -- --include-tags=critical
```

Expected: all critical flows pass on both platforms. Record wall-clock.
Target: under 10 minutes per platform.

- [ ] **Step 3: Commit**

```bash
git add base-test-flow.md
git commit -m "docs(base-test-flow): mark §5-§14 automated via Maestro"
```

---

## Self-Review Checklist

- [ ] All five new flows pass on iOS sim (`iPhone 17 Pro`, iOS 18).
- [ ] All five pass on Android emulator (`Pixel 7`, API 34).
- [ ] With `KKK_WEBDAV_*` unset, `pnpm e2e:mobile:ios` runs everything except sync-flow and prints the skip line.
- [ ] Full critical subset runs under 10 minutes per platform.
- [ ] `base-test-flow.md` has "Automated:" prefixes on all §5–§14 sections.
- [ ] No changes under `apps/mobile/` unless the DEV-only bundled-fixture fallback was required (Task 8).

When all confirmed, push and request review.
