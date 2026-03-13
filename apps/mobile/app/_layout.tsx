import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { setArgon2Adapter } from '@keykeykey/core';
import { nativeArgon2Adapter } from '@/lib/native-argon2-adapter';
import { VaultProvider } from '@/lib/vault-context';

// Register native Argon2id adapter before any vault operations.
// This replaces the slow pure-JS fallback (~20s) with the native C
// implementation (~70-110ms per KDF call).
setArgon2Adapter(nativeArgon2Adapter);

export default function RootLayout() {
  const scheme = useColorScheme();

  return (
    <VaultProvider>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: scheme === 'dark' ? '#000000' : '#FFFFFF',
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
      </Stack>
    </VaultProvider>
  );
}
