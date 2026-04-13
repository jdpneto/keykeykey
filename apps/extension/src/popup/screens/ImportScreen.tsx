import React, { useState, useRef } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import {
  importPasswordsCsv,
  detectSource,
  findDuplicates,
  stripItemMeta,
} from '@keykeykey/core/import';
import type { ImportSource } from '@keykeykey/core/import';
import { importEncryptedBackup } from '@keykeykey/core/export-import-zip';
import { deserializeVaultHeader, createVaultStore } from '@keykeykey/core';
import type { VaultItem } from '@keykeykey/core/models';
import type { NewItemData } from '../../lib/messages.js';
import { UploadIcon } from '../components/icons/index.js';

interface ImportScreenProps {
  onBack: () => void;
  onRefresh: () => void;
}

type Tab = 'csv' | 'encrypted';
type ImportMode = 'merge' | 'addAll';

const SOURCE_LABELS: Record<ImportSource, string> = {
  keykeykey: 'KeyKeyKey',
  chrome: 'Chrome',
  firefox: 'Firefox',
  bitwarden: 'Bitwarden',
  icloud: 'iCloud Keychain',
  '1password': '1Password',
};

const ALL_SOURCES: ImportSource[] = ['chrome', 'firefox', 'bitwarden', 'icloud', '1password'];

