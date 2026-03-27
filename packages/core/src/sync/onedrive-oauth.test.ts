import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildOneDriveAuthUrl,
  exchangeOneDriveAuthCode,
  createOneDriveTokenProvider,
  ONEDRIVE_ENDPOINTS,
  ONEDRIVE_SCOPE,
  generateCodeVerifier,
} from './onedrive-oauth.js';
import { SyncAuthError } from './errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

describe('OneDrive OAuth wrapper', () => {
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

  it('exports correct OneDrive endpoints', () => {
    expect(ONEDRIVE_ENDPOINTS.authEndpoint).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2/authorize',
    );
    expect(ONEDRIVE_ENDPOINTS.tokenEndpoint).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2/token',
    );
    // No revoke endpoint for Microsoft
    expect(ONEDRIVE_ENDPOINTS.revokeEndpoint).toBeUndefined();
  });

  it('exports correct OneDrive scope', () => {
    expect(ONEDRIVE_SCOPE).toContain('Files.ReadWrite.AppFolder');
    expect(ONEDRIVE_SCOPE).toContain('offline_access');
  });

  // -------------------------------------------------------------------------
  // Re-exports
  // -------------------------------------------------------------------------

  it('re-exports generateCodeVerifier from oauth module', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  // -------------------------------------------------------------------------
  // buildOneDriveAuthUrl
  // -------------------------------------------------------------------------

  describe('buildOneDriveAuthUrl', () => {
    it('uses OneDrive auth endpoint', async () => {
      const url = await buildOneDriveAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe(ONEDRIVE_ENDPOINTS.authEndpoint);
    });

    it('includes correct scope with Files.ReadWrite.AppFolder and offline_access', async () => {
      const url = await buildOneDriveAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      const scope = parsed.searchParams.get('scope') ?? '';
      expect(scope).toContain('Files.ReadWrite.AppFolder');
      expect(scope).toContain('offline_access');
    });

    it('includes response_mode=query in extra params', async () => {
      const url = await buildOneDriveAuthUrl({
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const parsed = new URL(url);
      expect(parsed.searchParams.get('response_mode')).toBe('query');
    });

    it('includes standard PKCE params (response_type=code, code_challenge_method=S256)', async () => {
      const url = await buildOneDriveAuthUrl({
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
      const url = await buildOneDriveAuthUrl({
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
  // exchangeOneDriveAuthCode
  // -------------------------------------------------------------------------

  describe('exchangeOneDriveAuthCode', () => {
    it('calls OneDrive token endpoint', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTokenResponse()));

      await exchangeOneDriveAuthCode({
        code: 'auth-code-123',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(ONEDRIVE_ENDPOINTS.tokenEndpoint);
    });

    it('returns access and refresh tokens', async () => {
      mockFetch.mockResolvedValueOnce(makeResponse(makeTokenResponse()));

      const result = await exchangeOneDriveAuthCode({
        code: 'auth-code-123',
        clientId: 'client-123',
        redirectUri: 'http://localhost/callback',
        codeVerifier: 'test-verifier',
      });

      expect(result.accessToken).toBe('test-access-token');
      expect(result.refreshToken).toBe('test-refresh-token');
      expect(result.expiresIn).toBe(3600);
    });
  });

  // -------------------------------------------------------------------------
  // createOneDriveTokenProvider
  // -------------------------------------------------------------------------

  describe('createOneDriveTokenProvider', () => {
    it('caches token and reuses within expiry window', async () => {
      mockFetch.mockResolvedValue(
        makeResponse({ access_token: 'cached-token', expires_in: 3600 }),
      );

      const getToken = createOneDriveTokenProvider('refresh-token', 'client-123');

      const token1 = await getToken();
      const token2 = await getToken();

      expect(token1).toBe('cached-token');
      expect(token2).toBe('cached-token');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('calls OneDrive token endpoint for refresh', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ access_token: 'fresh-token', expires_in: 3600 }),
      );

      const getToken = createOneDriveTokenProvider('refresh-token', 'client-123');
      await getToken();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(ONEDRIVE_ENDPOINTS.tokenEndpoint);
    });

    it('throws SyncAuthError on invalid_grant', async () => {
      mockFetch.mockResolvedValueOnce(
        makeResponse({ error: 'invalid_grant', error_description: 'Token revoked' }, 400),
      );

      const getToken = createOneDriveTokenProvider('revoked-token', 'client-123');
      await expect(getToken()).rejects.toThrow(SyncAuthError);
    });
  });
});
