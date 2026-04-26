# KeyKeyKey — Base Test Flow

End-to-end manual smoke test covering every user-facing flow we ship. The
flow targets the **Tauri desktop app** (driven via the `computer-use` MCP)
and the **Expo mobile app** (driven via the user's mobile-automation MCP of
choice — iOS Simulator, Android emulator, etc.). Platform divergences are
called out inline under each section.

Chrome/Firefox extension coverage is automated end-to-end in
`e2e/extension/*.spec.ts` — that suite owns §1–§14 for the extension. Don't
duplicate it here.

Pick up where you left off by reading this file top to bottom.

---

## Prerequisites

### Shared

- **WebDAV credentials** — never commit literally. Export locally before
  running the sync sections:
  ```bash
  export KKK_WEBDAV_URL='https://<your-host>'   # bare host, no Nextcloud path
  export KKK_WEBDAV_USER='<user>'
  export KKK_WEBDAV_PASS='<password>'
  ```
- **Anonymized CSV fixtures** (for §9 — import/export): checked in at
  `e2e/fixtures/password-imports/`. Never point tests at the real
  `/passwords/` exports — those are `.gitignore`d for a reason.

### Desktop

- Apple Silicon macOS.
- Build output at
  `apps/desktop/src-tauri/target/release/bundle/macos/KeyKeyKey.app`
  (rebuild with `cd apps/desktop && npx tauri build` if stale).
- `computer-use` MCP access to bundle id `com.keykeykey.desktop`.

### Mobile

- Expo build running against the iOS Simulator or Android emulator
  (`cd apps/mobile && npx expo run:ios` / `npx expo run:android`).
- For iOS: Apple Team ID exported (`APPLE_TEAM_ID=…`) — required by
  `apps/mobile/app.config.js` for the AutoFill Credential Provider target.
- A mobile-automation MCP that can click and read the device screen.

---

## Mobile automation — Maestro

§1–§4, §9, §12–§14 on iOS Simulator and Android Emulator are
automated via Maestro flows in `e2e/mobile/flows/`. Run the critical
subset with:

```bash
pnpm e2e:mobile:ios -- --include-tags=critical
pnpm e2e:mobile:android -- --include-tags=critical
```

See `e2e/mobile/README.md` for setup. §5 (first-time WebDAV connect) is
automated but flaky on dev builds — see "Known limitations" below.
§6–§8 (restore / merge / replace) and §10–§11 (round-trips) stay
manual-for-now. §15 autofill stays MCP/real-device-only.

Note: on dev (Metro) builds the first `launchApp: { clearState: true }`
in each flow takes ~90s as Android re-downloads and re-parses the JS
bundle. Release/APK builds land in under a second.

---

## Agent-runnable full suite

> **TL;DR for the operator:** "Claude, run the full mobile test suite"
> should invoke this section verbatim. Claude reads each step top to
> bottom, executes it, and reports PASS or the first failure.

### 0. Sanity — is this machine ready?

Before doing anything else, verify the environment:

```bash
node -v                 # expect v22.x
pnpm -v                 # expect 10.x
which maestro || ls -l ~/.maestro/bin/maestro   # must resolve
echo "${APPLE_TEAM_ID:-UNSET}"                  # iOS only
echo "${KKK_WEBDAV_URL:-UNSET} / ${KKK_WEBDAV_USER:-UNSET}"
```

If `maestro` is missing: `curl -Ls https://get.maestro.mobile.dev | bash`.
If the WebDAV vars are unset, `source ~/.zshrc` (they live there per
CLAUDE.md) and re-check. If they are still unset, skip §5 and note it
in the final report.

### 1. Boot a device

Pick one platform per run — running both in parallel confuses Maestro's
device auto-discovery.

**iOS:**

```bash
xcrun simctl list devices booted       # any booted? skip to install
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null || true
open -a Simulator
```

**Android:**

```bash
adb devices                             # any device? skip to install
emulator -list-avds                     # pick one
nohup emulator -avd <avd-name> -no-snapshot-load >/tmp/emu.log 2>&1 &
adb wait-for-device
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'
```

### 2. Install the dev build

```bash
# iOS
cd apps/mobile && npx expo run:ios --device "iPhone 17 Pro"
# Android
cd apps/mobile && npx expo run:android
```

