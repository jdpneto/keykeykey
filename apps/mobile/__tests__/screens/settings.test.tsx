import React from 'react';
import { act, render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import SettingsScreen from '../../app/(tabs)/settings';

type MockOrientationPreference = 'system' | 'portrait' | 'landscape' | 'current';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const React = require('react');
  RN.useColorScheme = jest.fn(() => 'light');
  // Modal doesn't render through the portal in Jest; render children inline when visible.
  RN.Modal = ({ children, visible }: any) =>
    visible ? React.createElement(RN.View, null, children) : null;
  RN.ActionSheetIOS = {
    ...RN.ActionSheetIOS,
    showActionSheetWithOptions: jest.fn(),
  };
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
  biometricEnabled: false,
  pinConfigured: false,
  enableBiometric: mockEnableBiometric,
  disableBiometric: mockDisableBiometric,
  enablePin: mockEnablePin,
  disablePin: mockDisablePin,
  resetVault: mockResetVault,
  syncConfig: null,
  autoLockMinutes: 5,
  setAutoLockMinutes: jest.fn(),
  onActivity: jest.fn(),
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

let mockOrientationPreference: MockOrientationPreference = 'portrait';
const mockSetOrientationPreference = jest.fn();

jest.mock('@/lib/orientation-preference', () => ({
  ORIENTATION_LABELS: {
    system: 'System',
    portrait: 'Portrait',
    landscape: 'Landscape',
    current: 'Lock current',
  },
  useOrientationPreference: () => ({
    preference: mockOrientationPreference,
    setPreference: mockSetOrientationPreference,
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

const realOS = Platform.OS;

function setPlatformOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
}

function latestAlertButtons() {
  const alertCall = (Alert.alert as jest.Mock).mock.calls.at(-1);
  return alertCall?.[2] as Array<{ text: string; onPress?: () => void }> | undefined;
}

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatformOS(realOS);
    mockVaultState.biometricAvailable = false;
    mockVaultState.biometricEnabled = false;
    mockVaultState.pinConfigured = false;
    mockOrientationPreference = 'portrait';
    mockSetOrientationPreference.mockReset();
    mockSetOrientationPreference.mockImplementation(async (next: MockOrientationPreference) => {
      mockOrientationPreference = next;
    });
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

  it('shows biometric row when hardware is available even if user has not enabled it', () => {
    mockVaultState.biometricAvailable = true;
    mockVaultState.biometricEnabled = false;
    const { getByText, getByTestId } = render(<SettingsScreen />);
    expect(getByText('Biometric Unlock')).toBeTruthy();
    expect(getByTestId('biometric-unlock-switch').props.value).toBe(false);
  });

  it('shows biometric row with switch on when user has enabled biometric unlock', () => {
    mockVaultState.biometricAvailable = true;
    mockVaultState.biometricEnabled = true;
    const { getByTestId } = render(<SettingsScreen />);
    expect(getByTestId('biometric-unlock-switch').props.value).toBe(true);
  });

  it('hides biometric row when device has no biometric hardware', () => {
    mockVaultState.biometricAvailable = false;
    mockVaultState.biometricEnabled = false;
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

  it('shows orientation row in appearance settings with the current label', () => {
    mockOrientationPreference = 'current';

    const { getByTestId, getByText } = render(<SettingsScreen />);

    expect(getByText('APPEARANCE')).toBeTruthy();
    expect(getByText('Theme')).toBeTruthy();

    const row = getByTestId('settings-orientation');
    expect(within(row).getByText('Orientation')).toBeTruthy();
    expect(within(row).getByText('Lock current')).toBeTruthy();
  });

  it('persists the selected Android orientation alert option', async () => {
    setPlatformOS('android');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-orientation'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Orientation',
      'Choose how KeyKeyKey should handle screen orientation.',
      expect.arrayContaining([expect.objectContaining({ text: 'Landscape' })]),
    );

    const landscapeButton = latestAlertButtons()?.find((button) => button.text === 'Landscape');
    await act(async () => {
      landscapeButton?.onPress?.();
    });

    await waitFor(() => {
      expect(mockSetOrientationPreference).toHaveBeenCalledWith('landscape');
    });
  });

  it('persists the selected iOS orientation action sheet option', async () => {
    setPlatformOS('ios');
    const actionSheetSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_options, callback) => {
        callback(2);
      });
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-orientation'));

    expect(actionSheetSpy).toHaveBeenCalledWith(
      {
        options: ['System', 'Portrait', 'Landscape', 'Lock current', 'Cancel'],
        cancelButtonIndex: 4,
        title: 'Orientation',
      },
      expect.any(Function),
    );

    await waitFor(() => {
      expect(mockSetOrientationPreference).toHaveBeenCalledWith('landscape');
    });
  });

  it('shows an error alert when saving orientation preference fails', async () => {
    setPlatformOS('android');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockSetOrientationPreference.mockRejectedValueOnce(new Error('storage unavailable'));
    const { getByTestId } = render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-orientation'));

    const landscapeButton = latestAlertButtons()?.find((button) => button.text === 'Landscape');
    await act(async () => {
      landscapeButton?.onPress?.();
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenLastCalledWith(
        'Error',
        'Failed to save orientation preference.',
      );
    });
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
