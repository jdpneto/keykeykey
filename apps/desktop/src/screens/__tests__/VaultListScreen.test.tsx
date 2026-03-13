import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { VaultItem } from '@keykeykey/core';

const mockItems: VaultItem[] = [];
const mockSearch = vi.fn(() => mockItems);
const mockNavigate = vi.fn();

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    items: mockItems,
    search: mockSearch,
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
        primary: '#A3E635', primaryMuted: '#A3E63520', background: '#FFF8F0',
        surface: '#FFFFFF', surfaceAlt: '#F5F0EB', text: '#1A1A1A',
        textSecondary: '#6B7280', border: '#E5E0DB', inputBackground: '#FFFFFF',
        error: '#EF4444', errorLight: '#FEE2E2', success: '#22C55E',
        successLight: '#DCFCE7', warning: '#F59E0B', warningLight: '#FEF3C7',
        danger: '#EF4444',
      },
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
      radii: { sm: 6, md: 10, lg: 16, full: 9999 },
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

import { VaultListScreen } from '../VaultListScreen';

function renderVaultList() {
  return render(
    <MemoryRouter>
      <VaultListScreen />
    </MemoryRouter>,
  );
}

describe('VaultListScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockItems.length = 0;
  });

  it('renders vault title', () => {
    renderVaultList();
    expect(screen.getByText('Vault')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    renderVaultList();
    expect(screen.getByText(/vault is empty/i)).toBeInTheDocument();
  });

  it('shows search input', () => {
    renderVaultList();
    expect(screen.getByPlaceholderText(/search vault/i)).toBeInTheDocument();
  });

  it('shows filter chips', () => {
    renderVaultList();
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Logins')).toBeInTheDocument();
    expect(screen.getByText('Cards')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('renders items when present', () => {
    mockItems.push(
      {
        id: '1',
        type: 'credential',
        name: 'Gmail',
        username: 'user@gmail.com',
        password: 'secret',
        favorite: false,
        tags: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    );
    renderVaultList();
    expect(screen.getByText('Gmail')).toBeInTheDocument();
  });

  it('shows no results on search with no matches', () => {
    mockSearch.mockReturnValue([]);
    renderVaultList();

    const input = screen.getByPlaceholderText(/search vault/i);
    fireEvent.change(input, { target: { value: 'nonexistent' } });

    expect(screen.getByText(/no results/i)).toBeInTheDocument();
  });
});
