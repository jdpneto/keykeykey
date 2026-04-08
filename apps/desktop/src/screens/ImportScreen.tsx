import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle, Upload, FileText, Lock } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';
import {
  importPasswordsCsv,
  detectSource,
  findDuplicates,
  stripItemMeta,
} from '@keykeykey/core/import';
import type { ImportSource } from '@keykeykey/core/import';
import { importEncryptedBackup } from '@keykeykey/core/export-import-zip';
import { deserializeVaultHeader, createVaultStore, type VaultItem } from '@keykeykey/core';

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

export function ImportScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { items, addItems } = useVault();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('csv');

  // CSV state
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [sourceOverride, setSourceOverride] = useState<ImportSource | ''>('');
  const [csvParseResult, setCsvParseResult] = useState<{
    items: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[];
    skipped: { row: number; reason: string }[];
    source: ImportSource;
    totalParsed: number;
  } | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Encrypted backup state
  const [encFile, setEncFile] = useState<File | null>(null);
  const [zipPassword, setZipPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [encError, setEncError] = useState<string | null>(null);

  // Shared state
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [success, setSuccess] = useState<{ count: number; duplicates: number } | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const encInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // CSV handlers
  // ---------------------------------------------------------------------------

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFile(file);
    setCsvError(null);
    setCsvParseResult(null);

    setSourceOverride('');
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvContent(text);
      try {
        const detected = detectSource(text);

        const result = importPasswordsCsv(text, detected);
        setCsvParseResult(result);
      } catch (err) {
        setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV');
      }
    };
    reader.onerror = () => {
      setCsvError('Failed to read file');
    };
    reader.readAsText(file);
  };

  const handleSourceOverride = (source: ImportSource) => {
    if (!csvContent) return;
    setSourceOverride(source);
    setCsvError(null);
    try {
      const result = importPasswordsCsv(csvContent, source);
      setCsvParseResult(result);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Failed to parse CSV with selected source');
      setCsvParseResult(null);
    }
  };

  const handleCsvImport = async () => {
    if (!csvParseResult || csvParseResult.items.length === 0) return;
    setImporting(true);
    setSyncing(false);
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

      setSyncing(true);
      await addItems(itemsToAdd);
      setSyncing(false);

      setSuccess({ count: itemsToAdd.length, duplicates: duplicateCount });
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Encrypted backup handlers
  // ---------------------------------------------------------------------------

  const handleEncFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEncFile(file);
    setEncError(null);
    setSuccess(null);
  };

  const handleEncryptedImport = async () => {
    if (!encFile || !masterPassword.trim()) return;
    setImporting(true);
    setEncError(null);
    try {
      const arrayBuffer = await encFile.arrayBuffer();
      const fileBytes = new Uint8Array(arrayBuffer);

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
      // Clear sensitive fields
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
  // Shared styles
  // ---------------------------------------------------------------------------

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    marginTop: 24,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 16px',
    background: active ? theme.colors.primary : 'transparent',
    color: active ? '#000000' : theme.colors.textSecondary,
    border: active ? 'none' : `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    cursor: 'pointer',
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    transition: 'all 0.15s ease',
  });

  const fileDropStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '24px 16px',
    border: `2px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    cursor: 'pointer',
    background: theme.colors.surface,
    transition: 'border-color 0.15s ease',
  };

  const badgeStyle = (color: string): React.CSSProperties => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: theme.radii.sm,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    background: color,
    color: '#000',
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 520 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: theme.colors.textSecondary,
            display: 'flex',
            alignItems: 'center',
            padding: 4,
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            margin: 0,
          }}
        >
          Import Passwords
        </h1>
      </div>

      {/* Success toast */}
      {success && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            background: theme.colors.successLight ?? 'rgba(34,197,94,0.1)',
            border: `1px solid ${theme.colors.success}`,
            borderRadius: theme.radii.md,
            marginBottom: 20,
          }}
        >
          <CheckCircle size={18} style={{ color: theme.colors.success, flexShrink: 0 }} />
          <span style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}>
            Successfully imported {success.count} item{success.count !== 1 ? 's' : ''}
            {success.duplicates > 0 &&
              ` (${success.duplicates} duplicate${success.duplicates !== 1 ? 's' : ''} skipped)`}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          style={tabStyle(activeTab === 'csv')}
          onClick={() => {
            setActiveTab('csv');
            setSuccess(null);
          }}
        >
          <FileText size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          From CSV
        </button>
        <button
          style={tabStyle(activeTab === 'encrypted')}
          onClick={() => {
            setActiveTab('encrypted');
            setSuccess(null);
          }}
        >
          <Lock size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          From Encrypted Backup
        </button>
      </div>

      {/* ================================================================= */}
      {/* CSV Tab */}
      {/* ================================================================= */}
      {activeTab === 'csv' && (
        <div>
          {/* File picker */}
          <div style={sectionHeaderStyle}>Select CSV File</div>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            onChange={handleCsvFileChange}
            style={{ display: 'none' }}
          />
          <div
            style={fileDropStyle}
            onClick={() => csvInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') csvInputRef.current?.click();
            }}
          >
            <Upload size={24} style={{ color: theme.colors.textSecondary }} />
            <span
              style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}
            >
              {csvFile ? csvFile.name : 'Click to select a .csv file'}
            </span>
          </div>

          {/* Source badge */}
          {csvParseResult && (
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}
              >
                Source:
              </span>
              <span style={badgeStyle(theme.colors.primary)}>
                {SOURCE_LABELS[csvParseResult.source]}
              </span>
            </div>
          )}

          {/* Source override dropdown */}
          {csvContent && (
            <div style={{ marginTop: 16 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: theme.typography.weights.medium,
                  color: theme.colors.textSecondary,
                  marginBottom: 6,
                }}
              >
                Override Source (optional)
              </label>
              <select
                value={sourceOverride}
                onChange={(e) => {
                  if (e.target.value) handleSourceOverride(e.target.value as ImportSource);
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  backgroundColor: theme.colors.inputBackground,
                  color: theme.colors.text,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md,
                  fontSize: theme.typography.sizes.md,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="">Auto-detect</option>
                {ALL_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Import mode toggle */}
          {csvParseResult && csvParseResult.items.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>Import Mode</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={tabStyle(importMode === 'merge')}
                  onClick={() => setImportMode('merge')}
                >
                  Merge
                </button>
                <button
                  style={tabStyle(importMode === 'addAll')}
                  onClick={() => setImportMode('addAll')}
                >
                  Add All
                </button>
              </div>
              {importMode === 'merge' && (
                <p
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.textSecondary,
                    margin: '8px 0 0',
                  }}
                >
                  Duplicates will be detected and skipped based on matching credentials.
                </p>
              )}
              {importMode === 'addAll' && (
                <p
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.textSecondary,
                    margin: '8px 0 0',
                  }}
                >
                  All items will be added without duplicate detection.
                </p>
              )}
            </>
          )}

          {/* Preview summary */}
          {csvParseResult && (
            <div
              style={{
                marginTop: 20,
                padding: '16px',
                background: theme.colors.surface,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radii.md,
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.sizes.sm,
                  color: theme.colors.text,
                  marginBottom: 4,
                }}
              >
                {csvParseResult.totalParsed} credential{csvParseResult.totalParsed !== 1 ? 's' : ''}{' '}
                ready to import
              </div>
              {csvParseResult.skipped.length > 0 && (
                <div
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.warning,
                    marginTop: 4,
                  }}
                >
                  {csvParseResult.skipped.length} row
                  {csvParseResult.skipped.length !== 1 ? 's' : ''} skipped (invalid data)
                </div>
              )}
            </div>
          )}

          {/* CSV error */}
          {csvError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: theme.colors.errorLight,
                border: `1px solid ${theme.colors.error}`,
                borderRadius: theme.radii.sm,
                marginTop: 16,
              }}
            >
              <AlertTriangle
                size={15}
                style={{ color: theme.colors.error, flexShrink: 0, marginTop: 1 }}
              />
              <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
                {csvError}
              </span>
            </div>
          )}

          {/* Import button */}
          {csvParseResult && csvParseResult.items.length > 0 && !success && (
            <div style={{ marginTop: 20 }}>
              <Button
                title={importing && syncing ? 'Syncing to cloud…' : importing ? 'Importing…' : 'Import'}
                onPress={handleCsvImport}
                variant="primary"
                loading={importing}
                disabled={importing}
              />
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Encrypted Backup Tab */}
      {/* ================================================================= */}
      {activeTab === 'encrypted' && (
        <div>
          {/* File picker */}
          <div style={sectionHeaderStyle}>Select Backup File</div>
          <input
            ref={encInputRef}
            type="file"
            accept=".keykeykey"
            onChange={handleEncFileChange}
            style={{ display: 'none' }}
          />
          <div
            style={fileDropStyle}
            onClick={() => encInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') encInputRef.current?.click();
            }}
          >
            <Upload size={24} style={{ color: theme.colors.textSecondary }} />
            <span
              style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}
            >
              {encFile ? encFile.name : 'Click to select a .keykeykey file'}
            </span>
          </div>

          {/* Passwords */}
          {encFile && (
            <>
              <div style={sectionHeaderStyle}>Passwords</div>
              <TextInput
                label="Master Password"
                value={masterPassword}
                onChangeText={setMasterPassword}
                placeholder="Master password of the backup vault"
                secureTextEntry
              />
              <div style={{ marginTop: 12 }}>
                <TextInput
                  label="Backup Password (optional)"
                  value={zipPassword}
                  onChangeText={setZipPassword}
                  placeholder="Leave blank if same as master password"
                  secureTextEntry
                />
              </div>

              {/* Import mode toggle */}
              <div style={sectionHeaderStyle}>Import Mode</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={tabStyle(importMode === 'merge')}
                  onClick={() => setImportMode('merge')}
                >
                  Merge
                </button>
                <button
                  style={tabStyle(importMode === 'addAll')}
                  onClick={() => setImportMode('addAll')}
                >
                  Add All
                </button>
              </div>
              {importMode === 'merge' && (
                <p
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.textSecondary,
                    margin: '8px 0 0',
                  }}
                >
                  Duplicates will be detected and skipped based on matching credentials.
                </p>
              )}
              {importMode === 'addAll' && (
                <p
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.textSecondary,
                    margin: '8px 0 0',
                  }}
                >
                  All items will be added without duplicate detection.
                </p>
              )}
            </>
          )}

          {/* Encrypted error */}
          {encError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: theme.colors.errorLight,
                border: `1px solid ${theme.colors.error}`,
                borderRadius: theme.radii.sm,
                marginTop: 16,
              }}
            >
              <AlertTriangle
                size={15}
                style={{ color: theme.colors.error, flexShrink: 0, marginTop: 1 }}
              />
              <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
                {encError}
              </span>
            </div>
          )}

          {/* Import button */}
          {encFile && masterPassword.trim() && !success && (
            <div style={{ marginTop: 20 }}>
              <Button
                title={importing ? 'Importing...' : 'Import Backup'}
                onPress={handleEncryptedImport}
                variant="primary"
                loading={importing}
                disabled={importing}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
