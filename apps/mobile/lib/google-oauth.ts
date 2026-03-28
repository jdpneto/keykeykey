import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import {
  generateCodeVerifier,
  generateState,
  buildAuthUrl,
  exchangeAuthCode,
  revokeToken as coreRevokeToken,
} from '@keykeykey/core/sync';

export const GOOGLE_DRIVE_CLIENT_ID_IOS = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? '';
export const GOOGLE_DRIVE_CLIENT_ID_ANDROID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? '';

export function getClientId(): string {
  return Platform.OS === 'ios' ? GOOGLE_DRIVE_CLIENT_ID_IOS : GOOGLE_DRIVE_CLIENT_ID_ANDROID;
}

export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  const clientId = getClientId();
  const redirectUri = makeRedirectUri();
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const authUrl = await buildAuthUrl({
    clientId,
    redirectUri,
    codeVerifier,
    state,
  });

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

  if (result.type !== 'success') {
    throw new Error(
      result.type === 'cancel' || result.type === 'dismiss'
        ? 'Google sign-in was cancelled'
        : 'Google sign-in failed',
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
    throw new Error('Google sign-in failed: no authorization code received');
  }

  const tokens = await exchangeAuthCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export const revokeToken = coreRevokeToken;
