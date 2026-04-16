import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
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
import type { SyncConfig, RestoreProgressEvent } from '@keykeykey/core/sync';

type Step = 'provider' | 'password' | 'restoring' | 'success';

export default function RestoreScreen() {
  const { restoreFromCloud } = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  const [step, setStep] = useState<Step>('provider');
  const [error, setError] = useState('');

  // Provider fields
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');

  // Master password
  const [masterPassword, setMasterPassword] = useState('');

  // Result
  const [itemCount, setItemCount] = useState(0);
  const [progress, setProgress] = useState<RestoreProgressEvent | null>(null);

  const canProceedToPassword =
    webdavUrl.trim().length > 0 &&
    webdavUsername.trim().length > 0 &&
    webdavPassword.trim().length > 0;

  const buildSyncConfig = (): SyncConfig => ({
    provider: 'webdav',
    webdav: {
      url: webdavUrl.trim(),
      username: webdavUsername.trim(),
      password: webdavPassword,
    },
  });

  const handleNext = () => {
    setError('');
    setStep('password');
  };

  const handleRestore = async () => {
    if (!masterPassword) return;
    setError('');
    setProgress(null);
    setStep('restoring');
    // Yield to let spinner render
    await new Promise((r) => setTimeout(r, 50));
    const config = buildSyncConfig();
    const result = await restoreFromCloud(config, masterPassword, (event) => {
      setProgress({ ...event });
    });
    if (result.success) {
      setItemCount(result.itemCount ?? 0);
      setStep('success');
    } else {
      const err = result.error ?? 'Restore failed';
      setError(err);
      // Route connection/network errors back to provider step, auth errors to password step
      const isConnectionError =
        err.includes('network') ||
        err.includes('fetch') ||
        err.includes('No vault data found') ||
        err.includes('ECONNREFUSED') ||
        err.includes('URL not allowed');
      setStep(isConnectionError ? 'provider' : 'password');
    }
  };

  const handleBack = () => {
    if (step === 'password') {
      setStep('provider');
      setError('');
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Back button (not shown during restoring or success) */}
          {step !== 'restoring' && step !== 'success' && (
            <View style={styles.backRow}>
              <Button
                title={step === 'password' ? 'Back' : 'Back to Setup'}
                variant="secondary"
                onPress={handleBack}
                style={styles.backButton}
                testID="restore-back"
              />
            </View>
          )}

          {/* Icon */}
          <View style={styles.header}>
            <View style={[styles.iconCircle, { backgroundColor: t.colors.surfaceAlt }]}>
              {step === 'success' ? (
                <Ionicons name="checkmark-circle" size={40} color={t.colors.success} />
              ) : (
                <Ionicons name="cloud-outline" size={40} color={t.colors.primary} />
              )}
            </View>
          </View>

          {/* Step: Provider + Credentials */}
          {step === 'provider' && (
            <View style={styles.form}>
              <Text style={[styles.title, { color: t.colors.text }]}>Restore from Cloud</Text>
              <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
                Connect to your cloud sync provider to restore an existing vault.
              </Text>

              <TextInput
                label="WebDAV URL"
                placeholder="https://dav.example.com/keykeykey/"
                value={webdavUrl}
                onChangeText={setWebdavUrl}
                autoCapitalize="none"
                keyboardType="url"
                testID="restore-webdav-url"
              />
              <TextInput
                label="Username"
                placeholder="your-username"
                value={webdavUsername}
                onChangeText={setWebdavUsername}
                testID="restore-webdav-username"
              />
              <TextInput
                label="Password"
                placeholder="your-password"
                value={webdavPassword}
                onChangeText={setWebdavPassword}
                isPassword
                testID="restore-webdav-password"
              />

              {error ? (
                <View
                  style={[
                    styles.errorBox,
                    { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.error },
                  ]}
                >
                  <Ionicons name="alert-circle-outline" size={16} color={t.colors.error} />
                  <Text style={[styles.errorBoxText, { color: t.colors.error }]}>{error}</Text>
                </View>
              ) : null}

              <Button
                title="Next"
                onPress={handleNext}
                disabled={!canProceedToPassword}
                testID="restore-next"
              />
            </View>
          )}

          {/* Step: Master Password */}
          {step === 'password' && (
            <View style={styles.form}>
              <Text style={[styles.title, { color: t.colors.text }]}>Enter Master Password</Text>
              <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
                Enter the master password for the vault stored on your cloud provider.
              </Text>

              <View style={[styles.infoRow, { backgroundColor: t.colors.surfaceAlt }]}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={16}
                  color={t.colors.textSecondary}
                />
                <Text style={[styles.infoText, { color: t.colors.textSecondary }]}>
                  Your password is used locally to decrypt the vault and is never sent to the
                  server.
                </Text>
              </View>

              <TextInput
                label="Master Password"
                placeholder="Enter your master password"
                value={masterPassword}
                onChangeText={setMasterPassword}
                isPassword
                testID="restore-master-password"
              />

              {error ? (
                <View
                  style={[
                    styles.errorBox,
                    { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.error },
                  ]}
                >
                  <Ionicons name="alert-circle-outline" size={16} color={t.colors.error} />
                  <Text style={[styles.errorBoxText, { color: t.colors.error }]}>{error}</Text>
                </View>
              ) : null}

              <Button
                title="Restore Vault"
                onPress={handleRestore}
                disabled={!masterPassword}
                testID="restore-submit"
              />
            </View>
          )}

          {/* Step: Restoring (progress) */}
          {step === 'restoring' && (
            <View style={styles.centeredContent}>
              <Text style={[styles.title, { color: t.colors.text }]}>Restoring Vault</Text>
              <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
                {progress
                  ? progress.phase === 'downloading'
                    ? `Downloading item ${progress.completed} of ${progress.total}...`
                    : `Importing item ${progress.completed} of ${progress.total}...`
                  : 'Connecting to cloud...'}
              </Text>
              <ActivityIndicator size="large" color={t.colors.primary} style={styles.spinner} />
            </View>
          )}

          {/* Step: Success */}
          {step === 'success' && (
            <View style={styles.centeredContent}>
              <Text style={[styles.title, { color: t.colors.text }]}>Vault Restored</Text>
              <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
                Successfully restored {itemCount} {itemCount === 1 ? 'item' : 'items'} from the
                cloud.
              </Text>
              <Button
                title="Go to Vault"
                onPress={() => router.replace('/(tabs)')}
                testID="restore-success-continue"
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  backRow: {
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    minHeight: 36,
  },
  header: {
    alignItems: 'center',
    marginBottom: 8,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    width: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  errorBoxText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  centeredContent: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  spinner: {
    marginTop: 24,
  },
});
