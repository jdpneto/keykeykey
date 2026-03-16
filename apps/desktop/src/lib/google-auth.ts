const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

export interface GoogleAuthProvider {
  authenticate(): Promise<{ refreshToken: string }>;
  getAccessToken(refreshToken: string): Promise<string>;
}

export function createDesktopGoogleAuth(): GoogleAuthProvider {
  return {
    authenticate: async () => {
      // Open system browser for OAuth consent
      const { open } = await import('@tauri-apps/plugin-shell');
      const redirectUri = 'http://localhost:9876/oauth/callback';
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      await open(authUrl.toString());

      // TODO: Start local HTTP server to capture callback with auth code
      // For now, this is a placeholder — the full OAuth callback server
      // will be implemented when the sync configuration UI is built (sub-project 2)
      throw new Error('Desktop Google OAuth not yet implemented — configure via WebDAV');
    },
    getAccessToken: async (refreshToken: string) => {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: GOOGLE_CLIENT_ID,
          grant_type: 'refresh_token',
        }),
      });
      if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`);
      const data = (await res.json()) as { access_token: string };
      return data.access_token;
    },
  };
}
