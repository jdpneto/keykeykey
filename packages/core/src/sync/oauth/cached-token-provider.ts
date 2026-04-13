/**
 * Cached OAuth token provider — wraps token refresh with in-memory caching.
 *
 * @module sync/oauth/cached-token-provider
 */

import { refreshAccessToken } from './oauth-client.js';

// ---------------------------------------------------------------------------
// Cached token provider
// ---------------------------------------------------------------------------

/**
 * Create a function that returns a valid access token, caching and refreshing
 * automatically. Refreshes 60 seconds before expiry.
 */
export function createCachedTokenProvider(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): () => Promise<string> {
  let cachedToken: string | null = null;
  let expiresAt = 0;

  return async () => {
    const now = Date.now();
    const bufferMs = 60_000; // refresh 60s before expiry

    if (cachedToken && now < expiresAt - bufferMs) {
      return cachedToken;
    }

    const result = await refreshAccessToken({
      tokenEndpoint,
      refreshToken,
      clientId,
      clientSecret,
    });
    cachedToken = result.accessToken;
    expiresAt = now + result.expiresIn * 1000;
    return cachedToken;
  };
}
