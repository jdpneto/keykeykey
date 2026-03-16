// Shared theme mock for tests that render components using useTheme.
// Import this file in test files that need it, BEFORE the jest.mock call.

export const mockThemeValue = {
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
  mode: 'system' as const,
  setMode: jest.fn(),
};
