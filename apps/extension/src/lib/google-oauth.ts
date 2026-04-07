import browser from 'webextension-polyfill';

/**
 * Extract token from getAuthToken result.
 * webextension-polyfill returns the token string directly,
 * while native Chrome MV3 returns { token: string }.
 */
function extractToken(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'token' in result) {
    return (result as { token: string }).token;
  }
  return null;
}

// Cast to access getAuthToken/removeCachedAuthToken (not in polyfill types)
const identity = browser.identity as unknown as {
  getAuthToken: (opts: { interactive: boolean }) => Promise<unknown>;
  removeCachedAuthToken: (opts: { token: string }) => Promise<void>;
};

/**
 * Start Google OAuth using chrome.identity.getAuthToken.
 * Chrome Extension type OAuth clients use getAuthToken (not launchWebAuthFlow).
 * Chrome manages token refresh internally — no refresh token is needed.
 */
export async function startGoogleOAuth(): Promise<void> {
  const result = await identity.getAuthToken({ interactive: true });
  const token = extractToken(result);
  if (!token) {
    throw new Error('Google sign-in failed — no token received');
  }
}

/**
 * Get a fresh Google access token via chrome.identity.getAuthToken.
 * This is the token provider passed to the Google Drive adapter.
 *
 * Always clears the cached token first to force Chrome to validate/refresh.
 * Without this, Chrome may return a stale expired token.
 */
export async function getChromeGoogleAccessToken(): Promise<string> {
  // Clear any cached token so Chrome fetches a fresh one
  try {
    const cached = await identity.getAuthToken({ interactive: false });
    const cachedToken = extractToken(cached);
    if (cachedToken) {
      await identity.removeCachedAuthToken({ token: cachedToken });
    }
  } catch {
    // No cached token — that's fine
  }

  const result = await identity.getAuthToken({ interactive: false });
  const token = extractToken(result);
  if (!token) {
    throw new Error('Failed to get Google access token — user may need to re-authenticate');
  }
  return token;
}

/**
 * Revoke the cached Google token and clear Chrome's token cache.
 */
export async function revokeGoogleToken(): Promise<void> {
  try {
    const result = await identity.getAuthToken({ interactive: false });
    const token = extractToken(result);
    if (token) {
      await identity.removeCachedAuthToken({ token });
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    }
  } catch {
    // Best-effort revocation
  }
}
