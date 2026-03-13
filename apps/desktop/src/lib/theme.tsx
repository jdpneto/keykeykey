import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeContextType = {
  theme: Theme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
};

const STORAGE_KEY = 'keykeykey-theme-mode';

function getSystemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme(mode: ThemeMode): { theme: Theme; isDark: boolean } {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemDark());
  return { theme: isDark ? darkTheme : lightTheme, isDark };
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    return 'system';
  });
  const [resolved, setResolved] = useState(() => resolveTheme(mode));

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  }, []);

  // Re-resolve when mode changes or system preference changes
  useEffect(() => {
    setResolved(resolveTheme(mode));

    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => setResolved(resolveTheme('system'));
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [mode]);

  // Apply theme class to document for CSS
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved.isDark ? 'dark' : 'light');
  }, [resolved.isDark]);

  return (
    <ThemeContext.Provider
      value={{ theme: resolved.theme, mode, setMode, isDark: resolved.isDark }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
