import React from 'react';
import { render } from '@testing-library/react-native';
import { EmptyState } from '../../components/EmptyState';

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

describe('EmptyState', () => {
  it('renders title text', () => {
    const { getByText } = render(<EmptyState icon="shield-outline" title="No items" />);
    expect(getByText('No items')).toBeTruthy();
  });

  it('renders subtitle when provided', () => {
    const { getByText } = render(
      <EmptyState icon="shield-outline" title="Empty" subtitle="Add something" />,
    );
    expect(getByText('Add something')).toBeTruthy();
  });

  it('does not render subtitle when not provided', () => {
    const { queryByText } = render(<EmptyState icon="shield-outline" title="Empty" />);
    expect(queryByText('Add something')).toBeNull();
  });
});
