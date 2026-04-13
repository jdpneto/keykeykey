import React from 'react';
import { useTheme } from '../../../lib/theme.js';
import type { ImportSource } from '@keykeykey/core/import';
import { UploadIcon } from '../../components/icons/index.js';

const SOURCE_LABELS: Record<ImportSource, string> = {
  keykeykey: 'KeyKeyKey',
  chrome: 'Chrome',
  firefox: 'Firefox',
  bitwarden: 'Bitwarden',
  icloud: 'iCloud Keychain',
  '1password': '1Password',
};

const ALL_SOURCES: ImportSource[] = ['chrome', 'firefox', 'bitwarden', 'icloud', '1password'];

interface CsvFileSelectorProps {
  csvFile: File | null;
  csvInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  csvContent: string | null;
  sourceOverride: ImportSource | '';
  onSourceOverride: (source: ImportSource) => void;
  detectedSource: ImportSource | null;
  fileDrop: React.CSSProperties;
  inputStyle: React.CSSProperties;
  badge: React.CSSProperties;
}

export function CsvFileSelector({
  csvFile,
  csvInputRef,
  onFileChange,
  csvContent,
  sourceOverride,
  onSourceOverride,
  detectedSource,
  fileDrop,
  inputStyle,
  badge,
}: CsvFileSelectorProps) {
  const { theme } = useTheme();

  const sectionHeader: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  };

  return (
    <>
      <div style={sectionHeader}>Select CSV File</div>
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv"
        onChange={onFileChange}
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
        <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary }}>
          {csvFile ? csvFile.name : 'Click to select a .csv file'}
        </span>
      </div>

      {/* Source badge */}
      {detectedSource && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
            }}
          >
            Source:
          </span>
          <span style={badge}>{SOURCE_LABELS[detectedSource]}</span>
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
              if (e.target.value) onSourceOverride(e.target.value as ImportSource);
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
    </>
  );
}

interface EncFileSelectorProps {
  encFile: File | null;
  encInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileDrop: React.CSSProperties;
}

export function EncFileSelector({
  encFile,
  encInputRef,
  onFileChange,
  fileDrop,
}: EncFileSelectorProps) {
  const { theme } = useTheme();

  const sectionHeader: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 16,
  };

  return (
    <>
      <div style={sectionHeader}>Select Backup File</div>
      <input
        ref={encInputRef}
        type="file"
        accept=".keykeykey"
        onChange={onFileChange}
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
        <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.textSecondary }}>
          {encFile ? encFile.name : 'Click to select a .keykeykey file'}
        </span>
      </div>
    </>
  );
}
