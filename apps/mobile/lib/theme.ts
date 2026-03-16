import { colors, spacing, radii, typography } from '@keykeykey/ui';

export const lightTheme = {
  colors: {
    primary: colors.primary,
    primaryMuted: colors.primaryMuted,
    background: colors.background,
    surface: colors.surface,
    surfaceAlt: colors.surfaceAlt,
    text: colors.text,
    textSecondary: colors.textSecondary,
    border: colors.border,
    inputBackground: colors.inputBackground,
    error: colors.error,
    errorLight: colors.errorLight,
    success: colors.success,
    successLight: colors.successLight,
    warning: colors.warning,
    warningLight: colors.warningLight,
    danger: colors.danger,
  },
  spacing,
  radii,
  typography,
} as const;

export const darkTheme = {
  colors: {
    primary: colors.primaryDark,
    primaryMuted: colors.primaryMutedDark,
    background: colors.backgroundDark,
    surface: colors.surfaceDark,
    surfaceAlt: colors.surfaceAltDark,
    text: colors.textDark,
    textSecondary: colors.textSecondaryDark,
    border: colors.borderDark,
    inputBackground: colors.inputBackgroundDark,
    error: colors.error,
    errorLight: colors.errorLight,
    success: colors.success,
    successLight: colors.successLight,
    warning: colors.warning,
    warningLight: colors.warningLight,
    danger: colors.danger,
  },
  spacing,
  radii,
  typography,
} as const;

export type Theme = {
  colors: { [K in keyof typeof lightTheme.colors]: string };
  spacing: typeof lightTheme.spacing;
  radii: typeof lightTheme.radii;
  typography: typeof lightTheme.typography;
};
