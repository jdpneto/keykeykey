import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';

type UnlockMode = 'biometric' | 'pin' | 'password';

export default function UnlockScreen() {
  const {
    unlock,
    unlockWithBiometric,
    unlockWithPin,
    biometricAvailable,
    pinConfigured,
    resetVault,
  } = useVault();
  const router = useRouter();
  const t = useTheme();

  const [mode, setMode] = useState<UnlockMode>('password');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Auto-detect best mode on mount
  useEffect(() => {
    if (biometricAvailable) {
      setMode('biometric');
    } else if (pinConfigured) {
      setMode('pin');
    } else {
      setMode('password');
    }
  }, [biometricAvailable, pinConfigured]);

  // Auto-trigger biometric prompt when in biometric mode
  useEffect(() => {
    if (mode === 'biometric') {
      triggerBiometric();
    }
  }, [mode]);

  const triggerBiometric = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const result = await unlockWithBiometric();
      if (result.status === 'success') {
        router.replace('/(tabs)');
      } else if (result.status === 'cancelled') {
        // User dismissed — fall back to PIN or password
        if (pinConfigured) {
          setMode('pin');
        } else {
          setMode('password');
        }
      } else if (result.status === 'invalidated') {
        setError('Biometric credential has expired. Please use your master password.');
        setMode('password');
      } else {
        setError(result.message ?? 'Biometric authentication failed.');
        if (pinConfigured) {
          setMode('pin');
        } else {
          setMode('password');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [unlockWithBiometric, pinConfigured, router]);

  const handlePinSubmit = async () => {
    if (!pin) return;
    setError('');
    setLoading(true);
    try {
      const result = await unlockWithPin(pin);
      if (result.success) {
        router.replace('/(tabs)');
      } else if (result.attemptsRemaining === 0) {
        setError('Too many incorrect attempts. PIN has been removed. Use your master password.');
        setMode('password');
        setPin('');
      } else if (result.attemptsRemaining === null) {
        setError('PIN not configured. Please use your master password.');
        setMode('password');
        setPin('');
      } else {
        setError(
          `Incorrect PIN. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} remaining.`,
        );
        setPin('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async () => {
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

  const subtitleText = () => {
    if (mode === 'biometric') return 'Authenticate with Face ID / Touch ID to unlock';
    if (mode === 'pin') return 'Enter your PIN to unlock';
    return 'Enter your master password to unlock';
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
              {subtitleText()}
            </Text>
          </View>

          <View style={styles.form}>
            {error ? (
              <Text style={[styles.errorText, { color: t.colors.error }]}>{error}</Text>
            ) : null}

            {mode === 'biometric' && (
              <>
                <Button title="Retry Biometrics" onPress={triggerBiometric} loading={loading} />
                {pinConfigured && (
                  <Button
                    title="Use PIN"
                    onPress={() => {
                      setError('');
                      setMode('pin');
                    }}
                    variant="secondary"
                    style={{ marginTop: 12 }}
                  />
                )}
                <Button
                  title="Use Master Password"
                  onPress={() => {
                    setError('');
                    setMode('password');
                  }}
                  variant="secondary"
                  style={{ marginTop: 12 }}
                />
              </>
            )}

            {mode === 'pin' && (
              <>
                <TextInput
                  label="PIN"
                  placeholder="Enter PIN"
                  value={pin}
                  onChangeText={(text) => {
                    setPin(text);
                    setError('');
                  }}
                  isPassword
                  keyboardType="number-pad"
                  returnKeyType="go"
                  onSubmitEditing={handlePinSubmit}
                />
                <Button
                  title="Unlock"
                  onPress={handlePinSubmit}
                  loading={loading}
                  disabled={!pin}
                />
                {biometricAvailable && (
                  <Button
                    title="Use Biometrics"
                    onPress={() => {
                      setError('');
                      setMode('biometric');
                    }}
                    variant="secondary"
                    style={{ marginTop: 12 }}
                  />
                )}
                <Button
                  title="Use Master Password"
                  onPress={() => {
                    setError('');
                    setMode('password');
                  }}
                  variant="secondary"
                  style={{ marginTop: 12 }}
                />
              </>
            )}

            {mode === 'password' && (
              <>
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
                  onSubmitEditing={handlePasswordSubmit}
                />
                <Button
                  title="Unlock"
                  onPress={handlePasswordSubmit}
                  loading={loading}
                  disabled={!password}
                />
                {biometricAvailable && (
                  <Button
                    title="Use Biometrics"
                    onPress={() => {
                      setError('');
                      setMode('biometric');
                    }}
                    variant="secondary"
                    style={{ marginTop: 12 }}
                  />
                )}
                {pinConfigured && (
                  <Button
                    title="Use PIN"
                    onPress={() => {
                      setError('');
                      setMode('pin');
                    }}
                    variant="secondary"
                    style={{ marginTop: 12 }}
                  />
                )}
              </>
            )}
          </View>

          <View style={styles.resetSection}>
            {!showResetConfirm ? (
              <TouchableOpacity onPress={() => setShowResetConfirm(true)}>
                <Text style={[styles.resetLink, { color: t.colors.error }]}>Reset Vault?</Text>
              </TouchableOpacity>
            ) : (
              <View
                style={[
                  styles.resetConfirm,
                  { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.error },
                ]}
              >
                <Text style={[styles.resetTitle, { color: t.colors.error }]}>Reset Vault?</Text>
                <Text style={[styles.resetBody, { color: t.colors.text }]}>
                  This will permanently delete your vault from this device. All stored passwords,
                  cards, and notes will be lost.
                </Text>
                <Text style={[styles.resetHint, { color: t.colors.textSecondary }]}>
                  If you have a cloud backup, you can restore your vault by setting up cloud sync
                  again after resetting.
                </Text>
                <View style={styles.resetButtons}>
                  <TouchableOpacity
                    onPress={() => setShowResetConfirm(false)}
                    style={[styles.resetBtn, { borderColor: t.colors.border }]}
                  >
                    <Text style={{ color: t.colors.text, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={resetting}
                    onPress={async () => {
                      setResetting(true);
                      try {
                        await resetVault();
                        router.replace('/setup');
                      } finally {
                        setResetting(false);
                      }
                    }}
                    style={[
                      styles.resetBtn,
                      {
                        backgroundColor: t.colors.error,
                        borderColor: t.colors.error,
                        opacity: resetting ? 0.6 : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
                      {resetting ? 'Resetting\u2026' : 'Reset Vault'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
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
  resetSection: {
    marginTop: 32,
    alignItems: 'center',
  },
  resetLink: {
    fontSize: 14,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  resetConfirm: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    width: '100%',
  },
  resetTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  resetBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  resetHint: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  resetButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  resetBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
});
