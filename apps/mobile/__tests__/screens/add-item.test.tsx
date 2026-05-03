import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AddItemScreen from '../../app/item/add';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
  useFocusEffect: (effect: () => void) => effect(),
}));

const mockAddItem = jest.fn();
jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    addItem: mockAddItem,
  }),
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

jest.mock('@keykeykey/core', () => ({
  extractDomainBrand: jest.fn((domain: string) => domain),
  getDefaultStrongPassword: jest.fn(() => 'GeneratedPassword123!'),
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

jest.spyOn(Alert, 'alert').mockImplementation(() => {});

describe('AddItemScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('saves card values reported by native end-editing events', async () => {
    mockAddItem.mockResolvedValue('card-1');

    const { getByTestId, getByText } = render(<AddItemScreen />);

    fireEvent.changeText(getByTestId('add-name'), 'Test Visa');
    fireEvent.press(getByTestId('add-tab-card'));

    fireEvent(getByTestId('add-cardholder'), 'endEditing', {
      nativeEvent: { text: 'Claude Tester' },
    });
    fireEvent(getByTestId('add-cardnumber'), 'endEditing', {
      nativeEvent: { text: '4111111111111111' },
    });
    fireEvent(getByTestId('add-month'), 'endEditing', {
      nativeEvent: { text: '12' },
    });
    fireEvent(getByTestId('add-year'), 'endEditing', {
      nativeEvent: { text: '2030' },
    });
    fireEvent(getByTestId('add-cvv'), 'endEditing', {
      nativeEvent: { text: '123' },
    });

    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'card',
          name: 'Test Visa',
          cardholderName: 'Claude Tester',
          number: '4111111111111111',
          expirationMonth: 12,
          expirationYear: 2030,
          cvv: '123',
        }),
      );
      expect(mockBack).toHaveBeenCalled();
    });
    expect(Alert.alert).not.toHaveBeenCalledWith(
      'Error',
      'Cardholder name, number, and CVV are required',
    );
  });
});
