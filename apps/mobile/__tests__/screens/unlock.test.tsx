import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import UnlockScreen from '../../app/unlock';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockUnlock = jest.fn();
const mockResetVault = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    unlock: mockUnlock,
    unlockWithBiometric: jest.fn(),
    unlockWithPin: jest.fn(),
    biometricAvailable: false,
    pinConfigured: false,
    resetVault: mockResetVault,
  }),
}));

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn().mockResolvedValue(false),
  isEnrolledAsync: jest.fn().mockResolvedValue(false),
  authenticateAsync: jest.fn(),
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

jest.mock('@keykeykey/ui', () => ({
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
    primaryDark: '#A3E635',
    primaryMutedDark: '#365314',
    backgroundDark: '#000000',
    surfaceDark: '#052E16',
    surfaceAltDark: '#064E3B',
    textDark: '#F0FDF4',
    textSecondaryDark: '#86EFAC',
    borderDark: '#14532D',
    inputBackgroundDark: '#022C22',
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
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

describe('UnlockScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders welcome title and password input', () => {
    const { getByText, getByPlaceholderText } = render(<UnlockScreen />);
    expect(getByText('Welcome Back')).toBeTruthy();
    expect(getByPlaceholderText('Enter master password')).toBeTruthy();
  });

  it('calls unlock and navigates on correct password', async () => {
    mockUnlock.mockResolvedValue(undefined);

    const { getByPlaceholderText, getByText } = render(<UnlockScreen />);

    fireEvent.changeText(getByPlaceholderText('Enter master password'), 'correctPassword');
    fireEvent.press(getByText('Unlock'));

    await waitFor(() => {
      expect(mockUnlock).toHaveBeenCalledWith('correctPassword');
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    });
  });

  it('shows error on wrong password', async () => {
    mockUnlock.mockRejectedValue(new Error('Bad password'));

    const { getByPlaceholderText, getByText } = render(<UnlockScreen />);

    fireEvent.changeText(getByPlaceholderText('Enter master password'), 'wrongPassword');
    fireEvent.press(getByText('Unlock'));

    await waitFor(() => {
      expect(getByText('Incorrect master password')).toBeTruthy();
    });
  });

  it('clears error when user types again', async () => {
    mockUnlock.mockRejectedValue(new Error('Bad password'));

    const { getByPlaceholderText, getByText, queryByText } = render(<UnlockScreen />);

    fireEvent.changeText(getByPlaceholderText('Enter master password'), 'wrong');
    fireEvent.press(getByText('Unlock'));

    await waitFor(() => {
      expect(getByText('Incorrect master password')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Enter master password'), 'trying again');
    expect(queryByText('Incorrect master password')).toBeNull();
  });

  describe('reset vault', () => {
    it('should show Reset Vault link', () => {
      const { getByText } = render(<UnlockScreen />);
      expect(getByText('Reset Vault?')).toBeTruthy();
    });

    it('should show confirmation when Reset Vault is pressed', () => {
      const { getByText } = render(<UnlockScreen />);
      fireEvent.press(getByText('Reset Vault?'));
      expect(getByText(/permanently delete/i)).toBeTruthy();
    });

    it('should call resetVault when confirmed', async () => {
      const { getByText } = render(<UnlockScreen />);
      fireEvent.press(getByText('Reset Vault?'));
      fireEvent.press(getByText('Reset Vault'));
      await waitFor(() => {
        expect(mockResetVault).toHaveBeenCalled();
      });
    });

    it('should hide confirmation when Cancel is pressed', () => {
      const { getByText, queryByText } = render(<UnlockScreen />);
      fireEvent.press(getByText('Reset Vault?'));
      expect(getByText(/permanently delete/i)).toBeTruthy();
      fireEvent.press(getByText('Cancel'));
      expect(queryByText(/permanently delete/i)).toBeNull();
    });
  });
});
