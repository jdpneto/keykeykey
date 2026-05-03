import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ItemDetailScreen from '../../app/item/[id]';

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

const mockRestore = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    items: [
      {
        id: 'cred-1',
        type: 'credential',
        name: 'GitHub',
        username: 'me',
        password: 'curr',
        passwordHistory: [
          { password: 'p1', changedAt: '2026-04-20T10:00:00.000Z' },
          { password: 'p2', changedAt: '2026-04-21T10:00:00.000Z' },
        ],
        tags: [],
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-21T10:00:00.000Z',
      },
    ],
    removeItem: jest.fn(),
    updateItem: jest.fn(),
    restorePasswordFromHistory: mockRestore,
  }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'cred-1' }),
  useRouter: () => ({ back: mockRouterBack, push: mockRouterPush }),
}));

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

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

describe('ItemDetailScreen — password history restore (mobile)', () => {
  beforeEach(() => {
    mockRestore.mockClear();
    mockRouterBack.mockClear();
    mockRouterPush.mockClear();
  });

  it('exposes a stable back button for native E2E reset navigation', () => {
    const { getByTestId } = render(<ItemDetailScreen />);

    fireEvent.press(getByTestId('detail-back'));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it('calls restorePasswordFromHistory with the original index when tapped', () => {
    const { getByTestId } = render(<ItemDetailScreen />);
    // Open the history section
    fireEvent.press(getByTestId('detail-password-history'));
    // Reversed-list index 0 = original index 1 (last item in array).
    fireEvent.press(getByTestId('history-restore-1'));
    expect(mockRestore).toHaveBeenCalledWith('cred-1', 1);
  });

  it('calls restorePasswordFromHistory with the correct index for the oldest entry', () => {
    const { getByTestId } = render(<ItemDetailScreen />);
    fireEvent.press(getByTestId('detail-password-history'));
    // Reversed-list index 1 = original index 0 (oldest entry).
    fireEvent.press(getByTestId('history-restore-0'));
    expect(mockRestore).toHaveBeenCalledWith('cred-1', 0);
  });
});
