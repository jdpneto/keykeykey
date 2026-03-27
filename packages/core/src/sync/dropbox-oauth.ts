/**
 * Dropbox OAuth 2.0 helpers with PKCE support for Dropbox sync.
 * Thin wrapper around the generic OAuth module, pre-filling Dropbox endpoints.
 *
 * @module sync/dropbox-oauth
 */

import {
  buildAuthUrl as genericBuildAuthUrl,
  exchangeAuthCode as genericExchangeAuthCode,
  revokeToken as genericRevokeToken,
  createCachedTokenProvider as genericCreateCachedTokenProvider,
} from './oauth.js';

export type { OAuthEndpoints, TokenResponse, RefreshResponse } from './oauth.js';
export { generateCodeVerifier } from './oauth.js';

// ---------------------------------------------------------------------------
// Dropbox endpoints
// ---------------------------------------------------------------------------

export const DROPBOX_ENDPOINTS = {
  authEndpoint: 'https://www.dropbox.com/oauth2/authorize',
  tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token',
  revokeEndpoint: 'https://api.dropboxapi.com/2/auth/token/revoke',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildDropboxAuthUrlParams {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  state?: string;
}

export interface ExchangeDropboxAuthCodeParams {
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
 * Build a Dropbox OAuth 2.0 authorization URL with PKCE.
 * Automatically adds `token_access_type: 'offline'` to request a refresh token.
 * No scope is needed — Dropbox uses app permissions set in the developer console.
 */
export async function buildDropboxAuthUrl(params: BuildDropboxAuthUrlParams): Promise<string> {
  return genericBuildAuthUrl({
    endpoints: DROPBOX_ENDPOINTS,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
    state: params.state,
    extraParams: { token_access_type: 'offline' },
  });
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** Exchange a Dropbox authorization code for tokens. */
export async function exchangeDropboxAuthCode(
  params: ExchangeDropboxAuthCodeParams,
): Promise<import('./oauth.js').TokenResponse> {
  return genericExchangeAuthCode({
    tokenEndpoint: DROPBOX_ENDPOINTS.tokenEndpoint,
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
 * Create a function that returns a valid Dropbox access token, caching and
 * refreshing automatically. Refreshes 60 seconds before expiry.
 */
export function createDropboxTokenProvider(
  refreshToken: string,
  clientId: string,
  clientSecret?: string,
): () => Promise<string> {
  return genericCreateCachedTokenProvider(
    DROPBOX_ENDPOINTS.tokenEndpoint,
    refreshToken,
    clientId,
    clientSecret,
  );
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------

/**
 * Revoke a Dropbox token. Best-effort — never throws.
 * Dropbox uses the Authorization header (bearer style), not the request body.
 */
export async function revokeDropboxToken(token: string): Promise<void> {
  return genericRevokeToken(DROPBOX_ENDPOINTS.revokeEndpoint, token, 'bearer');
}
