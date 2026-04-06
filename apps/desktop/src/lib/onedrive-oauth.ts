import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  generateCodeVerifier,
  generateState,
  buildOneDriveAuthUrl,
  ONEDRIVE_ENDPOINTS,
} from '@keykeykey/core/sync';

export const ONEDRIVE_CLIENT_ID = import.meta.env.VITE_ONEDRIVE_CLIENT_ID ?? '';

export async function startOneDriveOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  // Microsoft SPA type requires exact redirect URI match including port
  const fixedPort = 8395;
  const port = await invoke<number>('start_oauth', { expectedState: state, bindPort: fixedPort });
  const redirectUri = `http://localhost:${port}`;

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

  // Exchange code for tokens via Rust proxy to bypass CORS restrictions
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: ONEDRIVE_CLIENT_ID,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  }).toString();

  const result = await invoke<{ status: number; body: string }>('oauth_token_exchange', {
    url: ONEDRIVE_ENDPOINTS.tokenEndpoint,
    body,
    origin: `http://localhost:${port}`,
  });

  const json = JSON.parse(result.body);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `OAuth error: ${json.error ?? 'unknown_error'} — ${json.error_description ?? 'Token exchange failed'}`,
    );
  }

  return { refreshToken: json.refresh_token };
}
