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

import { SetupScreen } from './SetupScreen.js';

const mockSendMessage = vi.fn();

vi.mock('../hooks/useMessage.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

function renderSetup(onComplete = vi.fn()) {
  return render(<SetupScreen onComplete={onComplete} />);
}

describe('SetupScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the setup form', () => {
    renderSetup();
    expect(screen.getByText('Create Your Vault')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('At least 8 characters')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Repeat your password')).toBeInTheDocument();
  });

  it('shows error when password is too short', async () => {
    renderSetup();

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create vault/i }));

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('shows error when passwords do not match', async () => {
    renderSetup();

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), {
      target: { value: 'different123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create vault/i }));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('calls sendMessage with SETUP type on valid submission', async () => {
    const onComplete = vi.fn();
    mockSendMessage.mockResolvedValue({ recoveryKey: 'test-recovery-key-abc123' });

    renderSetup(onComplete);

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
      target: { value: 'ValidPassword1!' },
    });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), {
      target: { value: 'ValidPassword1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create vault/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'SETUP',
        password: 'ValidPassword1!',
      });
    });
  });

  it('calls onComplete with recovery key on successful setup', async () => {
    const onComplete = vi.fn();
    mockSendMessage.mockResolvedValue({ recoveryKey: 'test-recovery-key-abc123' });

    renderSetup(onComplete);

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
      target: { value: 'ValidPassword1!' },
    });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), {
      target: { value: 'ValidPassword1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create vault/i }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith('test-recovery-key-abc123');
    });
  });

  it('shows error message returned from background on setup failure', async () => {
    const onComplete = vi.fn();
    mockSendMessage.mockResolvedValue({ error: 'Setup failed on server' });

    renderSetup(onComplete);

    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), {
      target: { value: 'ValidPassword1!' },
    });
    fireEvent.change(screen.getByPlaceholderText('Repeat your password'), {
      target: { value: 'ValidPassword1!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create vault/i }));

    await waitFor(() => {
      expect(screen.getByText('Setup failed on server')).toBeInTheDocument();
    });
    expect(onComplete).not.toHaveBeenCalled();
  });
});
