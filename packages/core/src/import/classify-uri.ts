/**
 * Tagged union describing how an imported URI should be stored on a credential.
 */
export type UriClassification =
  | { kind: 'url'; value: string }
  | { kind: 'appIdentifier'; value: string }
  | { kind: 'drop' };

/**
 * Route a raw URI string from a CSV import into one of three buckets:
 *  - `url`           — a normalized http/https URL suitable for `Credential.url`
 *  - `appIdentifier` — a lowercased reverse-DNS string suitable for
 *                      `Credential.appIdentifiers`, extracted from app URIs
 *                      like `androidapp://com.example.app/`,
 *                      `android://<hash>@com.example.app/`,
 *                      `iosapp://com.example.app`, or `ios://com.example.app`
 *  - `drop`          — empty, unparseable, or uses an unrecognized scheme
 *
 * Detection is scheme-based: we do NOT try to guess whether a schemeless
 * string like `com.example.app` is a package name or a 2-label domain —
 * the reverse-DNS regex cannot distinguish them (`foo.com` matches too).
 * Schemeless inputs are always treated as URLs and get `https://` prepended.
 */
export function classifyUri(raw: string): UriClassification {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'drop' };

  const appId = extractAppIdentifier(trimmed);
  if (appId !== null) {
    return APP_ID_REGEX.test(appId) ? { kind: 'appIdentifier', value: appId } : { kind: 'drop' };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const path = parsed.pathname === '/' ? '' : parsed.pathname;
      return { kind: 'url', value: `${parsed.protocol}//${parsed.hostname}${path}` };
    }
    return { kind: 'drop' };
  } catch {
    return { kind: 'drop' };
  }
}

/** Schema stores appIdentifiers lowercased and validated against this regex. */
const APP_ID_REGEX = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Return the (lowercased) package/bundle id from a recognized app URI, or null. */
function extractAppIdentifier(uri: string): string | null {
  const android = uri.match(/^androidapp:\/\/([^/]+)\/?.*$/i);
  if (android?.[1]) return android[1].toLowerCase();

  // Chrome sync format: android://<base64ish-hash>@<package>/...
  const chromeAndroid = uri.match(/^android:\/\/[^@]+@([^/]+)\/?.*$/i);
  if (chromeAndroid?.[1]) return chromeAndroid[1].toLowerCase();

  const ios = uri.match(/^(?:iosapp|ios):\/\/([^/?#]+)\/?.*$/i);
  if (ios?.[1]) return ios[1].toLowerCase();

  return null;
}
