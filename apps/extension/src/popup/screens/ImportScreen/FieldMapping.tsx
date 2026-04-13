import React from 'react';
import { useTheme } from '../../../lib/theme.js';
import type { VaultItem } from '@keykeykey/core/models';

type ImportMode = 'merge' | 'addAll';

interface FieldMappingProps {
  importMode: ImportMode;
  onImportModeChange: (mode: ImportMode) => void;
  csvParseResult: {
    items: Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>[];
    skipped: { row: number; reason: string }[];
    totalParsed: number;
  } | null;
  tabBtn: (active: boolean) => React.CSSProperties;
}

export function FieldMapping({
  importMode,
  onImportModeChange,
  csvParseResult,
  tabBtn,
}: FieldMappingProps) {
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

  if (!csvParseResult || csvParseResult.items.length === 0) return null;

  return (
    <>
      <div style={sectionHeader}>Import Mode</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={tabBtn(importMode === 'merge')} onClick={() => onImportModeChange('merge')}>
          Merge
        </button>
        <button
          style={tabBtn(importMode === 'addAll')}
          onClick={() => onImportModeChange('addAll')}
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

      {/* Preview summary */}
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
    </>
  );
}
