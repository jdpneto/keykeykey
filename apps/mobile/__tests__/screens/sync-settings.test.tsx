import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SyncSettingsScreen from '../../app/settings/sync';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const React = require('react');
  RN.useColorScheme = jest.fn(() => 'light');
  // Modal doesn't render through the portal in Jest; render children inline when visible.
  RN.Modal = ({ children, visible }: any) =>
    visible ? React.createElement(RN.View, null, children) : null;
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
const mockValidateMasterPassword = jest.fn().mockResolvedValue(true);
const mockClearVaultMismatch = jest.fn().mockResolvedValue(undefined);
const mockReplaceRemoteVault = jest.fn().mockResolvedValue({ success: true });
const mockMergeRemoteVault = jest.fn().mockResolvedValue({ success: true });
const mockReplaceLocalVault = jest.fn().mockResolvedValue({ success: true });
let mockSyncConfig: any = null;
let mockVaultMismatchInfo: any = null;

jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    syncConfig: mockSyncConfig,
    saveSyncConfig: mockSaveSyncConfig,
    triggerSync: mockTriggerSync,
    getSyncStatus: mockGetSyncStatus,
    validateMasterPassword: mockValidateMasterPassword,
    vaultMismatchInfo: mockVaultMismatchInfo,
    clearVaultMismatch: mockClearVaultMismatch,
    replaceRemoteVault: mockReplaceRemoteVault,
    mergeRemoteVault: mockMergeRemoteVault,
    replaceLocalVault: mockReplaceLocalVault,
    restoreFromCloud: jest.fn(),
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
    mockVaultMismatchInfo = null;
    mockGetSyncStatus.mockReturnValue({ isSyncing: false });
    mockClearVaultMismatch.mockResolvedValue(undefined);
    mockReplaceRemoteVault.mockResolvedValue({ success: true });
    mockMergeRemoteVault.mockResolvedValue({ success: true });
    mockReplaceLocalVault.mockResolvedValue({ success: true });
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
    const { getByText, getByPlaceholderText, getByTestId } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('WebDAV'));

    fireEvent.changeText(
      getByPlaceholderText('https://dav.example.com/remote.php/dav/files/user/'),
      'https://dav.example.com/',
    );
    fireEvent.changeText(getByPlaceholderText('username'), 'myuser');
    fireEvent.changeText(getByPlaceholderText('password'), 'mypassword');
    fireEvent.changeText(getByTestId('sync-master-password'), 'my-master-password');

    fireEvent.press(getByText('Connect'));

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({
        provider: 'webdav',
        webdav: {
          url: 'https://dav.example.com/',
          username: 'myuser',
          password: 'mypassword',
        },
        masterPassword: 'my-master-password',
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
      webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
    };
    const { getByText } = render(<SyncSettingsScreen />);
    expect(getByText('Sync Now')).toBeTruthy();
    expect(getByText('Disconnect')).toBeTruthy();
  });

  it('calls triggerSync on Sync Now press', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
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
      webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
    };
    jest.spyOn(Alert, 'alert');
    const { getByText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('Disconnect'));

    // Alert.alert should have been called with confirmation
    expect(Alert.alert).toHaveBeenCalledWith(
      'Disconnect Sync',
      expect.any(String),
      expect.any(Array),
    );

    // Simulate pressing the destructive "Disconnect" button in the alert
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const destructiveButton = alertCall[2].find(
      (btn: { text: string }) => btn.text === 'Disconnect',
    );
    await destructiveButton.onPress();

    expect(mockSaveSyncConfig).toHaveBeenCalledWith({ provider: 'none' });
  });

  describe('mismatch dialog', () => {
    it('shows mismatch dialog when vaultMismatchInfo is set with canRestore: true', () => {
      mockSyncConfig = {
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
      };
      mockVaultMismatchInfo = { canRestore: true, remoteItemCount: 3 };

      const { getByText } = render(<SyncSettingsScreen />);

      expect(getByText('Remote Vault Detected')).toBeTruthy();
      expect(getByText('Merge Vaults')).toBeTruthy();
      expect(getByText('Replace Local with Remote')).toBeTruthy();
      expect(getByText('Replace Remote with Local')).toBeTruthy();
      expect(getByText('Cancel')).toBeTruthy();
    });

    it('shows incompatible dialog when canRestore is false', () => {
      mockSyncConfig = {
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
      };
      mockVaultMismatchInfo = { canRestore: false, remoteItemCount: 0 };

      const { getByText, queryByText } = render(<SyncSettingsScreen />);

      expect(getByText('Incompatible Remote Vault')).toBeTruthy();
      expect(queryByText('Merge Vaults')).toBeNull();
      expect(queryByText('Replace Local with Remote')).toBeNull();
      // Replace Remote with Local and Cancel are always shown
      expect(getByText('Replace Remote with Local')).toBeTruthy();
      expect(getByText('Cancel')).toBeTruthy();
    });

    it('calls clearVaultMismatch on Cancel', async () => {
      mockSyncConfig = {
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
      };
      mockVaultMismatchInfo = { canRestore: true, remoteItemCount: 2 };

      const { getByText } = render(<SyncSettingsScreen />);
      fireEvent.press(getByText('Cancel'));

      await waitFor(() => {
        expect(mockClearVaultMismatch).toHaveBeenCalled();
      });
    });

    it('calls mergeRemoteVault on Merge Vaults', async () => {
      mockSyncConfig = {
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
      };
      mockVaultMismatchInfo = { canRestore: true, remoteItemCount: 5 };

      const { getByText } = render(<SyncSettingsScreen />);
      fireEvent.press(getByText('Merge Vaults'));

      await waitFor(() => {
        expect(mockMergeRemoteVault).toHaveBeenCalled();
      });
    });

    it('calls replaceLocalVault on Replace Local with Remote', async () => {
      mockSyncConfig = {
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
      };
      mockVaultMismatchInfo = { canRestore: true, remoteItemCount: 4 };

      const { getByText } = render(<SyncSettingsScreen />);
      fireEvent.press(getByText('Replace Local with Remote'));

      await waitFor(() => {
        expect(mockReplaceLocalVault).toHaveBeenCalled();
      });
    });

    it('calls replaceRemoteVault on Replace Remote with Local', async () => {
      mockSyncConfig = {
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
      };
      mockVaultMismatchInfo = { canRestore: false, remoteItemCount: 0 };

      const { getByText } = render(<SyncSettingsScreen />);
      fireEvent.press(getByText('Replace Remote with Local'));

      await waitFor(() => {
        expect(mockReplaceRemoteVault).toHaveBeenCalled();
      });
    });

    it('shows item count in description when canRestore is true', () => {
      mockSyncConfig = {
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
      };
      mockVaultMismatchInfo = { canRestore: true, remoteItemCount: 7 };

      const { getByText } = render(<SyncSettingsScreen />);
      expect(getByText(/7 items/)).toBeTruthy();
    });
  });
});