Leave Metro running in a second terminal (or `run_in_background`). The
first build is 3–6 min; subsequent runs reuse the installed app.

### 3. Reset to a clean starting state

```bash
# WebDAV server — cheap, always do it even if you skip §5
curl -sS --fail-with-body -u "$KKK_WEBDAV_USER:$KKK_WEBDAV_PASS" \
  -X POST https://davidneto.eu/api/webdav/clear-data || true
```

On-device: each flow starts with `launchApp: { clearState: true }`, so
no extra reset needed between flows.

### 4. Run the critical subset

```bash
cd /Users/davidneto/keykeykey
pnpm e2e:mobile:ios     -- --include-tags=critical      # iOS
pnpm e2e:mobile:android -- --include-tags=critical      # Android
```

What this covers (on the platform you booted):

| Section              | Flow file                     | Tagged critical? |
| -------------------- | ----------------------------- | ---------------- |
| §1 setup             | `flows/setup-vault.yaml`      | yes              |
| §2 CRUD              | `flows/vault-crud.yaml`       | yes              |
| §4 unlock            | `flows/unlock.yaml`           | yes              |
| §5 sync              | `flows/sync-flow.yaml`        | yes              |
| §9 import CSV        | `flows/import-export.yaml`    | yes              |
| §12 PIN              | `flows/pin.yaml`              | yes              |
| §13 cold boot        | `flows/persistence.yaml`      | yes              |
| §14 clipboard        | `flows/clipboard.yaml`        | yes              |
| §16 password history | `flows/password-history.yaml` | yes              |

Non-critical (run with `pnpm e2e:mobile:<plat>` to include them):

| Section      | Flow file              |
| ------------ | ---------------------- |
| §3 generator | `flows/generator.yaml` |

### 5. Interpret the result

Maestro prints a green check per flow and a final line like
`8/8 passed`. That line is the single source of truth — if it says
`8/8 passed`, the suite is **PASS**. Anything else is **FAIL**, and
the operator wants to know:

1. Which flow failed (`flows/<name>.yaml`).
2. Which command inside that flow failed (Maestro prints the offending
   `tapOn`/`inputText`/`extendedWaitUntil` with the device hierarchy).
3. A screenshot if one was auto-captured under
   `~/.maestro/tests/<timestamp>/`.

Do **not** retry a failing flow silently. Report to the operator and
wait for instructions.

### 6. Report

Always report in this exact shape so the operator can scan quickly:

```
mobile e2e — <ios|android> — <N>/<M> passed
  PASS setup-vault    (Ns)
  PASS vault-crud     (Ns)
  PASS unlock         (Ns)
  FAIL sync-flow      (at: tapOn id: "sync-connect" — timeout 60000ms)
  ...
env: KKK_WEBDAV_{URL,USER,PASS}=<set|unset>
notes: <§X skipped because …> (only if applicable)
```

### Known limitations the agent should NOT try to "fix"

- **§5 currently fails on Android** because the two password fields
  on the Cloud Sync screen refuse `inputText` (confirmed
  2026-04-17). URL + Username fill fine, both passwords come back
  empty, Connect stays disabled, the flow times out at 60 s waiting
  for "Last synced". Flipping the visibility toggle to disable
  `secureTextEntry` before typing does not help. Root cause is still
  open — do not try to "fix" the flow by adding sleeps or
  bumping the 60 s timeout; report and move on.
- **§5 on dev builds is additionally slow (30–60 s Argon2)** even
  when the typing works. On truly slow machines (Intel Mac, battery
  saver) it can still fail. Don't bump the timeout; report it.
- **§6–§8 (restore / merge / replace) are not automated yet.** The
  flow files don't exist. Running them is a manual-MCP job.
- **§10, §11 round-trips** depend on reading back the exported file;
  they're not in `flows/` yet and stay manual.
- **§15 autofill** is OS-level and cannot be driven from Maestro.
  Leave it to the operator with the `mobile-mcp` MCP.

### Troubleshooting before giving up

