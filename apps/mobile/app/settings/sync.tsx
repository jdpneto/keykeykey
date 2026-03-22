import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';
import type { SyncProvider, SyncConfig } from '@keykeykey/core/sync';
import { startGoogleOAuth, revokeToken, getClientId } from '../../lib/google-oauth';

export default function SyncSettingsScreen() {
  const {
    syncConfig,
    saveSyncConfig,
    triggerSync,
    validateMasterPassword,
    vaultMismatchInfo,
    clearVaultMismatch,
    replaceRemoteVault,
    mergeRemoteVault,
    replaceLocalVault,
  } = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  const [syncProvider, setSyncProvider] = useState<SyncProvider>(syncConfig?.provider ?? 'none');
  const [webdavUrl, setWebdavUrl] = useState(syncConfig?.webdav?.url ?? '');
  const [webdavUsername, setWebdavUsername] = useState(syncConfig?.webdav?.username ?? '');
  // Never load the password from stored config into UI state — avoid holding plaintext in memory.
  const [webdavPassword, setWebdavPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');

  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [replacingLocal, setReplacingLocal] = useState(false);
  const [replacingRemote, setReplacingRemote] = useState(false);

  const isConnected = syncConfig != null && syncConfig.provider !== 'none';

  const canConnect =
    syncProvider === 'webdav' &&
    webdavUrl.trim().length > 0 &&
    webdavUsername.trim().length > 0 &&
    webdavPassword.trim().length > 0 &&
    masterPassword.trim() !== '';

  useEffect(() => {
    if (syncConfig) {
      setSyncProvider(syncConfig.provider);
      if (syncConfig.provider === 'webdav' && syncConfig.webdav) {
        setWebdavUrl(syncConfig.webdav.url);
        setWebdavUsername(syncConfig.webdav.username);
        // Do not reload password into state — avoid holding plaintext credentials in memory.
      }
    }
  }, [syncConfig]);

  const handleConnect = async () => {
    if (syncProvider !== 'webdav') return;
    setConnecting(true);
    setSyncError(null);
    try {
      const valid = await validateMasterPassword(masterPassword);
      if (!valid) {
        setSyncError('Incorrect master password');
        setConnecting(false);
        return;
      }
      const config: SyncConfig = {
        provider: 'webdav',
        webdav: {
          url: webdavUrl.trim(),
          username: webdavUsername.trim(),
          password: webdavPassword,
        },
        masterPassword,
      };
      await saveSyncConfig(config);
      setMasterPassword('');
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Sync',
      'Are you sure? You will need to re-enter your credentials to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setSyncError(null);
            try {
              // Best-effort revocation of Google refresh token before disconnecting
              if (
                syncConfig?.provider === 'google-drive' &&
                syncConfig.googleDrive?.refreshToken
              ) {
                try {
                  await revokeToken(syncConfig.googleDrive.refreshToken);
                } catch {
                  // Best-effort — continue with disconnect even if revocation fails
                }
              }
              await saveSyncConfig({ provider: 'none' });
              setSyncProvider('none');
              setWebdavUrl('');
              setWebdavUsername('');
              setWebdavPassword('');
              setMasterPassword('');
              setLastSynced(null);
            } catch (e) {
              setSyncError(e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await triggerSync();
      if (result.error) {
        setSyncError(result.error);
      } else {
        setLastSynced(result.lastSynced);
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleMismatchMerge = async () => {
    setMerging(true);
    setSyncError(null);
    try {
      const result = await mergeRemoteVault();
      if (result.success) {
        setLastSynced(new Date().toISOString());
      } else {
        setSyncError(result.error ?? 'Merge failed');
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  };

  const handleMismatchReplaceLocal = async () => {
    setReplacingLocal(true);
    setSyncError(null);
    try {
      const result = await replaceLocalVault();
      if (result.success) {
        setLastSynced(new Date().toISOString());
      } else {
        setSyncError(result.error ?? 'Replace failed');
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplacingLocal(false);
    }
  };

  const handleMismatchReplace = async () => {
    if (!syncConfig || syncConfig.provider === 'none') return;
    setReplacingRemote(true);
    setSyncError(null);
    try {
      const result = await replaceRemoteVault();
      if (result.success) {
        setLastSynced(new Date().toISOString());
      } else {
        setSyncError(result.error ?? 'Replace failed');
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplacingRemote(false);
    }
  };

  const handleMismatchCancel = async () => {
    await clearVaultMismatch();
    setSyncProvider('none');
    setWebdavUrl('');
    setWebdavUsername('');
    setWebdavPassword('');
    setLastSynced(null);
    setSyncError(null);
  };

  const handleGoogleConnect = async () => {
    if (!masterPassword) {
      setSyncError('Master password is required.');
      return;
    }
    setConnecting(true);
    setSyncError(null);
    try {
      const { refreshToken } = await startGoogleOAuth();
      const config: SyncConfig = {
        provider: 'google-drive',
        masterPassword,
        googleDrive: { refreshToken, clientId: getClientId() },
      };
      await saveSyncConfig(config);
      const result = await triggerSync();
      if (result.error) setSyncError(result.error);
      else setLastSynced(result.lastSynced);
      setMasterPassword('');
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Google sign-in failed');
    } finally {
      setConnecting(false);
    }
  };

  const isSyncing = syncing;

  const providers: { id: SyncProvider; label: string; comingSoon?: boolean }[] = [
    { id: 'none', label: 'None (Local Only)' },
    { id: 'webdav', label: 'WebDAV' },
    { id: 'google-drive', label: 'Google Drive' },
    { id: 'icloud', label: 'iCloud (Coming Soon)', comingSoon: true },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="arrow-back" size={24} color={t.colors.text} />
          </Pressable>
          <Text style={[styles.title, { color: t.colors.text }]}>Cloud Sync</Text>
        </View>

        {/* Provider picker */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: t.colors.textSecondary }]}>PROVIDER</Text>
          <View
            style={[
              styles.card,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            {providers.map((p) => {
              const selected = syncProvider === p.id;
              const disabled = isConnected || p.comingSoon;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    if (!disabled) setSyncProvider(p.id);
                  }}
                  style={[
                    styles.radioRow,
                    { borderBottomColor: t.colors.border, opacity: p.comingSoon ? 0.5 : 1 },
                  ]}
                  disabled={disabled}
                >
                  <View
                    style={[
                      styles.radioCircle,
                      {
                        borderColor: selected ? t.colors.primary : t.colors.border,
                      },
                    ]}
                  >
                    {selected && (
                      <View style={[styles.radioDot, { backgroundColor: t.colors.primary }]} />
                    )}
                  </View>
                  <Text style={[styles.radioLabel, { color: t.colors.text }]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* WebDAV form (not connected) */}
        {syncProvider === 'webdav' && !isConnected && (
          <View style={styles.form}>
            <TextInput
              label="Server URL"
              value={webdavUrl}
              onChangeText={setWebdavUrl}
              placeholder="https://dav.example.com/remote.php/dav/files/user/"
              autoCapitalize="none"
              keyboardType="url"
            />
            <TextInput
              label="Username"
              value={webdavUsername}
              onChangeText={setWebdavUsername}
              placeholder="username"
            />
            <TextInput
              label="Password"
              value={webdavPassword}
              onChangeText={setWebdavPassword}
              placeholder="password"
              isPassword
            />
            <TextInput
              label="Master Password"
              value={masterPassword}
              onChangeText={setMasterPassword}
              placeholder="Enter your vault master password"
              isPassword
              testID="sync-master-password"
            />
          </View>
        )}

        {/* Google Drive form (not connected) */}
        {syncProvider === 'google-drive' && !isConnected && (
          <View style={styles.form}>
            <TextInput
              label="Master Password"
              value={masterPassword}
              onChangeText={setMasterPassword}
              placeholder="Enter your vault master password"
              isPassword
              testID="sync-master-password"
            />
          </View>
        )}

        {/* Coming-soon banner */}
        {syncProvider === 'icloud' && (
          <View
            style={[
              styles.banner,
              { backgroundColor: t.colors.warningLight, borderColor: t.colors.warning },
            ]}
          >
            <Ionicons name="construct-outline" size={18} color={t.colors.warning} />
            <Text style={[styles.bannerText, { color: t.colors.text }]}>
              iCloud sync is not yet available.
            </Text>
          </View>
        )}

        {/* Connected: status card */}
        {isConnected && (
          <View
            style={[
              styles.statusCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Ionicons name="checkmark-circle" size={20} color={t.colors.success} />
              <Text style={[{ fontSize: 15, fontWeight: '600' }, { color: t.colors.text }]}>
                Connected
              </Text>
            </View>
            {lastSynced && (
              <Text style={{ color: t.colors.textSecondary, fontSize: 13, marginBottom: 4 }}>
                Last synced: {new Date(lastSynced).toLocaleString()}
              </Text>
            )}
            {syncError && (
              <Text style={{ color: t.colors.error, fontSize: 13, marginBottom: 4 }}>
                {syncError}
              </Text>
            )}
          </View>
        )}

        {/* Error (not connected) */}
        {!isConnected && syncError && (
          <Text style={[styles.errorText, { color: t.colors.error }]}>{syncError}</Text>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {isConnected ? (
            <>
              <Button
                title={isSyncing ? 'Syncing…' : 'Sync Now'}
                onPress={handleSyncNow}
                loading={isSyncing}
                disabled={isSyncing}
              />
              <Button
                title="Disconnect"
                onPress={handleDisconnect}
                variant="danger"
                style={{ marginTop: 12 }}
              />
            </>
          ) : (
            <>
              {syncProvider === 'webdav' && (
                <Button
                  title="Connect"
                  onPress={handleConnect}
                  loading={connecting}
                  disabled={!canConnect || connecting}
                />
              )}
              {syncProvider === 'google-drive' && (
                <Button
                  title="Sign in with Google"
                  onPress={handleGoogleConnect}
                  loading={connecting}
                  disabled={!masterPassword.trim() || connecting}
                />
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Vault mismatch dialog */}
      <Modal
        visible={vaultMismatchInfo != null}
        transparent
        animationType="fade"
        onRequestClose={handleMismatchCancel}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.dialogCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <View style={styles.dialogHeader}>
              <Ionicons name="warning-outline" size={22} color={t.colors.warning} />
              <Text style={[styles.dialogTitle, { color: t.colors.text }]}>
                {vaultMismatchInfo?.canRestore
                  ? 'Remote Vault Detected'
                  : 'Incompatible Remote Vault'}
              </Text>
            </View>
            <Text style={[styles.dialogDescription, { color: t.colors.textSecondary }]}>
              {vaultMismatchInfo?.canRestore
                ? `The remote server has a vault with ${vaultMismatchInfo.remoteItemCount} item${vaultMismatchInfo.remoteItemCount === 1 ? '' : 's'} from a different device.`
                : 'The remote server has vault data encrypted with a different password.'}
            </Text>
            <View style={styles.dialogActions}>
              {vaultMismatchInfo?.canRestore && (
                <>
                  <Button
                    title={merging ? 'Merging...' : 'Merge Vaults'}
                    onPress={handleMismatchMerge}
                    variant="primary"
                    loading={merging}
                    disabled={merging || replacingLocal || replacingRemote}
                    style={styles.dialogButton}
                  />
                  <Button
                    title={replacingLocal ? 'Replacing...' : 'Replace Local with Remote'}
                    onPress={handleMismatchReplaceLocal}
                    variant="secondary"
                    loading={replacingLocal}
                    disabled={merging || replacingLocal || replacingRemote}
                    style={styles.dialogButton}
                  />
                </>
              )}
              <Button
                title={replacingRemote ? 'Replacing...' : 'Replace Remote with Local'}
                onPress={handleMismatchReplace}
                variant="danger"
                loading={replacingRemote}
                disabled={merging || replacingLocal || replacingRemote}
                style={styles.dialogButton}
              />
              <Button
                title="Cancel"
                onPress={handleMismatchCancel}
                variant="secondary"
                disabled={merging || replacingLocal || replacingRemote}
                style={styles.dialogButton}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
    paddingHorizontal: 16,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  radioLabel: {
    fontSize: 15,
  },
  form: {
    marginBottom: 20,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 20,
  },
  bannerText: {
    fontSize: 14,
    flex: 1,
  },
  statusCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  actions: {
    gap: 0,
  },
  errorText: {
    fontSize: 14,
    marginBottom: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialogCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },
  dialogDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  dialogActions: {
    gap: 10,
  },
  dialogButton: {
    marginTop: 0,
  },
});
