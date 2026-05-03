import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';
import { useSyncSettings } from '@keykeykey/ui';
import type { SyncSettingsDriver, SyncStatus } from '@keykeykey/ui';
import type { SyncProvider } from '@keykeykey/core/sync';
import { startGoogleOAuth, revokeToken, getClientId } from '../../lib/google-oauth';
import { startDropboxOAuth, revokeDropboxToken, DROPBOX_CLIENT_ID } from '../../lib/dropbox-oauth';
import { startOneDriveOAuth, ONEDRIVE_CLIENT_ID } from '../../lib/onedrive-oauth';

function buildSyncStatus(
  syncConfig: { provider: SyncProvider } | null,
  lastSynced: string | null,
): SyncStatus | null {
  if (!syncConfig || syncConfig.provider === 'none') return null;
  return {
    provider: syncConfig.provider,
    lastSynced,
    isSyncing: false,
    error: null,
  };
}

export default function SyncSettingsScreen() {
  const vault = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  const driver = useMemo<SyncSettingsDriver>(() => {
    return {
      validateMasterPassword: (password) => vault.validateMasterPassword(password),

      saveConfig: (config) => vault.saveSyncConfig(config),

      // Read mismatchInfo via the lifecycle-backed getter instead of
      // `vault.vaultMismatchInfo` — the React state is captured in this
      // memoized driver's closure, and an in-flight `handleWebdavConnect`
      // calls `driver.refreshStatus()` *after* `triggerSync()` has set the
      // mismatch but *before* React has committed the re-render, so the
      // closure still sees the pre-trigger null. The getter reads straight
      // from `lifecycleRef.current.mismatchInfo`, which is always current.
      getInitialState: async () => ({
        syncStatus: buildSyncStatus(vault.syncConfig, vault.lastSynced),
        mismatchInfo: vault.getMismatchInfoNow(),
      }),

      refreshStatus: async () => ({
        syncStatus: buildSyncStatus(vault.syncConfig, vault.lastSynced),
        mismatchInfo: vault.getMismatchInfoNow(),
      }),

      triggerSync: async () => {
        const r = await vault.triggerSync();
        return {
          lastSynced: r.lastSynced ?? undefined,
          error: r.error ?? undefined,
          mismatchInfo: r.mismatchInfo ?? vault.getMismatchInfoNow() ?? undefined,
        };
      },

      disconnect: async (provider: SyncProvider) => {
        if (provider === 'google-drive' && vault.syncConfig?.googleDrive?.refreshToken) {
          try {
            await revokeToken(vault.syncConfig.googleDrive.refreshToken);
          } catch {
            // Best-effort
          }
        }
        if (provider === 'dropbox' && vault.syncConfig?.dropbox?.refreshToken) {
          try {
            await revokeDropboxToken(vault.syncConfig.dropbox.refreshToken);
          } catch {
            // Best-effort
          }
        }
        await vault.saveSyncConfig({ provider: 'none' });
      },

      startOAuth: async (provider, masterPassword) => {
        if (provider === 'google-drive') {
          const { refreshToken } = await startGoogleOAuth();
          await vault.saveSyncConfig({
            provider: 'google-drive',
            masterPassword,
            googleDrive: { refreshToken, clientId: getClientId() },
          });
        } else if (provider === 'dropbox') {
          const { refreshToken } = await startDropboxOAuth();
          await vault.saveSyncConfig({
            provider: 'dropbox',
            masterPassword,
            dropbox: { refreshToken, clientId: DROPBOX_CLIENT_ID },
          });
        } else if (provider === 'onedrive') {
          const { refreshToken } = await startOneDriveOAuth();
          await vault.saveSyncConfig({
            provider: 'onedrive',
            masterPassword,
            onedrive: { refreshToken, clientId: ONEDRIVE_CLIENT_ID },
          });
        }
        await vault.triggerSync();
      },

      mergeVaults: async () => {
        const result = await vault.mergeRemoteVault();
        if (!result.success) throw new Error(result.error ?? 'Merge failed');
      },

      replaceLocal: async () => {
        const result = await vault.replaceLocalVault();
        if (!result.success) throw new Error(result.error ?? 'Replace failed');
      },

      replaceRemote: async () => {
        const result = await vault.replaceRemoteVault();
        if (!result.success) throw new Error(result.error ?? 'Replace failed');
      },

      clearMismatch: () => vault.clearVaultMismatch(),
    };
  }, [vault]);

  const state = useSyncSettings(driver);

  const providers: { id: SyncProvider; label: string; comingSoon?: boolean }[] = [
    { id: 'none', label: 'None (Local Only)' },
    { id: 'webdav', label: 'WebDAV' },
    { id: 'google-drive', label: 'Google Drive' },
    { id: 'dropbox', label: 'Dropbox' },
    { id: 'onedrive', label: 'OneDrive' },
  ];
  const remoteItemCount = state.mismatchInfo?.remoteItemCount;
  const mismatchDescription = state.mismatchInfo?.canRestore
    ? typeof remoteItemCount === 'number'
      ? `The remote server has a vault with ${remoteItemCount} item${remoteItemCount === 1 ? '' : 's'} from a different device.`
      : 'The remote server has an existing vault from a different device.'
    : 'The remote server has vault data encrypted with a different password.';

  const confirmDisconnect = () => {
    Alert.alert(
      'Disconnect Sync',
      'Are you sure? You will need to re-enter your credentials to reconnect.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => state.handleDisconnect(),
        },
      ],
    );
  };

  const renderMismatchResolution = () => (
    <>
      <View style={styles.dialogHeader}>
        <Ionicons name="warning-outline" size={22} color={t.colors.warning} />
        <Text style={[styles.dialogTitle, { color: t.colors.text }]}>
          {state.mismatchInfo?.canRestore ? 'Remote Vault Detected' : 'Incompatible Remote Vault'}
        </Text>
      </View>
      <Text style={[styles.dialogDescription, { color: t.colors.textSecondary }]}>
        {mismatchDescription}
      </Text>
      <View style={styles.dialogActions}>
        {state.mismatchInfo?.canRestore && (
          <>
            <Button
              testID="sync-conflict-merge"
              title={state.merging ? 'Merging...' : 'Merge Vaults'}
              onPress={state.handleMismatchMerge}
              variant="primary"
              loading={state.merging}
              disabled={state.merging || state.replacingLocal || state.replacingRemote}
              style={styles.dialogButton}
            />
            <Button
              testID="sync-conflict-replace-local"
              title={state.replacingLocal ? 'Replacing...' : 'Replace Local with Remote'}
              onPress={state.handleMismatchReplaceLocal}
              variant="secondary"
              loading={state.replacingLocal}
              disabled={state.merging || state.replacingLocal || state.replacingRemote}
              style={styles.dialogButton}
            />
          </>
        )}
        <Button
          testID="sync-conflict-replace-remote"
          title={state.replacingRemote ? 'Replacing...' : 'Replace Remote with Local'}
          onPress={state.handleMismatchReplaceRemote}
          variant="danger"
          loading={state.replacingRemote}
          disabled={state.merging || state.replacingLocal || state.replacingRemote}
          style={styles.dialogButton}
        />
        <Button
          testID="sync-conflict-cancel"
          title="Cancel"
          onPress={state.handleMismatchCancel}
          variant="secondary"
          disabled={state.merging || state.replacingLocal || state.replacingRemote}
          style={styles.dialogButton}
        />
      </View>
    </>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          testID="sync-back"
          onPress={() => router.dismissTo('/(tabs)/settings')}
          hitSlop={8}
        >
          <Ionicons name="arrow-back" size={24} color={t.colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: t.colors.text }]}>Cloud Sync</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {/* Provider picker */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: t.colors.textSecondary }]}>PROVIDER</Text>
          <View
            testID="sync-provider"
            style={[
              styles.card,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            {providers.map((p) => {
              const selected = state.syncProvider === p.id;
              const disabled = state.isConnected || p.comingSoon;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    if (!disabled) state.setSyncProvider(p.id);
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
        {state.syncProvider === 'webdav' && !state.isConnected && (
          <View style={styles.form}>
            <TextInput
              testID="sync-webdav-url"
              label="Server URL"
              value={state.webdavUrl}
              onChangeText={state.setWebdavUrl}
              placeholder="https://dav.example.com/remote.php/dav/files/user/"
              autoCapitalize="none"
              keyboardType="url"
            />
            <TextInput
              testID="sync-webdav-username"
              label="Username"
              value={state.webdavUsername}
              onChangeText={state.setWebdavUsername}
              placeholder="username"
            />
            <TextInput
              testID="sync-webdav-password"
              label="Password"
              value={state.webdavPassword}
              onChangeText={state.setWebdavPassword}
              placeholder="password"
              isPassword
            />
            <TextInput
              label="Master Password"
              value={state.masterPassword}
              onChangeText={state.setMasterPassword}
              placeholder="Enter your vault master password"
              isPassword
              testID="sync-master-password"
            />
          </View>
        )}

        {/* OAuth provider form (not connected) */}
        {(state.syncProvider === 'google-drive' ||
          state.syncProvider === 'dropbox' ||
          state.syncProvider === 'onedrive') &&
          !state.isConnected && (
            <View style={styles.form}>
              <TextInput
                label="Master Password"
                value={state.masterPassword}
                onChangeText={state.setMasterPassword}
                placeholder="Enter your vault master password"
                isPassword
                testID="sync-master-password"
              />
            </View>
          )}

        {/* Connected: status card */}
        {state.isConnected && (
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
            {state.syncStatus?.lastSynced && (
              <Text
                testID="sync-status"
                style={{ color: t.colors.textSecondary, fontSize: 13, marginBottom: 4 }}
              >
                Last synced: {new Date(state.syncStatus.lastSynced).toLocaleString()}
              </Text>
            )}
            {state.error && (
              <Text style={{ color: t.colors.error, fontSize: 13, marginBottom: 4 }}>
                {state.error}
              </Text>
            )}
          </View>
        )}

        {/* Error (not connected) */}
        {!state.isConnected && state.error && (
          <Text style={[styles.errorText, { color: t.colors.error }]}>{state.error}</Text>
        )}

        {!state.isConnected && state.mismatchInfo != null && (
          <View
            testID="sync-conflict-inline"
            style={[
              styles.statusCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            {renderMismatchResolution()}
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {state.isConnected ? (
            <>
              <Button
                testID="sync-now"
                title={state.syncing ? 'Syncing\u2026' : 'Sync Now'}
                onPress={state.handleSyncNow}
                loading={state.syncing}
                disabled={state.syncing}
              />
              <Button
                testID="sync-disconnect"
                title="Disconnect"
                onPress={confirmDisconnect}
                variant="danger"
                style={{ marginTop: 12 }}
              />
            </>
          ) : (
            <>
              {state.syncProvider === 'webdav' && state.mismatchInfo == null && (
                <Button
                  testID="sync-connect"
                  title="Connect"
                  onPress={state.handleWebdavConnect}
                  loading={state.connecting}
                  disabled={!state.canConnect || state.connecting}
                />
              )}
              {state.syncProvider === 'google-drive' && state.mismatchInfo == null && (
                <Button
                  title="Sign in with Google"
                  onPress={() => state.handleOAuthConnect('google-drive')}
                  loading={state.connecting}
                  disabled={!state.masterPassword.trim() || state.connecting}
                />
              )}
              {state.syncProvider === 'dropbox' && state.mismatchInfo == null && (
                <Button
                  title="Sign in with Dropbox"
                  onPress={() => state.handleOAuthConnect('dropbox')}
                  loading={state.connecting}
                  disabled={!state.masterPassword.trim() || state.connecting}
                />
              )}
              {state.syncProvider === 'onedrive' && state.mismatchInfo == null && (
                <Button
                  title="Sign in with OneDrive"
                  onPress={() => state.handleOAuthConnect('onedrive')}
                  loading={state.connecting}
                  disabled={!state.masterPassword.trim() || state.connecting}
                />
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Connecting overlay — blocks navigation until sync completes or mismatch dialog appears */}
      <Modal
        visible={state.connecting && state.mismatchInfo == null}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.dialogCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <View style={[styles.dialogHeader, { justifyContent: 'center' }]}>
              <Ionicons name="cloud-outline" size={28} color={t.colors.primary} />
            </View>
            <Text
              style={[
                styles.dialogTitle,
                { color: t.colors.text, textAlign: 'center', marginBottom: 8 },
              ]}
            >
              Connecting to Cloud
            </Text>
            <Text
              style={[
                styles.dialogDescription,
                { color: t.colors.textSecondary, textAlign: 'center' },
              ]}
            >
              Checking for existing vault data...
            </Text>
            <View style={styles.dialogActions}>
              <Button
                title="Cancel"
                onPress={async () => {
                  await vault.saveSyncConfig({ provider: 'none' });
                  state.setSyncProvider('none');
                  state.setMasterPassword('');
                }}
                variant="secondary"
                style={styles.dialogButton}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Vault mismatch dialog */}
      <Modal
        visible={state.isConnected && state.mismatchInfo != null}
        transparent
        animationType="fade"
        onRequestClose={state.handleMismatchCancel}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.dialogCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            {renderMismatchResolution()}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 24 },
  scrollContent: { paddingBottom: 40 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 24,
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
