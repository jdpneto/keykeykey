import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  generateCodeVerifier,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
} from '@keykeykey/core/sync';

export const ONEDRIVE_CLIENT_ID = import.meta.env.VITE_ONEDRIVE_CLIENT_ID ?? '';

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startOneDriveOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const port = await invoke<number>('start_oauth', { expectedState: state });
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = await buildOneDriveAuthUrl({
    clientId: ONEDRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
    state,
  });

  if (!authUrl.startsWith('https://login.microsoftonline.com/')) {
    throw new Error('Invalid OAuth URL');
  }

  await open(authUrl);

  const code = await invoke<string>('await_oauth_code');

  const tokens = await exchangeOneDriveAuthCode({
    code,
    clientId: ONEDRIVE_CLIENT_ID,
    redirectUri,
    codeVerifier,
  });

  return { refreshToken: tokens.refreshToken };
}
