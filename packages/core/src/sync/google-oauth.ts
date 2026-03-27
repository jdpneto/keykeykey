/**
 * Google OAuth 2.0 helpers with PKCE support for Google Drive sync.
 * Thin wrapper around the generic OAuth module, pre-filling Google endpoints.
 *
 * @module sync/google-oauth
 */

import {
  OAuthError,
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl as genericBuildAuthUrl,
  exchangeAuthCode as genericExchangeAuthCode,
  refreshAccessToken as genericRefreshAccessToken,
  revokeToken as genericRevokeToken,
  createCachedTokenProvider as genericCreateCachedTokenProvider,
} from './oauth.js';

export type { TokenResponse, RefreshResponse, OAuthEndpoints } from './oauth.js';

export { generateCodeVerifier, generateCodeChallenge };

// ---------------------------------------------------------------------------
// Google endpoints
// ---------------------------------------------------------------------------

export const GOOGLE_ENDPOINTS = {
  authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const GOOGLE_DEFAULT_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// ---------------------------------------------------------------------------
// Types (preserve existing signatures)
// ---------------------------------------------------------------------------

export interface BuildAuthUrlParams {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
  loginHint?: string;
  state?: string;
}

export interface ExchangeAuthCodeParams {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  clientSecret?: string;
}

export interface RefreshParams {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

// ---------------------------------------------------------------------------
// Error (backward compat alias)
// ---------------------------------------------------------------------------

/** Thrown when a Google OAuth request fails. Alias for OAuthError. */
export class GoogleOAuthError extends OAuthError {
  constructor(error: string, errorDescription: string) {
    super(error, errorDescription);
    this.name = 'GoogleOAuthError';
  }
}

// ---------------------------------------------------------------------------
// Auth URL
// ---------------------------------------------------------------------------

/** Build a Google OAuth 2.0 authorization URL with PKCE. Computes the S256 challenge from the raw verifier. */
export async function buildAuthUrl(params: BuildAuthUrlParams): Promise<string> {
  const extraParams: Record<string, string> = {
    access_type: 'offline',
    prompt: 'consent',
  };
  if (params.loginHint) {
    extraParams['login_hint'] = params.loginHint;
  }

  return genericBuildAuthUrl({
    endpoints: GOOGLE_ENDPOINTS,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
    scope: params.scope ?? GOOGLE_DEFAULT_SCOPE,
    state: params.state,
    extraParams,
  });
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** Exchange an authorization code for tokens. */
export async function exchangeAuthCode(
  params: ExchangeAuthCodeParams,
): Promise<import('./oauth.js').TokenResponse> {
  try {
    return await genericExchangeAuthCode({
      tokenEndpoint: GOOGLE_ENDPOINTS.tokenEndpoint,
      code: params.code,
      clientId: params.clientId,
      redirectUri: params.redirectUri,
      codeVerifier: params.codeVerifier,
      clientSecret: params.clientSecret,
    });
  } catch (err) {
    if (err instanceof OAuthError) {
      throw new GoogleOAuthError(err.error, err.errorDescription);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/** Refresh an access token. Throws SyncAuthError on invalid_grant. */
export async function refreshAccessToken(
  params: RefreshParams,
): Promise<import('./oauth.js').RefreshResponse> {
  try {
    return await genericRefreshAccessToken({
      tokenEndpoint: GOOGLE_ENDPOINTS.tokenEndpoint,
      refreshToken: params.refreshToken,
      clientId: params.clientId,
      clientSecret: params.clientSecret,
    });
  } catch (err) {
    if (err instanceof OAuthError) {
      throw new GoogleOAuthError(err.error, err.errorDescription);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------

/** Revoke a token. Best-effort — never throws. */
export async function revokeToken(token: string): Promise<void> {
  return genericRevokeToken(GOOGLE_ENDPOINTS.revokeEndpoint, token, 'body');
}

// ---------------------------------------------------------------------------
// Cached token provider
// ---------------------------------------------------------------------------

/**
 * Create a function that returns a valid access token, caching and refreshing
 * automatically. Refreshes 60 seconds before expiry.
 */
export function createCachedTokenProvider(
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): () => Promise<string> {
  return genericCreateCachedTokenProvider(
    GOOGLE_ENDPOINTS.tokenEndpoint,
    refreshToken,
    clientId,
    clientSecret,
  );
}
