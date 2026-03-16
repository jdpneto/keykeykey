import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../../lib/theme-provider';

jest.mock('react-native', () => ({
  useColorScheme: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
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

const mockedUseColorScheme = useColorScheme as jest.MockedFunction<typeof useColorScheme>;
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('ThemeProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseColorScheme.mockReturnValue('light');
    mockedAsyncStorage.getItem.mockResolvedValue(null);
  });

  it('defaults to system mode', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.mode).toBe('system');
  });

  it('resolves light theme when system is light and mode is system', () => {
    mockedUseColorScheme.mockReturnValue('light');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme.colors.background).toBe('#FFFFFF');
    expect(result.current.isDark).toBe(false);
  });

  it('resolves dark theme when system is dark and mode is system', () => {
    mockedUseColorScheme.mockReturnValue('dark');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme.colors.background).toBe('#000000');
    expect(result.current.isDark).toBe(true);
  });

  it('setMode to dark overrides system preference', () => {
    mockedUseColorScheme.mockReturnValue('light');
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('dark');
    });

    expect(result.current.mode).toBe('dark');
    expect(result.current.theme.colors.background).toBe('#000000');
    expect(result.current.isDark).toBe(true);
  });

  it('setMode to light overrides system preference', () => {
    mockedUseColorScheme.mockReturnValue('dark');
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('light');
    });

    expect(result.current.mode).toBe('light');
    expect(result.current.theme.colors.background).toBe('#FFFFFF');
    expect(result.current.isDark).toBe(false);
  });

  it('persists mode to AsyncStorage', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });

    act(() => {
      result.current.setMode('dark');
    });

    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith('keykeykey-theme-mode', 'dark');
  });

  it('throws when useTheme is called outside provider', () => {
    expect(() => {
      renderHook(() => useTheme());
    }).toThrow('useTheme must be used within ThemeProvider');
  });
});
