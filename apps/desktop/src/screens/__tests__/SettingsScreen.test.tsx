import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockLock = vi.fn();
const mockResetVault = vi.fn();
const mockEnablePin = vi.fn();
const mockDisablePin = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    lock: mockLock,
    pinConfigured: false,
    enablePin: mockEnablePin,
    disablePin: mockDisablePin,
    resetVault: mockResetVault,
    syncConfig: null,
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

vi.mock('@keykeykey/core/pin', () => ({
  validatePin: vi.fn(() => ({ valid: true })),
}));

import { SettingsScreen } from '../SettingsScreen';

function renderSettings() {
  return render(
    <MemoryRouter>
      <SettingsScreen />
    </MemoryRouter>,
  );
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders settings title', () => {
    renderSettings();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  describe('reset vault', () => {
    it('should show Danger Zone with Reset Vault option', () => {
      renderSettings();
      expect(screen.getByText('Danger Zone')).toBeInTheDocument();
      expect(screen.getByText('Reset Vault')).toBeInTheDocument();
      expect(
        screen.getByText('Permanently delete all vault data from this device'),
      ).toBeInTheDocument();
    });

    it('should show confirmation dialog when Reset Vault is clicked', async () => {
      renderSettings();
      fireEvent.click(screen.getByText('Reset Vault'));

      await waitFor(() => {
        expect(screen.getByText('Reset Vault?')).toBeInTheDocument();
        expect(
          screen.getByText('This will permanently delete your vault from this device.', {
            exact: false,
          }),
        ).toBeInTheDocument();
      });
    });

    it('should call resetVault when confirmed', async () => {
      mockResetVault.mockResolvedValue(undefined);
      renderSettings();
      fireEvent.click(screen.getByText('Reset Vault'));

      await waitFor(() => {
        expect(screen.getByText('Reset Vault?')).toBeInTheDocument();
      });

      // Click the confirm button in the dialog
      const confirmButtons = screen.getAllByText('Reset Vault');
      fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

      await waitFor(() => {
        expect(mockResetVault).toHaveBeenCalled();
      });
    });

    it('should hide dialog when Cancel is clicked', async () => {
      renderSettings();
      fireEvent.click(screen.getByText('Reset Vault'));

      await waitFor(() => {
        expect(screen.getByText('Reset Vault?')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Cancel'));

      await waitFor(() => {
        expect(screen.queryByText('Reset Vault?')).not.toBeInTheDocument();
      });
    });
  });
});
