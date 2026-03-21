import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// --- Browser mock ---
vi.mock('webextension-polyfill', () => ({
  default: { runtime: { sendMessage: vi.fn() } },
}));

vi.mock('@keykeykey/core/generator', () => ({
  generatePassword: vi.fn(() => 'MockGeneratedPass1!'),
}));

vi.mock('../components/icons/index.js', () => ({
  EyeIcon: () => 'EyeIcon',
  EyeOffIcon: () => 'EyeOffIcon',
  RefreshIcon: () => 'RefreshIcon',
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

// --- Core mock ---
vi.mock('@keykeykey/core', () => ({
  extractDomainBrand: (url: string) => {
    // Simple mock: extract domain name without TLD
    try {
      const hostname = new URL(url).hostname;
      const parts = hostname.replace('www.', '').split('.');
      return parts[0] ?? '';
    } catch {
      return '';
    }
  },
  normalizeUrl: (url: string) => {
    if (!url.includes('://')) return `https://${url}`;
    return url;
  },
}));

const mockSendMessage = vi.fn();

vi.mock('../hooks/useMessage.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

import { AddItemScreen } from './AddItemScreen.js';

function renderAddItem(props: {
  onBack?: () => void;
  onNavigate?: (s: string) => void;
  onRefresh?: () => void;
}) {
  return render(
    <AddItemScreen
      onBack={props.onBack ?? vi.fn()}
      onNavigate={props.onNavigate ?? vi.fn()}
      onRefresh={props.onRefresh ?? vi.fn()}
    />,
  );
}

describe('AddItemScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the add item form', async () => {
    mockSendMessage.mockResolvedValue({ url: '' });
    renderAddItem({});
    expect(screen.getByText('Add Item')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
  });

  it('auto-fills URL from active tab for credential type', async () => {
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') {
        return Promise.resolve({ url: 'https://github.com' });
      }
      return Promise.resolve({ ok: true });
    });

    renderAddItem({});

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ACTIVE_TAB_URL' });
    });

    await waitFor(() => {
      const urlInput = screen.getByPlaceholderText('https://example.com');
      expect(urlInput).toHaveValue('https://github.com');
    });
  });

  it('auto-populates name from domain brand', async () => {
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') {
        return Promise.resolve({ url: 'https://github.com' });
      }
      return Promise.resolve({ ok: true });
    });

    renderAddItem({});

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText('Item name');
      expect(nameInput).toHaveValue('github');
    });
  });

  it('sends ADD_ITEM on form submission', async () => {
    mockSendMessage.mockImplementation((msg: { type: string }) => {
      if (msg.type === 'GET_ACTIVE_TAB_URL') {
        return Promise.resolve({ url: 'https://example.com' });
      }
      return Promise.resolve({ ok: true });
    });

    const onBack = vi.fn();
    const onRefresh = vi.fn();

    renderAddItem({ onBack, onRefresh });

    // Wait for auto-fill
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_ACTIVE_TAB_URL' });
    });

    // Fill in required fields
    fireEvent.change(screen.getByPlaceholderText('Item name'), {
      target: { value: 'My Login' },
    });
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'user@test.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'secret123' },
    });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADD_ITEM',
          item: expect.objectContaining({
            type: 'credential',
            name: 'My Login',
            username: 'user@test.com',
            password: 'secret123',
          }),
        }),
      );
    });
  });

  it('calls onBack when cancel is clicked', async () => {
    mockSendMessage.mockResolvedValue({ url: '' });
    const onBack = vi.fn();
    renderAddItem({ onBack });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows error when required fields are missing', async () => {
    mockSendMessage.mockResolvedValue({ url: '' });
    renderAddItem({});

    // Clear name (it may be auto-populated)
    await waitFor(() => {});

    // Click save without filling required fields
    // Make sure name is cleared
    const nameInput = screen.getByPlaceholderText('Item name');
    fireEvent.change(nameInput, { target: { value: '' } });

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(screen.getByText('Name is required.')).toBeInTheDocument();
    });
  });

  it('generates a password inline when Generate button clicked', async () => {
    const { generatePassword } = await import('@keykeykey/core/generator');
    mockSendMessage.mockResolvedValue({ url: '' });
    renderAddItem({});

    await waitFor(() => {});

    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(generatePassword).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'random', length: 20 }),
      );
      expect(screen.getByPlaceholderText('Password')).toHaveValue('MockGeneratedPass1!');
    });
  });

  it('toggles password visibility when eye button clicked', async () => {
    mockSendMessage.mockResolvedValue({ url: '' });
    renderAddItem({});

    await waitFor(() => {});

    const passwordInput = screen.getByPlaceholderText('Password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByLabelText('Show password'));
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByLabelText('Hide password'));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});
