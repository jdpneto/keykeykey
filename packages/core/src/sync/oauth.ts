/**
 * @deprecated Import from './oauth/' sub-module directly.
 * Shim for backward compatibility.
 */
export { generateCodeVerifier, generateCodeChallenge, generateState } from './oauth/pkce.js';
export {
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
  OAuthError,
} from './oauth/oauth-client.js';
export type {
  OAuthEndpoints,
  BuildAuthUrlParams,
  ExchangeAuthCodeParams,
  TokenResponse,
  RefreshParams,
  RefreshResponse,
} from './oauth/oauth-client.js';
export { createCachedTokenProvider } from './oauth/cached-token-provider.js';
