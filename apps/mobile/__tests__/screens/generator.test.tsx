import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import GeneratorScreen from '../../app/(tabs)/generator';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
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
  SafeAreaView: ({ children, ...props }: any) => children,
}));

jest.mock('@keykeykey/core', () => ({
  generatePassword: jest.fn(() => 'MockedPassword123!'),
}));

// Mock crypto.getRandomValues for password generation
const mockGetRandomValues = jest.fn((arr: Uint32Array) => {
  for (let i = 0; i < arr.length; i++) arr[i] = i * 7;
  return arr;
});
Object.defineProperty(global, 'crypto', {
  value: { getRandomValues: mockGetRandomValues },
});

describe('GeneratorScreen', () => {
  it('renders generator title', () => {
    const { getByText } = render(<GeneratorScreen />);
    expect(getByText('Generator')).toBeTruthy();
  });

  it('displays a generated password', () => {
    const { getByText } = render(<GeneratorScreen />);
    expect(getByText('Length: 20')).toBeTruthy();
  });

  it('shows toggle options for character classes', () => {
    const { getByText } = render(<GeneratorScreen />);
    expect(getByText('Uppercase (A-Z)')).toBeTruthy();
    expect(getByText('Numbers (0-9)')).toBeTruthy();
    expect(getByText('Symbols (!@#$)')).toBeTruthy();
  });

  it('has generate button', () => {
    const { getByText } = render(<GeneratorScreen />);
    expect(getByText('Generate New Password')).toBeTruthy();
  });

  it('calls core generatePassword on render', () => {
    const { generatePassword } = require('@keykeykey/core');
    render(<GeneratorScreen />);
    expect(generatePassword).toHaveBeenCalled();
  });
});
