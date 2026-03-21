import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import RestoreScreen from '../../app/restore';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

const mockRestoreFromCloud = jest.fn().mockResolvedValue({ success: true, itemCount: 5 });

jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    restoreFromCloud: mockRestoreFromCloud,
    syncConfig: null,
    saveSyncConfig: jest.fn(),
    triggerSync: jest.fn(),
    validateMasterPassword: jest.fn(),
    vaultMismatchInfo: null,
    clearVaultMismatch: jest.fn(),
    replaceRemoteVault: jest.fn(),
    mergeRemoteVault: jest.fn(),
    replaceLocalVault: jest.fn(),
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

describe('RestoreScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRestoreFromCloud.mockResolvedValue({ success: true, itemCount: 5 });
  });

  describe('provider step', () => {
    it('renders provider step with title and WebDAV fields', () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);

      expect(getByText('Restore from Cloud')).toBeTruthy();
      expect(getByPlaceholderText('https://dav.example.com/keykeykey/')).toBeTruthy();
      expect(getByPlaceholderText('your-username')).toBeTruthy();
      expect(getByPlaceholderText('your-password')).toBeTruthy();
    });

    it('renders Next button on provider step', () => {
      const { getByText } = render(<RestoreScreen />);
      expect(getByText('Next')).toBeTruthy();
    });

    it('Next button is disabled when fields are empty', () => {
      const { getByText } = render(<RestoreScreen />);
      // Button should be present but disabled — verify it does not advance to password step
      fireEvent.press(getByText('Next'));
      // Still on provider step
      expect(getByText('Restore from Cloud')).toBeTruthy();
    });

    it('Next button is disabled when only URL is filled', () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fireEvent.changeText(
        getByPlaceholderText('https://dav.example.com/keykeykey/'),
        'https://dav.example.com/',
      );
      fireEvent.press(getByText('Next'));
      // Still on provider step (username and password missing)
      expect(getByText('Restore from Cloud')).toBeTruthy();
    });

    it('Next button advances to password step when all fields are filled', () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);

      fireEvent.changeText(
        getByPlaceholderText('https://dav.example.com/keykeykey/'),
        'https://dav.example.com/',
      );
      fireEvent.changeText(getByPlaceholderText('your-username'), 'myuser');
      fireEvent.changeText(getByPlaceholderText('your-password'), 'mypassword');

      fireEvent.press(getByText('Next'));

      expect(getByText('Enter Master Password')).toBeTruthy();
    });

    it('shows Back to Setup button on provider step', () => {
      const { getByText } = render(<RestoreScreen />);
      expect(getByText('Back to Setup')).toBeTruthy();
    });

    it('calls router.back when Back to Setup is pressed on provider step', () => {
      const { getByText } = render(<RestoreScreen />);
      fireEvent.press(getByText('Back to Setup'));
      expect(mockBack).toHaveBeenCalled();
    });
  });

  describe('password step', () => {
    const fillProviderAndAdvance = (getByText: any, getByPlaceholderText: any) => {
      fireEvent.changeText(
        getByPlaceholderText('https://dav.example.com/keykeykey/'),
        'https://dav.example.com/',
      );
      fireEvent.changeText(getByPlaceholderText('your-username'), 'myuser');
      fireEvent.changeText(getByPlaceholderText('your-password'), 'mypassword');
      fireEvent.press(getByText('Next'));
    };

    it('renders master password step after Next', () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      expect(getByText('Enter Master Password')).toBeTruthy();
      expect(getByPlaceholderText('Enter your master password')).toBeTruthy();
      expect(getByText('Restore Vault')).toBeTruthy();
    });

    it('shows Back button on password step', () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      expect(getByText('Back')).toBeTruthy();
    });

    it('Back button from password step returns to provider step', () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      fireEvent.press(getByText('Back'));

      expect(getByText('Restore from Cloud')).toBeTruthy();
    });

    it('Back button on password step does not call router.back', () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      fireEvent.press(getByText('Back'));

      expect(mockBack).not.toHaveBeenCalled();
    });

    it('Restore Vault button is disabled when master password is empty', () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      // Press without entering password — should not call restoreFromCloud
      fireEvent.press(getByText('Restore Vault'));
      expect(mockRestoreFromCloud).not.toHaveBeenCalled();
    });

    it('calls restoreFromCloud with correct config and password', async () => {
      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      fireEvent.changeText(
        getByPlaceholderText('Enter your master password'),
        'my-master-password',
      );
      fireEvent.press(getByText('Restore Vault'));

      await waitFor(() => {
        expect(mockRestoreFromCloud).toHaveBeenCalledWith(
          {
            provider: 'webdav',
            webdav: {
              url: 'https://dav.example.com/',
              username: 'myuser',
              password: 'mypassword',
            },
          },
          'my-master-password',
        );
      });
    });

    it('shows success step after successful restore', async () => {
      mockRestoreFromCloud.mockResolvedValue({ success: true, itemCount: 3 });

      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      fireEvent.changeText(
        getByPlaceholderText('Enter your master password'),
        'my-master-password',
      );
      fireEvent.press(getByText('Restore Vault'));

      await waitFor(() => {
        expect(getByText('Vault Restored')).toBeTruthy();
      });

      expect(getByText(/3 items/)).toBeTruthy();
      expect(getByText('Go to Vault')).toBeTruthy();
    });

    it('shows error and returns to password step on auth failure', async () => {
      mockRestoreFromCloud.mockResolvedValue({
        success: false,
        error: 'Invalid master password',
      });

      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      fireEvent.changeText(
        getByPlaceholderText('Enter your master password'),
        'wrong-password',
      );
      fireEvent.press(getByText('Restore Vault'));

      await waitFor(() => {
        expect(getByText('Invalid master password')).toBeTruthy();
        expect(getByText('Enter Master Password')).toBeTruthy();
      });
    });

    it('returns to provider step on connection error', async () => {
      mockRestoreFromCloud.mockResolvedValue({
        success: false,
        error: 'No vault data found',
      });

      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);
      fillProviderAndAdvance(getByText, getByPlaceholderText);

      fireEvent.changeText(
        getByPlaceholderText('Enter your master password'),
        'my-master-password',
      );
      fireEvent.press(getByText('Restore Vault'));

      await waitFor(() => {
        expect(getByText('Restore from Cloud')).toBeTruthy();
        expect(getByText('No vault data found')).toBeTruthy();
      });
    });
  });

  describe('success step', () => {
    it('calls router.replace with tabs route on Go to Vault', async () => {
      mockRestoreFromCloud.mockResolvedValue({ success: true, itemCount: 1 });

      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);

      fireEvent.changeText(
        getByPlaceholderText('https://dav.example.com/keykeykey/'),
        'https://dav.example.com/',
      );
      fireEvent.changeText(getByPlaceholderText('your-username'), 'u');
      fireEvent.changeText(getByPlaceholderText('your-password'), 'p');
      fireEvent.press(getByText('Next'));

      fireEvent.changeText(
        getByPlaceholderText('Enter your master password'),
        'pass',
      );
      fireEvent.press(getByText('Restore Vault'));

      await waitFor(() => {
        expect(getByText('Go to Vault')).toBeTruthy();
      });

      fireEvent.press(getByText('Go to Vault'));
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)');
    });

    it('shows singular item text when itemCount is 1', async () => {
      mockRestoreFromCloud.mockResolvedValue({ success: true, itemCount: 1 });

      const { getByText, getByPlaceholderText } = render(<RestoreScreen />);

      fireEvent.changeText(
        getByPlaceholderText('https://dav.example.com/keykeykey/'),
        'https://dav.example.com/',
      );
      fireEvent.changeText(getByPlaceholderText('your-username'), 'u');
      fireEvent.changeText(getByPlaceholderText('your-password'), 'p');
      fireEvent.press(getByText('Next'));

      fireEvent.changeText(
        getByPlaceholderText('Enter your master password'),
        'pass',
      );
      fireEvent.press(getByText('Restore Vault'));

      await waitFor(() => {
        expect(getByText(/1 item from/)).toBeTruthy();
      });
    });
  });
});
