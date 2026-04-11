import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildAuthUrl as buildGoogleAuthUrl,
  exchangeAuthCode as exchangeGoogleAuthCode,
  revokeToken as coreRevokeToken,
} from '@keykeykey/core/sync';
import { getBrowserKind } from './browser-detect.js';

const GOOGLE_CLIENT_ID_FIREFOX = import.meta.env.VITE_GOOGLE_CLIENT_ID_FIREFOX ?? '';

/** Result of a successful `startGoogleOAuth()` call. */
export interface GoogleOAuthResult {
  refreshToken: string;
  clientId: string;
}

// ---------------------------------------------------------------------------
// Chrome-only helpers
// ---------------------------------------------------------------------------

// `chrome.identity.getAuthToken` is not exposed through webextension-polyfill
// types. We reach it via `browser.identity` (which exists in the polyfill)
// with a cast. This is the same pattern the rest of the extension uses.
const identity = browser.identity as unknown as {
  getAuthToken: (opts: { interactive: boolean }) => Promise<unknown>;
  removeCachedAuthToken: (opts: { token: string }) => Promise<void>;
};

/**
 * Extract a token string from the `getAuthToken` result.
 *
 * webextension-polyfill returns the token string directly; some Chrome builds
 * return `{ token: string }`. Handle both shapes.
 */
function extractToken(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'token' in result) {
    return (result as { token: string }).token;
  }
  return null;
}

/**
 * Chrome-only: fetch a fresh Google Drive access token via
 * `chrome.identity.getAuthToken`. Used as the `googleDriveTokenProvider`
 * adapter override on Chrome. Never called on Firefox — Firefox flows through
 * the core's `createCachedTokenProvider` path using the stored refresh token.
 *
 * Clears any cached token first to force Chrome to validate or refresh.
 * Without this, Chrome sometimes hands back a stale expired token.
 */
export async function getChromeGoogleAccessToken(): Promise<string> {
  try {
    const cached = await identity.getAuthToken({ interactive: false });
    const cachedToken = extractToken(cached);
    if (cachedToken) {
      await identity.removeCachedAuthToken({ token: cachedToken });
    }
  } catch {
    // No cached token — that's fine
  }

  const result = await identity.getAuthToken({ interactive: false });
  const token = extractToken(result);
  if (!token) {
    throw new Error(
      'Failed to get Google access token — user may need to re-authenticate',
    );
  }
  return token;
}

// ---------------------------------------------------------------------------
// startGoogleOAuth — dispatched at module load
// ---------------------------------------------------------------------------

async function startGoogleOAuthChrome(): Promise<GoogleOAuthResult> {
  const result = await identity.getAuthToken({ interactive: true });
  const token = extractToken(result);
  if (!token) {
    throw new Error('Google sign-in failed — no token received');
  }
  // Chrome uses placeholder values — the adapter override calls
  // getChromeGoogleAccessToken directly, so the stored refreshToken/clientId
  // in SyncConfig are never read on Chrome.
  return { refreshToken: 'chrome-identity', clientId: 'chrome-identity' };
}

async function startGoogleOAuthFirefox(): Promise<GoogleOAuthResult> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = await buildGoogleAuthUrl({
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
    redirectUri,
    codeVerifier,
    state,
  });

  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!callbackUrl) {
    throw new Error('No response URL from OAuth flow');
  }

  // Surface OAuth provider errors before validating the rest of the response.
  // Firefox's launchWebAuthFlow returns the redirect URL even when it carries
  // an `?error=…` payload (e.g., the user denied consent), so we have to
  // inspect it ourselves rather than relying on the call to throw.
  const url = new URL(callbackUrl);
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const description = url.searchParams.get('error_description');
    throw new Error(
      description
        ? `Google sign-in failed: ${description}`
        : `Google sign-in failed: ${oauthError}`,
    );
  }

  // Verify state parameter to prevent CSRF attacks
  if (url.searchParams.get('state') !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('No authorization code in OAuth redirect');
  }

  // Exchange for tokens. No clientSecret — the Firefox extension is registered
  // as a public PKCE client.
  const tokens = await exchangeGoogleAuthCode({
    code,
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
    redirectUri,
    codeVerifier,
  });

  return {
    refreshToken: tokens.refreshToken,
    clientId: GOOGLE_CLIENT_ID_FIREFOX,
  };
}

// ---------------------------------------------------------------------------
// revokeGoogleToken — dispatched per call
// ---------------------------------------------------------------------------

async function revokeGoogleTokenChrome(): Promise<void> {
  try {
    const result = await identity.getAuthToken({ interactive: false });
    const token = extractToken(result);
    if (token) {
      await identity.removeCachedAuthToken({ token });
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    }
  } catch {
    // Best-effort revocation
  }
}

async function revokeGoogleTokenFirefox(refreshToken?: string): Promise<void> {
  if (!refreshToken || refreshToken === 'chrome-identity') return;
  try {
    await coreRevokeToken(refreshToken);
  } catch {
    // Best-effort revocation
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const isFirefox = getBrowserKind() === 'firefox';

/**
 * Start the Google Drive OAuth flow.
 *
 * - On Chrome: interactive `chrome.identity.getAuthToken` (native consent).
 *   Returns `{ refreshToken: 'chrome-identity', clientId: 'chrome-identity' }`
 *   placeholders — Chrome calls `getAuthToken` at sync time and never reads
 *   these fields from SyncConfig.
 *
 * - On Firefox: PKCE flow via `browser.identity.launchWebAuthFlow`. Returns
 *   the real `{ refreshToken, clientId }` which the message handler persists
 *   into `SyncConfig.googleDrive`. The core's `createAdapterFromConfig`
 *   automatically uses them via `createCachedTokenProvider` on subsequent
 *   sync calls — no adapter override needed on Firefox.
 */
export const startGoogleOAuth = isFirefox
  ? startGoogleOAuthFirefox
  : startGoogleOAuthChrome;

/**
 * Revoke the active Google OAuth token.
 *
 * - On Chrome: ignores the argument; calls `removeCachedAuthToken` on the
 *   currently-cached token and fetches the revoke endpoint.
 *
 * - On Firefox: requires the `refreshToken` argument (the one stored in
 *   `SyncConfig.googleDrive.refreshToken`). Calls the core `revokeToken`.
 *
 * Always best-effort — never throws.
 */
export async function revokeGoogleToken(refreshToken?: string): Promise<void> {
  if (isFirefox) {
    return revokeGoogleTokenFirefox(refreshToken);
  }
  return revokeGoogleTokenChrome();
}
