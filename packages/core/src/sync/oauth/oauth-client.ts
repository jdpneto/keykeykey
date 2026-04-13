/**
 * Generic OAuth 2.0 HTTP operations.
 *
 * @module sync/oauth/oauth-client
 */

import { SyncAuthError } from '../core/errors.js';
import { generateCodeChallenge } from './pkce.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthEndpoints {
  authEndpoint: string;
  tokenEndpoint: string;
  revokeEndpoint?: string;
}

export interface BuildAuthUrlParams {
  endpoints: OAuthEndpoints;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scope?: string;
  state?: string;
  extraParams?: Record<string, string>;
}

export interface ExchangeAuthCodeParams {
  tokenEndpoint: string;
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  clientSecret?: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshParams {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

/** Thrown when an OAuth request fails. */
export class OAuthError extends Error {
  readonly error: string;
  readonly errorDescription: string;

  constructor(error: string, errorDescription: string) {
    super(`OAuth error: ${error} — ${errorDescription}`);
    this.name = 'OAuthError';
    this.error = error;
    this.errorDescription = errorDescription;
  }
}

// ---------------------------------------------------------------------------
// Auth URL
// ---------------------------------------------------------------------------

/** Build an OAuth 2.0 authorization URL with PKCE. Computes the S256 challenge from the raw verifier. */
export async function buildAuthUrl(params: BuildAuthUrlParams): Promise<string> {
  const challenge = await generateCodeChallenge(params.codeVerifier);
  const url = new URL(params.endpoints.authEndpoint);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);

  if (params.scope) {
    url.searchParams.set('scope', params.scope);
  }
  if (params.state) {
    url.searchParams.set('state', params.state);
  }
  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** Exchange an authorization code for tokens. */
export async function exchangeAuthCode(params: ExchangeAuthCodeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });
  if (params.clientSecret) body.set('client_secret', params.clientSecret);

  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    throw new OAuthError(
      (json.error as string) ?? 'unknown_error',
      (json.error_description as string) ?? 'Token exchange failed',
    );
  }

  return {
    accessToken: json.access_token as string,
    refreshToken: json.refresh_token as string,
    expiresIn: json.expires_in as number,
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/** Refresh an access token. Throws SyncAuthError on invalid_grant. */
export async function refreshAccessToken(params: RefreshParams): Promise<RefreshResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
  if (params.clientSecret) body.set('client_secret', params.clientSecret);

  const res = await fetch(params.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    if (json.error === 'invalid_grant') {
      throw new SyncAuthError(
        (json.error_description as string) ?? 'Refresh token is invalid or revoked',
      );
    }
    throw new OAuthError(
      (json.error as string) ?? 'unknown_error',
      (json.error_description as string) ?? 'Token refresh failed',
    );
  }

  return {
    accessToken: json.access_token as string,
    expiresIn: json.expires_in as number,
  };
}

// ---------------------------------------------------------------------------
// Token revocation
// ---------------------------------------------------------------------------

/**
 * Revoke a token. Best-effort — never throws.
 * @param revokeEndpoint - The revocation endpoint URL.
 * @param token - The token to revoke.
 * @param style - 'body' (default) sends token as form body; 'bearer' sends Authorization: Bearer header.
 */
export async function revokeToken(
  revokeEndpoint: string,
  token: string,
  style: 'body' | 'bearer' = 'body',
): Promise<void> {
  try {
    if (style === 'bearer') {
      await fetch(revokeEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: '',
      });
    } else {
      await fetch(revokeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
    }
  } catch {
    // Best-effort — ignore errors
  }
}
