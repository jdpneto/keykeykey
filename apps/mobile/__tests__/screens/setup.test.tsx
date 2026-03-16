import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SetupScreen from '../../app/setup';

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

const mockSetupVault = jest.fn();
jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    setupVault: mockSetupVault,
  }),
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

describe('SetupScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders create vault title and password inputs', () => {
    const { getByText, getByPlaceholderText } = render(<SetupScreen />);
    expect(getByText('Create Your Vault')).toBeTruthy();
    expect(getByPlaceholderText('Enter master password')).toBeTruthy();
    expect(getByPlaceholderText('Confirm master password')).toBeTruthy();
  });

  it('shows validation requirement indicators', () => {
    const { getByText } = render(<SetupScreen />);
    expect(getByText('At least 8 characters')).toBeTruthy();
    expect(getByText('Passwords match')).toBeTruthy();
  });

  it('disables Create Vault button when password is too short', () => {
    const { getByPlaceholderText, getByText } = render(<SetupScreen />);

    fireEvent.changeText(getByPlaceholderText('Enter master password'), 'short');
    fireEvent.changeText(getByPlaceholderText('Confirm master password'), 'short');

    const button = getByText('Create Vault');
    // Button should be disabled — pressing it should not call setupVault
    fireEvent.press(button);
    expect(mockSetupVault).not.toHaveBeenCalled();
  });

  it('disables Create Vault button when passwords do not match', () => {
    const { getByPlaceholderText, getByText } = render(<SetupScreen />);

    fireEvent.changeText(getByPlaceholderText('Enter master password'), 'password123');
    fireEvent.changeText(getByPlaceholderText('Confirm master password'), 'different123');

    const button = getByText('Create Vault');
    fireEvent.press(button);
    expect(mockSetupVault).not.toHaveBeenCalled();
  });

  it('calls setupVault and navigates on success', async () => {
    mockSetupVault.mockResolvedValue('AAAAA-BBBBB-CCCCC-DDDDD');

    const { getByPlaceholderText, getByText } = render(<SetupScreen />);

    fireEvent.changeText(getByPlaceholderText('Enter master password'), 'StrongPass123!');
    fireEvent.changeText(getByPlaceholderText('Confirm master password'), 'StrongPass123!');
    fireEvent.press(getByText('Create Vault'));

    await waitFor(() => {
      expect(mockSetupVault).toHaveBeenCalledWith('StrongPass123!');
      expect(mockReplace).toHaveBeenCalledWith('/recovery');
    });
  });
});
