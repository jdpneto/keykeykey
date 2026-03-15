import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// --- Browser mock ---
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: vi.fn() } },
}));

const mockSetMode = vi.fn();

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
    setMode: mockSetMode,
    isDark: false,
  }),
}));

const mockSendMessage = vi.fn();

vi.mock('../hooks/useMessage.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

import { SettingsScreen } from './SettingsScreen.js';

const defaultSettings = {
  autoLockMode: 'timed',
  autoLockMinutes: 15,
  themeMode: 'system',
};

const defaultSyncStatus = {
  provider: 'none',
  lastSynced: null,
  isSyncing: false,
};

const defaultStatus = {
  status: 'unlocked',
  hasPIN: false,
  itemCount: 0,
};

function renderSettings(props: { onBack?: () => void; onRefresh?: () => void } = {}) {
  return render(
    <SettingsScreen onBack={props.onBack ?? vi.fn()} onRefresh={props.onRefresh ?? vi.fn()} />,
  );
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_SETTINGS') return Promise.resolve(defaultSettings);
      if (msg.type === 'GET_SYNC_STATUS') return Promise.resolve(defaultSyncStatus);
      if (msg.type === 'GET_STATUS') return Promise.resolve(defaultStatus);
      return Promise.resolve({ ok: true });
    });
  });

  it('renders settings sections after loading', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    expect(screen.getByText(/Cloud Sync/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto-Lock/i)).toBeInTheDocument();
    expect(screen.getByText(/Appearance/i)).toBeInTheDocument();
    expect(screen.getByText(/Security/i)).toBeInTheDocument();
    expect(screen.getByText(/About/i)).toBeInTheDocument();
  });

  it('displays version number', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('v0.0.1')).toBeInTheDocument();
    });
  });

  it('calls setMode when theme button clicked', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Dark')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Dark'));

    expect(mockSetMode).toHaveBeenCalledWith('dark');
  });

  it('sends UPDATE_SETTINGS when theme changes', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Light')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Light'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_SETTINGS',
          settings: expect.objectContaining({ themeMode: 'light' }),
        }),
      );
    });
  });

  it('sends LOCK message when Lock Vault button clicked', async () => {
    const onRefresh = vi.fn();
    renderSettings({ onRefresh });

    await waitFor(() => {
      expect(screen.getByText('Lock Vault')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Lock Vault'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'LOCK' });
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn();
    renderSettings({ onBack });

    await waitFor(() => {
      expect(screen.getByLabelText('Back')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows Set PIN button when no PIN is configured', async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Set PIN')).toBeInTheDocument();
    });
  });

  it('shows Change PIN and Remove PIN buttons when PIN is configured', async () => {
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_SETTINGS') return Promise.resolve(defaultSettings);
      if (msg.type === 'GET_SYNC_STATUS') return Promise.resolve(defaultSyncStatus);
      if (msg.type === 'GET_STATUS') return Promise.resolve({ ...defaultStatus, hasPIN: true });
      return Promise.resolve({ ok: true });
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Change PIN')).toBeInTheDocument();
      expect(screen.getByText('Remove PIN')).toBeInTheDocument();
    });
  });

  it('sends REMOVE_PIN when Remove PIN is clicked', async () => {
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_SETTINGS') return Promise.resolve(defaultSettings);
      if (msg.type === 'GET_SYNC_STATUS') return Promise.resolve(defaultSyncStatus);
      if (msg.type === 'GET_STATUS') return Promise.resolve({ ...defaultStatus, hasPIN: true });
      return Promise.resolve({ ok: true });
    });

    renderSettings();

    await waitFor(() => {
      expect(screen.getByText('Remove PIN')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Remove PIN'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'REMOVE_PIN' });
    });
  });

  describe('reset vault', () => {
    it('should show Danger Zone section', async () => {
      renderSettings();

      await waitFor(() => {
        expect(screen.getByText('Danger Zone')).toBeInTheDocument();
      });

      expect(screen.getByText('Reset Vault')).toBeInTheDocument();
      expect(
        screen.getByText(
          /Permanently delete all vault data including credentials, cards, and notes/,
        ),
      ).toBeInTheDocument();
    });

    it('should show confirmation when Reset Vault is clicked', async () => {
      renderSettings();

      await waitFor(() => {
        expect(screen.getByText('Reset Vault')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Reset Vault'));

      await waitFor(() => {
        expect(
          screen.getByText('Are you sure? All data will be permanently lost.'),
        ).toBeInTheDocument();
        expect(screen.getByText('Yes, Reset Vault')).toBeInTheDocument();
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });
    });

    it('should send RESET_VAULT when confirmed', async () => {
      const onRefresh = vi.fn();
      renderSettings({ onRefresh });

      await waitFor(() => {
        expect(screen.getByText('Reset Vault')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Reset Vault'));

      await waitFor(() => {
        expect(screen.getByText('Yes, Reset Vault')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Yes, Reset Vault'));

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({ type: 'RESET_VAULT' });
      });
    });

    it('should hide confirmation when cancel is clicked', async () => {
      renderSettings();

      await waitFor(() => {
        expect(screen.getByText('Reset Vault')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Reset Vault'));

      await waitFor(() => {
        expect(screen.getByText('Cancel')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.getByText('Reset Vault')).toBeInTheDocument();
        expect(
          screen.queryByText('Are you sure? All data will be permanently lost.'),
        ).not.toBeInTheDocument();
      });
    });
  });
});
