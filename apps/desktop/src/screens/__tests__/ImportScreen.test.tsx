import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockAddItems = vi.fn();
const mockSetBusy = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    items: [],
    addItems: mockAddItems,
    setBusy: mockSetBusy,
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
  }),
}));

import { ImportScreen } from '../ImportScreen';

function renderImportScreen() {
  return render(
    <MemoryRouter>
      <ImportScreen />
    </MemoryRouter>,
  );
}

describe('ImportScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the KeyKeyKey source badge for KeyKeyKey export CSV files', async () => {
    const { container } = renderImportScreen();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const csv = [
      'name,url,username,password,notes,totp,folder,favorite',
      'GitHub,https://github.com,csv-github,csv-pass-1,,,,false',
    ].join('\n');
    const file = new File([csv], 'keykeykey-export-2026-05-02.csv', { type: 'text/csv' });

    fireEvent.change(input, { target: { files: [file] } });

    const sourceLabel = await screen.findByText('Source:');
    expect(sourceLabel).toBeInTheDocument();
    expect(within(sourceLabel.parentElement!).getByText('KeyKeyKey')).toBeInTheDocument();
  });
});
