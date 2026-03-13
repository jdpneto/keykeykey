import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';

export default function UnlockScreen() {
  const { unlock } = useVault();
  const router = useRouter();
  const t = useTheme();

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  useEffect(() => {
    checkBiometrics();
  }, []);

  const checkBiometrics = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setBiometricAvailable(compatible && enrolled);
  };

  const handleUnlock = async () => {
    if (!password) return;
    setError('');
    setLoading(true);
    try {
      // Yield to let React paint the loading spinner before KDF starts
      await new Promise((r) => setTimeout(r, 50));
      await unlock(password);
      router.replace('/(tabs)');
    } catch {
      setError('Incorrect master password');
    } finally {
      setLoading(false);
    }
  };

  const handleBiometric = async () => {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock KeyKeyKey',
      fallbackLabel: 'Use Password',
    });
    if (result.success) {
      // Biometric unlock would use stored DEK from SecureStore
      // For now, prompt for password
      Alert.alert(
        'Biometric Auth',
        'Biometric unlock will be available after first password unlock in a future update.',
      );
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: t.colors.surfaceAlt }]}>
              <Ionicons name="lock-closed-outline" size={40} color={t.colors.primary} />
            </View>
            <Text style={[styles.title, { color: t.colors.text }]}>Welcome Back</Text>
            <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
              Enter your master password to unlock
            </Text>
          </View>

          <View style={styles.form}>
            <TextInput
              label="Master Password"
              placeholder="Enter master password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setError('');
              }}
              isPassword
              returnKeyType="go"
              onSubmitEditing={handleUnlock}
            />
            {error ? (
              <Text style={[styles.errorText, { color: t.colors.error }]}>{error}</Text>
            ) : null}
            <Button title="Unlock" onPress={handleUnlock} loading={loading} disabled={!password} />
            {biometricAvailable && (
              <Button
                title="Use Biometrics"
                onPress={handleBiometric}
                variant="secondary"
                style={{ marginTop: 12 }}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  container: {
    flex: 1,
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
  },
  form: {
    width: '100%',
  },
  errorText: {
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
});
