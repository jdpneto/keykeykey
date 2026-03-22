import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle, FileText, Lock } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';
import { exportToCsv } from '@keykeykey/core/export';
import { exportEncryptedBackup } from '@keykeykey/core/export-import-zip';
import { serializeVaultHeader, deserializeVaultHeader } from '@keykeykey/core';
import { fromBase64 } from '@keykeykey/core/utils';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { loadVaultHeader, loadAllEncryptedItems } from '../lib/tauri-storage';

type Tab = 'csv' | 'encrypted';

function todayString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function ExportScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { items } = useVault();

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>('csv');

  // CSV state
  const [csvExporting, setCsvExporting] = useState(false);
  const [csvSuccess, setCsvSuccess] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Encrypted state
  const [zipPassword, setZipPassword] = useState('');
  const [zipConfirm, setZipConfirm] = useState('');
  const [encExporting, setEncExporting] = useState(false);
  const [encSuccess, setEncSuccess] = useState<string | null>(null);
  const [encError, setEncError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // CSV export handler
  // ---------------------------------------------------------------------------

  const credentialCount = items.filter((i) => i.type === 'credential').length;

  const handleCsvExport = async () => {
    setCsvExporting(true);
    setCsvError(null);
    setCsvSuccess(null);
    try {
      const csv = exportToCsv(items);

      const filePath = await save({
        defaultPath: `keykeykey-export-${todayString()}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });

      if (!filePath) {
        // User cancelled
        setCsvExporting(false);
        return;
      }

      await writeTextFile(filePath, csv);
      setCsvSuccess(filePath);
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
    setEncSuccess(null);
    try {
      // Collect vault files from local storage
      const vaultFiles = new Map<string, Uint8Array>();

      const headerB64 = await loadVaultHeader();
      if (!headerB64) {
        throw new Error('No vault header found');
      }
      const headerBytes = fromBase64(headerB64);
      // Re-serialize to ensure canonical format
      const header = deserializeVaultHeader(headerBytes);
      vaultFiles.set('vault.enc', serializeVaultHeader(header));

      const storedItems = await loadAllEncryptedItems();
      for (const item of storedItems) {
        vaultFiles.set(`items/${item.id}`, fromBase64(item.encrypted_data));
      }

      const backupBytes = await exportEncryptedBackup(vaultFiles, zipPassword);

      const filePath = await save({
        defaultPath: `keykeykey-backup-${todayString()}.keykeykey`,
        filters: [{ name: 'KeyKeyKey Backup', extensions: ['keykeykey'] }],
      });

      if (!filePath) {
        setEncExporting(false);
        return;
      }

      await writeFile(filePath, backupBytes);
      setEncSuccess(filePath);
      // Clear sensitive fields
      setZipPassword('');
      setZipConfirm('');
    } catch (err) {
      setEncError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setEncExporting(false);
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
          Export Vault
        </h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <button
          style={tabStyle(activeTab === 'csv')}
          onClick={() => {
            setActiveTab('csv');
            setCsvSuccess(null);
            setCsvError(null);
          }}
        >
          <FileText size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Export as CSV
        </button>
        <button
          style={tabStyle(activeTab === 'encrypted')}
          onClick={() => {
            setActiveTab('encrypted');
            setEncSuccess(null);
            setEncError(null);
          }}
        >
          <Lock size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Encrypted Backup
        </button>
      </div>

      {/* ================================================================= */}
      {/* CSV Tab */}
      {/* ================================================================= */}
      {activeTab === 'csv' && (
        <div>
          {/* Success message */}
          {csvSuccess && (
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
                Exported successfully to {csvSuccess}
              </span>
            </div>
          )}

          {/* Warning / info */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '12px 16px',
              background: theme.colors.warningLight ?? 'rgba(234,179,8,0.1)',
              border: `1px solid ${theme.colors.warning}`,
              borderRadius: theme.radii.md,
              marginBottom: 20,
            }}
          >
            <AlertTriangle
              size={18}
              style={{ color: theme.colors.warning, flexShrink: 0, marginTop: 1 }}
            />
            <div>
              <span
                style={{
                  fontSize: theme.typography.sizes.sm,
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
                {credentialCount !== 1 ? 's' : ''} as a plain-text CSV file. Anyone with access to
                this file can read your passwords. Delete it after use.
              </p>
            </div>
          </div>

          {/* Error */}
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
                marginBottom: 16,
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

          {/* Export button */}
          {!csvSuccess && (
            <Button
              title={csvExporting ? 'Exporting...' : 'Export CSV'}
              onPress={handleCsvExport}
              variant="primary"
              loading={csvExporting}
              disabled={csvExporting || credentialCount === 0}
            />
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* Encrypted Backup Tab */}
      {/* ================================================================= */}
      {activeTab === 'encrypted' && (
        <div>
          {/* Success message */}
          {encSuccess && (
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
                Backup exported successfully to {encSuccess}
              </span>
            </div>
          )}

          {/* Info text */}
          <p
            style={{
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.textSecondary,
              margin: '0 0 20px',
            }}
          >
            Create an encrypted backup of your entire vault. The backup is protected with a password
            you choose below.
          </p>

          {/* Zip password */}
          <div style={sectionHeaderStyle}>Backup Password</div>
          <TextInput
            label="Password"
            value={zipPassword}
            onChangeText={setZipPassword}
            placeholder="Choose a password for the backup"
            secureTextEntry
          />
          <div style={{ marginTop: 12 }}>
            <TextInput
              label="Confirm Password"
              value={zipConfirm}
              onChangeText={setZipConfirm}
              placeholder="Confirm the backup password"
              secureTextEntry
            />
          </div>

          {/* Error */}
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

          {/* Export button */}
          {!encSuccess && (
            <div style={{ marginTop: 20 }}>
              <Button
                title={encExporting ? 'Encrypting & exporting...' : 'Export Backup'}
                onPress={handleEncryptedExport}
                variant="primary"
                loading={encExporting}
                disabled={encExporting || !zipPassword.trim() || !zipConfirm.trim()}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
