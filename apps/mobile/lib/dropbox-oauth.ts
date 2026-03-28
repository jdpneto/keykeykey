import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import {
  generateCodeVerifier,
  generateState,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  revokeDropboxToken as coreRevokeDropboxToken,
} from '@keykeykey/core/sync';

export const DROPBOX_CLIENT_ID = process.env.EXPO_PUBLIC_DROPBOX_CLIENT_ID ?? '';

export async function startDropboxOAuth(): Promise<{ refreshToken: string }> {
  const clientId = DROPBOX_CLIENT_ID;
  const redirectUri = makeRedirectUri();
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const authUrl = await buildDropboxAuthUrl({
    clientId,
    redirectUri,
    codeVerifier,
    state,
  });

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

  if (result.type !== 'success') {
    throw new Error(
      result.type === 'cancel' || result.type === 'dismiss'
        ? 'Dropbox sign-in was cancelled'
        : 'Dropbox sign-in failed',
    );
  }

  // Verify state parameter to prevent CSRF attacks
  const url = new URL(result.url);
  const returnedState = url.searchParams.get('state');
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('Dropbox sign-in failed: no authorization code received');
  }

  const tokens = await exchangeDropboxAuthCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export const revokeDropboxToken = coreRevokeDropboxToken;
