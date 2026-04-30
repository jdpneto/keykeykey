import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockSaveSyncConfig = vi.fn().mockResolvedValue(undefined);
const mockTriggerSync = vi
  .fn()
  .mockResolvedValue({ lastSynced: '2026-03-17T12:00:00Z', error: null });
const mockGetSyncStatus = vi.fn(() => ({ isSyncing: false }));
const mockValidateMasterPassword = vi.fn().mockResolvedValue(true);
const mockNavigate = vi.fn();
import type { SyncConfig } from '@keykeykey/core/sync';
let mockSyncConfig: SyncConfig | null = null;
let mockLastSynced: string | null = null;

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    syncConfig: mockSyncConfig,
    saveSyncConfig: mockSaveSyncConfig,
    triggerSync: mockTriggerSync,
    getSyncStatus: mockGetSyncStatus,
    validateMasterPassword: mockValidateMasterPassword,
    lastSynced: mockLastSynced,
    vaultMismatchInfo: null,
    clearVaultMismatch: vi.fn(),
    replaceRemoteVault: vi.fn().mockResolvedValue({ success: true }),
    mergeRemoteVault: vi.fn().mockResolvedValue({ success: true }),
    replaceLocalVault: vi.fn().mockResolvedValue({ success: true }),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../lib/theme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        primary: '#A3E635',
        primaryMuted: '#A3E63520',
        background: '#FFF8F0',
        surface: '#FFFFFF',
        surfaceAlt: '#F5F0EB',
        text: '#1A1A1A',
        textSecondary: '#6B7280',
        border: '#E5E0DB',
        inputBackground: '#FFFFFF',
        error: '#EF4444',
        errorLight: '#FEE2E2',
        success: '#22C55E',
        successLight: '#DCFCE7',
        warning: '#F59E0B',
        warningLight: '#FEF3C7',
        danger: '#EF4444',
      },
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
      radii: { sm: 6, md: 10, lg: 16, xl: 24, full: 9999 },
      typography: {
        sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 24, '2xl': 32 },
        weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
      },
    },
    mode: 'light',
    setMode: vi.fn(),
    isDark: false,
  }),
}));

vi.mock('../../lib/google-oauth.js', () => ({
  startGoogleOAuth: vi.fn(),
  revokeToken: vi.fn(),
  GOOGLE_DRIVE_CLIENT_ID: 'test-client-id',
  GOOGLE_DRIVE_CLIENT_SECRET: 'test-client-secret',
}));

vi.mock('../../lib/dropbox-oauth', () => ({
  startDropboxOAuth: vi.fn(),
  revokeDropboxToken: vi.fn(),
  DROPBOX_CLIENT_ID: 'test-dropbox-client-id',
}));

vi.mock('../../lib/onedrive-oauth', () => ({
  startOneDriveOAuth: vi.fn(),
  ONEDRIVE_CLIENT_ID: 'test-onedrive-client-id',
}));

vi.mock('../../lib/fetch-proxy', () => ({
  wasSchemeDowngradeDetected: vi.fn(() => false),
  clearSchemeDowngradeFlag: vi.fn(),
}));

import { SyncSettingsScreen } from '../SyncSettingsScreen';

function renderSyncSettings() {
  return render(
    <MemoryRouter>
      <SyncSettingsScreen />
    </MemoryRouter>,
  );
}

