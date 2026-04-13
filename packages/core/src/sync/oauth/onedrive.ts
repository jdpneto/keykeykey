/**
 * OneDrive OAuth 2.0 helpers with PKCE support for OneDrive sync.
 * Thin wrapper around the generic OAuth module, pre-filling Microsoft endpoints.
 *
 * @module sync/oauth/onedrive
 */

import {
  buildAuthUrl as genericBuildAuthUrl,
  exchangeAuthCode as genericExchangeAuthCode,
} from './oauth-client.js';
import { createCachedTokenProvider as genericCreateCachedTokenProvider } from './cached-token-provider.js';

export type { OAuthEndpoints, TokenResponse, RefreshResponse } from './oauth-client.js';
export { generateCodeVerifier } from './pkce.js';

// ---------------------------------------------------------------------------
// OneDrive endpoints
// ---------------------------------------------------------------------------

export const ONEDRIVE_ENDPOINTS = {
  authEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  // No revoke endpoint — Microsoft doesn't have simple token revocation
};

export const ONEDRIVE_SCOPE = 'Files.ReadWrite.AppFolder offline_access';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildOneDriveAuthUrlParams {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  state?: string;
}

export interface ExchangeOneDriveAuthCodeParams {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  clientSecret?: string;
}

// ---------------------------------------------------------------------------
// Auth URL
// ---------------------------------------------------------------------------

/**
 * Build a OneDrive OAuth 2.0 authorization URL with PKCE.
 * Automatically requests the AppFolder scope and offline_access for refresh tokens.
 */
export async function buildOneDriveAuthUrl(params: BuildOneDriveAuthUrlParams): Promise<string> {
  return genericBuildAuthUrl({
    endpoints: ONEDRIVE_ENDPOINTS,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
    scope: ONEDRIVE_SCOPE,
    state: params.state,
    extraParams: { response_mode: 'query' },
  });
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** Exchange a OneDrive authorization code for tokens. */
export async function exchangeOneDriveAuthCode(
  params: ExchangeOneDriveAuthCodeParams,
): Promise<import('./oauth-client.js').TokenResponse> {
  return genericExchangeAuthCode({
    tokenEndpoint: ONEDRIVE_ENDPOINTS.tokenEndpoint,
    code: params.code,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
    clientSecret: params.clientSecret,
  });
}

// ---------------------------------------------------------------------------
// Cached token provider
// ---------------------------------------------------------------------------

/**
 * Create a function that returns a valid OneDrive access token, caching and
 * refreshing automatically. Refreshes 60 seconds before expiry.
 */
export function createOneDriveTokenProvider(
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): () => Promise<string> {
  return genericCreateCachedTokenProvider(
    ONEDRIVE_ENDPOINTS.tokenEndpoint,
    refreshToken,
    clientId,
    clientSecret,
  );
}
