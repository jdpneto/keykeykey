import React from 'react';
import { render } from '@testing-library/react-native';
import { TotpCodeDisplay } from '../../components/TotpCodeDisplay';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

jest.mock('@keykeykey/ui', () => ({
  useTotpCode: () => ({ code: '123456', remainingSeconds: 25, error: null }),
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

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
}));

describe('TotpCodeDisplay', () => {
  it('forwards testID prop to root View', () => {
    const { getByTestId } = render(
      <TotpCodeDisplay input="JBSWY3DPEHPK3PXP" testID="totp-display-root" />,
    );
    expect(getByTestId('totp-display-root')).toBeTruthy();
  });

  it('renders copy Pressable with hardcoded testID detail-totp-copy', () => {
    const { getByTestId } = render(
      <TotpCodeDisplay input="JBSWY3DPEHPK3PXP" testID="totp-display-root" />,
    );
    expect(getByTestId('detail-totp-copy')).toBeTruthy();
  });
});
