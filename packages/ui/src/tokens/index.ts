// Design tokens shared across all KeyKeyKey platforms.
// Colors, spacing, typography scales, and breakpoints.

export const colors = {
  primary: '#6366F1',
  primaryDark: '#4F46E5',
  background: '#FFFFFF',
  backgroundDark: '#0F172A',
  surface: '#F8FAFC',
  surfaceDark: '#1E293B',
  text: '#0F172A',
  textDark: '#F8FAFC',
  border: '#E2E8F0',
  borderDark: '#334155',
  error: '#EF4444',
  success: '#22C55E',
  warning: '#F59E0B',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

export type Colors = typeof colors;
export type Spacing = typeof spacing;
