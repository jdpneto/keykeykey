import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
} from '@keykeykey/core/sync';
import { getBrowserKind, type BrowserKind } from './browser-detect.js';

// Each browser has a different OAuth client ID due to different redirect URIs
const ONEDRIVE_CLIENT_IDS: Record<BrowserKind, string> = {
  chrome: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_FIREFOX ?? '',
};

export const ONEDRIVE_CLIENT_ID = ONEDRIVE_CLIENT_IDS[getBrowserKind()];

export async function startOneDriveOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  // Get the browser-specific redirect URL
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = await buildOneDriveAuthUrl({
    clientId: ONEDRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
    state,
  });

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
  const tokens = await exchangeOneDriveAuthCode({
    code,
    clientId: ONEDRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}
