import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';

export default function IndexScreen() {
  const { status, initialize } = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (status === 'needs_setup') {
      router.replace('/setup');
    } else if (status === 'locked') {
      router.replace('/unlock');
    } else if (status === 'unlocked') {
      router.replace('/(tabs)');
    }
  }, [status, router]);

  return (
    <View style={[styles.container, { backgroundColor: t.colors.background }]}>
      <ActivityIndicator size="large" color={t.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
