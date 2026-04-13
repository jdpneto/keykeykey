import browser from 'webextension-polyfill';
import { generateCodeVerifier, generateState } from '@keykeykey/core/sync';

export interface LaunchOAuthFlowParams<T> {
  buildAuthUrl: (params: {
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    state: string;
  }) => Promise<string>;
  exchangeCode: (params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    [key: string]: unknown;
  }) => Promise<T>;
  clientId: string;
  extraExchangeParams?: Record<string, string>;
}

/**
 * Shared OAuth flow for browser extensions:
 * 1. Generate PKCE verifier + state
 * 2. Build auth URL via provider-specific builder
 * 3. Launch browser.identity.launchWebAuthFlow
 * 4. Validate state, extract code
 * 5. Exchange code via provider-specific exchanger
 */
export async function launchOAuthFlow<T>(params: LaunchOAuthFlowParams<T>): Promise<T> {
  const { buildAuthUrl, exchangeCode, clientId, extraExchangeParams } = params;

  const codeVerifier = generateCodeVerifier();
  const state = generateState();
  const redirectUri = browser.identity.getRedirectURL();

  const authUrl = await buildAuthUrl({ clientId, redirectUri, codeVerifier, state });

  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!callbackUrl) {
    throw new Error('No response URL from OAuth flow');
  }

  const url = new URL(callbackUrl);

  // Surface OAuth provider errors from redirect URL
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const description = url.searchParams.get('error_description');
    throw new Error(description ? `OAuth failed: ${description}` : `OAuth failed: ${oauthError}`);
  }

  if (url.searchParams.get('state') !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('No authorization code in OAuth redirect');
  }

  return exchangeCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
    ...extraExchangeParams,
  });
}
