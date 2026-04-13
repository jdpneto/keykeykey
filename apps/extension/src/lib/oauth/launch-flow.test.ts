import { describe, it, expect, vi, beforeEach } from 'vitest';
import { launchOAuthFlow } from './launch-flow.js';

// Mock webextension-polyfill
vi.mock('webextension-polyfill', () => ({
  default: {
    identity: {
      getRedirectURL: () => 'https://redirect.test/',
      launchWebAuthFlow: vi.fn(),
    },
  },
}));

// Mock core sync to control PKCE + state values
vi.mock('@keykeykey/core/sync', () => ({
  generateCodeVerifier: () => 'mock-verifier',
  generateState: () => 'mock-state',
}));

import browser from 'webextension-polyfill';

describe('launchOAuthFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return the exchange result on success', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=mock-state');
    const mockExchange = vi.fn().mockResolvedValue({ refreshToken: 'rt_123', accessToken: 'at' });

    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?code=AUTH_CODE&state=mock-state',
    );

    const result = await launchOAuthFlow({
      buildAuthUrl: mockBuildUrl,
      exchangeCode: mockExchange,
      clientId: 'client-123',
    });

    expect(result).toEqual({ refreshToken: 'rt_123', accessToken: 'at' });
    expect(mockBuildUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-123',
        redirectUri: 'https://redirect.test/',
        codeVerifier: 'mock-verifier',
        state: 'mock-state',
      }),
    );
    expect(mockExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AUTH_CODE',
        clientId: 'client-123',
        redirectUri: 'https://redirect.test/',
        codeVerifier: 'mock-verifier',
      }),
    );
  });

  it('should throw on state mismatch', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=mock-state');
    const mockExchange = vi.fn();

    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?code=CODE&state=wrong',
    );

    await expect(
      launchOAuthFlow({
        buildAuthUrl: mockBuildUrl,
        exchangeCode: mockExchange,
        clientId: 'client-123',
      }),
    ).rejects.toThrow('OAuth state mismatch');
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('should throw when no callback URL is returned', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com');
    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue('');

    await expect(
      launchOAuthFlow({
        buildAuthUrl: mockBuildUrl,
        exchangeCode: vi.fn(),
        clientId: 'client-123',
      }),
    ).rejects.toThrow('No response URL from OAuth flow');
  });

  it('should throw when no authorization code in redirect', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=mock-state');
    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?state=mock-state',
    );

    await expect(
      launchOAuthFlow({
        buildAuthUrl: mockBuildUrl,
        exchangeCode: vi.fn(),
        clientId: 'client-123',
      }),
    ).rejects.toThrow('No authorization code');
  });

  it('should pass extraExchangeParams to exchangeCode', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=mock-state');
    const mockExchange = vi.fn().mockResolvedValue({ refreshToken: 'rt' });
    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?code=CODE&state=mock-state',
    );

    await launchOAuthFlow({
      buildAuthUrl: mockBuildUrl,
      exchangeCode: mockExchange,
      clientId: 'client-123',
      extraExchangeParams: { clientSecret: 'secret' },
    });

    expect(mockExchange).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: 'secret' }));
  });

  it('should throw on OAuth provider error in redirect', async () => {
    const mockBuildUrl = vi.fn().mockResolvedValue('https://auth.example.com?state=mock-state');
    vi.mocked(browser.identity.launchWebAuthFlow).mockResolvedValue(
      'https://redirect.test/?error=access_denied&error_description=User%20denied%20consent',
    );

    await expect(
      launchOAuthFlow({
        buildAuthUrl: mockBuildUrl,
        exchangeCode: vi.fn(),
        clientId: 'client-123',
      }),
    ).rejects.toThrow('OAuth failed: User denied consent');
  });
});
