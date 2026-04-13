/**
 * OAuth sub-module barrel — re-exports all public OAuth helpers.
 *
 * @module sync/oauth
 */

// PKCE
export { generateCodeVerifier, generateCodeChallenge, generateState } from './pkce.js';

// Generic OAuth client
export {
  OAuthError,
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
} from './oauth-client.js';
export type {
  OAuthEndpoints,
  BuildAuthUrlParams,
  ExchangeAuthCodeParams,
  TokenResponse,
  RefreshParams,
  RefreshResponse,
} from './oauth-client.js';

// Cached token provider
export { createCachedTokenProvider } from './cached-token-provider.js';

// Google
export {
  GOOGLE_ENDPOINTS,
  GoogleOAuthError,
  buildAuthUrl as buildGoogleAuthUrl,
  exchangeAuthCode as exchangeGoogleAuthCode,
  refreshAccessToken as refreshGoogleAccessToken,
  revokeToken as revokeGoogleToken,
  createCachedTokenProvider as createGoogleCachedTokenProvider,
  generateCodeVerifier as generateGoogleCodeVerifier,
  generateCodeChallenge as generateGoogleCodeChallenge,
} from './google.js';
export type {
  BuildAuthUrlParams as GoogleBuildAuthUrlParams,
  ExchangeAuthCodeParams as GoogleExchangeAuthCodeParams,
  RefreshParams as GoogleRefreshParams,
} from './google.js';

// Dropbox
export {
  DROPBOX_ENDPOINTS,
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  createDropboxTokenProvider,
  revokeDropboxToken,
  generateCodeVerifier as generateDropboxCodeVerifier,
} from './dropbox.js';
export type {
  BuildDropboxAuthUrlParams,
  ExchangeDropboxAuthCodeParams,
} from './dropbox.js';

// OneDrive
export {
  ONEDRIVE_ENDPOINTS,
  ONEDRIVE_SCOPE,
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
  createOneDriveTokenProvider,
  generateCodeVerifier as generateOneDriveCodeVerifier,
} from './onedrive.js';
export type {
  BuildOneDriveAuthUrlParams,
  ExchangeOneDriveAuthCodeParams,
} from './onedrive.js';
