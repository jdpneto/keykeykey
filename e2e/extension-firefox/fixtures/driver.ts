/**
 * Selenium WebDriver fixture for Firefox extension tests.
 *
 * Flow:
 *   1. Zip the unpacked `apps/extension/dist-firefox/` tree into an XPI
 *      (geckodriver's `installAddon` wants a packaged file, not a
 *      directory).
 *   2. Launch Firefox Dev Edition via geckodriver with a small set of
 *      startup-suppression prefs (the Firefox 150+ Terms-of-Use prompt,
 *      telemetry first-run, default-browser check).
 *   3. `driver.installAddon(xpi, true)` installs as a *temporary* addon,
 *      which bypasses the signing check on Dev Edition / Nightly /
 *      Unbranded.
 *   4. Pin the addon's internal UUID via `extensions.webextensions.uuids`
 *      so callers can hardcode `moz-extension://<UUID>/src/popup/index.html`.
 *
 * Cleanup: `driver.quit()` kills the browser + geckodriver, and the temp
 * dir containing the XPI is removed.
 */
import { Builder, type WebDriver } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { download as downloadGeckodriver } from 'geckodriver';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXT_UUID, GECKO_ID, firefoxBinary } from './profile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const EXTENSION_SOURCE = resolve(__dirname, '../../../apps/extension/dist-firefox');

/**
 * geckodriver 0.37.0 (released 2026-06-03) regressed temporarily-installed
 * extensions: manifest-declared content scripts never load in content
 * processes ("Unable to load script: moz-extension://…/content/index.js"
 * in the browser console), which silently breaks autofill while popup and
 * background keep working. Selenium Manager always downloads the latest
 * driver, which is how CI went green→red with an identical browser binary
 * and identical code. Pin 0.36.0 via the `geckodriver` npm package's
 * downloader; bump deliberately, re-running `npm run test:firefox` to
 * verify autofill.
 *
 * Upstream: mozilla/geckodriver#2248 → Firefox-side fix in Bugzilla
 * 2045054, shipped in Firefox 152. UNPIN CONDITION: once the Firefox
 * binary used here (CI cache + local installs) is ≥152, geckodriver
 * 0.37+ is safe again.
 *
 * Override with KKK_GECKODRIVER_BIN to test a different driver build.
 */
const GECKODRIVER_VERSION = '0.36.0';

async function geckodriverBinary(): Promise<string> {
  const env = process.env.KKK_GECKODRIVER_BIN;
  if (env && existsSync(env)) return env;
  // The downloader returns whatever binary already sits in its cache dir,
  // ignoring the requested version — so scope the cache dir BY version to
  // make the pin real.
  return downloadGeckodriver(
    GECKODRIVER_VERSION,
    join(tmpdir(), `kkk-geckodriver-${GECKODRIVER_VERSION}`),
  );
}

export const POPUP_URL = `moz-extension://${EXT_UUID}/src/popup/index.html`;

export interface DriverHandle {
  driver: WebDriver;
  cleanup: () => Promise<void>;
}

export async function startDriver(): Promise<DriverHandle> {
  const binary = firefoxBinary();
  if (!binary) {
    throw new Error(
      'No Firefox binary found that accepts unsigned addons. Install Firefox ' +
        'Developer Edition / Nightly / Unbranded, or set KKK_FIREFOX_BIN to a ' +
        'suitable binary. Playwright-bundled Firefox will NOT work — see ' +
        'docs/superpowers/specs/2026-04-11-firefox-e2e-design.md §9.',
    );
  }

  // Package the built extension as an XPI in a scratch directory.
  const tmp = mkdtempSync(join(tmpdir(), 'kkk-ff-sel-'));
  const xpi = join(tmp, 'keykeykey.xpi');
  execFileSync('zip', ['-r', '-q', xpi, '.'], { cwd: EXTENSION_SOURCE });

  const options = new firefox.Options()
    .setBinary(binary)
    // Pin the addon UUID so the popup URL is stable across runs.
    .setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: EXT_UUID }))
    // Suppress the Firefox 150+ Terms-of-Use / onboarding gate that
    // otherwise blocks all interaction until dismissed.
    .setPreference('browser.preonboarding.enabled', false)
    .setPreference('browser.aboutwelcome.enabled', false)
    .setPreference('browser.shell.checkDefaultBrowser', false)
    .setPreference('browser.startup.page', 0)
    .setPreference('browser.startup.homepage_override.mstone', 'ignore')
    .setPreference('toolkit.telemetry.reportingpolicy.firstRun', false)
    .setPreference('datareporting.policy.dataSubmissionPolicyBypassNotification', true)
    .setPreference('datareporting.policy.dataSubmissionPolicyAcceptedVersion', 2)
    .setPreference('app.update.disabledForTesting', true)
    // Hermetic-profile hardening (not a bug fix): block Nimbus experiments
    // and Remote Settings so Mozilla server-side rollouts cannot change
    // browser behavior between identical runs. Eliminates a whole class of
    // "same code, same binary, different result" nondeterminism.
    .setPreference('app.normandy.enabled', false)
    .setPreference('messaging-system.rsexperimentloader.enabled', false)
    .setPreference('services.settings.server', 'http://127.0.0.1:1/remote-settings-disabled');

  // Pinned geckodriver (see GECKODRIVER_VERSION above) — never let
  // Selenium Manager float to the latest driver.
  const service = new firefox.ServiceBuilder(await geckodriverBinary());
  const driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();

  // Temporary install bypasses signing on Dev Edition / Nightly / Unbranded.
  await driver.installAddon(xpi, /* temporary */ true);

  return {
    driver,
    async cleanup() {
      try {
        await driver.quit();
      } catch {
        // Already closed — fine.
      }
      rmSync(tmp, { recursive: true, force: true });
    },
  };
}
