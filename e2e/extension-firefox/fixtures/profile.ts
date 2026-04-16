/**
 * Locates a Firefox binary that accepts unsigned addons.
 *
 * Selenium drives the browser via geckodriver's first-class
 * `installAddon(xpi, temporary=true)` API — no profile-scope scan required.
 * But geckodriver still needs a binary to launch, and release-channel
 * Firefox refuses unsigned addons even when you install them via
 * geckodriver (that's the build-time `MOZ_REQUIRE_SIGNING` check).
 * Developer Edition, Nightly, and Unbranded ESR all accept unsigned.
 *
 * Resolution order:
 *   1. `KKK_FIREFOX_BIN` env var (explicit override, wins everything).
 *   2. Conventional install locations for Dev Edition and Nightly on
 *      macOS and Linux.
 *   3. A `~/.cache/firefox-developer/firefox/firefox` path that CI can
 *      drop a curl-extracted build into.
 * Returns `null` when nothing suitable is found — the fixture skips the
 * suite with a clear message.
 */
import { existsSync } from 'node:fs';

/** `browser_specific_settings.gecko.id` in apps/extension/manifest.firefox.json. */
export const GECKO_ID = 'keykeykey@keykeykey.app';

/**
 * Pinned UUID for `moz-extension://<uuid>/` so tests can `driver.get(...)`
 * the popup URL without a dynamic lookup. Mirrors the UUID we set via
 * `extensions.webextensions.uuids` below.
 */
export const EXT_UUID = 'e7c5d2a0-1234-5678-9abc-def012345678';

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
    // CI — curl-extracted Dev Edition tarball drops here.
    `${process.env.HOME ?? ''}/.cache/firefox-developer/firefox/firefox`,
  ];
  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  return null;
}
