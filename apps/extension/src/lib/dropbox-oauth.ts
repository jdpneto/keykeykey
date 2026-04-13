import browser from 'webextension-polyfill';
import {
  generateCodeVerifier,
  generateState,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  revokeDropboxToken as coreRevokeDropboxToken,
} from '@keykeykey/core/sync';
import { getBrowserKind, type BrowserKind } from './browser-detect.js';

// Each browser has a different OAuth client ID due to different redirect URIs
const DROPBOX_CLIENT_IDS: Record<BrowserKind, string> = {
  chrome: import.meta.env.VITE_DROPBOX_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_DROPBOX_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_DROPBOX_CLIENT_ID_FIREFOX ?? '',
};

export const DROPBOX_CLIENT_ID = DROPBOX_CLIENT_IDS[getBrowserKind()];

export async function startDropboxOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  // Get the browser-specific redirect URL
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = await buildDropboxAuthUrl({
    clientId: DROPBOX_CLIENT_ID,
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
  const tokens = await exchangeDropboxAuthCode({
    code,
    clientId: DROPBOX_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export const revokeDropboxToken = coreRevokeDropboxToken;
