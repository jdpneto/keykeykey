import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
  createCachedTokenProvider,
  GoogleOAuthError,
  GOOGLE_ENDPOINTS,
  generateCodeVerifier,
  generateCodeChallenge,
} from './google.js';
import { OAuthError } from './oauth-client.js';
import { SyncAuthError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'ya29.test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    token_type: 'Bearer',
    ...overrides,
  };
}

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests — Google-specific behavior only
// ---------------------------------------------------------------------------

describe('Google OAuth wrapper', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Re-exports from generic module
  // -------------------------------------------------------------------------

  it('re-exports generateCodeVerifier from oauth module', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('re-exports generateCodeChallenge from oauth module', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  // -------------------------------------------------------------------------
  // GoogleOAuthError is OAuthError
  // -------------------------------------------------------------------------

  it('GoogleOAuthError is instanceof OAuthError', () => {
    const err = new GoogleOAuthError('test_error', 'test description');
    expect(err).toBeInstanceOf(OAuthError);
    expect(err).toBeInstanceOf(Error);
    expect(err.error).toBe('test_error');
    expect(err.errorDescription).toBe('test description');
    expect(err.name).toBe('GoogleOAuthError');
  });

  // -------------------------------------------------------------------------
  // buildAuthUrl — Google-specific params
  // -------------------------------------------------------------------------

  describe('buildAuthUrl', () => {
    it('uses Google auth endpoint', async () => {
      const url = await buildAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(GOOGLE_ENDPOINTS.authEndpoint);
    });

    it('includes access_type=offline and prompt=consent', async () => {
      const url = await buildAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
    });

    it('defaults to drive.appdata scope', async () => {
      const url = await buildAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('scope')).toContain('drive.appdata');
    });

    it('includes login_hint when provided', async () => {
      const url = await buildAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
        loginHint: 'user@example.com',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('login_hint')).toBe('user@example.com');
    });

    it('includes state when provided', async () => {
      const url = await buildAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
        state: 'random-state',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('state')).toBe('random-state');
    });
  });

  // -------------------------------------------------------------------------
  // exchangeAuthCode — uses Google token endpoint, wraps to GoogleOAuthError
  // -------------------------------------------------------------------------

  describe('exchangeAuthCode', () => {
    it('calls Google token endpoint', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTokenResponse()));

      await exchangeAuthCode({
        code: 'auth-code-123',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(GOOGLE_ENDPOINTS.tokenEndpoint);
    });

    it('throws GoogleOAuthError on failure', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'invalid_client', error_description: 'Bad client' }, 400),
      );

      await expect(
        exchangeAuthCode({
          code: 'bad-code',
          clientId: 'client-123',
          redirectUri: 'http://localhost/callback',
          codeVerifier: 'test-verifier',
        }),
      ).rejects.toThrow(GoogleOAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // refreshAccessToken — uses Google token endpoint
  // -------------------------------------------------------------------------

  describe('refreshAccessToken', () => {
    it('calls Google token endpoint', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ access_token: 'ya29.new-token', expires_in: 3600 }),
      );

      await refreshAccessToken({
        refreshToken: 'test-refresh-token',
        clientId: 'client-123',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(GOOGLE_ENDPOINTS.tokenEndpoint);
    });

    it('throws SyncAuthError on invalid_grant', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'invalid_grant', error_description: 'Token revoked' }, 400),
      );

      await expect(
        refreshAccessToken({
          refreshToken: 'revoked-token',
          clientId: 'client-123',
        }),
      ).rejects.toThrow(SyncAuthError);
    });

    it('throws GoogleOAuthError on other errors', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'server_error', error_description: 'Server failed' }, 500),
      );

      await expect(
        refreshAccessToken({
          refreshToken: 'test-refresh-token',
          clientId: 'client-123',
        }),
      ).rejects.toThrow(GoogleOAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // revokeToken — uses Google revoke endpoint, body style
  // -------------------------------------------------------------------------

  describe('revokeToken', () => {
    it('calls Google revoke endpoint with token in body', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}, 200));

      await revokeToken('test-token');

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(GOOGLE_ENDPOINTS.revokeEndpoint);
      const body = new URLSearchParams(init.body);
      expect(body.get('token')).toBe('test-token');
    });

    it('does not throw on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(revokeToken('test-token')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // createCachedTokenProvider — uses Google token endpoint
  // -------------------------------------------------------------------------

  describe('createCachedTokenProvider', () => {
    it('caches token and reuses within expiry window', async () => {
      mockFetch.mockResolvedValue(makeResponse({ access_token: 'ya29.cached', expires_in: 3600 }));

      const getToken = createCachedTokenProvider('refresh-token', 'client-123');

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('ya29.cached');
      expect(token2).toBe('ya29.cached');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('calls Google token endpoint for refresh', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ access_token: 'ya29.fresh', expires_in: 3600 }),
      );

      const getToken = createCachedTokenProvider('refresh-token', 'client-123');
      await getToken();

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(GOOGLE_ENDPOINTS.tokenEndpoint);
    });

    it('refreshes when token is near expiry', async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse({ access_token: 'ya29.first', expires_in: 0 }))
        .mockResolvedValueOnce(makeResponse({ access_token: 'ya29.second', expires_in: 3600 }));

      const getToken = createCachedTokenProvider('refresh-token', 'client-123');

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('ya29.first');
      expect(token2).toBe('ya29.second');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
