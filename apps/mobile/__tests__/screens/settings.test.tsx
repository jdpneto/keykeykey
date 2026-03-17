import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import SettingsScreen from '../../app/(tabs)/settings';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const React = require('react');
  RN.useColorScheme = jest.fn(() => 'light');
  // Modal doesn't render through the portal in Jest; render children inline when visible.
  RN.Modal = ({ children, visible }: any) =>
    visible ? React.createElement(RN.View, null, children) : null;
  return RN;
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockLock = jest.fn();
const mockEnableBiometric = jest.fn().mockResolvedValue(undefined);
const mockDisableBiometric = jest.fn().mockResolvedValue(undefined);
const mockEnablePin = jest.fn().mockResolvedValue(undefined);
const mockDisablePin = jest.fn().mockResolvedValue(undefined);

const mockResetVault = jest.fn().mockResolvedValue(undefined);

const mockVaultState = {
  lock: mockLock,
  biometricAvailable: false,
  pinConfigured: false,
  enableBiometric: mockEnableBiometric,
  disableBiometric: mockDisableBiometric,
  enablePin: mockEnablePin,
  disablePin: mockDisablePin,
  resetVault: mockResetVault,
  syncConfig: null,
};

jest.mock('../../lib/vault-context', () => ({
  useVault: () => mockVaultState,
}));

jest.mock('@keykeykey/core/pin', () => ({
  validatePin: (pin: string) => {
    if (!/^\d{4,8}$/.test(pin)) return { valid: false, error: 'PIN must be 4–8 digits.' };
    return { valid: true };
  },
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

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultState.biometricAvailable = false;
    mockVaultState.pinConfigured = false;
  });

  it('renders settings title', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Settings')).toBeTruthy();
  });

  it('shows security section', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('SECURITY')).toBeTruthy();
    expect(getByText('Lock Vault Now')).toBeTruthy();
    expect(getByText('Auto-Lock Timeout')).toBeTruthy();
  });

  it('shows biometric row when biometricAvailable is true', () => {
    mockVaultState.biometricAvailable = true;
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Biometric Unlock')).toBeTruthy();
  });

  it('hides biometric row when biometricAvailable is false', () => {
    mockVaultState.biometricAvailable = false;
    const { queryByText } = render(<SettingsScreen />);
    expect(queryByText('Biometric Unlock')).toBeNull();
  });

  it('shows PIN Unlock row', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('PIN Unlock')).toBeTruthy();
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

  it('opens PIN setup modal when PIN switch is toggled on', () => {
    const { getByTestId, getByText } = render(<SettingsScreen />);
    fireEvent(getByTestId('pin-unlock-switch'), 'valueChange', true);
    expect(getByText('Set Up PIN')).toBeTruthy();
  });

  it('calls enablePin with valid matching PINs', async () => {
    const { getByTestId, getByText, getAllByPlaceholderText } = render(<SettingsScreen />);
    fireEvent(getByTestId('pin-unlock-switch'), 'valueChange', true);

    const inputs = getAllByPlaceholderText(/Enter PIN|Re-enter PIN/);
    fireEvent.changeText(inputs[0], '1357');
    fireEvent.changeText(inputs[1], '1357');

    fireEvent.press(getByText('Enable PIN Unlock'));

    await waitFor(() => {
      expect(mockEnablePin).toHaveBeenCalledWith('1357');
    });
  });

  it('shows error when PINs do not match', async () => {
    const { getByTestId, getByText, getAllByPlaceholderText } = render(<SettingsScreen />);
    fireEvent(getByTestId('pin-unlock-switch'), 'valueChange', true);

    const inputs = getAllByPlaceholderText(/Enter PIN|Re-enter PIN/);
    fireEvent.changeText(inputs[0], '1357');
    fireEvent.changeText(inputs[1], '2468');

    fireEvent.press(getByText('Enable PIN Unlock'));

    await waitFor(() => {
      expect(getByText('PINs do not match.')).toBeTruthy();
    });
  });

  describe('reset vault', () => {
    it('should show DANGER ZONE section', () => {
      const { getByText } = render(<SettingsScreen />);
      expect(getByText('DANGER ZONE')).toBeTruthy();
    });

    it('should show reset confirmation modal when Reset Vault is pressed', () => {
      const { getByText } = render(<SettingsScreen />);
      fireEvent.press(getByText('Reset Vault'));
      expect(getByText(/permanently delete/i)).toBeTruthy();
    });

    it('should call resetVault when confirmed in modal', async () => {
      const { getByText, getAllByText } = render(<SettingsScreen />);
      fireEvent.press(getByText('Reset Vault'));
      // There may be multiple "Reset Vault" texts — the button in the modal
      const confirmButtons = getAllByText('Reset Vault');
      fireEvent.press(confirmButtons[confirmButtons.length - 1]); // last one is the confirm button
      await waitFor(() => {
        expect(mockResetVault).toHaveBeenCalled();
      });
    });
  });
});