export function ImportScreen({ onBack, onRefresh }: ImportScreenProps) {
  const { theme } = useTheme();

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
  const [success, setSuccess] = useState<{ count: number; duplicates: number } | null>(null);
  const [importProgress, setImportProgress] = useState<{
    status: 'idle' | 'importing' | 'syncing' | 'done' | 'error';
    imported: number;
    total: number;
    error?: string;
  } | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const encInputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function getCurrentItems(): Promise<VaultItem[]> {
    try {
      const result = (await sendMessage<{ items?: VaultItem[] }>({ type: 'GET_ITEMS' })) as {
        items?: VaultItem[];
      };
      return result.items ?? [];
    } catch {
      return [];
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await sendMessage<{
        status: string;
        imported: number;
        total: number;
        error?: string;
      }>({ type: 'GET_IMPORT_STATUS' });
      if (!cancelled && status && (status as { status: string }).status !== 'idle') {
        setImportProgress(status as NonNullable<typeof importProgress>);
        setImporting(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!importing) return;
    const interval = setInterval(async () => {
      const status = await sendMessage<{
        status: string;
        imported: number;
        total: number;
        error?: string;
      }>({ type: 'GET_IMPORT_STATUS' });
      if (!status) return;
      const typed = status as NonNullable<typeof importProgress>;
      setImportProgress(typed);

      if (typed.status === 'done') {
        clearInterval(interval);
        setImporting(false);
        setSuccess({ count: typed.total, duplicates: 0 });
        await sendMessage({ type: 'CLEAR_IMPORT_STATUS' });
        onRefresh();
      } else if (typed.status === 'error') {
        clearInterval(interval);
        setImporting(false);
        setCsvError(typed.error ?? 'Import failed');
        await sendMessage({ type: 'CLEAR_IMPORT_STATUS' });
      }
    }, 500);
    return () => clearInterval(interval);
  }, [importing, onRefresh]);

  // ---------------------------------------------------------------------------
  // CSV handlers
  // ---------------------------------------------------------------------------

  const handleCsvFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFile(file);
    setCsvError(null);
    setCsvParseResult(null);
    // source now tracked via csvParseResult.source
    setSourceOverride('');
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvContent(text);
      try {
        const detected = detectSource(text);
        // detected source now read from csvParseResult.source
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
    setCsvError(null);
    try {
      let itemsToAdd = csvParseResult.items;

      if (importMode === 'merge') {
        const existingItems = await getCurrentItems();
        if (existingItems.length > 0) {
          const tempItems: VaultItem[] = csvParseResult.items.map((item, i) => ({
            ...item,
            id: `temp-${i}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })) as VaultItem[];

          const mergeResult = findDuplicates(tempItems, existingItems);

          const importIds = new Set(mergeResult.toImport.map((it) => it.id));
          itemsToAdd = csvParseResult.items.filter((_, i) => importIds.has(`temp-${i}`));
        }
      }

      // Send all items in one message — background handles persist + sync
      const result = await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'IMPORT_ITEMS',
        items: itemsToAdd as NewItemData[],
      });

      if ((result as { error?: string }).error) {
        throw new Error((result as { error: string }).error);
      }

      // Polling effect will handle progress updates from here
      setImportProgress({ status: 'importing', imported: 0, total: itemsToAdd.length });
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Import failed');
      setImporting(false);
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

      let files: Map<string, Uint8Array>;
      try {
        files = await importEncryptedBackup(fileBytes, zipPw);
      } catch {
        throw new Error('Incorrect backup password');
      }

      const vaultEncBytes = files.get('vault.enc');
      if (!vaultEncBytes) {
        throw new Error('Backup does not contain a vault header (vault.enc)');
      }

      const header = deserializeVaultHeader(vaultEncBytes);

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

      let itemsToAdd: NewItemData[] = restoredItems.map(stripItemMeta);
      let duplicateCount = 0;

      if (importMode === 'merge') {
        const existingItems = await getCurrentItems();
        if (existingItems.length > 0) {
          const mergeResult = findDuplicates(restoredItems, existingItems);
          duplicateCount = mergeResult.skipped.length;
          const importIds = new Set(mergeResult.toImport.map((it) => it.id));
          itemsToAdd = restoredItems.filter((it) => importIds.has(it.id)).map(stripItemMeta);
        }
      }

      // Send all items in one IMPORT_ITEMS message — background handles
      // persist + sync, same as the CSV import path above. Avoids the
      // popup-close race that would interrupt a per-item loop.
      const result = await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'IMPORT_ITEMS',
        items: itemsToAdd,
      });
      if ((result as { error?: string }).error) {
        throw new Error((result as { error: string }).error);
      }

      setSuccess({ count: itemsToAdd.length, duplicates: duplicateCount });
      setZipPassword('');
      setMasterPassword('');
      onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed';
      setEncError(msg);
    } finally {
      setImporting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const scrollBody: React.CSSProperties = {
    flex: 1,
    overflowY: 'auto',
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px ${theme.spacing.lg}px`,
  };

  const sectionHeader: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 12px',
    background: active ? theme.colors.primary : 'transparent',
    color: active ? '#000000' : theme.colors.textSecondary,
    border: active ? 'none' : `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    cursor: 'pointer',
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    transition: 'all 0.15s ease',
  });

  const fileDrop: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '20px 12px',
    border: `2px dashed ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    cursor: 'pointer',
    background: theme.colors.surface,
  };

  const badge: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: theme.radii.sm,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    background: theme.colors.primary,
    color: '#000',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.sm,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const primaryBtn: React.CSSProperties = {
    width: '100%',
    padding: '10px 16px',
    background: theme.colors.primary,
    color: '#000',
    border: 'none',
    borderRadius: theme.radii.md,
    cursor: 'pointer',
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    opacity: importing ? 0.6 : 1,
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Show full-screen progress view if import is in progress or syncing
  if (
    importProgress &&
    (importProgress.status === 'importing' || importProgress.status === 'syncing')
  ) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
        {/* Header without back button — can't leave during import */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          <div
            style={{
              flex: 1,
              fontWeight: theme.typography.weights.bold,
              fontSize: theme.typography.sizes.md,
              color: theme.colors.text,
            }}
          >
            {importProgress.status === 'syncing' ? 'Syncing to Cloud' : 'Importing Passwords'}
          </div>
        </div>

        {/* Progress body */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.spacing.lg,
            gap: theme.spacing.md,
          }}
        >
          {/* Spinner */}
          <div
            style={{
              width: 48,
              height: 48,
              border: `4px solid ${theme.colors.border}`,
              borderTopColor: theme.colors.primary,
              borderRadius: '50%',
              animation: 'keykey-spin 1s linear infinite',
            }}
          />
          <style>{`@keyframes keykey-spin { to { transform: rotate(360deg); } }`}</style>

          {/* Status text */}
          <div
            style={{
              fontSize: theme.typography.sizes.md,
              fontWeight: theme.typography.weights.semibold,
              color: theme.colors.text,
              textAlign: 'center',
            }}
          >
            {importProgress.status === 'syncing'
              ? 'Uploading to cloud…'
              : `Importing ${importProgress.imported} of ${importProgress.total}`}
          </div>

          {/* Progress bar (only during importing phase) */}
          {importProgress.status === 'importing' && importProgress.total > 0 && (
            <div
              style={{
                width: '80%',
                height: 8,
                background: theme.colors.border,
                borderRadius: theme.radii.sm,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${(importProgress.imported / importProgress.total) * 100}%`,
                  height: '100%',
                  background: theme.colors.primary,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}

          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
              textAlign: 'center',
              marginTop: theme.spacing.sm,
            }}
          >
            Please wait. You can close this window — the import will continue in the background.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.md,
            padding: theme.spacing.xs,
            borderRadius: theme.radii.sm,
          }}
          aria-label="Back"
        >
          &#8592;
        </button>
        <div
          style={{
            flex: 1,
            fontWeight: theme.typography.weights.bold,
            fontSize: theme.typography.sizes.md,
            color: theme.colors.text,
          }}
        >
          Import Passwords
        </div>
      </div>

      <div style={scrollBody}>
        {/* Success toast */}
        {success && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              background: theme.colors.successLight,
              border: `1px solid ${theme.colors.success}`,
              borderRadius: theme.radii.md,
              marginBottom: 12,
            }}
          >
            <span style={{ color: theme.colors.success, fontSize: 16 }}>&#10003;</span>
            <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.text }}>
              Imported {success.count} item{success.count !== 1 ? 's' : ''}
              {success.duplicates > 0 &&
                ` (${success.duplicates} duplicate${success.duplicates !== 1 ? 's' : ''} skipped)`}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button
            style={tabBtn(activeTab === 'csv')}
            onClick={() => {
              setActiveTab('csv');
              setSuccess(null);
            }}
          >
            From CSV
          </button>
          <button
            style={tabBtn(activeTab === 'encrypted')}
            onClick={() => {
              setActiveTab('encrypted');
              setSuccess(null);
            }}
          >
            From Encrypted Backup
          </button>
        </div>

        {/* ================================================================= */}
        {/* CSV Tab */}
        {/* ================================================================= */}
        {activeTab === 'csv' && (
          <div>
            {/* File picker */}
            <div style={sectionHeader}>Select CSV File</div>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              onChange={handleCsvFileChange}
              style={{ display: 'none' }}
            />
            <div
              style={fileDrop}
              onClick={() => csvInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') csvInputRef.current?.click();
              }}
            >
              <UploadIcon size={20} color={theme.colors.textSecondary} />
              <span
                style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary }}
              >
                {csvFile ? csvFile.name : 'Click to select a .csv file'}
              </span>
            </div>

            {/* Source badge */}
            {csvParseResult && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.textSecondary,
                  }}
                >
                  Source:
                </span>
                <span style={badge}>{SOURCE_LABELS[csvParseResult.source]}</span>
              </div>
            )}

            {/* Source override dropdown */}
            {csvContent && (
              <div style={{ marginTop: 12 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: theme.typography.sizes.xs,
                    fontWeight: theme.typography.weights.medium,
                    color: theme.colors.textSecondary,
                    marginBottom: 4,
                  }}
                >
                  Override Source (optional)
                </label>
                <select
                  value={sourceOverride}
                  onChange={(e) => {
                    if (e.target.value) handleSourceOverride(e.target.value as ImportSource);
                  }}
                  style={inputStyle}
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
                <div style={sectionHeader}>Import Mode</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    style={tabBtn(importMode === 'merge')}
                    onClick={() => setImportMode('merge')}
                  >
                    Merge
                  </button>
                  <button
                    style={tabBtn(importMode === 'addAll')}
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
                      margin: '4px 0 0',
                    }}
                  >
                    Duplicates will be detected and skipped.
                  </p>
                )}
                {importMode === 'addAll' && (
                  <p
                    style={{
                      fontSize: theme.typography.sizes.xs,
                      color: theme.colors.textSecondary,
                      margin: '4px 0 0',
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
                  marginTop: 12,
                  padding: '12px',
                  background: theme.colors.surface,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md,
                }}
              >
                <div
                  style={{
                    fontSize: theme.typography.sizes.sm,
                    color: theme.colors.text,
                    marginBottom: 2,
                  }}
                >
                  {csvParseResult.totalParsed} credential
                  {csvParseResult.totalParsed !== 1 ? 's' : ''} ready to import
                </div>
                {csvParseResult.skipped.length > 0 && (
                  <div
                    style={{
                      fontSize: theme.typography.sizes.xs,
                      color: theme.colors.warning,
                      marginTop: 2,
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
                  gap: 6,
                  padding: '8px 10px',
                  background: theme.colors.errorLight,
                  border: `1px solid ${theme.colors.error}`,
                  borderRadius: theme.radii.sm,
                  marginTop: 12,
                }}
              >
                <span
                  style={{
                    color: theme.colors.error,
                    flexShrink: 0,
                    fontSize: 13,
                    marginTop: 1,
                  }}
                >
                  &#9888;
                </span>
                <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
                  {csvError}
                </span>
              </div>
            )}

            {/* Import button */}
            {csvParseResult && csvParseResult.items.length > 0 && !success && (
              <div style={{ marginTop: 16 }}>
                <button style={primaryBtn} onClick={handleCsvImport} disabled={importing}>
                  {importing && importProgress?.status === 'syncing'
                    ? 'Syncing to cloud…'
                    : importing && importProgress
                      ? `Importing ${importProgress.imported}/${importProgress.total}…`
                      : importing
                        ? 'Importing…'
                        : 'Import'}
                </button>
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
            <div style={sectionHeader}>Select Backup File</div>
            <input
              ref={encInputRef}
              type="file"
              accept=".keykeykey"
              onChange={handleEncFileChange}
              style={{ display: 'none' }}
            />
            <div
              style={fileDrop}
              onClick={() => encInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') encInputRef.current?.click();
              }}
            >
              <UploadIcon size={20} color={theme.colors.textSecondary} />
              <span
                style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary }}
              >
                {encFile ? encFile.name : 'Click to select a .keykeykey file'}
              </span>
            </div>

            {/* Passwords */}
            {encFile && (
              <>
                <div style={sectionHeader}>Passwords</div>
                <label
                  style={{
                    display: 'block',
                    fontSize: theme.typography.sizes.xs,
                    fontWeight: theme.typography.weights.medium,
                    color: theme.colors.textSecondary,
                    marginBottom: 4,
                  }}
                >
                  Master Password
                </label>
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  placeholder="Master password of the backup vault"
                  style={inputStyle}
                />
                <div style={{ marginTop: 10 }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: theme.typography.sizes.xs,
                      fontWeight: theme.typography.weights.medium,
                      color: theme.colors.textSecondary,
                      marginBottom: 4,
                    }}
                  >
                    Backup Password (optional)
                  </label>
                  <input
                    type="password"
                    value={zipPassword}
                    onChange={(e) => setZipPassword(e.target.value)}
                    placeholder="Leave blank if same as master password"
                    style={inputStyle}
                  />
                </div>

                {/* Import mode toggle */}
                <div style={sectionHeader}>Import Mode</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    style={tabBtn(importMode === 'merge')}
                    onClick={() => setImportMode('merge')}
                  >
                    Merge
                  </button>
                  <button
                    style={tabBtn(importMode === 'addAll')}
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
                      margin: '4px 0 0',
                    }}
                  >
                    Duplicates will be detected and skipped.
                  </p>
                )}
                {importMode === 'addAll' && (
                  <p
                    style={{
                      fontSize: theme.typography.sizes.xs,
                      color: theme.colors.textSecondary,
                      margin: '4px 0 0',
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
                  gap: 6,
                  padding: '8px 10px',
                  background: theme.colors.errorLight,
                  border: `1px solid ${theme.colors.error}`,
                  borderRadius: theme.radii.sm,
                  marginTop: 12,
                }}
              >
                <span
                  style={{
                    color: theme.colors.error,
                    flexShrink: 0,
                    fontSize: 13,
                    marginTop: 1,
                  }}
                >
                  &#9888;
                </span>
                <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
                  {encError}
                </span>
              </div>
            )}

            {/* Import button */}
            {encFile && masterPassword.trim() && !success && (
              <div style={{ marginTop: 16 }}>
                <button style={primaryBtn} onClick={handleEncryptedImport} disabled={importing}>
                  {importing ? 'Importing...' : 'Import Backup'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
