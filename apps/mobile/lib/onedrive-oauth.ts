import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import {
  generateCodeVerifier,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
} from '@keykeykey/core/sync';

export const ONEDRIVE_CLIENT_ID = process.env.EXPO_PUBLIC_ONEDRIVE_CLIENT_ID ?? '';

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startOneDriveOAuth(): Promise<{ refreshToken: string }> {
  const clientId = ONEDRIVE_CLIENT_ID;
  const redirectUri = makeRedirectUri();
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const authUrl = await buildOneDriveAuthUrl({
    clientId,
    redirectUri,
    codeVerifier,
    state,
  });

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

  if (result.type !== 'success') {
    throw new Error(
      result.type === 'cancel' || result.type === 'dismiss'
        ? 'OneDrive sign-in was cancelled'
        : 'OneDrive sign-in failed',
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
    throw new Error('OneDrive sign-in failed: no authorization code received');
  }

  const tokens = await exchangeOneDriveAuthCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}
