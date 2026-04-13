import React from 'react';
import type { Theme } from '../../../lib/theme.js';

export interface NoteFormValues {
  content: string;
}

interface NoteFormProps {
  values: NoteFormValues;
  onChange: (field: keyof NoteFormValues, value: string) => void;
  theme: Theme;
}

export function NoteForm({ values, onChange, theme }: NoteFormProps) {
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    background: theme.colors.inputBackground,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    color: theme.colors.text,
    fontSize: theme.typography.sizes.sm,
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.medium,
    marginBottom: 4,
    display: 'block',
  };

  const fieldStyle: React.CSSProperties = {
    marginBottom: theme.spacing.sm,
  };

  return (
    <div style={fieldStyle}>
      <label style={labelStyle}>Content</label>
      <textarea
        value={values.content}
        onChange={(e) => onChange('content', e.target.value)}
        placeholder="Your secure note content"
        rows={6}
        style={{ ...inputStyle, resize: 'vertical' as const }}
      />
    </div>
  );
}
