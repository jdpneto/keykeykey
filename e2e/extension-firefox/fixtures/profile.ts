/**
 * Prepares a Firefox profile directory with the KeyKeyKey extension
 * pre-installed as an unpacked addon.
 *
 * This only works on a Firefox build that honours
 * `xpinstall.signatures.required=false` — release/beta/ESR-branded builds
 * bake signing enforcement into the binary and silently drop unsigned
 * addons. The fixture resolves `firefoxBinary()` to a compatible build
 * (Developer Edition, Nightly, or Unbranded ESR) and skips the project if
 * none is present.
 *
 * The addon is loaded via the "proxy file" mechanism: a plain text file
 * named after the gecko.id whose contents are the absolute path to the
 * unpacked extension directory. This is the install path Firefox devs use
 * for live-reload-friendly dev builds — no XPI packaging required.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** `browser_specific_settings.gecko.id` in apps/extension/manifest.firefox.json. */
export const GECKO_ID = 'keykeykey@keykeykey.app';

/** Any fixed UUIDv4 — pinning it keeps `moz-extension://<uuid>/` stable. */
export const EXT_UUID = 'e7c5d2a0-1234-5678-9abc-def012345678';

/**
 * Prefs applied at launch time. Playwright rewrites `prefs.js` on startup
 * and honours `firefoxUserPrefs` as the authoritative source, so these go
 * through `launchPersistentContext({ firefoxUserPrefs })` rather than
 * user.js.
 */
export const firefoxUserPrefs: Record<string, unknown> = {
  // Addon loading — the reason we need Dev Edition / Nightly in the first
  // place. Release channel ignores `xpinstall.signatures.required`.
  'xpinstall.signatures.required': false,
  'extensions.autoDisableScopes': 0,
  'extensions.enabledScopes': 15,
  'extensions.install_origins.enabled': false,
  'extensions.legacy.enabled': true,
  'extensions.webextensions.uuids': JSON.stringify({ [GECKO_ID]: EXT_UUID }),
  // Suppress first-run surfaces. Firefox 150+ added a Terms-of-Use gate
  // (`browser.preonboarding.*`) that blocks all interaction until dismissed,
  // and it's disabled via a separate knob from the older welcome screen.
  'browser.preonboarding.enabled': false,
  'browser.aboutwelcome.enabled': false,
  'browser.shell.checkDefaultBrowser': false,
  'browser.shell.defaultBrowserCheckCount': 1,
  'browser.startup.page': 0,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.sessionstore.resume_from_crash': false,
  'startup.homepage_welcome_url': '',
  'startup.homepage_welcome_url.additional': '',
  'startup.homepage_override_url': '',
  'trailhead.firstrun.didSeeAboutWelcome': true,
  // Telemetry / data-reporting prompts.
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'datareporting.policy.firstRunURL': '',
  'datareporting.policy.dataSubmissionEnabled': false,
  'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
  'datareporting.policy.dataSubmissionPolicyAcceptedVersion': 2,
  'datareporting.healthreport.uploadEnabled': false,
  // Update nags.
  'app.update.disabledForTesting': true,
  'app.normandy.first_run': false,
};

export function prepareFirefoxProfile(profileDir: string, extDir: string): void {
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(join(profileDir, 'extensions'), { recursive: true });
  // Proxy-file install: text file whose name is gecko.id, contents is the
  // absolute path to the unpacked extension. Trailing newline is required.
  writeFileSync(join(profileDir, 'extensions', GECKO_ID), `${extDir}\n`);
  writeFileSync(join(profileDir, 'user.js'), '');
}

/**
 * Locates a Firefox binary that accepts unsigned addons. Honours
 * `KKK_FIREFOX_BIN` first; otherwise scans the conventional install paths
 * for Developer Edition and Nightly on macOS and Linux. Returns `null` when
 * nothing suitable is found — the fixture then skips the project.
 */
export function firefoxBinary(): string | null {
  const env = process.env.KKK_FIREFOX_BIN;
  if (env && existsSync(env)) return env;
  const candidates = [
    // macOS
    '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    '/Applications/Firefox Nightly.app/Contents/MacOS/firefox',
    // Linux
    '/usr/bin/firefox-developer-edition',
    '/usr/bin/firefox-nightly',
    '/usr/bin/firefox-esr-unbranded',
    '/opt/firefox-developer-edition/firefox',
    '/opt/firefox-nightly/firefox',
    // Manual curl-extract target used by CI (see .github/workflows/ci.yml).
    `${process.env.HOME ?? ''}/.cache/firefox-developer/firefox/firefox`,
  ];
  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  return null;
}
