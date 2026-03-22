import { lightTheme, darkTheme } from '../../lib/theme';

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
    errorDark: '#F87171',
    errorLightDark: 'rgba(239,68,68,0.15)',
    successDark: '#4ADE80',
    successLightDark: 'rgba(34,197,94,0.15)',
    warningDark: '#FBBF24',
    warningLightDark: 'rgba(245,158,11,0.15)',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, '2xl': 48 },
  radii: { sm: 6, md: 12, lg: 16, xl: 24, full: 9999 },
  typography: {
    sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, '2xl': 28, '3xl': 34 },
    weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  },
}));

describe('theme', () => {
  describe('lightTheme', () => {
    it('uses lime accent color', () => {
      expect(lightTheme.colors.primary).toBe('#A3E635');
    });

    it('uses peach surface colors', () => {
      expect(lightTheme.colors.surface).toBe('#FFF7ED');
      expect(lightTheme.colors.surfaceAlt).toBe('#FFEDD5');
    });

    it('uses white background', () => {
      expect(lightTheme.colors.background).toBe('#FFFFFF');
    });

    it('includes all semantic colors', () => {
      expect(lightTheme.colors.error).toBeDefined();
      expect(lightTheme.colors.success).toBeDefined();
      expect(lightTheme.colors.warning).toBeDefined();
      expect(lightTheme.colors.danger).toBeDefined();
    });
  });

  describe('darkTheme', () => {
    it('uses black background', () => {
      expect(darkTheme.colors.background).toBe('#000000');
    });

    it('uses green surface tones', () => {
      expect(darkTheme.colors.surface).toBe('#052E16');
      expect(darkTheme.colors.surfaceAlt).toBe('#064E3B');
    });

    it('uses dark-mode semantic colors', () => {
      expect(darkTheme.colors.error).toBe('#F87171');
      expect(darkTheme.colors.success).toBe('#4ADE80');
      expect(darkTheme.colors.warning).toBe('#FBBF24');
    });
  });

  describe('theme color keys consistency', () => {
    it('light and dark themes have identical color keys', () => {
      const lightKeys = Object.keys(lightTheme.colors).sort();
      const darkKeys = Object.keys(darkTheme.colors).sort();
      expect(lightKeys).toEqual(darkKeys);
    });

    it('no color values are undefined', () => {
      for (const [, value] of Object.entries(lightTheme.colors)) {
        expect(value).toBeDefined();
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
      for (const [, value] of Object.entries(darkTheme.colors)) {
        expect(value).toBeDefined();
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    });
  });
});
