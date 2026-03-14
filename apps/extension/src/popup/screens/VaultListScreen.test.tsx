import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// --- Browser mock ---
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: vi.fn() } },
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
    url: 'https://gitlab.com',
    notes: '',
    tags: [],
    favorite: true,
    createdAt: '2024-01-02T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
];

function renderVaultList(onNavigate = vi.fn()) {
  return render(<VaultListScreen onNavigate={onNavigate} />);
}

describe('VaultListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header and search input', async () => {
    mockSendMessage.mockResolvedValue({ items: [] });
    renderVaultList();
    expect(screen.getByText('KeyKeyKey')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search vault/i)).toBeInTheDocument();
  });

  it('renders items returned from GET_ITEMS', async () => {
    mockSendMessage.mockResolvedValue({ items: sampleItems });
    renderVaultList();

    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('GitLab')).toBeInTheDocument();
    });
  });

  it('calls GET_ITEMS on mount', async () => {
    mockSendMessage.mockResolvedValue({ items: [] });
    renderVaultList();

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ITEMS' });
    });
  });

  it('shows empty state when no items', async () => {
    mockSendMessage.mockResolvedValue({ items: [] });
    renderVaultList();

    await waitFor(() => {
      expect(screen.getByText(/no items yet/i)).toBeInTheDocument();
    });
  });

  it('sends SEARCH message when query changes', async () => {
    mockSendMessage.mockResolvedValue({ items: sampleItems });
    renderVaultList();

    // Wait for initial load
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ITEMS' });
    });

    mockSendMessage.mockResolvedValue({ items: [sampleItems[0]!] });

    fireEvent.change(screen.getByPlaceholderText(/search vault/i), {
      target: { value: 'GitHub' },
    });

    await waitFor(
      () => {
        expect(mockSendMessage).toHaveBeenCalledWith({ type: 'SEARCH', query: 'GitHub' });
      },
      { timeout: 1000 },
    );
  });

  it('navigates to detail screen on item click', async () => {
    const onNavigate = vi.fn();
    mockSendMessage.mockResolvedValue({ items: sampleItems });
    renderVaultList(onNavigate);

    await waitFor(() => {
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('GitHub'));

    expect(onNavigate).toHaveBeenCalledWith(
      `detail:${sampleItems[0]!.id}`,
    );
  });

  it('navigates to add screen when + button is clicked', async () => {
    const onNavigate = vi.fn();
    mockSendMessage.mockResolvedValue({ items: [] });
    renderVaultList(onNavigate);

    await waitFor(() => {
      expect(screen.getByTitle('Add item')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Add item'));
    expect(onNavigate).toHaveBeenCalledWith('add');
  });

  it('navigates to settings when settings button is clicked', async () => {
    const onNavigate = vi.fn();
    mockSendMessage.mockResolvedValue({ items: [] });
    renderVaultList(onNavigate);

    await waitFor(() => {
      expect(screen.getByTitle('Settings')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Settings'));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('shows no results when search finds nothing', async () => {
    mockSendMessage.mockResolvedValue({ items: [] });
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
});
