# Firefox extension E2E

Selenium 4 + geckodriver against **Firefox Developer Edition**
(Nightly or Unbranded-ESR also work — anything that honours
`xpinstall.signatures.required=false`). Tests live next to this README
and use Vitest as the runner.

## Why not Playwright?

Playwright's bundled Firefox (a custom-patched Nightly build) silently
skips profile-scope addon scanning — same XPI that Dev Edition registers
with `signedState=-1, active=true` leaves Playwright's Firefox with a
blank `extensions.json`. And Playwright can't drive stock Firefox
because stock Firefox doesn't speak juggler.

geckodriver is the canonical path: Mozilla-maintained, first-class
`installAddon(xpi, temporary=true)` that bypasses signing on Dev /
Nightly / Unbranded builds. The full write-up is in
`docs/superpowers/specs/2026-04-11-firefox-e2e-design.md` §9.

## Prerequisites

- **Firefox Developer Edition** installed. Default location on macOS:
  `/Applications/Firefox Developer Edition.app`. Install with
  `brew install --cask firefox@developer-edition` or grab the `.dmg`
  from
  <https://www.mozilla.org/firefox/channel/desktop/#developer>.
  Alternatively, set `KKK_FIREFOX_BIN=/path/to/firefox` to point at any
  Dev / Nightly / Unbranded build.
- **Built extension at `apps/extension/dist-firefox/`**:
  ```bash
  pnpm --filter @keykeykey/core --filter @keykeykey/ui build
  pnpm --filter @keykeykey/extension build:firefox
  ```
- **`zip` on PATH** (used to package the unpacked tree into a
  temporary XPI at runtime).

geckodriver comes in via the `geckodriver` npm dep and is auto-installed
when you run `npm install` in `e2e/`.

## Running

From `e2e/`:

```bash
npm run test:firefox
```

You should see all three Setup-Vault specs pass in ~12 seconds.

## Adding specs

- Name files `*.firefox.spec.ts` so the Vitest include pattern picks
  them up.
- Use `startDriver()` from `./fixtures/driver.js` in a `beforeEach` to
  spin up a fresh driver per test and call `cleanup()` in `afterEach`.
- The popup URL is exported as `POPUP_URL` (resolves to
  `moz-extension://<pinned-uuid>/src/popup/index.html`).
- Selenium's `[attr*=value]` CSS selectors are case-sensitive by
  default. Append the CSS4 `i` flag for case-insensitive matching (e.g.
  `input[placeholder*="repeat" i]`) — Chromium's Playwright selectors
  `getByPlaceholder(/repeat/i)` are case-insensitive, so the
  translation isn't always obvious.

## Current coverage (Phase A)

- `setup-vault.firefox.spec.ts` — 3 tests mirroring
  `e2e/extension/setup-vault.spec.ts` @critical.

## Next up (Phase B — tracked in task #26)

- Port `unlock`, `vault-crud`, `sync-flow`, `import-export`, `pin`,
  `persistence`, `clipboard`, `autofill` specs.
- Add a non-blocking `test-ext-firefox` GitHub Actions job that
  downloads a pinned Dev Edition build (cached via `actions/cache`)
  and runs the Selenium suite.
- After ≥2 Selenium specs land, extract shared flow helpers
  (`createVault`, `addCredential`, …) so the Chromium and Firefox
  dialects stop diverging.