| Symptom                             | Likely cause              | Fix                                                             |
| ----------------------------------- | ------------------------- | --------------------------------------------------------------- |
| `No device found`                   | simulator not booted      | run step 1                                                      |
| `launchApp` hangs 60s+ on Android   | stale adb forward         | `adb kill-server && adb start-server`                           |
| `Element not found: setup-password` | old build without testIDs | re-run `expo run:<platform>` (step 2)                           |
| `Timeout on setup-submit`           | cold Metro reload         | first run after boot always slow; re-run once                   |
| §5 "Connect button disabled"        | password didn't arrive    | check `$KKK_WEBDAV_PASS` for `^`, `&`, `%`                      |
| `http-proxy refuses 192.168.*`      | LAN WebDAV guard on       | use the public WebDAV URL per CLAUDE.md "Local Network Testing" |

If none of the above applies, stop and report. Do **not** edit flow
YAML to make a failing test pass.

---

## Setup

### Desktop

1. `request_access(["com.keykeykey.desktop"])`. If `windowLocations` shows
   the app on a secondary display, `switch_display` to that monitor.
   Screenshot coordinates below assume the KeyKeyKey window is centered at
   ~(727, 350).
2. `open` the `.app` bundle, then
   `open_application("com.keykeykey.desktop")`.
3. If a vault already exists, click "Lock Vault" (sidebar, ~450,568) →
   "Reset Vault" → confirm. You should land on **Create Your Vault**.

### Mobile

1. Launch the app on the simulator/emulator.
2. If a vault already exists, use Settings → Danger Zone → Reset Vault to
   get back to **Create Your Vault**.

---

## WebDAV reset utility — run BEFORE and AFTER the sync flow

Leaves the server in a known-empty state so the first-time-connect path
(§5) runs as first-time. Also useful between §7 (merge) and §8 (replace)
if you want to isolate failures.

You have **two ways** to reset:

### Option A — `clear-data` HTTP endpoint (preferred)

```bash
curl -sS --fail-with-body -u "$KKK_WEBDAV_USER:$KKK_WEBDAV_PASS" \
  -X POST https://davidneto.eu/api/webdav/clear-data
```

One call; atomic; the endpoint CI also uses (see
`e2e/extension/sync-flow.spec.ts` → `wipeRemote()`).

### Option B — raw WebDAV (fallback)

```bash
# Delete the encrypted vault blob (404 after a clean run is fine).
curl -s -u "$KKK_WEBDAV_USER:$KKK_WEBDAV_PASS" -o /dev/null -w "vault.enc DELETE: %{http_code}\n" \
  -X DELETE "$KKK_WEBDAV_URL/keykeykey/vault.enc"

# Enumerate and delete every uploaded item.
curl -s -u "$KKK_WEBDAV_USER:$KKK_WEBDAV_PASS" -X PROPFIND -H "Depth:1" \
  "$KKK_WEBDAV_URL/keykeykey/items/" \
  | grep -oE '[0-9a-f-]{36}\.bin' \
  | while read -r f; do
      curl -s -u "$KKK_WEBDAV_USER:$KKK_WEBDAV_PASS" -o /dev/null \
        -X DELETE "$KKK_WEBDAV_URL/keykeykey/items/$f"
    done

# Verify:
curl -s -u "$KKK_WEBDAV_USER:$KKK_WEBDAV_PASS" -o /dev/null -w "vault.enc status: %{http_code}\n" \
  "$KKK_WEBDAV_URL/keykeykey/vault.enc"   # expect 404
```

---

## check-vault.mjs utility — verify the remote blob out-of-band

Useful when a merge/replace test looks wrong — confirms what the server
actually has without relying on the UI. Writes a throwaway script in
`packages/core/` so it can resolve `@noble/*` via the workspace.

```bash
curl -s -u "$KKK_WEBDAV_USER:$KKK_WEBDAV_PASS" -o /tmp/vault.enc \
  "$KKK_WEBDAV_URL/keykeykey/vault.enc"

cat > /Users/davidneto/keykeykey/packages/core/check-vault.mjs <<'EOF'
import { readFileSync } from 'node:fs';
import { argon2id } from '@noble/hashes/argon2';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
const data = readFileSync('/tmp/vault.enc');
const syncSalt = data.subarray(0, 16);
const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
const params = {
  t: dv.getUint32(16, true), m: dv.getUint32(20, true),
  p: dv.getUint32(24, true), dkLen: dv.getUint32(28, true),
};
const ct = data.subarray(32);
for (const pwd of process.argv.slice(2)) {
  const mek = argon2id(new TextEncoder().encode(pwd), syncSalt, params);
  try {
    const plain = xchacha20poly1305(mek, ct.subarray(0, 24))
      .decrypt(ct.subarray(24));
    const obj = JSON.parse(new TextDecoder().decode(plain));
    console.log(pwd, 'OK — vaultId:', obj.manifest?.vaultId,
      'items:', Object.keys(obj.manifest?.items || {}).length);
    process.exit(0);
  } catch { console.log(pwd, 'fail'); }
}
EOF
node /Users/davidneto/keykeykey/packages/core/check-vault.mjs testqwer test1234
rm /Users/davidneto/keykeykey/packages/core/check-vault.mjs /tmp/vault.enc
```

