import React, { useEffect, useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { extractDomainBrand, normalizeUrl } from '@keykeykey/core';
import type { NewItemData } from '../../lib/messages.js';
import {
  CredentialForm,
  CardForm,
  NoteForm,
  type CredentialFormValues,
  type CardFormValues,
  type NoteFormValues,
} from '../components/forms/index.js';

type ItemType = 'credential' | 'card' | 'secure-note';

interface AddItemScreenProps {
  onBack: () => void;
  onRefresh: () => void;
}

export function AddItemScreen({ onBack, onRefresh }: AddItemScreenProps) {
  const { theme } = useTheme();
  const [itemType, setItemType] = useState<ItemType>('credential');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Shared fields
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');
  const [favorite, setFavorite] = useState(false);

  // Credential fields
  const [credentialValues, setCredentialValues] = useState<CredentialFormValues>({
    url: '',
    username: '',
    password: '',
    totp: '',
    notes: '',
  });

  // Card fields
  const [cardValues, setCardValues] = useState<CardFormValues>({
    cardholderName: '',
    cardNumber: '',
    expirationMonth: '',
    expirationYear: '',
    cvv: '',
    pin: '',
    notes: '',
  });

  // Note fields
  const [noteValues, setNoteValues] = useState<NoteFormValues>({
    content: '',
  });

  // Auto-fill URL + name from active tab for credential type
  useEffect(() => {
    if (itemType !== 'credential') return;
    const load = async () => {
      try {
        const result = (await sendMessage<{ url?: string }>({
          type: 'GET_ACTIVE_TAB_URL',
        })) as { url?: string };
        if (result?.url) {
          setCredentialValues((prev) => ({ ...prev, url: result.url! }));
          const brand = extractDomainBrand(result.url);
          if (brand && !name) {
            setName(brand);
          }
        }
      } catch {
        // ignore
      }
    };
    load();
  }, [itemType]);

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

  const handleCredentialChange = (field: keyof CredentialFormValues, value: string) => {
    setCredentialValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleCardChange = (field: keyof CardFormValues, value: string) => {
    setCardValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleNoteChange = (field: keyof NoteFormValues, value: string) => {
    setNoteValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      let itemData: NewItemData;
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (itemType === 'credential') {
        if (!name.trim()) {
          setError('Name is required.');
          return;
        }
        if (!credentialValues.username.trim() && !credentialValues.password.trim()) {
          setError('Username or password is required.');
          return;
        }
        itemData = {
          type: 'credential',
          name: name.trim(),
          url: credentialValues.url ? normalizeUrl(credentialValues.url.trim()) : undefined,
          username: credentialValues.username.trim(),
          password: credentialValues.password.trim(),
          totp: credentialValues.totp.trim() || undefined,
          notes: credentialValues.notes.trim() || undefined,
          tags: parsedTags,
          favorite,
        };
      } else if (itemType === 'card') {
        if (!name.trim()) {
          setError('Name is required.');
          return;
        }
        if (!cardValues.cardholderName.trim()) {
          setError('Cardholder name is required.');
          return;
        }
        if (!cardValues.cardNumber.trim()) {
          setError('Card number is required.');
          return;
        }
        const month = parseInt(cardValues.expirationMonth, 10);
        const year = parseInt(cardValues.expirationYear, 10);
        if (!cardValues.expirationMonth || isNaN(month) || month < 1 || month > 12) {
          setError('Valid expiration month (1\u201312) is required.');
          return;
        }
        if (!cardValues.expirationYear || isNaN(year) || year < 2000) {
          setError('Valid expiration year is required.');
          return;
        }
        if (!cardValues.cvv.trim()) {
          setError('CVV is required.');
          return;
        }
        itemData = {
          type: 'card',
          name: name.trim(),
          cardholderName: cardValues.cardholderName.trim(),
          number: cardValues.cardNumber.trim(),
          expirationMonth: month,
          expirationYear: year,
          cvv: cardValues.cvv.trim(),
          pin: cardValues.pin.trim() || undefined,
          notes: cardValues.notes.trim() || undefined,
          tags: parsedTags,
          favorite,
        };
      } else {
        if (!name.trim()) {
          setError('Name is required.');
          return;
        }
        itemData = {
          type: 'secure-note',
          name: name.trim(),
          content: noteValues.content,
          tags: parsedTags,
          favorite,
        };
      }

      const result = (await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'ADD_ITEM',
        item: itemData,
      })) as { ok?: boolean; error?: string };

      if (result?.error) {
        setError(result.error);
        return;
      }

      onRefresh();
      onBack();
    } finally {
      setSaving(false);
    }
  };

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
          Add Item
        </div>
      </div>

      {/* Form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: theme.spacing.md }}>
        {/* Type selector */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Type</label>
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value as ItemType)}
            style={inputStyle}
          >
            <option value="credential">Login / Credential</option>
            <option value="card">Payment Card</option>
            <option value="secure-note">Secure Note</option>
          </select>
        </div>

        {/* Name */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            style={inputStyle}
          />
        </div>

        {/* Type-specific fields */}
        {itemType === 'credential' && (
          <CredentialForm
            values={credentialValues}
            onChange={handleCredentialChange}
            theme={theme}
          />
        )}
        {itemType === 'card' && (
          <CardForm values={cardValues} onChange={handleCardChange} theme={theme} />
        )}
        {itemType === 'secure-note' && (
          <NoteForm values={noteValues} onChange={handleNoteChange} theme={theme} />
        )}

        {/* Tags */}
        <div style={fieldStyle}>
          <label style={labelStyle}>Tags (comma-separated)</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="work, personal"
            style={inputStyle}
          />
        </div>

        {/* Favorite */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.md,
          }}
        >
          <input
            type="checkbox"
            id="add-favorite"
            checked={favorite}
            onChange={(e) => setFavorite(e.target.checked)}
          />
          <label
            htmlFor="add-favorite"
            style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.text }}
          >
            Mark as favorite
          </label>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: theme.spacing.sm,
              background: theme.colors.errorLight,
              border: `1px solid ${theme.colors.error}`,
              borderRadius: theme.radii.md,
              color: theme.colors.error,
              fontSize: theme.typography.sizes.sm,
              marginBottom: theme.spacing.sm,
            }}
          >
            {error}
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: theme.spacing.sm }}>
          <button
            onClick={onBack}
            style={{
              flex: 1,
              padding: `${theme.spacing.sm}px`,
              background: 'none',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: theme.radii.md,
              color: theme.colors.text,
              cursor: 'pointer',
              fontSize: theme.typography.sizes.sm,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 1,
              padding: `${theme.spacing.sm}px`,
              background: theme.colors.primary,
              border: 'none',
              borderRadius: theme.radii.md,
              color: '#000',
              cursor: 'pointer',
              fontWeight: theme.typography.weights.semibold,
              fontSize: theme.typography.sizes.sm,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving\u2026' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
