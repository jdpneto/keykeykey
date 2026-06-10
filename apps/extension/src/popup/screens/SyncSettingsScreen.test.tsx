import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('offers only None and WebDAV as provider options', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['None', 'WebDAV']);
  });

  it('does not show iCloud option', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('sync-provider')).toBeInTheDocument();
    });

    expect(screen.queryByText('iCloud (Coming Soon)')).not.toBeInTheDocument();
  });

  it('shows connected state when provider is webdav', async () => {
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_SYNC_STATUS')
        return Promise.resolve({
          provider: 'webdav',
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
});
