import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';

export default function SetupScreen() {
  const { setupVault } = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      // Yield to let React paint the loading spinner before KDF starts
      await new Promise((r) => setTimeout(r, 50));
      await setupVault(password);
      router.replace('/recovery');
    } catch (e: unknown) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
      console.error('Vault creation failed:', msg);
      Alert.alert('Error', `Failed to create vault: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: t.colors.surfaceAlt }]}>
              <Ionicons name="shield-checkmark-outline" size={40} color={t.colors.primary} />
            </View>
            <Text style={[styles.title, { color: t.colors.text }]}>Create Your Vault</Text>
            <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
              Choose a strong master password. This is the only password you'll need to remember.
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              label="Master Password"
              placeholder="Enter master password"
              value={password}
              onChangeText={setPassword}
              isPassword
            />
            <TextInput
              label="Confirm Password"
              placeholder="Confirm master password"
              value={confirm}
              onChangeText={setConfirm}
              isPassword
            />
            {error ? (
              <Text style={[styles.errorText, { color: t.colors.error }]}>{error}</Text>
            ) : null}

            <View style={styles.requirements}>
              <Requirement met={password.length >= 8} label="At least 8 characters" />
              <Requirement
                met={password === confirm && confirm.length > 0}
                label="Passwords match"
              />
            </View>

            <Button
              title="Create Vault"
              onPress={handleCreate}
              loading={loading}
              disabled={password.length < 8 || password !== confirm}
            />
            <View style={{ marginTop: 16 }}>
              <Button
                title="Restore from Cloud"
                variant="secondary"
                onPress={() => {}}
                disabled
              />
              <Text
                style={{
                  textAlign: 'center',
                  color: t.colors.textSecondary,
                  fontSize: 13,
                  marginTop: 8,
                }}
              >
                Coming soon
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Requirement({ met, label }: { met: boolean; label: string }) {
  const { theme: t } = useTheme();
  return (
    <View style={styles.reqRow}>
      <Ionicons
        name={met ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={met ? t.colors.success : t.colors.textSecondary}
      />
      <Text style={[styles.reqText, { color: met ? t.colors.success : t.colors.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
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
    paddingHorizontal: 16,
  },
  form: {
    width: '100%',
  },
  errorText: {
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  requirements: {
    marginBottom: 24,
  },
  reqRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  reqText: {
    fontSize: 13,
    marginLeft: 8,
  },
});
