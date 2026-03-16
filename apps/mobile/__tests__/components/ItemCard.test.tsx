import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ItemCard } from '../../components/ItemCard';
import type { VaultItem } from '@keykeykey/core';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => ({
    theme: {
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
        error: '#EF4444',
        errorLight: '#FEE2E2',
        success: '#22C55E',
        successLight: '#DCFCE7',
        warning: '#F59E0B',
        warningLight: '#FEF3C7',
        danger: '#DC2626',
      },
      radii: { sm: 6, md: 12, lg: 16, xl: 24, full: 9999 },
    },
    isDark: false,
    mode: 'system',
    setMode: jest.fn(),
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

const makeCredential = (overrides?: Partial<VaultItem>): VaultItem =>
  ({
    id: 'cred-1',
    type: 'credential',
    name: 'Gmail',
    username: 'user@gmail.com',
    password: 'secret123',
    tags: [],
    favorite: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }) as VaultItem;

const makeCard = (): VaultItem =>
  ({
    id: 'card-1',
    type: 'card',
    name: 'Visa',
    cardholderName: 'John Doe',
    number: '4111111111111111',
    expirationMonth: 12,
    expirationYear: 2028,
    cvv: '123',
    tags: [],
    favorite: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }) as VaultItem;

const makeNote = (): VaultItem =>
  ({
    id: 'note-1',
    type: 'secure-note',
    name: 'API Keys',
    content: 'secret content',
    tags: [],
    favorite: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }) as VaultItem;

describe('ItemCard', () => {
  it('renders credential name and username', () => {
    const { getByText } = render(<ItemCard item={makeCredential()} onPress={() => {}} />);
    expect(getByText('Gmail')).toBeTruthy();
    expect(getByText('user@gmail.com')).toBeTruthy();
  });

  it('renders card with masked number', () => {
    const { getByText } = render(<ItemCard item={makeCard()} onPress={() => {}} />);
    expect(getByText('Visa')).toBeTruthy();
    expect(getByText('•••• 1111')).toBeTruthy();
  });

  it('renders secure note subtitle', () => {
    const { getByText } = render(<ItemCard item={makeNote()} onPress={() => {}} />);
    expect(getByText('API Keys')).toBeTruthy();
    expect(getByText('Secure Note')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<ItemCard item={makeCredential()} onPress={onPress} />);
    fireEvent.press(getByText('Gmail'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not expose full card number', () => {
    const { queryByText } = render(<ItemCard item={makeCard()} onPress={() => {}} />);
    expect(queryByText('4111111111111111')).toBeNull();
  });
});
