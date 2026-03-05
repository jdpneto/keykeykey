import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SettingsScreen from '../../app/(tabs)/settings';

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

const mockLock = jest.fn();
jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    lock: mockLock,
  }),
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

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders settings title', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Settings')).toBeTruthy();
  });

  it('shows security section', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('SECURITY')).toBeTruthy();
    expect(getByText('Lock Vault Now')).toBeTruthy();
    expect(getByText('Biometric Unlock')).toBeTruthy();
    expect(getByText('Auto-Lock Timeout')).toBeTruthy();
  });

  it('shows sync section', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('SYNC')).toBeTruthy();
    expect(getByText('Cloud Sync')).toBeTruthy();
  });

  it('shows about section with version', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('ABOUT')).toBeTruthy();
    expect(getByText('Version')).toBeTruthy();
    expect(getByText('0.0.1')).toBeTruthy();
  });

  it('shows confirmation alert before locking', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = render(<SettingsScreen />);

    fireEvent.press(getByText('Lock Vault Now'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Lock Vault',
      'Are you sure you want to lock the vault?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Lock' }),
      ]),
    );
  });
});
