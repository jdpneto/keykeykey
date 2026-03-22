import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  generateCodeVerifier,
  buildAuthUrl,
  exchangeAuthCode,
  revokeToken,
} from '@keykeykey/core/sync';

export const GOOGLE_DRIVE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
export const GOOGLE_DRIVE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? '';

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startGoogleOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const port = await invoke<number>('start_google_oauth', { expectedState: state });
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = await buildAuthUrl({
    clientId: GOOGLE_DRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
    state,
  });

  if (!authUrl.startsWith('https://accounts.google.com/')) {
    throw new Error('Invalid OAuth URL');
  }

  await open(authUrl);

  const code = await invoke<string>('await_google_oauth_code');

  const tokens = await exchangeAuthCode({
    code,
    clientId: GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: GOOGLE_DRIVE_CLIENT_SECRET,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}

export { revokeToken };
