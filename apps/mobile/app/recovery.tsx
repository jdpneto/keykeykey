import { View, Text, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { Button } from '@/components/Button';

export default function RecoveryScreen() {
  const { recoveryKey } = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  const handleCopy = async () => {
    if (recoveryKey) {
      await Clipboard.setStringAsync(recoveryKey);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Copied', 'Recovery key copied to clipboard. Store it somewhere safe!');
      // Auto-clear clipboard after 30 seconds for security
      setTimeout(() => {
        Clipboard.setStringAsync('');
      }, 30_000);
    }
  };

  const handleContinue = () => {
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: t.colors.warningLight }]}>
            <Ionicons name="key-outline" size={40} color={t.colors.warning} />
          </View>
          <Text style={[styles.title, { color: t.colors.text }]}>Recovery Key</Text>
          <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
            Save this key in a safe place. If you forget your master password, this is the only way
            to recover your vault.
          </Text>
        </View>

        <View
          style={[
            styles.keyContainer,
            { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.md },
          ]}
        >
          <Text style={[styles.keyText, { color: t.colors.text }]} selectable>
            {recoveryKey ?? ''}
          </Text>
        </View>

        <View
          style={[
            styles.warningBox,
            { backgroundColor: t.colors.warningLight, borderRadius: t.radii.md },
          ]}
        >
          <Ionicons name="warning-outline" size={20} color={t.colors.warning} />
          <Text style={[styles.warningText, { color: '#92400E' }]}>
            This key will not be shown again. Write it down or store it in a secure location.
          </Text>
        </View>

        <View style={styles.buttons}>
          <Button title="Copy to Clipboard" onPress={handleCopy} variant="secondary" />
          <View style={{ height: 12 }} />
          <Button title="I've Saved It — Continue" onPress={handleContinue} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  keyContainer: {
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  keyText: {
    fontSize: 18,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
    letterSpacing: 1,
    lineHeight: 28,
  },
  warningBox: {
    flexDirection: 'row',
    padding: 14,
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 32,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  buttons: {},
});
