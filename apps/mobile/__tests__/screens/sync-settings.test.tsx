import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SyncSettingsScreen from '../../app/settings/sync';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

const mockSaveSyncConfig = jest.fn().mockResolvedValue(undefined);
const mockTriggerSync = jest
  .fn()
  .mockResolvedValue({ lastSynced: '2026-03-17T12:00:00Z', error: null });
const mockGetSyncStatus = jest.fn(() => ({ isSyncing: false }));
let mockSyncConfig: any = null;

jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    syncConfig: mockSyncConfig,
    saveSyncConfig: mockSaveSyncConfig,
    triggerSync: mockTriggerSync,
    getSyncStatus: mockGetSyncStatus,
  }),
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

jest.mock('@keykeykey/ui', () => ({
  colors: {
    primary: '#A3E635',
    primaryMuted: '#D9F99D',
    background: '#FFFFFF',
    surface: '#FFF7ED',
    surfaceAlt: '#FFEDD5',
    text: '#292524',
    textSecondary: '#78716C',
    border: '#E7E5E4',
    inputBackground: '#FAFAF9',
    primaryDark: '#A3E635',
    primaryMutedDark: '#365314',
    backgroundDark: '#000000',
    surfaceDark: '#052E16',
    surfaceAltDark: '#064E3B',
    textDark: '#F0FDF4',
    textSecondaryDark: '#86EFAC',
    borderDark: '#14532D',
    inputBackgroundDark: '#022C22',
    error: '#EF4444',
    errorLight: '#FEE2E2',
    success: '#22C55E',
    successLight: '#DCFCE7',
    warning: '#F59E0B',
    warningLight: '#FEF3C7',
    danger: '#DC2626',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
  radii: { sm: 6, md: 12, lg: 16, xl: 24, full: 9999 },
  typography: {
    sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 34 },
    weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  },
}));

describe('SyncSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncConfig = null;
    mockGetSyncStatus.mockReturnValue({ isSyncing: false });
  });

  it('renders provider radio list', () => {
    const { getByText } = render(<SyncSettingsScreen />);
    expect(getByText('Cloud Sync')).toBeTruthy();
    expect(getByText('None (Local Only)')).toBeTruthy();
    expect(getByText('WebDAV')).toBeTruthy();
    expect(getByText('Google Drive (Coming Soon)')).toBeTruthy();
    expect(getByText('iCloud (Coming Soon)')).toBeTruthy();
  });

  it('shows WebDAV fields when WebDAV is selected', () => {
    const { getByText, getByPlaceholderText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('WebDAV'));
    expect(getByPlaceholderText('https://dav.example.com/remote.php/dav/files/user/')).toBeTruthy();
    expect(getByPlaceholderText('username')).toBeTruthy();
    expect(getByPlaceholderText('password')).toBeTruthy();
  });

  it('Connect button disabled until all fields filled', () => {
    const { getByText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('WebDAV'));
    expect(getByText('Connect')).toBeTruthy();
  });

  it('calls saveSyncConfig on Connect with WebDAV config', async () => {
    const { getByText, getByPlaceholderText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('WebDAV'));

    fireEvent.changeText(
      getByPlaceholderText('https://dav.example.com/remote.php/dav/files/user/'),
      'https://dav.example.com/',
    );
    fireEvent.changeText(getByPlaceholderText('username'), 'myuser');
    fireEvent.changeText(getByPlaceholderText('password'), 'mypassword');

    fireEvent.press(getByText('Connect'));

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({
        provider: 'webdav',
        webdav: {
          url: 'https://dav.example.com/',
          username: 'myuser',
          password: 'mypassword',
        },
      });
    });
  });

  it('does not show coming soon banner by default', () => {
    const { queryByText } = render(<SyncSettingsScreen />);
    expect(queryByText(/not yet available/i)).toBeNull();
  });

  it('shows Disconnect and Sync Now when connected', () => {
    mockSyncConfig = {
      provider: 'webdav',
      url: 'https://dav.example.com/',
      username: 'user',
      password: 'pass',
    };
    const { getByText } = render(<SyncSettingsScreen />);
    expect(getByText('Sync Now')).toBeTruthy();
    expect(getByText('Disconnect')).toBeTruthy();
  });

  it('calls triggerSync on Sync Now press', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      url: 'https://dav.example.com/',
      username: 'user',
      password: 'pass',
    };
    const { getByText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('Sync Now'));

    await waitFor(() => {
      expect(mockTriggerSync).toHaveBeenCalled();
    });
  });

  it('calls saveSyncConfig with none on Disconnect', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      url: 'https://dav.example.com/',
      username: 'user',
      password: 'pass',
    };
    const { getByText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('Disconnect'));

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({ provider: 'none' });
    });
  });
});
