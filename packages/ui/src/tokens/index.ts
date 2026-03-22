// Design tokens shared across all KeyKeyKey platforms.
// Colors, spacing, typography scales, and radii.

export const colors = {
  // Light mode
  primary: '#A3E635', // lime accent
  primaryMuted: '#D9F99D', // softer lime
  background: '#FFFFFF', // white background
  surface: '#FFF7ED', // peach surface
  surfaceAlt: '#FFEDD5', // deeper peach for cards
  text: '#292524', // stone-800
  textSecondary: '#78716C', // stone-500
  border: '#E7E5E4', // stone-200
  inputBackground: '#FAFAF9', // stone-50

  // Dark mode
  primaryDark: '#A3E635', // lime stays vibrant on dark
  primaryMutedDark: '#365314', // dark olive muted lime
  backgroundDark: '#000000', // black background
  surfaceDark: '#052E16', // dark green surface
  surfaceAltDark: '#064E3B', // teal-green for cards
  textDark: '#F0FDF4', // green-50
  textSecondaryDark: '#86EFAC', // green-300
  borderDark: '#14532D', // green-900
  inputBackgroundDark: '#022C22', // teal-950

  // Semantic – light mode
  error: '#EF4444',
  errorLight: '#FEE2E2',
  success: '#22C55E',
  successLight: '#DCFCE7',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  danger: '#DC2626',

  // Semantic – dark mode
  errorDark: '#F87171',
  errorLightDark: 'rgba(239,68,68,0.15)',
  successDark: '#4ADE80',
  successLightDark: 'rgba(34,197,94,0.15)',
  warningDark: '#FBBF24',
  warningLightDark: 'rgba(245,158,11,0.15)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

export const radii = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const typography = {
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    '2xl': 28,
    '3xl': 34,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },
} as const;

export type Colors = typeof colors;
export type Spacing = typeof spacing;
export type Radii = typeof radii;
export type Typography = typeof typography;
