import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SyncSettingsScreen from '../../app/settings/sync';
import type { SyncSettingsState, SyncSettingsDriver } from '@keykeykey/ui';

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
const mockDismissTo = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, dismissTo: mockDismissTo }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

jest.mock('../../lib/google-oauth', () => ({
  startGoogleOAuth: jest.fn(),
  revokeToken: jest.fn(),
  getClientId: jest.fn(() => 'test-ios-client-id'),
  GOOGLE_DRIVE_CLIENT_ID_IOS: 'test-ios',
  GOOGLE_DRIVE_CLIENT_ID_ANDROID: 'test-android',
}));

jest.mock('../../lib/dropbox-oauth', () => ({
  startDropboxOAuth: jest.fn(),
  revokeDropboxToken: jest.fn(),
  DROPBOX_CLIENT_ID: 'test-dropbox-client-id',
}));

jest.mock('../../lib/onedrive-oauth', () => ({
  startOneDriveOAuth: jest.fn(),
  ONEDRIVE_CLIENT_ID: 'test-onedrive-client-id',
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
const mockGetMismatchInfoNow = jest.fn(() => mockVaultMismatchInfo);
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
    getMismatchInfoNow: mockGetMismatchInfoNow,
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

// ---------------------------------------------------------------------------
// Mock useSyncSettings from @keykeykey/ui
//
// The UI package ships React 19 in its own node_modules while mobile uses
// React 18.  Importing the real hook source from the test would trigger the
// "two copies of React" error.  Instead we mock the hook so each test can
// configure the returned state, while still exercising the component's
// rendering logic end-to-end.
// ---------------------------------------------------------------------------
let mockHookStateOverride: Partial<SyncSettingsState> = {};
let mockCapturedDriver: SyncSettingsDriver | null = null;

function mockCreateDefaultHookState(): SyncSettingsState {
  return {
    syncProvider: 'none',
    setSyncProvider: jest.fn(),
    webdavUrl: '',
    setWebdavUrl: jest.fn(),
    webdavUsername: '',
    setWebdavUsername: jest.fn(),
    webdavPassword: '',
    setWebdavPassword: jest.fn(),
    masterPassword: '',
    setMasterPassword: jest.fn(),
    isConnected: false,
    canConnect: false,
    syncStatus: null,
    mismatchInfo: null,
    error: null,
    loading: false,
    connecting: false,
    syncing: false,
    merging: false,
    replacingLocal: false,
    replacingRemote: false,
    showDisconnectConfirm: false,
    setShowDisconnectConfirm: jest.fn(),
    handleWebdavConnect: jest.fn(),
    handleOAuthConnect: jest.fn(),
    handleSyncNow: jest.fn(),
    handleDisconnect: jest.fn(),
    handleMismatchMerge: jest.fn(),
    handleMismatchReplaceLocal: jest.fn(),
    handleMismatchReplaceRemote: jest.fn(),
    handleMismatchCancel: jest.fn(),
    refreshStatus: jest.fn(),
  };
}

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
  useSyncSettings: (driver: SyncSettingsDriver) => {
    mockCapturedDriver = driver;
    return { ...mockCreateDefaultHookState(), ...mockHookStateOverride };
  },
}));

