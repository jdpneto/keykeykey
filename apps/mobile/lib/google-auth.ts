export interface GoogleAuthProvider {
  authenticate(): Promise<{ refreshToken: string }>;
  getAccessToken(refreshToken: string): Promise<string>;
}

const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function createMobileGoogleAuth(): GoogleAuthProvider {
  return {
    authenticate: async () => {
      // TODO: Implement with expo-auth-session when sync config UI is built (sub-project 2)
      throw new Error('Mobile Google OAuth not yet implemented — configure via WebDAV');
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
