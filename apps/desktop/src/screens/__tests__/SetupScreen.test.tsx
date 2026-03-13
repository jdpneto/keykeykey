import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockSetupVault = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    setupVault: mockSetupVault,
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
        sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 24, '2xl': 32 },
        weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
      },
    },
    mode: 'light',
    setMode: vi.fn(),
    isDark: false,
  }),
}));

import { SetupScreen } from '../SetupScreen';

function renderSetup() {
  return render(
    <MemoryRouter>
      <SetupScreen />
    </MemoryRouter>,
  );
}

describe('SetupScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and password inputs', () => {
    renderSetup();
    expect(screen.getByText('Create Your Vault')).toBeInTheDocument();
    expect(screen.getByLabelText('Master Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
  });

  it('shows requirement indicators', () => {
    renderSetup();
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords match')).toBeInTheDocument();
  });

  it('disables button when requirements are not met', () => {
    renderSetup();
    const button = screen.getByRole('button', { name: /create vault/i });
    expect(button).toBeDisabled();
  });

  it('calls setupVault and navigates on success', async () => {
    mockSetupVault.mockResolvedValue('AAAA-BBBB-CCCC-DDDD');
    renderSetup();

    const passwordInput = screen.getByLabelText('Master Password');
    const confirmInput = screen.getByLabelText('Confirm Password');

    fireEvent.change(passwordInput, { target: { value: 'StrongPass123!' } });
    fireEvent.change(confirmInput, { target: { value: 'StrongPass123!' } });

    const button = screen.getByRole('button', { name: /create vault/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockSetupVault).toHaveBeenCalledWith('StrongPass123!');
      expect(mockNavigate).toHaveBeenCalledWith('/recovery', { replace: true });
    });
  });

  it('shows error when setup fails', async () => {
    mockSetupVault.mockRejectedValue(new Error('Setup failed'));
    renderSetup();

    fireEvent.change(screen.getByLabelText('Master Password'), { target: { value: 'StrongPass123!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'StrongPass123!' } });

    fireEvent.click(screen.getByRole('button', { name: /create vault/i }));

    await waitFor(() => {
      expect(screen.getByText('Setup failed')).toBeInTheDocument();
    });
  });
});