describe('SyncSettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncConfig = null;
    mockLastSynced = null;
    mockSaveSyncConfig.mockResolvedValue(undefined);
    mockTriggerSync.mockResolvedValue({ lastSynced: '2026-03-17T12:00:00Z', error: null });
    mockGetSyncStatus.mockReturnValue({ isSyncing: false });
    mockValidateMasterPassword.mockResolvedValue(true);
  });

  it('renders provider picker with all options', async () => {
    renderSyncSettings();
    // Wait for async getInitialState to settle
    await waitFor(() => {
      expect(screen.getByText('Sync Settings')).toBeInTheDocument();
    });
    expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(screen.getByText('WebDAV')).toBeInTheDocument();
    expect(screen.getByText('Google Drive')).toBeInTheDocument();
    expect(screen.getByText('Dropbox')).toBeInTheDocument();
    expect(screen.getByText('OneDrive')).toBeInTheDocument();
  });

  it('shows WebDAV fields when WebDAV is selected', async () => {
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });
    const select = screen.getByTestId('sync-provider');
    fireEvent.change(select, { target: { value: 'webdav' } });
    expect(screen.getByTestId('sync-webdav-url')).toBeInTheDocument();
    expect(screen.getByTestId('sync-webdav-username')).toBeInTheDocument();
    expect(screen.getByTestId('sync-webdav-password')).toBeInTheDocument();
  });

  it('Connect button is disabled until all WebDAV fields are filled', async () => {
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });
    const select = screen.getByTestId('sync-provider');
    fireEvent.change(select, { target: { value: 'webdav' } });
    const connectButton = screen.getByRole('button', { name: /^Connect/ });
    expect(connectButton).toBeDisabled();
  });

  it('Connect button is disabled until master password is filled', async () => {
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });
    const select = screen.getByTestId('sync-provider');
    fireEvent.change(select, { target: { value: 'webdav' } });

    const urlInput = screen.getByTestId('sync-webdav-url');
    const usernameInput = screen.getByTestId('sync-webdav-username');
    const passwordInput = screen.getByTestId('sync-webdav-password');

    fireEvent.change(urlInput, { target: { value: 'https://dav.example.com/keykeykey/' } });
    fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    fireEvent.change(passwordInput, { target: { value: 'testpass' } });

    // All WebDAV fields filled but master password still empty — Connect must stay disabled
    const connectButton = screen.getByRole('button', { name: /^Connect/ });
    expect(connectButton).toBeDisabled();

    // Fill master password — Connect should become enabled
    const masterPasswordInput = screen.getByTestId('sync-master-password');
    fireEvent.change(masterPasswordInput, { target: { value: 'masterpass' } });
    expect(connectButton).not.toBeDisabled();
  });

  it('calls saveSyncConfig on Connect with WebDAV config', async () => {
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });
    const select = screen.getByTestId('sync-provider');
    fireEvent.change(select, { target: { value: 'webdav' } });

    const urlInput = screen.getByTestId('sync-webdav-url');
    const usernameInput = screen.getByTestId('sync-webdav-username');
    const passwordInput = screen.getByTestId('sync-webdav-password');
    const masterPasswordInput = screen.getByTestId('sync-master-password');

    fireEvent.change(urlInput, { target: { value: 'https://dav.example.com/keykeykey/' } });
    fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    fireEvent.change(passwordInput, { target: { value: 'testpass' } });
    fireEvent.change(masterPasswordInput, { target: { value: 'masterpass' } });

    const connectButton = screen.getByRole('button', { name: /^Connect/ });
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({
        provider: 'webdav',
        masterPassword: 'masterpass',
        webdav: {
          url: 'https://dav.example.com/keykeykey/',
          username: 'testuser',
          password: 'testpass',
        },
      });
    });
  });

  it('shows Disconnect and Sync Now when connected', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: {
        url: 'https://dav.example.com/keykeykey/',
        username: 'testuser',
        password: 'testpass',
      },
    };
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sync Now' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });

  it('calls triggerSync on Sync Now', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: {
        url: 'https://dav.example.com/keykeykey/',
        username: 'testuser',
        password: 'testpass',
      },
    };
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sync Now' })).toBeInTheDocument();
    });
    const syncNowButton = screen.getByRole('button', { name: 'Sync Now' });
    fireEvent.click(syncNowButton);

    await waitFor(() => {
      expect(mockTriggerSync).toHaveBeenCalled();
    });
  });

  it('shows confirmation dialog and disconnects on confirm', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: {
        url: 'https://dav.example.com/keykeykey/',
        username: 'testuser',
        password: 'testpass',
      },
    };
    renderSyncSettings();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    });

    // Click Disconnect — should show confirmation dialog
    const disconnectButton = screen.getByRole('button', { name: 'Disconnect' });
    fireEvent.click(disconnectButton);
    expect(screen.getByText('Disconnect Sync')).toBeInTheDocument();
    expect(screen.getByText(/re-enter your credentials/)).toBeInTheDocument();

    // Confirm disconnect
    const confirmButton = screen.getAllByRole('button', { name: 'Disconnect' });
    // The confirm button is the one inside the dialog (last one)
    fireEvent.click(confirmButton[confirmButton.length - 1]);

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({ provider: 'none' });
    });
  });

  it('shows Sign in with Google button for google-drive', async () => {
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });
    const select = screen.getByTestId('sync-provider');
    fireEvent.change(select, { target: { value: 'google-drive' } });
    expect(screen.getByText(/Sign in with Google/i)).toBeInTheDocument();
  });

  it('shows Sign in with Dropbox button for dropbox', async () => {
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });
    const select = screen.getByTestId('sync-provider');
    fireEvent.change(select, { target: { value: 'dropbox' } });
    expect(screen.getByText(/Sign in with Dropbox/i)).toBeInTheDocument();
  });

  it('shows Sign in with Microsoft button for onedrive', async () => {
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });
    const select = screen.getByTestId('sync-provider');
    fireEvent.change(select, { target: { value: 'onedrive' } });
    // The shared ProviderSelector uses "OneDrive" label
    expect(screen.getByText(/Sign in with OneDrive/i)).toBeInTheDocument();
  });

  it('navigates back on back button click', async () => {
    renderSyncSettings();
    await waitFor(() => {
      expect(screen.getByText('Sync Settings')).toBeInTheDocument();
    });
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]!);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('displays sync error when triggerSync fails', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: {
        url: 'https://dav.example.com/keykeykey/',
        username: 'testuser',
        password: 'testpass',
      },
    };
    mockTriggerSync.mockResolvedValue({ lastSynced: null, error: 'Connection refused' });
    renderSyncSettings();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sync Now' })).toBeInTheDocument();
    });

    const syncNowButton = screen.getByRole('button', { name: 'Sync Now' });
    fireEvent.click(syncNowButton);

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
  });
});
