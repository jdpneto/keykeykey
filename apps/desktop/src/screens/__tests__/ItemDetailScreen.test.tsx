import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

const mockRestore = vi.fn();
const mockToastShow = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    items: [
      {
        id: 'cred-1',
        type: 'credential',
        name: 'GitHub',
        username: 'me',
        password: 'curr',
        passwordHistory: [
          { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
          { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
        ],
        tags: [],
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-21T10:00:00.000Z',
      },
    ],
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    restorePasswordFromHistory: mockRestore,
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
        sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 34 },
        weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
      },
    },
    mode: 'light',
    setMode: vi.fn(),
    isDark: false,
  }),
}));

vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../lib/clipboard', () => ({
  copyWithAutoClear: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../components/ui/TotpCodeDisplay', () => ({
  TotpCodeDisplay: () => null,
}));

import { ItemDetailScreen } from '../ItemDetailScreen';

function renderItemDetail() {
  return render(
    <MemoryRouter initialEntries={['/item/cred-1']}>
      <Routes>
        <Route path="/item/:id" element={<ItemDetailScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ItemDetailScreen — password history restore', () => {
  beforeEach(() => {
    mockRestore.mockClear();
    mockToastShow.mockClear();
    mockNavigate.mockClear();
  });

  it('renders a Restore button per history row', () => {
    renderItemDetail();
    fireEvent.click(screen.getByRole('button', { name: /password history/i }));
    const restoreButtons = screen.getAllByRole('button', { name: /restore this password/i });
    expect(restoreButtons).toHaveLength(2);
  });

  it('calls restorePasswordFromHistory with the original index when clicked', () => {
    renderItemDetail();
    fireEvent.click(screen.getByRole('button', { name: /password history/i }));
    const restoreButtons = screen.getAllByRole('button', { name: /restore this password/i });
    // The list renders newest-first (index 0 in the rendered list = index 1 in
    // the original passwordHistory array — i.e. p2). Click the first row.
    fireEvent.click(restoreButtons[0]);
    expect(mockRestore).toHaveBeenCalledWith('cred-1', 1);
    expect(mockToastShow).toHaveBeenCalledWith(expect.stringMatching(/Password restored/));
  });
});
