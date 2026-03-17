import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setArgon2Adapter } from '@keykeykey/core';
import { nativeArgon2Adapter } from '@/lib/native-argon2-adapter';
import { VaultProvider } from '@/lib/vault-context';
import { ThemeProvider, useTheme } from '@/lib/theme-provider';

// Register native Argon2id adapter before any vault operations.
setArgon2Adapter(nativeArgon2Adapter);

function RootLayoutInner() {
  const { theme, isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: theme.colors.background,
          },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="unlock" />
        <Stack.Screen name="recovery" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="item/add"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="item/[id]"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="item/edit"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="settings/sync"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <VaultProvider>
        <RootLayoutInner />
      </VaultProvider>
    </ThemeProvider>
  );
}
