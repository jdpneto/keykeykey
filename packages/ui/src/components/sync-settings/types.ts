/**
 * Theme type for shared sync-settings web components.
 *
 * Both the desktop and extension `useTheme()` hooks return this same shape.
 * Components receive it as a prop to avoid requiring a ThemeProvider context.
 */
export interface SyncSettingsTheme {
  colors: {
    primary: string;
    primaryMuted: string;
    background: string;
    surface: string;
    surfaceAlt: string;
    text: string;
    textSecondary: string;
    border: string;
    inputBackground: string;
    error: string;
    errorLight: string;
    success: string;
    successLight: string;
    warning: string;
    warningLight: string;
    danger: string;
  };
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number; '2xl': number };
  radii: { sm: number; md: number; lg: number; xl: number; full: number };
  typography: {
    sizes: Record<string, number>;
    weights: Record<string, number | string>;
  };
}
