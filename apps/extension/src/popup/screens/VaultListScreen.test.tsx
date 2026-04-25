import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// --- Browser mock ---
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: vi.fn() } },
}));

vi.mock('../components/icons/index.js', () => ({
  SyncIcon: () => 'SyncIcon',
  PlusIcon: () => 'PlusIcon',
  DiceIcon: () => 'DiceIcon',
  ShieldIcon: () => 'ShieldIcon',
  LockIcon: () => 'LockIcon',
  GearIcon: () => 'GearIcon',
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

import { VaultListScreen } from './VaultListScreen.js';
import type { VaultItem } from '@keykeykey/core';

const sampleItems: VaultItem[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    type: 'credential',
    name: 'GitHub',
    username: 'user@example.com',
    password: 'secret123',
    passwordHistory: [],
    url: 'https://github.com',
    notes: '',
    tags: [],
    favorite: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    type: 'credential',
    name: 'GitLab',
    username: 'admin@example.com',
    password: 'secret456',
    passwordHistory: [],
    url: 'https://gitlab.com',
    notes: '',
    tags: [],
    favorite: true,
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
];

function renderVaultList(onNavigate = vi.fn(), onLock = vi.fn()) {
  return render(<VaultListScreen onNavigate={onNavigate} onLock={onLock} />);
}

describe('VaultListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header and search input', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: [] };
    });
    renderVaultList();
    expect(screen.getByText('KeyKeyKey')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search vault/i)).toBeInTheDocument();
  });

  it('renders items returned from GET_ITEMS', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: sampleItems };
    });
    renderVaultList();

    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('GitLab')).toBeInTheDocument();
    });
  });

  it('calls GET_ACTIVE_TAB_URL and GET_ITEMS on mount', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: [] };
    });
    renderVaultList();

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ACTIVE_TAB_URL' });
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ITEMS' });
    });
  });

  it('shows empty state when no items', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: [] };
    });
    renderVaultList();

    await waitFor(() => {
      expect(screen.getByText(/no items yet/i)).toBeInTheDocument();
    });
  });

  it('sends SEARCH message when query changes', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: sampleItems };
    });
    renderVaultList();

    // Wait for initial load
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ITEMS' });
    });

    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      if (msg.type === 'SEARCH') return { items: [sampleItems[0]!] };
      return { items: sampleItems };
    });

    fireEvent.change(screen.getByPlaceholderText(/search vault/i), {
      target: { value: 'GitHub' },
    });

    await waitFor(
      () => {
        // The default tab is "All", which sends types=undefined and
        // deepFields=false. Cards/Notes tabs would set types=[filter] and
        // deepFields=true respectively.
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'SEARCH',
          query: 'GitHub',
          types: undefined,
          deepFields: false,
        });
      },
      { timeout: 1000 },
    );
  });

  it('navigates to detail screen on item click', async () => {
    const onNavigate = vi.fn();
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: sampleItems };
    });
    renderVaultList(onNavigate);

    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('GitHub'));

    expect(onNavigate).toHaveBeenCalledWith(`detail:${sampleItems[0]!.id}`);
  });

  it('navigates to add screen when + button is clicked', async () => {
    const onNavigate = vi.fn();
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: [] };
    });
    renderVaultList(onNavigate);

    await waitFor(() => {
      expect(screen.getByLabelText('Add item')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Add item'));
    expect(onNavigate).toHaveBeenCalledWith('add');
  });

  it('navigates to settings when settings button is clicked', async () => {
    const onNavigate = vi.fn();
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: [] };
    });
    renderVaultList(onNavigate);

    await waitFor(() => {
      expect(screen.getByLabelText('Settings')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Settings'));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('shows no results when search finds nothing', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: [] };
    });
    renderVaultList();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/search vault/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/search vault/i), {
      target: { value: 'xyznotfound' },
    });

    await waitFor(
      () => {
        expect(screen.getByText('No results found.')).toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });

  it('shows "For this site" section when active tab has matching credentials', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: 'https://github.com/login' };
      if (msg.type === 'GET_ITEMS_FOR_HOST')
        return {
          items: sampleItems,
          matchedIds: [sampleItems[0]!.id],
        };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: sampleItems };
    });
    renderVaultList();

    await waitFor(() => {
      expect(screen.getByText('For this site')).toBeInTheDocument();
      expect(screen.getByText('All items')).toBeInTheDocument();
    });
  });

  it('renders fill button for credential items', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: sampleItems };
    });
    renderVaultList();

    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });

    const fillButtons = screen.getAllByLabelText('Fill credentials');
    expect(fillButtons).toHaveLength(2);
  });

  it('does not show "For this site" when no tab URL', async () => {
    mockSendMessage.mockImplementation(async (msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') return { url: null };
      if (msg.type === 'GET_ITEMS') return { items: sampleItems };
      if (msg.type === 'GET_SYNC_STATUS') return { provider: 'none' };
      return { items: sampleItems };
    });
    renderVaultList();

    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });

    expect(screen.queryByText('For this site')).not.toBeInTheDocument();
  });
});
