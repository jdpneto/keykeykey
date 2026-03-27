import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
  createCachedTokenProvider,
  OAuthError,
} from './oauth.js';
import { SyncAuthError } from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_ENDPOINTS = {
  authEndpoint: 'https://example.com/oauth/authorize',
  tokenEndpoint: 'https://example.com/oauth/token',
  revokeEndpoint: 'https://example.com/oauth/revoke',
};

function makeTokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'test-access-token',
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
// Tests
// ---------------------------------------------------------------------------

describe('Generic OAuth helpers', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // PKCE helpers
  // -------------------------------------------------------------------------

  describe('generateCodeVerifier', () => {
    it('returns a 43-128 char URL-safe string', () => {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    });

    it('produces unique values', () => {
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toBe(b);
    });
  });

  describe('generateCodeChallenge', () => {
    it('returns correct SHA-256 hash (RFC 7636 Appendix B test vector)', async () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = await generateCodeChallenge(verifier);
      expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });
  });

  // -------------------------------------------------------------------------
  // buildAuthUrl
  // -------------------------------------------------------------------------

  describe('buildAuthUrl', () => {
    it('includes all required OAuth parameters and computes challenge from verifier', async () => {
      const verifier = 'test-verifier';
      const expectedChallenge = await generateCodeChallenge(verifier);
      const url = await buildAuthUrl({
        endpoints: TEST_ENDPOINTS,
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: verifier,
        scope: 'read write',
      });

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://example.com/oauth/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('client-123');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost/callback');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('code_challenge')).toBe(expectedChallenge);
      expect(parsed.searchParams.get('scope')).toBe('read write');
    });

    it('includes state parameter when provided', async () => {
      const url = await buildAuthUrl({
        endpoints: TEST_ENDPOINTS,
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
        state: 'random-state-value',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('state')).toBe('random-state-value');
    });

    it('includes extraParams when provided', async () => {
      const url = await buildAuthUrl({
        endpoints: TEST_ENDPOINTS,
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
        extraParams: { access_type: 'offline', prompt: 'consent' },
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
    });

    it('omits scope when not provided', async () => {
      const url = await buildAuthUrl({
        endpoints: TEST_ENDPOINTS,
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.has('scope')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // exchangeAuthCode
  // -------------------------------------------------------------------------

  describe('exchangeAuthCode', () => {
    it('exchanges code for tokens', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTokenResponse()));

      const result = await exchangeAuthCode({
        tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
        code: 'auth-code-123',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      expect(result).toEqual({
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresIn: 3600,
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(TEST_ENDPOINTS.tokenEndpoint);
      expect(init.method).toBe('POST');
    });

    it('includes client_secret in request body when provided', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTokenResponse()));

      await exchangeAuthCode({
        tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
        code: 'auth-code-123',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
        clientSecret: 'secret-456',
      });

      const [, init] = mockFetch.mock.calls[0];
      const body = new URLSearchParams(init.body);
      expect(body.get('client_secret')).toBe('secret-456');
    });

    it('throws OAuthError on failure', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'invalid_client', error_description: 'Bad client' }, 400),
      );

      await expect(
        exchangeAuthCode({
          tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
          code: 'bad-code',
          clientId: 'client-123',
          redirectUri: 'http://localhost/callback',
          codeVerifier: 'test-verifier',
        }),
      ).rejects.toThrow(OAuthError);
    });

    it('OAuthError carries error and errorDescription fields', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'invalid_client', error_description: 'Bad client' }, 400),
      );

      const err = await exchangeAuthCode({
        tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
        code: 'bad-code',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(OAuthError);
      expect((err as OAuthError).error).toBe('invalid_client');
      expect((err as OAuthError).errorDescription).toBe('Bad client');
    });
  });

  // -------------------------------------------------------------------------
  // refreshAccessToken
  // -------------------------------------------------------------------------

  describe('refreshAccessToken', () => {
    it('refreshes access token', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ access_token: 'new-token', expires_in: 3600 }),
      );

      const result = await refreshAccessToken({
        tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
        refreshToken: 'test-refresh-token',
        clientId: 'client-123',
      });

      expect(result).toEqual({
        accessToken: 'new-token',
        expiresIn: 3600,
      });
    });

    it('includes client_secret in request body when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ access_token: 'new-token', expires_in: 3600 }),
      );

      await refreshAccessToken({
        tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
        refreshToken: 'test-refresh-token',
        clientId: 'client-123',
        clientSecret: 'secret-456',
      });

      const [, init] = mockFetch.mock.calls[0];
      const body = new URLSearchParams(init.body);
      expect(body.get('client_secret')).toBe('secret-456');
    });

    it('throws SyncAuthError on invalid_grant', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'invalid_grant', error_description: 'Token revoked' }, 400),
      );

      await expect(
        refreshAccessToken({
          tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
          refreshToken: 'revoked-token',
          clientId: 'client-123',
        }),
      ).rejects.toThrow(SyncAuthError);
    });

    it('throws OAuthError on other errors', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'server_error', error_description: 'Internal error' }, 500),
      );

      await expect(
        refreshAccessToken({
          tokenEndpoint: TEST_ENDPOINTS.tokenEndpoint,
          refreshToken: 'test-refresh-token',
          clientId: 'client-123',
        }),
      ).rejects.toThrow(OAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // revokeToken
  // -------------------------------------------------------------------------

  describe('revokeToken', () => {
    it('calls revoke endpoint with body style (default)', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}, 200));

      await revokeToken(TEST_ENDPOINTS.revokeEndpoint!, 'test-token');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(TEST_ENDPOINTS.revokeEndpoint);
      const body = new URLSearchParams(init.body);
      expect(body.get('token')).toBe('test-token');
    });

    it('calls revoke endpoint with bearer style', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}, 200));

      await revokeToken(TEST_ENDPOINTS.revokeEndpoint!, 'test-token', 'bearer');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe(TEST_ENDPOINTS.revokeEndpoint);
      expect(init.headers['Authorization']).toBe('Bearer test-token');
      expect(init.body).toBe('');
    });

    it('does not throw on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        revokeToken(TEST_ENDPOINTS.revokeEndpoint!, 'test-token'),
      ).resolves.toBeUndefined();
    });

    it('does not throw on non-2xx response', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({ error: 'server_error' }, 500));

      await expect(
        revokeToken(TEST_ENDPOINTS.revokeEndpoint!, 'test-token'),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // createCachedTokenProvider
  // -------------------------------------------------------------------------

  describe('createCachedTokenProvider', () => {
    it('caches token and reuses within expiry window', async () => {
      mockFetch.mockResolvedValue(makeResponse({ access_token: 'cached-token', expires_in: 3600 }));

      const getToken = createCachedTokenProvider(
        TEST_ENDPOINTS.tokenEndpoint,
        'refresh-token',
        'client-123',
      );

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('cached-token');
      expect(token2).toBe('cached-token');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('refreshes when token is near expiry', async () => {
      mockFetch
        .mockResolvedValueOnce(makeResponse({ access_token: 'first-token', expires_in: 0 }))
        .mockResolvedValueOnce(makeResponse({ access_token: 'second-token', expires_in: 3600 }));

      const getToken = createCachedTokenProvider(
        TEST_ENDPOINTS.tokenEndpoint,
        'refresh-token',
        'client-123',
      );

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('first-token');
      expect(token2).toBe('second-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('passes clientSecret to refresh endpoint', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ access_token: 'secret-token', expires_in: 3600 }),
      );

      const getToken = createCachedTokenProvider(
        TEST_ENDPOINTS.tokenEndpoint,
        'refresh-token',
        'client-123',
        'client-secret',
      );

      await getToken();

      const [, init] = mockFetch.mock.calls[0];
      const body = new URLSearchParams(init.body);
      expect(body.get('client_secret')).toBe('client-secret');
    });

    it('uses fake timers to verify buffer window', async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      mockFetch
        .mockResolvedValueOnce(makeResponse({ access_token: 'first-token', expires_in: 3600 }))
        .mockResolvedValueOnce(makeResponse({ access_token: 'refreshed-token', expires_in: 3600 }));

      const getToken = createCachedTokenProvider(
        TEST_ENDPOINTS.tokenEndpoint,
        'refresh-token',
        'client-123',
      );

      const token1 = await getToken();
      expect(token1).toBe('first-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance time to within the buffer window: expiresAt - bufferMs = now + 3600000 - 60000 = now + 3540000
      // At now + 3539000 (1s before the buffer threshold), the token is still valid
      vi.setSystemTime(now + 3539 * 1000);
      const token2 = await getToken();
      expect(token2).toBe('first-token'); // still cached
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Advance past the buffer threshold (now + 3541s > now + 3540s = expiresAt - bufferMs)
      vi.setSystemTime(now + 3541 * 1000);
      const token3 = await getToken();
      expect(token3).toBe('refreshed-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
