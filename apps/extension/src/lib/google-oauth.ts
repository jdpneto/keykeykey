import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildAuthUrl,
  exchangeAuthCode,
  revokeToken as coreRevokeToken,
} from '@keykeykey/core/sync';

// Each browser has a different OAuth client ID due to different redirect URIs
const GOOGLE_DRIVE_CLIENT_IDS: Record<string, string> = {
  chrome: import.meta.env.VITE_GOOGLE_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_GOOGLE_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_GOOGLE_CLIENT_ID_FIREFOX ?? '',
};

function detectBrowser(): string {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (ua.includes('Firefox')) return 'firefox';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'safari';
  }
  return 'chrome';
}

export const GOOGLE_DRIVE_CLIENT_ID = GOOGLE_DRIVE_CLIENT_IDS[detectBrowser()];

export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  // Get the browser-specific redirect URL
  const redirectUri = browser.identity.getRedirectURL();

  // Chrome Extension type OAuth clients derive the redirect URI from the
  // Item ID — sending redirect_uri in the auth request causes a mismatch.
  // Build the URL then strip the redirect_uri param before launching.
  const rawAuthUrl = await buildAuthUrl({
    clientId: GOOGLE_DRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
    state,
  });
  const authUrlObj = new URL(rawAuthUrl);
  authUrlObj.searchParams.delete('redirect_uri');
  const authUrl = authUrlObj.toString();

  // Launch the OAuth popup (webextension-polyfill returns a promise)
  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!callbackUrl) {
    throw new Error('No response URL from OAuth flow');
  }

  // Verify state parameter to prevent CSRF attacks
  const url = new URL(callbackUrl);
  const returnedState = url.searchParams.get('state');
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  // Extract auth code from callback URL
  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('No authorization code in OAuth redirect');
  }

  // Exchange for tokens
  const tokens = await exchangeAuthCode({
    code,
    clientId: GOOGLE_DRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export const revokeToken = coreRevokeToken;
