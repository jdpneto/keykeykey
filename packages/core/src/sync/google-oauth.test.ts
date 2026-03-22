import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  buildAuthUrl,
  exchangeAuthCode,
  refreshAccessToken,
  revokeToken,
  createCachedTokenProvider,
  GoogleOAuthError,
} from './google-oauth.js';
import { SyncAuthError } from './errors.js';

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
// Tests
// ---------------------------------------------------------------------------

describe('Google OAuth helpers', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: verifier,
      });

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(parsed.searchParams.get('client_id')).toBe('client-123');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost/callback');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('code_challenge')).toBe(expectedChallenge);
      expect(parsed.searchParams.get('scope')).toContain('drive.appdata');
    });

    it('includes state parameter when provided', async () => {
      const url = await buildAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
        state: 'random-state-value',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('state')).toBe('random-state-value');
    });
  });

  // -------------------------------------------------------------------------
  // exchangeAuthCode
  // -------------------------------------------------------------------------

  describe('exchangeAuthCode', () => {
    it('exchanges code for tokens', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTokenResponse()));

      const result = await exchangeAuthCode({
        code: 'auth-code-123',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      expect(result).toEqual({
        accessToken: 'ya29.test-access-token',
        refreshToken: 'test-refresh-token',
        expiresIn: 3600,
      });

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(init.method).toBe('POST');
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
  // refreshAccessToken
  // -------------------------------------------------------------------------

  describe('refreshAccessToken', () => {
    it('refreshes access token', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ access_token: 'ya29.new-token', expires_in: 3600 }),
      );

      const result = await refreshAccessToken({
        refreshToken: 'test-refresh-token',
        clientId: 'client-123',
      });

      expect(result).toEqual({
        accessToken: 'ya29.new-token',
        expiresIn: 3600,
      });
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
  });

  // -------------------------------------------------------------------------
  // revokeToken
  // -------------------------------------------------------------------------

  describe('revokeToken', () => {
    it('calls revoke endpoint', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}, 200));

      await revokeToken('test-token');

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('https://oauth2.googleapis.com/revoke');
    });

    it('does not throw on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(revokeToken('test-token')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // createCachedTokenProvider
  // -------------------------------------------------------------------------

  describe('createCachedTokenProvider', () => {
    it('caches token and reuses within expiry window', async () => {
      mockFetch.mockResolvedValue(
        makeResponse({ access_token: 'ya29.cached', expires_in: 3600 }),
      );

      const getToken = createCachedTokenProvider('refresh-token', 'client-123');

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('ya29.cached');
      expect(token2).toBe('ya29.cached');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('refreshes when token is near expiry', async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeResponse({ access_token: 'ya29.first', expires_in: 0 }),
        )
        .mockResolvedValueOnce(
          makeResponse({ access_token: 'ya29.second', expires_in: 3600 }),
        );

      const getToken = createCachedTokenProvider('refresh-token', 'client-123');

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('ya29.first');
      expect(token2).toBe('ya29.second');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
