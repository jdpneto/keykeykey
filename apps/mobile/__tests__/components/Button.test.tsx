import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../../components/Button';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

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

describe('Button', () => {
  it('renders with title text', async () => {
    const { getByText } = await render(<Button title="Press Me" onPress={() => {}} />);
    expect(getByText('Press Me')).toBeTruthy();
  });

  it('calls onPress when tapped', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<Button title="Tap" onPress={onPress} />);
    await fireEvent.press(getByText('Tap'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', async () => {
    const onPress = jest.fn();
    const { getByText } = await render(<Button title="Disabled" onPress={onPress} disabled />);
    await fireEvent.press(getByText('Disabled'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows ActivityIndicator when loading', async () => {
    const { queryByText, container } = await render(
      <Button title="Loading" onPress={() => {}} loading />,
    );
    expect(queryByText('Loading')).toBeNull();
    expect(container.queryAll((node) => node.type === 'ActivityIndicator')).toHaveLength(1);
  });

  it('does not call onPress when loading', async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <Button title="Loading" onPress={onPress} loading testID="loading-button" />,
    );
    // Loading state should prevent press
    await fireEvent.press(getByTestId('loading-button'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders all three variants without error', async () => {
    const { getByText, rerender } = await render(
      <Button title="Primary" onPress={() => {}} variant="primary" />,
    );
    expect(getByText('Primary')).toBeTruthy();

    await rerender(<Button title="Secondary" onPress={() => {}} variant="secondary" />);
    expect(getByText('Secondary')).toBeTruthy();

    await rerender(<Button title="Danger" onPress={() => {}} variant="danger" />);
    expect(getByText('Danger')).toBeTruthy();
  });

  it('forwards testID prop to the underlying Pressable', async () => {
    const { getByTestId } = await render(
      <Button title="Go" onPress={() => {}} testID="setup-submit" />,
    );
    expect(getByTestId('setup-submit')).toBeTruthy();
  });
});
