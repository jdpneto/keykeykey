const mockOpenAuthSessionAsync = jest.fn();
const mockBuildAuthUrl = jest.fn(async ({ redirectUri }: { redirectUri: string }) => {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('redirect_uri', redirectUri);
  return url.toString();
});

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: jest.fn(({ native }: { native?: string }) => native ?? 'keykeykey://oauth'),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args),
}));

jest.mock('@keykeykey/core/sync', () => ({
  generateCodeVerifier: jest.fn(() => 'test-verifier'),
  generateState: jest.fn(() => 'test-state'),
  buildAuthUrl: (params: unknown) => mockBuildAuthUrl(params as { redirectUri: string }),
  exchangeAuthCode: jest.fn(),
  revokeToken: jest.fn(),
}));

import { makeRedirectUri } from 'expo-auth-session';
import { startGoogleOAuth } from '../../lib/google-oauth';

describe('mobile Google OAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the native app id redirect URI required by Google OAuth', async () => {
    mockOpenAuthSessionAsync.mockResolvedValueOnce({ type: 'cancel' });

    await expect(startGoogleOAuth()).rejects.toThrow('Google sign-in was cancelled');

    expect(makeRedirectUri).toHaveBeenCalledWith({
      native: 'com.keykeykey.app:/oauthredirect',
      scheme: 'com.keykeykey.app',
      path: 'oauthredirect',
    });

    const [authUrl, redirectUri] = mockOpenAuthSessionAsync.mock.calls[0];
    expect(redirectUri).toBe('com.keykeykey.app:/oauthredirect');
    expect(new URL(authUrl as string).searchParams.get('redirect_uri')).toBe(
      'com.keykeykey.app:/oauthredirect',
    );
  });
});
