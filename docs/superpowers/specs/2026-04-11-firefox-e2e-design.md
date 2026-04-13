# Firefox Extension E2E Coverage Design (Follow-Up)

**Date:** 2026-04-11
**Status:** Reference / Not Implemented

Follow-up spec written alongside `2026-04-11-firefox-extension-parity-design.md`. That plan ships Firefox parity with **manual verification only**. This spec documents how to add automated Playwright coverage for the Firefox extension later, when time permits. Nothing here is scheduled — it's a reference the author can pick up when ready.

## Goals

- Run the existing `@critical` Playwright specs against the Firefox extension build.
- Catch regressions in Firefox-specific code paths (Google PKCE OAuth, clipboard `navigator.clipboard.writeText`, `launchWebAuthFlow` redirect URL plumbing, `browser_specific_settings.gecko.id`-gated storage persistence).
- Mirror the ergonomics of the existing Chromium extension test project in `e2e/extension/` — same directory layout, same test naming, just a different browser target.

## Non-Goals

- Rewriting the Chromium tests to be browser-agnostic. Keep them separate; duplication is fine when harness plumbing differs meaningfully.
- Supporting Firefox headless mode in CI. The addon loading story requires a real browser profile and works best in headed or `xvfb`-wrapped mode.
- Covering Safari. Safari's extension runner is Xcode-driven and doesn't fit the Playwright model.

## 1. How Firefox Extension Loading Differs From Chromium

The existing Chromium extension project launches Chromium with `--load-extension=<path>` and talks to the browser via the Chrome DevTools Protocol (CDP). None of that works in Firefox:

- Firefox has no `--load-extension` flag. You load a temporary addon via `about:debugging` or by writing it to a profile's `extensions/` directory.
- Firefox doesn't speak CDP — it uses its own remote debugging protocol, and Playwright wraps it via `juggler`.
- Firefox won't load an unsigned extension by default. You need a Developer Edition or Nightly build, or to set `xpinstall.signatures.required = false` in the profile's `prefs.js`.
- Temporary addons are blown away when Firefox closes. For repeated CI runs you want either a pre-seeded profile or a helper that re-installs each test run.
- The addon's internal UUID (and therefore its origins and `storage.local` scope) depends on the profile. You must set `browser_specific_settings.gecko.id` in the manifest (already done as of the parity work) **and** pin the UUID in `prefs.js` via `extensions.webextensions.uuids`.

## 2. Recommended Approach: `web-ext` + Playwright

### 2.1 Harness Shape

Use `web-ext` (already a devDependency) to produce a dedicated Firefox profile with the extension pre-installed, then launch Firefox via Playwright with `--profile <path>` equivalent. Two patterns exist:

**Pattern A — `web-ext run` wrapper (recommended).** Spawn `web-ext run --source-dir dist-firefox --firefox-binary <path> --no-reload --keep-profile-changes --firefox-profile <profile>` as a background process. `web-ext` handles loading the addon into the profile, applying the unsigned-extension prefs, and launching Firefox. Then use Playwright's `firefox.connectOverCDP` equivalent... wait, Firefox doesn't do CDP. Instead: have `web-ext` launch Firefox with `--start-debugger-server=<port>`, and connect Playwright via the remote debugging protocol.

**Pattern B — Custom profile pre-seeding.** Pre-create a Firefox profile directory, write the right `prefs.js`, copy the extension into `extensions/keykeykey@keykeykey.app/`, and pass the profile path to Playwright's `firefox.launchPersistentContext`. This skips `web-ext` entirely but requires reimplementing the profile preparation. Cleaner in CI, messier locally.

Recommendation: **Pattern B** for CI and local runs. The one-time profile setup is fiddly but contained in a single helper (`e2e/extension-firefox/fixtures/profile.ts`). It avoids the process-coordination pain of running `web-ext` as a sidecar.

### 2.2 Profile Setup Helper

Rough shape:

