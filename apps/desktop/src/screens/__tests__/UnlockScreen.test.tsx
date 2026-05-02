import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockUnlock = vi.fn();
const mockUnlockWithPin = vi.fn();
const mockResetVault = vi.fn();
const mockNavigate = vi.fn();
let mockPinConfigured = false;

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    status: 'locked',
    unlock: mockUnlock,
    unlockWithPin: mockUnlockWithPin,
    pinConfigured: mockPinConfigured,
    biometricAvailable: false,
    unlockWithBiometric: vi.fn(),
    resetVault: mockResetVault,
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

import { UnlockScreen } from '../UnlockScreen';

function renderUnlock() {
  return render(
    <MemoryRouter>
      <UnlockScreen />
    </MemoryRouter>,
  );
}

describe('UnlockScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPinConfigured = false;
  });

  it('renders title and password input', () => {
    renderUnlock();
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByLabelText('Master Password')).toBeInTheDocument();
  });

  it('calls unlock and navigates on success', async () => {
    mockUnlock.mockResolvedValue(undefined);
    renderUnlock();

    const input = screen.getByLabelText('Master Password');
    fireEvent.change(input, { target: { value: 'mypassword' } });

    const button = screen.getByRole('button', { name: 'Unlock' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockUnlock).toHaveBeenCalledWith('mypassword');
      expect(mockNavigate).toHaveBeenCalledWith('/vault', { replace: true });
    });
  });

  it('shows error on unlock failure', async () => {
    mockUnlock.mockRejectedValue(new Error('Wrong password'));
    renderUnlock();

    const input = screen.getByLabelText('Master Password');
    fireEvent.change(input, { target: { value: 'wrong' } });

    const button = screen.getByRole('button', { name: 'Unlock' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Incorrect master password')).toBeInTheDocument();
    });
  });

  it('shows the remaining attempts after a wrong PIN', async () => {
    mockPinConfigured = true;
    mockUnlockWithPin.mockResolvedValue({ success: false, attemptsRemaining: 4 });
    renderUnlock();

    await waitFor(() => {
      expect(screen.getByLabelText('PIN')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock with PIN' }));

    await waitFor(() => {
      expect(screen.getByText('Wrong PIN. 4 attempts remaining.')).toBeInTheDocument();
    });
  });

  describe('reset vault', () => {
    it('should show Reset Vault link', () => {
      renderUnlock();
      expect(screen.getByText('Reset Vault')).toBeInTheDocument();
    });

    it('should show confirmation dialog when Reset Vault is clicked', async () => {
      renderUnlock();
      fireEvent.click(screen.getByText('Reset Vault'));

      await waitFor(() => {
        expect(screen.getByText('permanently delete', { exact: false })).toBeInTheDocument();
      });
    });

    it('should call resetVault when confirmed', async () => {
      mockResetVault.mockResolvedValue(undefined);
      renderUnlock();
      fireEvent.click(screen.getByText('Reset Vault'));

      await waitFor(() => {
        expect(screen.getByText('Reset Vault?')).toBeInTheDocument();
      });

      // Click the confirm button (the one inside the dialog, with role button)
      const confirmButtons = screen.getAllByText('Reset Vault');
      // The last one is the confirm button in the dialog
      fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

      await waitFor(() => {
        expect(mockResetVault).toHaveBeenCalled();
      });
    });

    it('should hide dialog when Cancel is clicked', async () => {
      renderUnlock();
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
