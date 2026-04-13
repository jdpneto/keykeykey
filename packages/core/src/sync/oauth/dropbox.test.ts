import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  createDropboxTokenProvider,
  revokeDropboxToken,
  DROPBOX_ENDPOINTS,
  generateCodeVerifier,
} from './dropbox.js';
import { SyncAuthError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'sl.test-access-token',
    refresh_token: 'test-refresh-token',
    expires_in: 14400,
    token_type: 'bearer',
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

describe('Dropbox OAuth wrapper', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // Endpoints
  // -------------------------------------------------------------------------

  it('exports correct Dropbox endpoints', () => {
    expect(DROPBOX_ENDPOINTS.authEndpoint).toBe('https://www.dropbox.com/oauth2/authorize');
    expect(DROPBOX_ENDPOINTS.tokenEndpoint).toBe('https://api.dropboxapi.com/oauth2/token');
    expect(DROPBOX_ENDPOINTS.revokeEndpoint).toBe('https://api.dropboxapi.com/2/auth/token/revoke');
  });

  // -------------------------------------------------------------------------
  // Re-exports
  // -------------------------------------------------------------------------

  it('re-exports generateCodeVerifier from oauth module', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  // -------------------------------------------------------------------------
  // buildDropboxAuthUrl
  // -------------------------------------------------------------------------

  describe('buildDropboxAuthUrl', () => {
    it('uses Dropbox auth endpoint', async () => {
      const url = await buildDropboxAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(DROPBOX_ENDPOINTS.authEndpoint);
    });

    it('includes token_access_type=offline', async () => {
      const url = await buildDropboxAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('token_access_type')).toBe('offline');
    });

    it('does not set a scope param (Dropbox uses app permissions)', async () => {
      const url = await buildDropboxAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.has('scope')).toBe(false);
    });

    it('includes standard PKCE params (response_type=code, code_challenge_method=S256)', async () => {
      const url = await buildDropboxAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('code_challenge')).toBeTruthy();
    });

    it('includes state when provided', async () => {
      const url = await buildDropboxAuthUrl({
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
  // exchangeDropboxAuthCode
  // -------------------------------------------------------------------------

  describe('exchangeDropboxAuthCode', () => {
    it('calls Dropbox token endpoint', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTokenResponse()));

      await exchangeDropboxAuthCode({
        code: 'auth-code-123',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(DROPBOX_ENDPOINTS.tokenEndpoint);
    });

    it('returns access and refresh tokens', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTokenResponse()));

      const result = await exchangeDropboxAuthCode({
        code: 'auth-code-123',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      expect(result.accessToken).toBe('sl.test-access-token');
      expect(result.refreshToken).toBe('test-refresh-token');
      expect(result.expiresIn).toBe(14400);
    });
  });

  // -------------------------------------------------------------------------
  // createDropboxTokenProvider
  // -------------------------------------------------------------------------

  describe('createDropboxTokenProvider', () => {
    it('caches token and reuses within expiry window', async () => {
      mockFetch.mockResolvedValue(
        makeResponse({ access_token: 'sl.cached-token', expires_in: 14400 }),
      );

      const getToken = createDropboxTokenProvider('refresh-token', 'client-123');

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('sl.cached-token');
      expect(token2).toBe('sl.cached-token');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('calls Dropbox token endpoint for refresh', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ access_token: 'sl.fresh', expires_in: 14400 }),
      );

      const getToken = createDropboxTokenProvider('refresh-token', 'client-123');
      await getToken();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(DROPBOX_ENDPOINTS.tokenEndpoint);
    });

    it('throws SyncAuthError on invalid_grant', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'invalid_grant', error_description: 'Token revoked' }, 400),
      );

      const getToken = createDropboxTokenProvider('revoked-token', 'client-123');
      await expect(getToken()).rejects.toThrow(SyncAuthError);
    });
  });

  // -------------------------------------------------------------------------
  // revokeDropboxToken — uses bearer style (Authorization header)
  // -------------------------------------------------------------------------

  describe('revokeDropboxToken', () => {
    it('calls Dropbox revoke endpoint with bearer Authorization header', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}, 200));

      await revokeDropboxToken('test-token');

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(DROPBOX_ENDPOINTS.revokeEndpoint);
      expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    });

    it('does NOT send token in body (bearer style, not body style)', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse({}, 200));

      await revokeDropboxToken('test-token');

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      // body should be empty string for bearer style
      expect(init.body).toBe('');
    });

    it('does not throw on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(revokeDropboxToken('test-token')).resolves.toBeUndefined();
    });
  });
});
