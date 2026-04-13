import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// --- Browser mock ---
vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { sendMessage: vi.fn() },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
      },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  },
}));

// --- Theme mock ---
vi.mock('../../lib/theme.js', () => ({
  useTheme: () => ({
    theme: {
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
    },
    mode: 'light',
    setMode: vi.fn(),
    isDark: false,
  }),
}));

// --- Icons mock ---
vi.mock('../components/icons/index.js', () => ({
  EyeIcon: ({ size }: { size: number }) => <span data-testid="eye-icon">{size}</span>,
  EyeOffIcon: ({ size }: { size: number }) => <span data-testid="eye-off-icon">{size}</span>,
}));

const mockSendMessage = vi.fn();

vi.mock('../hooks/useMessage.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

import { SyncSettingsScreen } from './SyncSettingsScreen/index.js';

const defaultSyncStatus = {
  provider: 'none',
  lastSynced: null,
  isSyncing: false,
};

function renderScreen(props: { onBack?: () => void } = {}) {
  return render(<SyncSettingsScreen onBack={props.onBack ?? vi.fn()} />);
}

describe('SyncSettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_SYNC_STATUS') return Promise.resolve(defaultSyncStatus);
      if (msg.type === 'GET_MISMATCH_INFO') return Promise.resolve(null);
      return Promise.resolve({ ok: true });
    });
  });

  it('renders provider select after loading', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Cloud Sync')).toBeInTheDocument();
    });

    expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
  });

  it('shows Google Drive as an enabled option', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    const option = screen.getByRole('option', { name: 'Google Drive' }) as HTMLOptionElement;
    expect(option).toBeInTheDocument();
    expect(option.disabled).toBe(false);
  });

  it('shows Sign in with Google button when google-drive is selected', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-provider'), {
      target: { value: 'google-drive' },
    });

    await waitFor(() => {
      expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
    });

    expect(screen.getByTestId('sync-master-password')).toBeInTheDocument();
  });

  it('disables Sign in with Google when master password is empty', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-provider'), {
      target: { value: 'google-drive' },
    });

    await waitFor(() => {
      expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
    });

    const button = screen.getByText('Sign in with Google');
    expect(button).toBeDisabled();
  });

  it('sends GOOGLE_OAUTH_CONNECT when Sign in with Google is clicked', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-provider'), {
      target: { value: 'google-drive' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-master-password')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-master-password'), {
      target: { value: 'mypassword' },
    });

    fireEvent.click(screen.getByText('Sign in with Google'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'GOOGLE_OAUTH_CONNECT',
        masterPassword: 'mypassword',
      });
    });
  });

  it('shows connected state when provider is google-drive', async () => {
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_SYNC_STATUS')
        return Promise.resolve({
          provider: 'google-drive',
          lastSynced: '2026-01-01T00:00:00Z',
          isSyncing: false,
        });
      if (msg.type === 'GET_MISMATCH_INFO') return Promise.resolve(null);
      return Promise.resolve({ ok: true });
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Sync Now')).toBeInTheDocument();
      expect(screen.getByText('Disconnect')).toBeInTheDocument();
    });
  });

  it('shows Dropbox as an enabled option', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    const option = screen.getByRole('option', { name: 'Dropbox' }) as HTMLOptionElement;
    expect(option).toBeInTheDocument();
    expect(option.disabled).toBe(false);
  });

  it('shows OneDrive as an enabled option', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    const option = screen.getByRole('option', { name: 'OneDrive' }) as HTMLOptionElement;
    expect(option).toBeInTheDocument();
    expect(option.disabled).toBe(false);
  });

  it('shows Sign in with Dropbox button when dropbox is selected', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-provider'), {
      target: { value: 'dropbox' },
    });

    await waitFor(() => {
      expect(screen.getByText('Sign in with Dropbox')).toBeInTheDocument();
    });

    expect(screen.getByTestId('sync-master-password')).toBeInTheDocument();
  });

  it('shows Sign in with OneDrive button when onedrive is selected', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-provider'), {
      target: { value: 'onedrive' },
    });

    await waitFor(() => {
      expect(screen.getByText('Sign in with OneDrive')).toBeInTheDocument();
    });

    expect(screen.getByTestId('sync-master-password')).toBeInTheDocument();
  });

  it('sends DROPBOX_OAUTH_CONNECT when Sign in with Dropbox is clicked', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-provider'), {
      target: { value: 'dropbox' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-master-password')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-master-password'), {
      target: { value: 'mypassword' },
    });

    fireEvent.click(screen.getByText('Sign in with Dropbox'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'DROPBOX_OAUTH_CONNECT',
        masterPassword: 'mypassword',
      });
    });
  });

  it('sends ONEDRIVE_OAUTH_CONNECT when Sign in with OneDrive is clicked', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-provider'), {
      target: { value: 'onedrive' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('sync-master-password')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('sync-master-password'), {
      target: { value: 'mypassword' },
    });

    fireEvent.click(screen.getByText('Sign in with OneDrive'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'ONEDRIVE_OAUTH_CONNECT',
        masterPassword: 'mypassword',
      });
    });
  });

  it('does not show iCloud option', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    expect(screen.queryByText('iCloud (Coming Soon)')).not.toBeInTheDocument();
  });
});
