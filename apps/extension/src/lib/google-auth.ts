const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata';

type Browser = 'chrome' | 'firefox' | 'safari';

export function detectBrowser(): Browser {
  if (typeof chrome !== 'undefined' && chrome.identity?.getAuthToken) return 'chrome';
  if (navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome'))
    return 'safari';
  return 'firefox';
}

export interface GoogleAuthProvider {
  authenticate(): Promise<{ refreshToken: string }>;
  getAccessToken(refreshToken: string): Promise<string>;
}

export function createExtensionGoogleAuth(): GoogleAuthProvider {
  const browser = detectBrowser();

  if (browser === 'chrome') {
    return {
      authenticate: async () => {
        await new Promise<string>((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(token!);
          });
        });
        return { refreshToken: '__chrome_managed__' };
      },
      getAccessToken: async () => {
        return new Promise<string>((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: false }, (token) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(token!);
          });
        });
      },
    };
  }

  // Firefox and Safari use launchWebAuthFlow
  return {
    authenticate: async () => {
      const redirectUrl = globalThis.browser?.identity?.getRedirectURL?.() ?? '';
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUrl);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      const responseUrl = await globalThis.browser.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true,
      });

      const code = new URL(responseUrl).searchParams.get('code');
      if (!code) throw new Error('No auth code received');

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          redirect_uri: redirectUrl,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok)
        throw new Error(`Token exchange failed: ${tokenRes.status} ${tokenRes.statusText}`);
      const tokens = (await tokenRes.json()) as { refresh_token: string };
      return { refreshToken: tokens.refresh_token };
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
