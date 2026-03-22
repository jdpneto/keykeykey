import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Alert,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-provider';
import { useVault } from '@/lib/vault-context';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/TextInput';
import { exportToCsv } from '@keykeykey/core/export';
import { exportEncryptedBackup } from '@keykeykey/core/export-import-zip';
import { serializeVaultHeader, deserializeVaultHeader } from '@keykeykey/core';
import { fromBase64, toBase64 } from '@keykeykey/core/utils';
import { loadVaultHeader, loadAllEncryptedItems } from '@/lib/storage';

type Tab = 'csv' | 'encrypted';

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function ExportScreen() {
  const router = useRouter();
  const { theme: t } = useTheme();
  const { items } = useVault();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('csv');

  // CSV state
  const [csvExporting, setCsvExporting] = useState(false);
  const [csvSuccess, setCsvSuccess] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Encrypted state
  const [zipPassword, setZipPassword] = useState('');
  const [zipConfirm, setZipConfirm] = useState('');
  const [encExporting, setEncExporting] = useState(false);
  const [encSuccess, setEncSuccess] = useState(false);
  const [encError, setEncError] = useState<string | null>(null);

  const credentialCount = items.filter((i) => i.type === 'credential').length;

  // ---------------------------------------------------------------------------
  // CSV export handler
  // ---------------------------------------------------------------------------

  const handleCsvExport = () => {
    Alert.alert(
      'Unencrypted Export',
      `This will export ${credentialCount} credential${credentialCount !== 1 ? 's' : ''} as a plain-text CSV file. Anyone with access to this file can read your passwords. Delete it after use.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          style: 'destructive',
          onPress: async () => {
            setCsvExporting(true);
            setCsvError(null);
            setCsvSuccess(false);
            try {
              const csv = exportToCsv(items);
              const filePath = `${FileSystem.cacheDirectory}keykeykey-export-${todayString()}.csv`;
              await FileSystem.writeAsStringAsync(filePath, csv);
              await Sharing.shareAsync(filePath, {
                mimeType: 'text/csv',
                dialogTitle: 'Export CSV',
                UTI: 'public.comma-separated-values-text',
              });
              setCsvSuccess(true);
            } catch (err) {
              setCsvError(err instanceof Error ? err.message : 'Export failed');
            } finally {
              setCsvExporting(false);
            }
          },
        },
      ],
    );
  };

  // ---------------------------------------------------------------------------
  // Encrypted backup handler
  // ---------------------------------------------------------------------------

  const handleEncryptedExport = async () => {
    if (zipPassword !== zipConfirm) {
      setEncError('Passwords do not match');
      return;
    }
    if (zipPassword.length < 1) {
      setEncError('Password is required');
      return;
    }

    setEncExporting(true);
    setEncError(null);
    setEncSuccess(false);
    try {
      // Collect vault files from local storage
      const vaultFiles = new Map<string, Uint8Array>();

      const headerB64 = await loadVaultHeader();
      if (!headerB64) {
        throw new Error('No vault header found');
      }
      const headerBytes = fromBase64(headerB64);
      const header = deserializeVaultHeader(headerBytes);
      vaultFiles.set('vault.enc', serializeVaultHeader(header));

      const storedItems = await loadAllEncryptedItems();
      for (const item of storedItems) {
        vaultFiles.set(`items/${item.id}`, fromBase64(item.encrypted_data));
      }

      const backupBytes = await exportEncryptedBackup(vaultFiles, zipPassword);

      const filePath = `${FileSystem.cacheDirectory}keykeykey-backup-${todayString()}.keykeykey`;
      await FileSystem.writeAsStringAsync(filePath, toBase64(backupBytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      await Sharing.shareAsync(filePath, {
        mimeType: 'application/octet-stream',
        dialogTitle: 'Export Encrypted Backup',
      });
      setEncSuccess(true);
      setZipPassword('');
      setZipConfirm('');
    } catch (err) {
      setEncError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setEncExporting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={22} color={t.colors.textSecondary} />
        </Pressable>
        <Text style={[styles.title, { color: t.colors.text }]}>Export Vault</Text>
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {/* Tabs */}
        <View style={styles.tabRow}>
          <Pressable
            style={[
              styles.tab,
              {
                backgroundColor: activeTab === 'csv' ? t.colors.primary : t.colors.surface,
                borderColor: t.colors.border,
                borderWidth: activeTab === 'csv' ? 0 : 1,
              },
            ]}
            onPress={() => {
              setActiveTab('csv');
              setCsvSuccess(false);
              setCsvError(null);
            }}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === 'csv' ? '#1a2e05' : t.colors.textSecondary },
              ]}
            >
              Export as CSV
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.tab,
              {
                backgroundColor: activeTab === 'encrypted' ? t.colors.primary : t.colors.surface,
                borderColor: t.colors.border,
                borderWidth: activeTab === 'encrypted' ? 0 : 1,
              },
            ]}
            onPress={() => {
              setActiveTab('encrypted');
              setEncSuccess(false);
              setEncError(null);
            }}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === 'encrypted' ? '#1a2e05' : t.colors.textSecondary },
              ]}
            >
              Encrypted Backup
            </Text>
          </Pressable>
        </View>

        {/* ================================================================= */}
        {/* CSV Tab */}
        {/* ================================================================= */}
        {activeTab === 'csv' && (
          <View>
            {/* Success banner */}
            {csvSuccess && (
              <View
                style={[
                  styles.banner,
                  { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: t.colors.success },
                ]}
              >
                <Ionicons name="checkmark-circle" size={20} color={t.colors.success} />
                <Text style={[styles.bannerText, { color: t.colors.text }]}>
                  Exported successfully via share sheet.
                </Text>
              </View>
            )}

            {/* Warning */}
            <View
              style={[
                styles.warningBox,
                { backgroundColor: 'rgba(234,179,8,0.1)', borderColor: t.colors.warning },
              ]}
            >
              <Ionicons
                name="warning-outline"
                size={20}
                color={t.colors.warning}
                style={{ marginTop: 1 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.warningTitle, { color: t.colors.text }]}>
                  Unencrypted export
                </Text>
                <Text style={[styles.warningSubtext, { color: t.colors.textSecondary }]}>
                  This will export {credentialCount} credential
                  {credentialCount !== 1 ? 's' : ''} as a plain-text CSV file. Anyone with access to
                  this file can read your passwords. Delete it after use.
                </Text>
              </View>
            </View>

            {/* Error */}
            {csvError && (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: t.colors.error },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={16} color={t.colors.error} />
                <Text style={[styles.errorText, { color: t.colors.error }]}>{csvError}</Text>
              </View>
            )}

            {/* Export button */}
            {!csvSuccess && (
              <View style={{ marginTop: 20 }}>
                <Button
                  title={csvExporting ? 'Exporting...' : 'Export CSV'}
                  onPress={handleCsvExport}
                  loading={csvExporting}
                  disabled={csvExporting || credentialCount === 0}
                />
              </View>
            )}
          </View>
        )}

        {/* ================================================================= */}
        {/* Encrypted Backup Tab */}
        {/* ================================================================= */}
        {activeTab === 'encrypted' && (
          <View>
            {/* Success banner */}
            {encSuccess && (
              <View
                style={[
                  styles.banner,
                  { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: t.colors.success },
                ]}
              >
                <Ionicons name="checkmark-circle" size={20} color={t.colors.success} />
                <Text style={[styles.bannerText, { color: t.colors.text }]}>
                  Backup exported successfully via share sheet.
                </Text>
              </View>
            )}

            {/* Info text */}
            <Text style={[styles.infoText, { color: t.colors.textSecondary }]}>
              Create an encrypted backup of your entire vault. The backup is protected with a
              password you choose below.
            </Text>

            {/* Zip password */}
            <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>
              BACKUP PASSWORD
            </Text>
            <TextInput
              label="Password"
              value={zipPassword}
              onChangeText={setZipPassword}
              placeholder="Choose a password for the backup"
              isPassword
            />
            <TextInput
              label="Confirm Password"
              value={zipConfirm}
              onChangeText={setZipConfirm}
              placeholder="Confirm the backup password"
              isPassword
            />

            {/* Argon2 indicator */}
            {encExporting && (
              <View style={styles.argonRow}>
                <ActivityIndicator size="small" color={t.colors.primary} />
                <Text style={[styles.argonText, { color: t.colors.textSecondary }]}>
                  Deriving encryption key (Argon2)...
                </Text>
              </View>
            )}

            {/* Error */}
            {encError && (
              <View
                style={[
                  styles.errorBox,
                  { backgroundColor: 'rgba(239,68,68,0.1)', borderColor: t.colors.error },
                ]}
              >
                <Ionicons name="alert-circle-outline" size={16} color={t.colors.error} />
                <Text style={[styles.errorText, { color: t.colors.error }]}>{encError}</Text>
              </View>
            )}

            {/* Export button */}
            {!encSuccess && (
              <View style={{ marginTop: 20 }}>
                <Button
                  title={encExporting ? 'Encrypting & exporting...' : 'Export Backup'}
                  onPress={handleEncryptedExport}
                  loading={encExporting}
                  disabled={encExporting || !zipPassword.trim() || !zipConfirm.trim()}
                />
              </View>
            )}
          </View>
        )}

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    padding: 4,
    marginRight: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  content: {
    padding: 20,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 20,
  },
  bannerText: {
    fontSize: 14,
    flex: 1,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 16,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  warningSubtext: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  infoText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  argonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  argonText: {
    fontSize: 13,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 6,
    marginTop: 16,
  },
  errorText: {
    fontSize: 13,
    flex: 1,
  },
});
