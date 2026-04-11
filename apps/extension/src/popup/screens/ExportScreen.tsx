import React, { useState, useEffect } from 'react';
import browser from 'webextension-polyfill';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { exportToCsv } from '@keykeykey/core/export';
import { exportEncryptedBackup } from '@keykeykey/core/export-import-zip';
import { serializeVaultHeader, deserializeVaultHeader } from '@keykeykey/core';
import { fromBase64 } from '@keykeykey/core/utils';
import type { VaultItem } from '@keykeykey/core/models';
import { DownloadIcon } from '../components/icons/index.js';

interface ExportScreenProps {
  onBack: () => void;
  onRefresh: () => void;
}

type Tab = 'csv' | 'encrypted';

/** Storage key constants (must match background/storage.ts) */
const KEY_VAULT_HEADER = 'vault_header';
const ITEM_PREFIX = 'item_';

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    // Try browser.downloads API first (available in extension context)
    if (browser.downloads) {
      browser.downloads.download({ url, filename }).finally(() => {
        // Delay revoke to give browser time to start the download
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      });
      return;
    }
  } catch {
    // Fall through to anchor fallback
  }
  // Fallback: create a temporary <a> element
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportScreen({ onBack }: ExportScreenProps) {
  const { theme } = useTheme();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('csv');

  // Items loaded from vault
  const [items, setItems] = useState<VaultItem[]>([]);

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

  // Load items on mount
  useEffect(() => {
    (async () => {
      try {
        const result = (await sendMessage<{ items?: VaultItem[] }>({ type: 'GET_ITEMS' })) as {
          items?: VaultItem[];
        };
        setItems(result.items ?? []);
      } catch {
        // ignore
      }
    })();
  }, []);

  const credentialCount = items.filter((i) => i.type === 'credential').length;

  // ---------------------------------------------------------------------------
  // CSV export handler
  // ---------------------------------------------------------------------------

  const handleCsvExport = async () => {
    setCsvExporting(true);
    setCsvError(null);
    setCsvSuccess(false);
    try {
      const csv = exportToCsv(items);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      triggerDownload(blob, `keykeykey-export-${todayString()}.csv`);
      setCsvSuccess(true);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setCsvExporting(false);
    }
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
      // Read vault header and encrypted items directly from extension storage
      const vaultFiles = new Map<string, Uint8Array>();

      const headerResult = await browser.storage.local.get(KEY_VAULT_HEADER);
      const headerBase64 = headerResult[KEY_VAULT_HEADER];
      if (!headerBase64 || typeof headerBase64 !== 'string') {
        throw new Error('No vault header found');
      }

      const headerBytes = fromBase64(headerBase64);
      const header = deserializeVaultHeader(headerBytes);
      vaultFiles.set('vault.enc', serializeVaultHeader(header));

      // Load all encrypted items
      const all = await browser.storage.local.get(null);
      for (const [key, value] of Object.entries(all)) {
        if (key.startsWith(ITEM_PREFIX) && typeof value === 'string') {
          const id = key.slice(ITEM_PREFIX.length);
          vaultFiles.set(`items/${id}`, fromBase64(value));
        }
      }

      const backupBytes = await exportEncryptedBackup(vaultFiles, zipPassword);
      // Wrap in a fresh Uint8Array<ArrayBuffer> — TypeScript 5.7 rejects
      // Uint8Array<ArrayBufferLike> as a BlobPart due to SharedArrayBuffer
      // ambiguity. Copying via the Uint8Array constructor narrows the buffer.
      const blob = new Blob([new Uint8Array(backupBytes)], {
        type: 'application/octet-stream',
      });
      triggerDownload(blob, `keykeykey-backup-${todayString()}.keykeykey`);

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

  const primaryBtn = (disabled: boolean): React.CSSProperties => ({
    width: '100%',
    padding: '10px 16px',
    background: theme.colors.primary,
    color: '#000',
    border: 'none',
    borderRadius: theme.radii.md,
    cursor: disabled ? 'default' : 'pointer',
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    opacity: disabled ? 0.6 : 1,
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
          Export Vault
        </div>
      </div>

      <div style={scrollBody}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <button
            style={tabBtn(activeTab === 'csv')}
            onClick={() => {
              setActiveTab('csv');
              setCsvSuccess(false);
              setCsvError(null);
            }}
          >
            <DownloadIcon
              size={12}
              color={activeTab === 'csv' ? '#000' : theme.colors.textSecondary}
            />{' '}
            Export as CSV
          </button>
          <button
            style={tabBtn(activeTab === 'encrypted')}
            onClick={() => {
              setActiveTab('encrypted');
              setEncSuccess(false);
              setEncError(null);
            }}
          >
            Encrypted Backup
          </button>
        </div>

        {/* ================================================================= */}
        {/* CSV Tab */}
        {/* ================================================================= */}
        {activeTab === 'csv' && (
          <div>
            {/* Success */}
            {csvSuccess && (
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
                  CSV exported successfully. Check your downloads.
                </span>
              </div>
            )}

            {/* Warning */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                background: theme.colors.warningLight,
                border: `1px solid ${theme.colors.warning}`,
                borderRadius: theme.radii.md,
                marginBottom: 12,
              }}
            >
              <span
                style={{
                  color: theme.colors.warning,
                  flexShrink: 0,
                  fontSize: 14,
                  marginTop: 1,
                }}
              >
                &#9888;
              </span>
              <div>
                <span
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.text,
                    fontWeight: theme.typography.weights.semibold,
                  }}
                >
                  Unencrypted export
                </span>
                <p
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.textSecondary,
                    margin: '4px 0 0',
                  }}
                >
                  This will export {credentialCount} credential
                  {credentialCount !== 1 ? 's' : ''} as plain-text CSV. Anyone with access to this
                  file can read your passwords. Delete it after use.
                </p>
              </div>
            </div>

            {/* Error */}
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
                  marginBottom: 12,
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

            {/* Export button */}
            {!csvSuccess && (
              <button
                style={primaryBtn(csvExporting || credentialCount === 0)}
                onClick={handleCsvExport}
                disabled={csvExporting || credentialCount === 0}
              >
                {csvExporting ? 'Exporting...' : 'Export CSV'}
              </button>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* Encrypted Backup Tab */}
        {/* ================================================================= */}
        {activeTab === 'encrypted' && (
          <div>
            {/* Success */}
            {encSuccess && (
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
                  Backup exported successfully. Check your downloads.
                </span>
              </div>
            )}

            {/* Info text */}
            <p
              style={{
                fontSize: theme.typography.sizes.xs,
                color: theme.colors.textSecondary,
                margin: '0 0 12px',
              }}
            >
              Create an encrypted backup of your entire vault. The backup is protected with a
              password you choose below.
            </p>

            {/* Zip password */}
            <div style={sectionHeader}>Backup Password</div>
            <input
              type="password"
              value={zipPassword}
              onChange={(e) => setZipPassword(e.target.value)}
              placeholder="Choose a password for the backup"
              style={inputStyle}
            />
            <div style={{ marginTop: 8 }}>
              <input
                type="password"
                value={zipConfirm}
                onChange={(e) => setZipConfirm(e.target.value)}
                placeholder="Confirm the backup password"
                style={inputStyle}
              />
            </div>

            {/* Error */}
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

            {/* Export button */}
            {!encSuccess && (
              <div style={{ marginTop: 16 }}>
                <button
                  style={primaryBtn(encExporting || !zipPassword.trim() || !zipConfirm.trim())}
                  onClick={handleEncryptedExport}
                  disabled={encExporting || !zipPassword.trim() || !zipConfirm.trim()}
                >
                  {encExporting ? 'Encrypting & exporting...' : 'Export Backup'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