```ts
// e2e/extension-firefox/fixtures/profile.ts
import { mkdirSync, writeFileSync, cpSync } from 'fs';
import { join } from 'path';

const GECKO_ID = 'keykeykey@keykeykey.app';
const EXT_UUID = 'e7c5d2a0-1234-5678-9abc-def012345678'; // any fixed UUIDv4

export function prepareFirefoxProfile(profileDir: string, extDir: string) {
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(join(profileDir, 'extensions'), { recursive: true });

  // Copy the built extension into the profile's extensions directory
  cpSync(extDir, join(profileDir, 'extensions', GECKO_ID), { recursive: true });

  // Prefs that let Firefox load unsigned temporary extensions, pin the UUID,
  // and disable first-run noise.
  const prefs = `
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.webextensions.uuids", '{"${GECKO_ID}":"${EXT_UUID}"}');
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.page", 0);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("datareporting.policy.firstRunURL", "");
`;
  writeFileSync(join(profileDir, 'prefs.js'), prefs);
  writeFileSync(join(profileDir, 'user.js'), prefs); // belt and suspenders
}
```

Pinning `extensions.webextensions.uuids` is critical — without it, each Firefox start generates a fresh UUID and the `storage.local` scope changes (no persistence across runs, no stable `moz-extension://` origin).

### 2.3 Playwright Project

`e2e/playwright.config.ts`:

```ts
projects: [
  { name: 'extension',          testDir: './extension' },
  { name: 'firefox-extension',  testDir: './extension-firefox', use: { browserName: 'firefox' } },
  { name: 'desktop',            testDir: './desktop', timeout: 60_000 },
],
```

`e2e/extension-firefox/` holds the tests. Most test files should be thin re-exports of the Chromium specs — same test logic, different fixture. The divergence lives in `fixtures/`, not the specs.

`e2e/extension-firefox/fixtures/extension.ts`:

```ts
import { firefox, test as base } from '@playwright/test';
import { prepareFirefoxProfile } from './profile.js';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const EXT_DIR = join(__dirname, '../../../apps/extension/dist-firefox');
const EXT_UUID = 'e7c5d2a0-1234-5678-9abc-def012345678';

export const test = base.extend({
  context: async ({}, use) => {
    const profileDir = mkdtempSync(join(tmpdir(), 'kkk-ff-'));
    prepareFirefoxProfile(profileDir, EXT_DIR);

    const context = await firefox.launchPersistentContext(profileDir, {
      headless: false, // Firefox headless can't load unsigned extensions reliably
      args: ['-no-remote'],
    });

    await use(context);
    await context.close();
  },

  popupPage: async ({ context }, use) => {
    const popupUrl = `moz-extension://${EXT_UUID}/src/popup/index.html`;
    const page = await context.newPage();
    await page.goto(popupUrl);
    await use(page);
  },
});
```

Tests receive `popupPage` directly — same API as the Chromium fixture, just routed through `moz-extension://<pinned-uuid>/`.

### 2.4 Selector Strategy

The existing popup uses the same React tree in both browsers, so text-based and `data-testid`-based selectors transfer unchanged. The `data-testid` values listed in `CLAUDE.md` all apply.

## 3. Test Parity Checklist

Start with these (the current `@critical` set, adapted):

1. **Onboarding** — Fresh install, set master password, vault unlocks.
2. **Add credential** — Add, list, search, delete.
3. **Lock / unlock** — Password round-trip.
4. **PIN unlock** — Set PIN, lock, unlock with PIN.
5. **Clipboard copy** — Copy password, verify auto-clear after 30s. (Firefox-specific: exercises `navigator.clipboard.writeText('')` path.)
6. **WebDAV sync** — Connect to a local `webdav-server` fixture, sync, verify data.
7. **Import CSV** — Chrome CSV import → items appear → (sync assertion).
8. **Export CSV** — Export → parse → verify round-trip.
9. **Autofill injection** — Visit a fixture login page → icon appears → fill → events fire.
10. **Save prompt** — Submit a login form on an unknown site → save prompt appears → accept → item created.
11. **Storage persistence** — Add items, close browser, reopen, verify items remain. (Firefox-specific: proves `gecko.id` is wired correctly.)