---

## Timings that matter

Both desktop and mobile use the heavy Argon2 preset (m=65536, 3 iterations).
Every operation that runs the KDF — Create Vault, Unlock, Restore from
Cloud, Connect Sync — takes ~15–22 s on desktop, and can be slower on
mobile simulators. Always wait ≥22 s after clicking those buttons before
asserting the next screen.

---

## Desktop UI coordinates (full-screen, 1456-wide monitor, centered window)

- Master password field (Setup/Unlock): (727, 337) / (727, 400)
- Confirm password (Setup): (727, 408)
- Create Vault button: (727, 513)
- Restore from Cloud: (727, 566)
- Sidebar: Vault (437,192), Authenticator (457,224), Generator (449,257),
  Settings (445,289), Lock Vault (450,568)
- Add item "+" button: (1030, 156)
- Save / Cancel in Add Item: (909, 156) / (954, 156)
- Add Item form fields: Name (770,275), URL (770,345), Username (770,415),
  Password (770,486); Card variants use Month (671,486), Year (868,486),
  CVV (671,556); Note uses Content (770,370)
- Sync Settings → Provider dropdown: (772, 220); WebDAV option: (612, 238)
- Sync Settings → URL (773,272), Username (773,333), Password (762,395),
  Master Password (762,457), Connect (614,495)
- Sync Settings → Sync Now (773,306), Disconnect (773,347)
- Settings → Import Passwords / Export Vault rows: below the Cloud Sync row
  on the Settings screen — scroll if not visible.

---

## The base flow

Runs in this exact order. Each section ends in a known-good state that the
next section depends on. If you skip ahead, run the WebDAV reset first to
isolate state.

### §1. Create vault

**Automated:** `e2e/mobile/flows/setup-vault.yaml` (iOS + Android).

- Enter `test1234` in both fields.
  > **Rule:** min 8 chars — the app rejects shorter passwords **silently**
  > (see "Known issues"). The "At least 8 characters" indicator turns on
  > but the button stays active and inert.
- Click Create Vault → wait 22 s → lands on the empty Vault screen.
- **Mobile:** same flow; the recovery-key screen appears on both
  platforms. Tick the "I've saved my recovery key" checkbox before
  Continue.

### §2. Add one of each item type

**Automated:** `e2e/mobile/flows/vault-crud.yaml` (iOS + Android).

- **Login** (Add → Login tab default): Name "GitHub", URL
  `https://github.com`, Username `claude-test`, Password
  `hunter2-test-password`.
- **Card** (Add → Card tab): Name "Test Visa", Cardholder "Claude Tester",
  Number `4111111111111111`, Month 12, Year 2030, CVV 123.
- **Note** (Add → Note tab): Name "WiFi Backup Codes", Content
  `SSID: home-network\nKey: correct horse battery staple`.

Vault list should show all three.

### §3. Password generator

**Automated:** `e2e/mobile/flows/generator.yaml` (iOS + Android, non-critical).

