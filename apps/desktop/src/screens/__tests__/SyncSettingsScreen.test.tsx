import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockSaveSyncConfig = vi.fn().mockResolvedValue(undefined);
const mockTriggerSync = vi
  .fn()
  .mockResolvedValue({ lastSynced: '2026-03-17T12:00:00Z', error: null });
const mockGetSyncStatus = vi.fn(() => ({ isSyncing: false }));
const mockNavigate = vi.fn();
import type { SyncConfig } from '@keykeykey/core/sync';
let mockSyncConfig: SyncConfig | null = null;

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    syncConfig: mockSyncConfig,
    syncReady: true,
    saveSyncConfig: mockSaveSyncConfig,
    triggerSync: mockTriggerSync,
    getSyncStatus: mockGetSyncStatus,
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
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
      radii: { sm: 6, md: 10, lg: 16, full: 9999 },
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
    mockSaveSyncConfig.mockResolvedValue(undefined);
    mockTriggerSync.mockResolvedValue({ lastSynced: '2026-03-17T12:00:00Z', error: null });
    mockGetSyncStatus.mockReturnValue({ isSyncing: false });
  });

  it('renders provider picker with all options', () => {
    renderSyncSettings();
    expect(screen.getByText('Sync Settings')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('None (Local Only)')).toBeInTheDocument();
    expect(screen.getByText('WebDAV')).toBeInTheDocument();
    expect(screen.getByText('Google Drive (Coming Soon)')).toBeInTheDocument();
    expect(screen.getByText('iCloud (Coming Soon)')).toBeInTheDocument();
  });

  it('disables Google Drive and iCloud options', () => {
    renderSyncSettings();
    const googleDriveOption = screen.getByText('Google Drive (Coming Soon)');
    const icloudOption = screen.getByText('iCloud (Coming Soon)');
    expect(googleDriveOption).toHaveProperty('disabled', true);
    expect(icloudOption).toHaveProperty('disabled', true);
  });

  it('shows WebDAV fields when WebDAV is selected', () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'webdav' } });
    expect(screen.getByPlaceholderText('https://dav.example.com/keykeykey/')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('your-username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('your-password')).toBeInTheDocument();
  });

  it('Connect button is disabled until all WebDAV fields are filled', () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'webdav' } });
    const connectButton = screen.getByRole('button', { name: 'Connect' });
    expect(connectButton).toBeDisabled();
  });

  it('calls saveSyncConfig on Connect with WebDAV config', async () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'webdav' } });

    const urlInput = screen.getByPlaceholderText('https://dav.example.com/keykeykey/');
    const usernameInput = screen.getByPlaceholderText('your-username');
    const passwordInput = screen.getByPlaceholderText('your-password');

    fireEvent.change(urlInput, { target: { value: 'https://dav.example.com/keykeykey/' } });
    fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    fireEvent.change(passwordInput, { target: { value: 'testpass' } });

    const connectButton = screen.getByRole('button', { name: 'Connect' });
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith(
        {
          provider: 'webdav',
          webdav: {
            url: 'https://dav.example.com/keykeykey/',
            username: 'testuser',
            password: 'testpass',
          },
        },
        undefined, // masterPassword — not needed when syncReady is true
      );
    });
  });

  it('shows Disconnect and Sync Now when connected', () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: {
        url: 'https://dav.example.com/keykeykey/',
        username: 'testuser',
        password: 'testpass',
      },
    };
    renderSyncSettings();
    expect(screen.getByRole('button', { name: 'Sync Now' })).toBeInTheDocument();
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

    // Click Disconnect — should show confirmation dialog
    const disconnectButton = screen.getByRole('button', { name: 'Disconnect' });
    fireEvent.click(disconnectButton);
    expect(screen.getByText('Disconnect Sync')).toBeInTheDocument();
    expect(screen.getByText(/re-enter your credentials/)).toBeInTheDocument();

    // Confirm disconnect
    const confirmButton = screen.getAllByRole('button', { name: 'Disconnect' });
    // The confirm button is the one inside the dialog (second one)
    fireEvent.click(confirmButton[confirmButton.length - 1]);

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({ provider: 'none' });
    });
  });

  it('shows coming soon banner for google-drive', () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'google-drive' } });
    expect(screen.getByText(/not yet available/i)).toBeInTheDocument();
  });

  it('navigates back on back button click', () => {
    renderSyncSettings();
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

    const syncNowButton = screen.getByRole('button', { name: 'Sync Now' });
    fireEvent.click(syncNowButton);

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
  });
});