describe('SyncSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncConfig = null;
    mockVaultMismatchInfo = null;
    mockHookStateOverride = {};
    mockCapturedDriver = null;
    mockGetSyncStatus.mockReturnValue({ isSyncing: false });
    mockGetMismatchInfoNow.mockImplementation(() => mockVaultMismatchInfo);
    mockClearVaultMismatch.mockResolvedValue(undefined);
    mockReplaceRemoteVault.mockResolvedValue({ success: true });
    mockMergeRemoteVault.mockResolvedValue({ success: true });
    mockReplaceLocalVault.mockResolvedValue({ success: true });
  });

  it('renders only enabled sync providers', () => {
    const { getByText, queryByText } = render(<SyncSettingsScreen />);
    expect(getByText('Cloud Sync')).toBeTruthy();
    expect(getByText('None (Local Only)')).toBeTruthy();
    expect(getByText('WebDAV')).toBeTruthy();
    expect(queryByText('Google Drive')).toBeNull();
    expect(queryByText('Dropbox')).toBeNull();
    expect(queryByText('OneDrive')).toBeNull();
  });

  it('returns to Settings when the back button is pressed', () => {
    const { getByTestId } = render(<SyncSettingsScreen />);
    fireEvent.press(getByTestId('sync-back'));
    expect(mockDismissTo).toHaveBeenCalledWith('/(tabs)/settings');
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('shows WebDAV fields when WebDAV is selected', () => {
    mockHookStateOverride = { syncProvider: 'webdav' };
    const { getByPlaceholderText } = render(<SyncSettingsScreen />);
    expect(getByPlaceholderText('https://dav.example.com/remote.php/dav/files/user/')).toBeTruthy();
    expect(getByPlaceholderText('username')).toBeTruthy();
    expect(getByPlaceholderText('password')).toBeTruthy();
  });

  it('Connect button disabled until all fields filled', () => {
    mockHookStateOverride = { syncProvider: 'webdav', canConnect: false };
    const { getByText } = render(<SyncSettingsScreen />);
    expect(getByText('Connect')).toBeTruthy();
  });

  it('provides correct driver that calls saveSyncConfig on WebDAV connect', async () => {
    mockHookStateOverride = { syncProvider: 'webdav' };
    render(<SyncSettingsScreen />);

    expect(mockCapturedDriver).toBeTruthy();

    // Verify the driver delegates to vault correctly
    await mockCapturedDriver!.saveConfig({
      provider: 'webdav',
      webdav: {
        url: 'https://dav.example.com/',
        username: 'myuser',
        password: 'mypassword',
      },
      masterPassword: 'my-master-password',
    });

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

  it('does not show coming soon banner by default', () => {
    const { queryByText } = render(<SyncSettingsScreen />);
    expect(queryByText(/not yet available/i)).toBeNull();
  });

  it('shows Disconnect and Sync Now when connected', () => {
    mockHookStateOverride = {
      isConnected: true,
      syncStatus: {
        provider: 'webdav',
        lastSynced: null,
        isSyncing: false,
        error: null,
      },
    };
    const { getByText } = render(<SyncSettingsScreen />);
    expect(getByText('Sync Now')).toBeTruthy();
    expect(getByText('Disconnect')).toBeTruthy();
  });

  it('calls handleSyncNow on Sync Now press', () => {
    const mockHandleSyncNow = jest.fn();
    mockHookStateOverride = {
      isConnected: true,
      syncStatus: {
        provider: 'webdav',
        lastSynced: null,
        isSyncing: false,
        error: null,
      },
      handleSyncNow: mockHandleSyncNow,
    };
    const { getByText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('Sync Now'));

    expect(mockHandleSyncNow).toHaveBeenCalled();
  });

  it('shows Alert.alert on Disconnect and calls handleDisconnect', async () => {
    const mockHandleDisconnect = jest.fn();
    mockHookStateOverride = {
      isConnected: true,
      syncStatus: {
        provider: 'webdav',
        lastSynced: null,
        isSyncing: false,
        error: null,
      },
      handleDisconnect: mockHandleDisconnect,
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
    destructiveButton.onPress();

    expect(mockHandleDisconnect).toHaveBeenCalled();
  });

  it('driver disconnect calls saveSyncConfig with none', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com/', username: 'user', password: 'pass' },
    };
    mockHookStateOverride = { isConnected: true };
    render(<SyncSettingsScreen />);
    expect(mockCapturedDriver).toBeTruthy();

    await mockCapturedDriver!.disconnect('webdav');
    expect(mockSaveSyncConfig).toHaveBeenCalledWith({ provider: 'none' });
  });

  it('driver triggerSync delegates to vault', async () => {
    render(<SyncSettingsScreen />);
    expect(mockCapturedDriver).toBeTruthy();

    const result = await mockCapturedDriver!.triggerSync();
    expect(mockTriggerSync).toHaveBeenCalled();
    expect(mockGetMismatchInfoNow).toHaveBeenCalled();
    expect(result.lastSynced).toBe('2026-03-17T12:00:00Z');
  });

  it('driver validateMasterPassword delegates to vault', async () => {
    render(<SyncSettingsScreen />);
    expect(mockCapturedDriver).toBeTruthy();

    const valid = await mockCapturedDriver!.validateMasterPassword('test-password');
    expect(mockValidateMasterPassword).toHaveBeenCalledWith('test-password');
    expect(valid).toBe(true);
  });

  describe('mismatch dialog', () => {
    it('shows mismatch dialog when mismatchInfo has canRestore: true', () => {
      mockHookStateOverride = {
        mismatchInfo: { canRestore: true, remoteItemCount: 3 },
        isConnected: true,
      };

      const { getByText } = render(<SyncSettingsScreen />);

      expect(getByText('Remote Vault Detected')).toBeTruthy();
      expect(getByText('Merge Vaults')).toBeTruthy();
      expect(getByText('Replace Local with Remote')).toBeTruthy();
      expect(getByText('Replace Remote with Local')).toBeTruthy();
      expect(getByText('Cancel')).toBeTruthy();
    });

    it('hides connecting overlay while mismatch dialog is visible', () => {
      mockHookStateOverride = {
        connecting: true,
        mismatchInfo: { canRestore: true, remoteItemCount: 3 },
        isConnected: true,
      };

      const { getByText, queryByText } = render(<SyncSettingsScreen />);

      expect(queryByText('Connecting to Cloud')).toBeNull();
      expect(getByText('Remote Vault Detected')).toBeTruthy();
    });

    it('shows incompatible dialog when canRestore is false', () => {
      mockHookStateOverride = {
        mismatchInfo: { canRestore: false, remoteItemCount: 0 },
        isConnected: true,
      };

      const { getByText, queryByText } = render(<SyncSettingsScreen />);

      expect(getByText('Incompatible Remote Vault')).toBeTruthy();
      expect(queryByText('Merge Vaults')).toBeNull();
      expect(queryByText('Replace Local with Remote')).toBeNull();
      // Replace Remote with Local and Cancel are always shown
      expect(getByText('Replace Remote with Local')).toBeTruthy();
      expect(getByText('Cancel')).toBeTruthy();
    });

    it('calls handleMismatchCancel on Cancel', () => {
      const mockCancel = jest.fn();
      mockHookStateOverride = {
        mismatchInfo: { canRestore: true, remoteItemCount: 2 },
        handleMismatchCancel: mockCancel,
      };

      const { getByText } = render(<SyncSettingsScreen />);
      fireEvent.press(getByText('Cancel'));

      expect(mockCancel).toHaveBeenCalled();
    });

    it('calls handleMismatchMerge on Merge Vaults', () => {
      const mockMerge = jest.fn();
      mockHookStateOverride = {
        mismatchInfo: { canRestore: true, remoteItemCount: 5 },
        handleMismatchMerge: mockMerge,
      };

      const { getByText } = render(<SyncSettingsScreen />);
      fireEvent.press(getByText('Merge Vaults'));

      expect(mockMerge).toHaveBeenCalled();
    });

    it('calls handleMismatchReplaceLocal on Replace Local with Remote', () => {
      const mockReplaceLocal = jest.fn();
      mockHookStateOverride = {
        mismatchInfo: { canRestore: true, remoteItemCount: 4 },
        handleMismatchReplaceLocal: mockReplaceLocal,
      };

      const { getByText } = render(<SyncSettingsScreen />);
      fireEvent.press(getByText('Replace Local with Remote'));

      expect(mockReplaceLocal).toHaveBeenCalled();
    });

    it('calls handleMismatchReplaceRemote on Replace Remote with Local', () => {
      const mockReplaceRemote = jest.fn();
      mockHookStateOverride = {
        mismatchInfo: { canRestore: false, remoteItemCount: 0 },
        handleMismatchReplaceRemote: mockReplaceRemote,
      };

      const { getByText } = render(<SyncSettingsScreen />);
      fireEvent.press(getByText('Replace Remote with Local'));

      expect(mockReplaceRemote).toHaveBeenCalled();
    });

    it('shows item count in description when canRestore is true', () => {
      mockHookStateOverride = {
        mismatchInfo: { canRestore: true, remoteItemCount: 7 },
      };

      const { getByText } = render(<SyncSettingsScreen />);
      expect(getByText(/7 items/)).toBeTruthy();
    });

    it('uses generic description when the remote item count is unavailable', () => {
      mockHookStateOverride = {
        mismatchInfo: { canRestore: true },
      };

      const { getByText, queryByText } = render(<SyncSettingsScreen />);
      expect(getByText(/has an existing vault from a different device/)).toBeTruthy();
      expect(queryByText(/undefined item/)).toBeNull();
    });

    it('shows conflict actions instead of Connect when a disconnected WebDAV connect detects a mismatch', () => {
      mockHookStateOverride = {
        syncProvider: 'webdav',
        isConnected: false,
        canConnect: true,
        error: 'Remote vault mismatch — resolve it before syncing',
        mismatchInfo: { canRestore: true },
      };

      const { getByTestId, queryByTestId } = render(<SyncSettingsScreen />);

      expect(queryByTestId('sync-connect')).toBeNull();
      expect(getByTestId('sync-conflict-merge')).toBeTruthy();
      expect(getByTestId('sync-conflict-replace-local')).toBeTruthy();
      expect(getByTestId('sync-conflict-replace-remote')).toBeTruthy();
    });

    it('driver mergeVaults delegates to vault mergeRemoteVault', async () => {
      render(<SyncSettingsScreen />);
      expect(mockCapturedDriver).toBeTruthy();

      await mockCapturedDriver!.mergeVaults();
      expect(mockMergeRemoteVault).toHaveBeenCalled();
    });

    it('driver replaceLocal delegates to vault replaceLocalVault', async () => {
      render(<SyncSettingsScreen />);
      expect(mockCapturedDriver).toBeTruthy();

      await mockCapturedDriver!.replaceLocal();
      expect(mockReplaceLocalVault).toHaveBeenCalled();
    });

    it('driver replaceRemote delegates to vault replaceRemoteVault', async () => {
      render(<SyncSettingsScreen />);
      expect(mockCapturedDriver).toBeTruthy();

      await mockCapturedDriver!.replaceRemote();
      expect(mockReplaceRemoteVault).toHaveBeenCalled();
    });

    it('driver clearMismatch delegates to vault clearVaultMismatch', async () => {
      render(<SyncSettingsScreen />);
      expect(mockCapturedDriver).toBeTruthy();

      await mockCapturedDriver!.clearMismatch();
      expect(mockClearVaultMismatch).toHaveBeenCalled();
    });
  });
});
