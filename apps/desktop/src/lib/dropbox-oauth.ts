import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  generateCodeVerifier,
  generateState,
  buildDropboxAuthUrl,
  revokeDropboxToken,
  DROPBOX_ENDPOINTS,
} from '@keykeykey/core/sync';

export const DROPBOX_CLIENT_ID = import.meta.env.VITE_DROPBOX_CLIENT_ID ?? '';

export async function startDropboxOAuth(): Promise<{ refreshToken: string }> {
  const codeVerifier = generateCodeVerifier();
  const state = generateState();

  const port = await invoke<number>('start_oauth', { expectedState: state });
  const redirectUri = `http://127.0.0.1:${port}`;

  const authUrl = await buildDropboxAuthUrl({
    clientId: DROPBOX_CLIENT_ID,
    redirectUri,
    codeVerifier,
    state,
  });

  if (!authUrl.startsWith('https://www.dropbox.com/')) {
    throw new Error('Invalid OAuth URL');
  }

  await open(authUrl);

  const code = await invoke<string>('await_oauth_code');

  // Exchange code for tokens via Rust proxy to bypass CORS restrictions
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: DROPBOX_CLIENT_ID,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  }).toString();

  const result = await invoke<{ status: number; body: string }>('oauth_token_exchange', {
    url: DROPBOX_ENDPOINTS.tokenEndpoint,
    body,
  });

  const json = JSON.parse(result.body);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `OAuth error: ${json.error ?? 'unknown_error'} — ${json.error_description ?? 'Token exchange failed'}`,
    );
  }

  return { refreshToken: json.refresh_token };
}

export { revokeDropboxToken };
