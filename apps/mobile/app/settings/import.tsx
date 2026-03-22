import { useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-provider';
import { useVault } from '@/lib/vault-context';
import { Button } from '@/components/Button';
import { TextInput } from '@/components/TextInput';
import { importPasswordsCsv, detectSource, findDuplicates, stripItemMeta } from '@keykeykey/core/import';
import type { ImportSource } from '@keykeykey/core/import';
import { importEncryptedBackup } from '@keykeykey/core/export-import-zip';
import { deserializeVaultHeader, createVaultStore, type VaultItem } from '@keykeykey/core';
import { fromBase64 } from '@keykeykey/core/utils';

type Tab = 'csv' | 'encrypted';
type ImportMode = 'merge' | 'addAll';

const SOURCE_LABELS: Record<ImportSource, string> = {
  chrome: 'Chrome',
  firefox: 'Firefox',
  bitwarden: 'Bitwarden',
  icloud: 'iCloud Keychain',
  '1password': '1Password',
};

const ALL_SOURCES: ImportSource[] = ['chrome', 'firefox', 'bitwarden', 'icloud', '1password'];


export default function ImportScreen() {
  const router = useRouter();
  const { theme: t } = useTheme();
  const { items, addItems } = useVault();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('csv');

  // CSV state
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [detectedSource, setDetectedSource] = useState<ImportSource | null>(null);
  const [sourceOverride, setSourceOverride] = useState<ImportSource | null>(null);
  const [csvParseResult, setCsvParseResult] = useState<{
    items: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[];
    skipped: { row: number; reason: string }[];
    source: ImportSource;
    totalParsed: number;
  } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Encrypted backup state
  const [encFileName, setEncFileName] = useState<string | null>(null);
  const [encFileUri, setEncFileUri] = useState<string | null>(null);
  const [zipPassword, setZipPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [encError, setEncError] = useState<string | null>(null);

  // Shared state
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importing, setImporting] = useState(false);
  const [success, setSuccess] = useState<{ count: number; duplicates: number } | null>(null);

  // ---------------------------------------------------------------------------
  // CSV handlers
  // ---------------------------------------------------------------------------

  const handleCsvFilePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setCsvFileName(asset.name);
      setCsvError(null);
      setCsvParseResult(null);
      setDetectedSource(null);
      setSourceOverride(null);
      setSuccess(null);

      const text = await FileSystem.readAsStringAsync(asset.uri);
      setCsvContent(text);

      try {
        const detected = detectSource(text);
        setDetectedSource(detected);
        const parsed = importPasswordsCsv(text, detected);
        setCsvParseResult(parsed);
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV');
      }
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Failed to read file');
    }
  };

  const handleSourceOverride = (source: ImportSource) => {
    if (!csvContent) return;
    setSourceOverride(source);
    setCsvError(null);
    try {
      const parsed = importPasswordsCsv(csvContent, source);
      setCsvParseResult(parsed);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV with selected source');
      setCsvParseResult(null);
    }
  };

  const handleCsvImport = async () => {
    if (!csvParseResult || csvParseResult.items.length === 0) return;

    Alert.alert(
      'Import Passwords',
      `Import ${csvParseResult.items.length} credential${csvParseResult.items.length !== 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async () => {
            setImporting(true);
            setCsvError(null);
            try {
              let itemsToAdd = csvParseResult.items;
              let duplicateCount = 0;

              if (importMode === 'merge' && items.length > 0) {
                const tempItems: VaultItem[] = csvParseResult.items.map((item, i) => ({
                  ...item,
                  id: `temp-${i}`,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                })) as VaultItem[];

                const mergeResult = findDuplicates(tempItems, items);
                duplicateCount = mergeResult.skipped.length;

                const importIds = new Set(mergeResult.toImport.map((it) => it.id));
                itemsToAdd = csvParseResult.items.filter((_, i) => importIds.has(`temp-${i}`));
              }

              await addItems(itemsToAdd);

              setSuccess({ count: itemsToAdd.length, duplicates: duplicateCount });
            } catch (err) {
              setCsvError(err instanceof Error ? err.message : 'Import failed');
            } finally {
              setImporting(false);
            }
          },
        },
      ],
    );
  };

  // ---------------------------------------------------------------------------
  // Encrypted backup handlers
  // ---------------------------------------------------------------------------

  const handleEncFilePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/octet-stream'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setEncFileName(asset.name);
      setEncFileUri(asset.uri);
      setEncError(null);
      setSuccess(null);
    } catch (err) {
      setEncError(err instanceof Error ? err.message : 'Failed to select file');
    }
  };

  const handleEncryptedImport = async () => {
    if (!encFileUri || !masterPassword.trim()) return;
    setImporting(true);
    setEncError(null);
    try {
      const b64 = await FileSystem.readAsStringAsync(encFileUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const fileBytes = fromBase64(b64);

      // Use zip password if provided, otherwise fall back to master password
      const zipPw = zipPassword.trim() || masterPassword;

      // 1. Decrypt the backup
      let files: Map<string, Uint8Array>;
      try {
        files = await importEncryptedBackup(fileBytes, zipPw);
      } catch {
        throw new Error('Incorrect backup password');
      }

      // 2. Get the vault header
      const vaultEncBytes = files.get('vault.enc');
      if (!vaultEncBytes) {
        throw new Error('Backup does not contain a vault header (vault.enc)');
      }

      const header = deserializeVaultHeader(vaultEncBytes);

      // 3. Unlock with master password to decrypt items
      const store = createVaultStore();
      store.getState().loadHeader(header);

      const itemEntries: Uint8Array[] = [];
      for (const [path, data] of files) {
        if (path.startsWith('items/')) {
          itemEntries.push(data);
        }
      }

      try {
        await store.getState().unlock(masterPassword, itemEntries);
      } catch {
        throw new Error('Incorrect master password');
      }

      const restoredItems = store.getState().items;

      if (restoredItems.length === 0) {
        throw new Error('No items found in backup');
      }

      let itemsToAdd: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[] =
        restoredItems.map(stripItemMeta);
      let duplicateCount = 0;

      if (importMode === 'merge' && items.length > 0) {
        const mergeResult = findDuplicates(restoredItems, items);
        duplicateCount = mergeResult.skipped.length;
        const importIds = new Set(mergeResult.toImport.map((it) => it.id));
        itemsToAdd = restoredItems.filter((it) => importIds.has(it.id)).map(stripItemMeta);
      }

      await addItems(itemsToAdd);

      setSuccess({ count: itemsToAdd.length, duplicates: duplicateCount });
      setZipPassword('');
      setMasterPassword('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      setEncError(msg);
    } finally {
      setImporting(false);
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
        <Text style={[styles.title, { color: t.colors.text }]}>Import Passwords</Text>
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {/* Success banner */}
        {success && (
          <View
            style={[
              styles.banner,
              { backgroundColor: 'rgba(34,197,94,0.1)', borderColor: t.colors.success },
            ]}
          >
            <Ionicons name="checkmark-circle" size={20} color={t.colors.success} />
            <Text style={[styles.bannerText, { color: t.colors.text }]}>
              Imported {success.count} item{success.count !== 1 ? 's' : ''}
              {success.duplicates > 0 &&
                ` (${success.duplicates} duplicate${success.duplicates !== 1 ? 's' : ''} skipped)`}
            </Text>
          </View>
        )}

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
              setSuccess(null);
            }}
          >
            <Text
              style={[
                styles.tabText,
                { color: activeTab === 'csv' ? '#1a2e05' : t.colors.textSecondary },
              ]}
            >
              From CSV
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
              setSuccess(null);
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
            <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>
              SELECT CSV FILE
            </Text>

            <Pressable
              style={[
                styles.filePicker,
                {
                  borderColor: t.colors.border,
                  backgroundColor: t.colors.surface,
                },
              ]}
              onPress={handleCsvFilePick}
            >
              <Ionicons name="cloud-upload-outline" size={24} color={t.colors.textSecondary} />
              <Text style={[styles.filePickerText, { color: t.colors.textSecondary }]}>
                {csvFileName ?? 'Tap to select a .csv file'}
              </Text>
            </Pressable>

            {/* Source badge */}
            {csvParseResult && (
              <View style={styles.detectedRow}>
                <Text style={[styles.detectedLabel, { color: t.colors.textSecondary }]}>
                  Source:
                </Text>
                <View style={[styles.badge, { backgroundColor: t.colors.primary }]}>
                  <Text style={styles.badgeText}>{SOURCE_LABELS[csvParseResult.source]}</Text>
                </View>
              </View>
            )}

            {/* Source override */}
            {csvContent && (
              <View style={{ marginTop: 16 }}>
                <Text style={[styles.fieldLabel, { color: t.colors.textSecondary }]}>
                  Override Source (optional)
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: 8 }}
                >
                  {ALL_SOURCES.map((s) => (
                    <Pressable
                      key={s}
                      style={[
                        styles.sourceChip,
                        {
                          backgroundColor:
                            sourceOverride === s ? t.colors.primary : t.colors.surface,
                          borderColor: t.colors.border,
                          borderWidth: sourceOverride === s ? 0 : 1,
                        },
                      ]}
                      onPress={() => handleSourceOverride(s)}
                    >
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: '500',
                          color: sourceOverride === s ? '#1a2e05' : t.colors.textSecondary,
                        }}
                      >
                        {SOURCE_LABELS[s]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Import mode toggle */}
            {csvParseResult && csvParseResult.items.length > 0 && (
              <>
                <Text
                  style={[styles.sectionTitle, { color: t.colors.textSecondary, marginTop: 24 }]}
                >
                  IMPORT MODE
                </Text>
                <View style={styles.tabRow}>
                  <Pressable
                    style={[
                      styles.tab,
                      {
                        backgroundColor:
                          importMode === 'merge' ? t.colors.primary : t.colors.surface,
                        borderColor: t.colors.border,
                        borderWidth: importMode === 'merge' ? 0 : 1,
                      },
                    ]}
                    onPress={() => setImportMode('merge')}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        { color: importMode === 'merge' ? '#1a2e05' : t.colors.textSecondary },
                      ]}
                    >
                      Merge
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.tab,
                      {
                        backgroundColor:
                          importMode === 'addAll' ? t.colors.primary : t.colors.surface,
                        borderColor: t.colors.border,
                        borderWidth: importMode === 'addAll' ? 0 : 1,
                      },
                    ]}
                    onPress={() => setImportMode('addAll')}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        { color: importMode === 'addAll' ? '#1a2e05' : t.colors.textSecondary },
                      ]}
                    >
                      Add All
                    </Text>
                  </Pressable>
                </View>
                {importMode === 'merge' && (
                  <Text style={[styles.hintText, { color: t.colors.textSecondary }]}>
                    Duplicates will be detected and skipped based on matching credentials.
                  </Text>
                )}
                {importMode === 'addAll' && (
                  <Text style={[styles.hintText, { color: t.colors.textSecondary }]}>
                    All items will be added without duplicate detection.
                  </Text>
                )}
              </>
            )}

            {/* Preview summary */}
            {csvParseResult && (
              <View
                style={[
                  styles.previewBox,
                  { backgroundColor: t.colors.surface, borderColor: t.colors.border },
                ]}
              >
                <Text style={[styles.previewText, { color: t.colors.text }]}>
                  {csvParseResult.totalParsed} credential
                  {csvParseResult.totalParsed !== 1 ? 's' : ''} ready to import
                </Text>
                {csvParseResult.skipped.length > 0 && (
                  <Text style={[styles.previewWarning, { color: t.colors.warning }]}>
                    {csvParseResult.skipped.length} row
                    {csvParseResult.skipped.length !== 1 ? 's' : ''} skipped (invalid data)
                  </Text>
                )}
              </View>
            )}

            {/* CSV error */}
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

            {/* Import button */}
            {csvParseResult && csvParseResult.items.length > 0 && !success && (
              <View style={{ marginTop: 20 }}>
                <Button
                  title={importing ? 'Importing...' : 'Import'}
                  onPress={handleCsvImport}
                  loading={importing}
                  disabled={importing}
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
            <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>
              SELECT BACKUP FILE
            </Text>

            <Pressable
              style={[
                styles.filePicker,
                {
                  borderColor: t.colors.border,
                  backgroundColor: t.colors.surface,
                },
              ]}
              onPress={handleEncFilePick}
            >
              <Ionicons name="lock-closed-outline" size={24} color={t.colors.textSecondary} />
              <Text style={[styles.filePickerText, { color: t.colors.textSecondary }]}>
                {encFileName ?? 'Tap to select a .keykeykey file'}
              </Text>
            </Pressable>

            {/* Passwords */}
            {encFileName && (
              <>
                <Text
                  style={[styles.sectionTitle, { color: t.colors.textSecondary, marginTop: 24 }]}
                >
                  PASSWORDS
                </Text>
                <TextInput
                  label="Master Password"
                  value={masterPassword}
                  onChangeText={setMasterPassword}
                  placeholder="Master password of the backup vault"
                  isPassword
                />
                <View style={{ marginTop: 12 }}>
                  <TextInput
                    label="Backup Password (optional)"
                    value={zipPassword}
                    onChangeText={setZipPassword}
                    placeholder="Leave blank if same as master password"
                    isPassword
                  />
                </View>

                {/* Import mode toggle */}
                <Text
                  style={[styles.sectionTitle, { color: t.colors.textSecondary, marginTop: 24 }]}
                >
                  IMPORT MODE
                </Text>
                <View style={styles.tabRow}>
                  <Pressable
                    style={[
                      styles.tab,
                      {
                        backgroundColor:
                          importMode === 'merge' ? t.colors.primary : t.colors.surface,
                        borderColor: t.colors.border,
                        borderWidth: importMode === 'merge' ? 0 : 1,
                      },
                    ]}
                    onPress={() => setImportMode('merge')}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        { color: importMode === 'merge' ? '#1a2e05' : t.colors.textSecondary },
                      ]}
                    >
                      Merge
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.tab,
                      {
                        backgroundColor:
                          importMode === 'addAll' ? t.colors.primary : t.colors.surface,
                        borderColor: t.colors.border,
                        borderWidth: importMode === 'addAll' ? 0 : 1,
                      },
                    ]}
                    onPress={() => setImportMode('addAll')}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        { color: importMode === 'addAll' ? '#1a2e05' : t.colors.textSecondary },
                      ]}
                    >
                      Add All
                    </Text>
                  </Pressable>
                </View>
                {importMode === 'merge' && (
                  <Text style={[styles.hintText, { color: t.colors.textSecondary }]}>
                    Duplicates will be detected and skipped based on matching credentials.
                  </Text>
                )}
                {importMode === 'addAll' && (
                  <Text style={[styles.hintText, { color: t.colors.textSecondary }]}>
                    All items will be added without duplicate detection.
                  </Text>
                )}
              </>
            )}

            {/* Encrypted error */}
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

            {/* Import button */}
            {encFileName && masterPassword.trim() && !success && (
              <View style={{ marginTop: 20 }}>
                <Button
                  title={importing ? 'Importing...' : 'Import Backup'}
                  onPress={handleEncryptedImport}
                  loading={importing}
                  disabled={importing}
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
  filePicker: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 8,
    marginBottom: 12,
  },
  filePickerText: {
    fontSize: 14,
  },
  detectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  detectedLabel: {
    fontSize: 14,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a2e05',
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  sourceChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  hintText: {
    fontSize: 12,
    marginTop: 8,
  },
  previewBox: {
    marginTop: 20,
    padding: 16,
    borderWidth: 1,
    borderRadius: 8,
  },
  previewText: {
    fontSize: 14,
  },
  previewWarning: {
    fontSize: 12,
    marginTop: 4,
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
