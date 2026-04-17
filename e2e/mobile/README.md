# Mobile E2E — Maestro

Maestro flows that automate §1–§14 of `base-test-flow.md` on iOS
Simulator and Android Emulator. Mirrors the extension Playwright suite
at `e2e/extension/` — one YAML per scenario, tagged `critical` for the
smoke subset.

## Prerequisites

- **Maestro CLI** — pinned to `2.4.0`. Install with:

  ```bash
  curl -Ls https://get.maestro.mobile.dev | bash
  export PATH="$PATH:$HOME/.maestro/bin"
  ```

- **Node 22+** (matches the rest of the monorepo).
- **iOS toolchain**: Xcode + `iPhone 17 Pro` simulator, iOS 18.
- **Android toolchain**: Android Studio + an AVD, API 34+.
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

Then, from the repo root:

```bash
pnpm e2e:mobile:ios                           # all flows, iOS
pnpm e2e:mobile:android                       # all flows, Android
pnpm e2e:mobile:ios -- --include-tags=critical    # critical subset only
pnpm e2e:mobile:ios -- flows/setup-vault.yaml     # single flow
```

`pnpm e2e:mobile` without a platform defaults to iOS.

## Troubleshooting

- **"Element not found: setup-password"** — the installed build predates
  PR-A. Rebuild: `cd apps/mobile && npx expo run:ios` (or run:android).
- **"Timeout on setup-submit"** — Argon2 may take up to 25s on a cold
  simulator. If it fails repeatedly, bump `extendedWaitUntil` timeouts
  or raise `defaultTimeoutMs` in `config.yaml` to 45000.
- **"No device found"** — confirm a device is booted:
  `xcrun simctl list devices booted` or `adb devices`.

## Layout

- `config.yaml` — workspace config (app id)
- `flows/` — one YAML per extension spec
- `helpers/` — reusable sub-flows invoked via `runFlow:`
- `scripts/` — Node helpers for `runScript:` (env reading, WebDAV reset, etc.)
