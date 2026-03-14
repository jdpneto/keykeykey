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

import { UnlockScreen } from './UnlockScreen.js';

function renderUnlock(hasPIN = false, onUnlock = vi.fn()) {
  return render(<UnlockScreen hasPIN={hasPIN} onUnlock={onUnlock} />);
}

describe('UnlockScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the unlock form with password input', () => {
    renderUnlock();
    expect(screen.getByText('Unlock Vault')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Master password')).toBeInTheDocument();
  });

  it('sends UNLOCK message with password on submit', async () => {
    const onUnlock = vi.fn();
    mockSendMessage.mockResolvedValue({ ok: true });

    renderUnlock(false, onUnlock);

    fireEvent.change(screen.getByPlaceholderText('Master password'), {
      target: { value: 'mypassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'UNLOCK',
        password: 'mypassword',
      });
    });
  });

  it('calls onUnlock on successful unlock', async () => {
    const onUnlock = vi.fn();
    mockSendMessage.mockResolvedValue({ ok: true });

    renderUnlock(false, onUnlock);

    fireEvent.change(screen.getByPlaceholderText('Master password'), {
      target: { value: 'mypassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalled();
    });
  });

  it('shows error message on failed unlock', async () => {
    const onUnlock = vi.fn();
    mockSendMessage.mockResolvedValue({ error: 'Invalid password' });

    renderUnlock(false, onUnlock);

    fireEvent.change(screen.getByPlaceholderText('Master password'), {
      target: { value: 'wrongpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid password')).toBeInTheDocument();
    });
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('shows toggle link when hasPIN is true', () => {
    renderUnlock(true);
    expect(screen.getByText('Use PIN instead')).toBeInTheDocument();
  });

  it('shows PinPad when hasPIN is true and toggle is clicked', async () => {
    renderUnlock(true);

    fireEvent.click(screen.getByText('Use PIN instead'));

    await waitFor(() => {
      // PinPad renders digit buttons 1-9 and 0
      expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument();
    });
  });

  it('sends UNLOCK_PIN message when PIN is submitted via PinPad', async () => {
    const onUnlock = vi.fn();
    mockSendMessage.mockResolvedValue({ ok: true });

    renderUnlock(true, onUnlock);

    // Switch to PIN mode
    fireEvent.click(screen.getByText('Use PIN instead'));

    // Enter 6-digit PIN
    await waitFor(() => screen.getByRole('button', { name: '1' }));
    for (const digit of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(screen.getByRole('button', { name: digit }));
    }

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'UNLOCK_PIN',
        pin: '123456',
      });
    });
  });

  it('shows toggle back to password when in PIN mode', async () => {
    renderUnlock(true);

    fireEvent.click(screen.getByText('Use PIN instead'));

    await waitFor(() => {
      expect(screen.getByText('Use master password instead')).toBeInTheDocument();
    });
  });
});
