import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// --- Theme mock ---
vi.mock('../../../lib/theme.js', () => ({
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

// --- TOTP mock ---
vi.mock('../../../lib/totp.js', () => ({
  generateTotp: vi.fn().mockReturnValue({ code: '123456', secondsRemaining: 30 }),
}));

// --- sendMessage mock ---
const mockSendMessage = vi.fn().mockResolvedValue({ ok: true });

vi.mock('../../hooks/useMessage.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

import { CredentialDetailScreen } from '../CredentialDetailScreen.js';

const baseItem = {
  id: 'cred-1',
  type: 'credential' as const,
  name: 'GitHub',
  username: 'me',
  password: 'curr',
  passwordHistory: [
    { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
    { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
  ],
  tags: [],
  url: undefined,
  notes: undefined,
  appIdentifiers: undefined,
  totp: undefined,
  favorite: false,
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-21T10:00:00.000Z',
};

describe('CredentialDetailScreen — password history restore', () => {
  beforeEach(() => mockSendMessage.mockClear());

  it('sends UPDATE_ITEM with the rebuilt payload when Restore is clicked', async () => {
    const onRefreshItems = vi.fn().mockResolvedValue(undefined);
    render(
      <CredentialDetailScreen
        item={baseItem}
        onNavigate={vi.fn()}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onRefreshItems={onRefreshItems}
      />,
    );
    // Expand the history — there are multiple "Show" buttons (password field + history section).
    // The history Show/Hide button is the last one before the Restore buttons appear.
    const showButtons = screen.getAllByRole('button', { name: /^show$/i });
    fireEvent.click(showButtons[showButtons.length - 1]);
    // Two restore buttons appear (one per entry, reversed-list order).
    const restoreButtons = screen.getAllByRole('button', { name: /restore this password/i });
    expect(restoreButtons).toHaveLength(2);
    // Click the first row (reversed index 0 → original index 1 → 'p2').
    fireEvent.click(restoreButtons[0]);

    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'UPDATE_ITEM',
        id: 'cred-1',
        updates: {
          password: 'p2',
          passwordHistory: [
            { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
            // displaced 'curr' lands at the end with the call's timestamp
            expect.objectContaining({ password: 'curr' }),
          ],
        },
      }),
    );

    // onRefreshItems must be called after the restore so the popup's items
    // snapshot is refreshed (GET_ITEMS) and the UI shows the swapped password.
    await waitFor(() => expect(onRefreshItems).toHaveBeenCalledTimes(1));
  });
});