- Sidebar → Generator → a 20-char password with entropy ~129 bits ("very
  strong") should appear.
- Click Regenerate → password changes.
- **Mobile:** same, on the Generator tab.

### §4. Lock + unlock (master password)

**Automated:** `e2e/mobile/flows/unlock.yaml` (iOS + Android).

- Click "Lock Vault" → lands on **Welcome Back / Unlock Vault** screen.
- Enter `test1234` → Unlock → wait 22 s → three items from §2 still
  present.

### §5. WebDAV sync (first time, clean remote)

Ensure the remote is clean first (run the **WebDAV reset** utility).

- Settings → Cloud Sync → Provider dropdown → WebDAV.
- URL `$KKK_WEBDAV_URL` — bare host, **no** `/remote.php/dav/files/...`
  tail. The client handles path discovery, and appending a Nextcloud path
  silently routes through the wrong endpoint.
- Username `$KKK_WEBDAV_USER`, Password `$KKK_WEBDAV_PASS`, Master
  Password `test1234` (vault master — throwaway, not a server secret).
- Connect → wait ~20 s → "Last synced: HH:MM:SS" with a green check.
- Verify: `check-vault.mjs test1234` → `OK` with item count = 3.

### §6. Destroy and restore from cloud

- Lock Vault → Reset Vault → confirm. Lands on **Create Your Vault**.
- Click **Restore from Cloud**. Enter WebDAV URL / user / pass → Next.
- Enter master password `test1234` → Restore Vault → wait ~22 s.
- Expected: **"Vault Restored — Successfully restored 3 items from the
  cloud."**
- Open the vault: all three §2 items present.

### §7. Merge conflict (same master password)

- Lock → Reset Vault → confirm. Create a new vault with the **same**
  master password `test1234`. Add a distinct local item (login "GitLab").
- Settings → Cloud Sync → configure WebDAV with same creds & master →
  Connect.
- Expected: **"Remote Vault Detected — The remote server has a vault with
  N items from a different device"** dialog with options Merge Vaults /
  Replace Local with Remote / Replace Remote with Local / Cancel.
- Click **Merge Vaults** → wait ~15 s.
- Expected: dialog dismisses, the "Remote vault mismatch" banner clears
  (was the PR #59 fix), vault shows all items from both vaults, remote is
  rewritten under the new vault ID with the merged item set.
- Verify: `check-vault.mjs test1234` → remote decrypts and reports the
  merged item count.

> **Historical:** PR #57 fixed the underlying issue where the old sync
> engine's 2 s debounce timer survived teardown and fired a stale sync
> against the new remote blob, producing a fake "Incompatible Remote
> Vault" dialog even though the merge had succeeded end-to-end. PR #59
> clears the now-stale "Remote vault mismatch" banner that those
> resolutions left behind.

### §8. Replace conflict (different master password)

- Run the WebDAV reset (optional but recommended).
- Lock → Reset Vault → confirm. Create a new vault with a **different**
  master password, e.g. `testqwer`. Add a distinct local item.
- Settings → Cloud Sync → configure WebDAV (WebDAV password stays
  `$KKK_WEBDAV_PASS`, Master Password is now `testqwer`) → Connect.
- Expected (first-time remote empty): a successful "Last synced" without
  a dialog. If the previous remote still has items from §7 and the master
  password doesn't match, **"Incompatible Remote Vault"** is shown with
  **only** Replace Remote with Local + Cancel (no Merge, no Replace Local
  — because the remote can't be decrypted with the new password).
- Click **Replace Remote with Local** → wait ~15 s.
- Expected: dialog dismisses, banner clears, "Last synced" updates. No
  manual Sync Now click required — the engine is recreated with the new
  salt/MEK as part of the replace flow.
- Verify: `check-vault.mjs testqwer test1234` → `testqwer` decrypts,
  vault ID matches the new local vault, item count == local.

### §9. Import passwords — CSV (per-vendor)

Anonymized fixtures live at `e2e/fixtures/password-imports/`. Test each
vendor format independently — start from a fresh empty vault for each
one, otherwise you'll collide with a prior import.

For each fixture, verify:

1. **Source badge matches**: after selecting the file, the "Source:"
   badge in the Import screen should display the correct vendor
   (`Chrome`, `Firefox`, `Bitwarden`, `iCloud Keychain`, `1Password`).
2. **Parse succeeds**: an item count appears under the badge; no parse
   error is surfaced.
3. **Import succeeds**: click Import → progress view (extension/mobile) or
   inline progress (desktop) → the "Imported N items" toast appears.
4. **Vault contents reflect the import**: representative titles are
   visible in the list.

Expected representative titles per fixture (loose; the parser skips the
Firefox Accounts `chrome://` entry, the 1Password Identity row, etc.):

| Fixture                        | Look for                                             |
| ------------------------------ | ---------------------------------------------------- |
| `chrome.csv`                   | `9gag.com`, `account.dji.com`, `account.samsung.com` |
| `firefox.csv`                  | `amazon.it`, `acp.pt`                                |
| `bitwarden.csv`                | `1password`, `9gag.com`, `account.jetbrains.com`     |
| `icloud.csv`                   | `a1.net`, `backoffice.aan.pt`                        |
| `1password-without-header.csv` | `radiopopular.pt`, `accounts.google.com`             |

Desktop specifics:

- Settings → Import Passwords → "From CSV" tab → file picker → select the
  fixture.
- Pick Import Mode (Merge vs Add All) before clicking Import.

Mobile specifics:

- Settings → Import → select file via the native picker. Expo's
  `expo-document-picker` is used; ensure the fixture is accessible to the
  simulator (e.g. drag-drop onto the iOS simulator window).

### §10. CSV export → re-import round-trip

Verifies our own CSV format is lossless for the credential fields we care
about. Mirrors the e2e test
`e2e/extension/import-export.spec.ts` → "CSV export and re-import
round-trip preserves items".

- From a vault with at least two distinct logins (e.g. GitHub + GitLab),
  Settings → Export Vault → "Export as CSV" tab → Export CSV.
- Note the file-saver prompt path; the filename is
  `keykeykey-export-YYYY-MM-DD.csv`.
- Reset Vault → create a fresh vault with the same master password.
- Settings → Import Passwords → select the just-exported CSV. Source
  badge should read **"KeyKeyKey"**.
- Import → verify the GitHub + GitLab items reappear with the same
  usernames and passwords.

### §11. Encrypted backup export → re-import round-trip

Verifies the `.keykeykey` zip bundle (`vault.enc` + `items/*`) unwraps
correctly under the original master password. Mirrors the e2e test
"encrypted backup round-trip preserves items".

> **Important:** the encrypted-import flow in the extension had a UI race
> where the progress view froze at "Importing 0 of N" (PR #63 fixed it).
> Desktop and mobile do NOT have this race — they call `addItems` as a
> direct awaitable rather than the extension's background
> fire-and-forget + polling pattern. The manual flow below assumes the
> fixed behavior.

- Create a vault with a known item (e.g. `GitHub` / user /
  `encpass1`).
- Settings → Export Vault → "Encrypted Backup" tab → set a backup
  password (`backup1234`, confirm it) → Export Backup.
- File saved as `keykeykey-backup-YYYY-MM-DD.keykeykey` (wire format:
  `[16-byte salt][16-byte argon2 params][encrypted zip ciphertext]` — NOT
  a standard PK zip, so don't try to open it with Finder Quick Look).
- Reset Vault → create a fresh vault with the same master password
  (`test1234`).
- Settings → Import Passwords → "From Encrypted Backup" tab → select the
  `.keykeykey` file → enter master `test1234` and backup password
  `backup1234` → Import Backup.
- Expected: "Imported 1 item" (or whatever count you exported).
- Vault list shows the restored items.

### §12. PIN unlock (set, unlock, wrong-PIN counter)

**Automated:** `e2e/mobile/flows/pin.yaml` (iOS + Android).

Mirrors `e2e/extension/pin.spec.ts`. The PinPad default `maxLength=6`, so
even though the Settings form accepts any PIN ≥4 chars, only 6-digit PINs
auto-submit on the unlock screen. Use 6 digits.

- Settings → Security → Set PIN → enter `135790`, confirm `135790` → Set
  PIN. The form should collapse and the button change to "Change PIN".
- Lock Vault → on the Unlock screen, toggle **"Use PIN instead"**.
- Enter the correct PIN → vault unlocks.
- Lock again → toggle to PIN mode → enter a wrong PIN (`000000`).
- Expected: **"Wrong PIN. 4 attempts remaining."** (SET_PIN seeds 5
  attempts; first miss surfaces 4.)
- Toggle **"Use master password instead"** → enter `test1234` → Unlock.
  This proves the master-password fallback is available even after a
  wrong PIN.

### §13. Persistence (close app, reopen)

**Automated:** `e2e/mobile/flows/persistence.yaml` (iOS + Android).

Mirrors `e2e/extension/persistence.spec.ts` — proves the vault header and
encrypted items round-trip through local storage when the app cold-starts.

- With at least one item in the vault, Lock Vault.
- **Desktop:** Quit the KeyKeyKey app entirely (`Cmd+Q` or via
  `open_application` again after `osascript -e 'quit app "KeyKeyKey"'`).
- **Mobile:** force-quit the app (iOS: swipe up in app switcher;
  Android: Recents → swipe away).
- Relaunch. The app should boot to the **Unlock Vault** screen (not
  Setup), proving the vault header survived.
- Unlock with `test1234` → verify the item list is intact.

### §14. Clipboard copy + auto-clear

**Automated:** `e2e/mobile/flows/clipboard.yaml` (iOS + Android) —
partial: the flow verifies the copy action + native "Password copied
to clipboard" alert. The 30s auto-clear is covered by
`e2e/extension/clipboard.spec.ts` and manual smoke; mobile introspection
requires a Google-APIs emulator image or a dev-only UI helper.

Mirrors `e2e/extension/clipboard.spec.ts`. On all platforms, copying a
password schedules a 30-second clear.

- Open a credential's detail view.
- Click the password **Copy** button (the row with "Password" label —
  it's the second "Copy" button in DOM order on desktop, after the
  username Copy).
- Paste into any other app within 30 s — should be the password.
- Wait ≥30 s, paste again — should be empty.

Note: the 30 s alarm fires via `chrome.alarms` on the extension, via
Tauri's Rust backend on desktop, and via `expo-notifications`-backed
timing on mobile. All three paths end up calling
`navigator.clipboard.writeText('')` (extension / desktop renderer) or the
native clipboard-clear API (mobile). Verify by pasting into a scratch
note.

### §15. Autofill (mobile only)

Desktop has no autofill path — it's a standalone app. The extension's
autofill is automated in `e2e/extension/autofill.spec.ts`. This section
is mobile-only.

- **iOS:** Settings → General → AutoFill Passwords → enable KeyKeyKey as
  an Autofill provider.
- **Android:** Settings → Passwords & accounts → Autofill service → pick
  KeyKeyKey.
- Open any app's login form (use the Expo-served test harness if
  available, or a browser).
- Tap the username field → Autofill quicksuggest → pick a stored
  credential → both username and password fields populate.

### §16. Password history (view, restore, clear)

**Automated:** `e2e/mobile/flows/password-history.yaml` (iOS + Android,
critical). Extension parity in `e2e/extension/password-history.spec.ts`
(@critical).

The password-history feature auto-tracks every password change on a
credential (capped at 20 entries). The Restore action lets the user swap
the current password for any history entry in one click — chosen entry
leaves history, displaced current password is appended at the end. Net
history length unchanged. No master-password re-auth.

- From a vault containing a Login (e.g. the `GitHub` item from §2), edit
  the credential and change its password to `p2`, then edit again and
  change to `p3`.
- Reopen the credential. Tap/click the "Password History (2)" header to
  expand it.
- Each row shows a masked password, a "Changed on YYYY-MM-DD" line, and
  three icon buttons: reveal, copy, **Restore**.
- Tap/click **Restore** on the older row (the `p1`/`p2` entry, depending
  on what you set up).
- Expected: a toast / alert "Password restored — previous moved to
  history." (desktop), `Alert.alert('Restored', 'Previous password moved
to history')` (mobile), or inline "Restored!" pill that auto-dismisses
  after 1.5s (extension). The current password is now the chosen entry's
  password. The history list still has 2 entries: the entry that was NOT
  chosen, and the displaced `p3` at the end (newest position).
- Tap/click "Clear History" → confirm. History is empty.

**Cross-platform notes:**

- **Desktop**: `lucide-react` `RotateCcw` icon next to the eye and copy
  icons.
- **Mobile**: Ionicons `refresh-outline` icon. The action surfaces a
  native `Alert.alert('Restored', ...)` confirmation.
- **Extension**: text "Restore" button (matches the Show/Hide and Copy
  text-button typography on this screen). Inline "Restored!" feedback
  for ~1.5s, then resets.

---

## Known issues / quirks

1. **Silent min-length on setup.** Clicking Create Vault with <8 chars
   does nothing — the "At least 8 characters" indicator turns on, but the
   button stays active and inert. Consider disabling the button or
   surfacing an error on click.
2. **`windowLocations` in `request_access` is load-bearing.** The desktop
   app often opens on the secondary display. Always inspect
   `windowLocations` and `switch_display` before assuming the screenshot
   will show the window.
3. **Connecting WebDAV spins for ~20 s with no in-dialog progress.** The
   Connect button disables but there's no spinner or phase text; consider
   adding one so the user knows it's alive.
4. **Encrypted backup is not a standard zip.** Opening a `.keykeykey`
   file in Finder / File Roller shows "damaged archive" — that's
   expected. See §11 for the wire format.

---

## E2E automation — what's covered where

These Playwright specs own the corresponding scenarios for the extension.
If you're regression-testing just desktop or mobile, skim the spec to see
what the canonical flow looks like; the selectors translate roughly.

| Section                                     | Extension spec                           |
| ------------------------------------------- | ---------------------------------------- |
| §1 create vault                             | `e2e/extension/setup-vault.spec.ts`      |
| §2 add credential                           | `e2e/extension/vault-crud.spec.ts`       |
| §4 lock + unlock (password)                 | `e2e/extension/unlock.spec.ts`           |
| §5–§8 sync flows                            | `e2e/extension/sync-flow.spec.ts`        |
| §9 CSV import per vendor                    | `e2e/extension/import-export.spec.ts`    |
| §10 CSV round-trip                          | `e2e/extension/import-export.spec.ts`    |
| §11 encrypted backup round-trip             | `e2e/extension/import-export.spec.ts`    |
| §12 PIN                                     | `e2e/extension/pin.spec.ts`              |
| §13 persistence                             | `e2e/extension/persistence.spec.ts`      |
| §14 clipboard copy/clear                    | `e2e/extension/clipboard.spec.ts`        |
| §15 autofill (content-script fill)          | `e2e/extension/autofill.spec.ts`         |
| §16 password history (view, restore, clear) | `e2e/extension/password-history.spec.ts` |

Run the full extension `@critical` suite locally with:

```bash
source ~/.zshrc   # sets KKK_WEBDAV_{URL,USER,PASS}
cd e2e && npx playwright test --project=extension --grep @critical
```

Should report `21 passed (~1m 20s)` on a clean checkout.

Firefox extension is **parked** behind a `KKK_FIREFOX_E2E=1` skip gate
(`e2e/extension-firefox/`) — Playwright's bundled Firefox silently skips
profile-scope addon scanning and stock Dev Edition lacks juggler patches.
Revisit with Selenium + geckodriver. See
`docs/superpowers/specs/2026-04-11-firefox-e2e-design.md` §9 for the
details.

---

## Fixes landed during this flow's development

- **PR #57** — `fix(core/sync): stop leaked engine timers from firing
spurious mismatch`. `SyncEngine.destroy()` clears both periodic and
  debounce timers; `_teardownEngine` and `mergeVaults`/`replaceRemote`
  tear down the old engine up-front; `handleMismatch` guards against
  callbacks from a non-current engine.
- **PR #58** — `fix(ci): replace pnpm audit with osv-scanner`. npm
  retired `/-/npm/v1/security/audits/quick` (HTTP 410); pnpm ≤ 10.x has
  that endpoint hardcoded.
- **PR #59** — `fix(ui/sync): clear stale "Remote vault mismatch" error
on resolve`. Mismatch-resolve handlers now null out `error` on success.
- **PR #60** — `fix(desktop): rebuild @keykeykey/core and @keykeykey/ui
before tauri build`. Desktop Tauri build was packaging stale core/UI
  bundles.
- **PR #61** — `fix(extension): allow popup-as-tab to call privileged
background handlers`. `sender.tab` check was too strict; popup loaded
  as a tab (Playwright, right-click → Open in new tab, future Options
  page) was being rejected as a content script.
- **PR #62** — `ci(extension): run sync-flow spec in @critical e2e
suite`. Wired the WebDAV-secret env vars into the
  `E2E Extension (critical)` job and tagged the sync-flow describe
  `@critical`.
- **PR #63** — `test(extension): expand e2e coverage with import/export
  - Firefox scaffold`. Seven new import/export specs, parked Firefox
    scaffold, anonymized vendor fixtures. Also fixed the encrypted-import
    progress-view race described in §11.
- **PR #64** — `test(extension): add PIN, persistence, clipboard,
autofill e2e coverage`. Four more @critical specs; suite now 21 tests
  in 1m 20s.

---

## Cleanup

Run the **WebDAV reset** utility once the flow finishes. Leave the local
vault locked so the next run starts from the Unlock screen → Reset Vault.
