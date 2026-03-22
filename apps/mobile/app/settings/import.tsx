import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/theme-provider';
import { Button } from '@/components/Button';

export default function ImportScreen() {
  const router = useRouter();
  const { theme: t } = useTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.colors.background }}>
      <View style={{ padding: 20 }}>
        <Button title="Back" onPress={() => router.back()} />
        <Text style={{ color: t.colors.text, fontSize: 24, marginTop: 16 }}>Import Passwords</Text>
        <Text style={{ color: t.colors.textSecondary, marginTop: 8 }}>Coming soon</Text>
      </View>
    </SafeAreaView>
  );
}