Deferred (not part of the initial parity pass):

- Google Drive, Dropbox, OneDrive OAuth flows. OAuth in headless/headed CI requires a mock OAuth server or recorded fixtures. See §4.
- Autofill across multi-step login flows (Google-style email-then-password).

## 4. OAuth Testing Strategy

Live OAuth in CI is fraught. Three options:

**A) Mock OAuth server** — `e2e/fixtures/oauth-server.ts` runs a local HTTP server that impersonates Google, Dropbox, and OneDrive token endpoints. The test rewrites `VITE_*_CLIENT_ID_FIREFOX` and the endpoint URLs at build time (or via an env var the extension reads). Deterministic, fast, no flaky network. **Recommended.**

**B) Pre-recorded fixtures via MSW** — Mock the `fetch` calls inside the core OAuth helpers using `msw`. Tests never make real network calls. Works for token exchange and refresh, but `launchWebAuthFlow` itself goes through the browser, so you'd need to intercept that too (hard).

**C) Skip OAuth in E2E, cover in unit tests** — Leave OAuth to `packages/core/src/sync/*.test.ts` and accept that full end-to-end OAuth is manually verified. Cheapest.

Start with C to unblock the harness, then move to A when the core tests aren't enough.

## 5. CI Integration

Add a new GitHub Actions job `test-ext-firefox`:

```yaml
test-ext-firefox:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v3
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @keykeykey/core --filter @keykeykey/ui build
    - run: pnpm --filter @keykeykey/extension build:firefox
    - run: pnpm --filter @keykeykey/extension lint:manifest:firefox
    - run: cd e2e && npx playwright install firefox
    - run: cd e2e && xvfb-run npx playwright test --project=firefox-extension --grep @critical
      continue-on-error: true # non-blocking while harness stabilizes
```

Mark non-blocking initially (like current Chromium extension tests) until flaky baseline settles.

## 6. Known Harness Pitfalls

- **Headless Firefox silently drops addons.** Don't try to run headless — use `headless: false` with `xvfb-run` in CI.
- **`web-ext lint` checks are strict.** They'll fail on permissions you don't use. Keep the Firefox permission set tight.
- **Extension origin instability.** Without pinned UUIDs, `moz-extension://<uuid>/` changes every launch and tests can't navigate to the popup URL. `extensions.webextensions.uuids` pref is mandatory.
- **Popup lifetime.** Unlike Chromium where the popup is rendered in a regular page for tests, Firefox popups are ephemeral. Navigate directly to `moz-extension://<uuid>/src/popup/index.html` via `page.goto()` rather than trying to trigger the real popup UI.
- **Service-worker-style background termination.** Firefox event pages persist longer than Chrome service workers, so timing assertions that rely on "background worker sleeps after N seconds" may need Firefox-specific adjustments.
- **Clipboard API from background in tests.** Firefox may reject `navigator.clipboard.writeText` if no tab has focus. In tests, always keep a dummy tab open.

## 7. Scope Estimate

Rough order, smallest first:

1. Profile helper + fixture — 1 hour
2. Playwright project wiring + one smoke test — 1 hour
3. Port first three `@critical` specs — 2 hours
4. Port remaining `@critical` specs — 3 hours
5. Mock OAuth server — 3 hours
6. CI wiring + debugging flaky runs — 2–4 hours

Total: ~a full day of focused work to reach parity with the existing Chromium `@critical` coverage. Not a lot, but not a side-task either.

## 8. When To Do This

Triggers that should move this up the priority list:

- A Firefox-specific regression slips past manual QA.
- The extension is ready to publish to AMO (automated E2E in CI becomes a release gate).
- A significant Firefox-only code path (e.g. a second clipboard approach, a new OAuth provider) lands and would benefit from automated regression coverage.

Until one of those triggers, manual testing per the parity spec's §5 checklist is sufficient.
