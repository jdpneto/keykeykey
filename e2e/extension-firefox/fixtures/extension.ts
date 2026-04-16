/**
 * Firefox equivalent of e2e/fixtures/extension.ts. Same API shape (`popup`
 * is a Page navigated to the extension popup URL) so spec re-exports can
 * share test logic between Chromium and Firefox projects.
 *
 * Requires a Firefox binary that accepts unsigned addons (see
 * `firefoxBinary()` in profile.ts). When none is available the whole project
 * is skipped — the scaffolding is still in place and tests light up the
 * moment a Developer Edition / Nightly / Unbranded build is on $PATH (or
 * `KKK_FIREFOX_BIN` is set).
 */
import { test as base, firefox, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXT_UUID, firefoxBinary, firefoxUserPrefs, prepareFirefoxProfile } from './profile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = resolve(__dirname, '../../../apps/extension/dist-firefox');

const FIREFOX_BIN = firefoxBinary();

// Double-gated deliberately: the harness is parked pending a Selenium +
// geckodriver pivot (Playwright's Firefox silently ignores profile-scope
// addon scanning, and stock Dev Edition lacks juggler patches). Setting
// KKK_FIREFOX_E2E=1 without a working approach would just timeout, so we
// force the operator to acknowledge the state of the world. See
// docs/superpowers/specs/2026-04-11-firefox-e2e-design.md §9.
base.skip(
  process.env.KKK_FIREFOX_E2E !== '1' || FIREFOX_BIN === null,
  'Firefox e2e is parked — harness not currently runnable under Playwright. ' +
    'See docs/superpowers/specs/2026-04-11-firefox-e2e-design.md §9.',
);

export const test = base.extend<{
  context: BrowserContext;
  extensionId: string;
  popup: Page;
  profileDir: string;
}>({
  // eslint-disable-next-line no-empty-pattern
  profileDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'kkk-ff-'));
    prepareFirefoxProfile(dir, EXTENSION_PATH);
    if (process.env.KKK_FIREFOX_DEBUG) {
      // eslint-disable-next-line no-console
      console.log('[firefox-ext] profile:', dir);
    }
    await use(dir);
    if (!process.env.KKK_FIREFOX_DEBUG) {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  context: async ({ profileDir }, use) => {
    const context = await firefox.launchPersistentContext(profileDir, {
      headless: false,
      args: ['-no-remote'],
      firefoxUserPrefs,
      // FIREFOX_BIN is non-null here because the top-level base.skip() is
      // evaluated before the fixture runs; see the comment above base.skip.
      executablePath: FIREFOX_BIN!,
    });
    await use(context);
    await context.close();
  },
  // eslint-disable-next-line no-empty-pattern
  extensionId: async ({}, use) => {
    // UUID pinned via firefoxUserPrefs — no service-worker lookup needed.
    await use(EXT_UUID);
  },
  popup: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`moz-extension://${extensionId}/src/popup/index.html`);
    await page.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, {
      timeout: 30_000,
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
