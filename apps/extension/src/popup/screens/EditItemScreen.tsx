import React, { useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { normalizeUrl } from '@keykeykey/core';
import type { VaultItem } from '@keykeykey/core';
import type { ItemUpdates } from '../../lib/messages.js';

interface EditItemScreenProps {
  item: VaultItem;
  onBack: () => void;
  onNavigate: (s: string) => void;
  onRefresh: () => void;
}

export function EditItemScreen({ item, onBack, onNavigate, onRefresh }: EditItemScreenProps) {
  const { theme } = useTheme();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Shared fields
  const [name, setName] = useState(item.name);
  const [tags, setTags] = useState(item.tags?.join(', ') ?? '');
  const [favorite, setFavorite] = useState(item.favorite ?? false);

  // Credential fields
  const [url, setUrl] = useState(item.type === 'credential' ? (item.url ?? '') : '');
  const [username, setUsername] = useState(item.type === 'credential' ? item.username : '');
  const [password, setPassword] = useState(item.type === 'credential' ? item.password : '');
  const [credNotes, setCredNotes] = useState(item.type === 'credential' ? (item.notes ?? '') : '');

  // Card fields
  const [cardholderName, setCardholderName] = useState(
    item.type === 'card' ? item.cardholderName : '',
  );
  const [cardNumber, setCardNumber] = useState(item.type === 'card' ? item.number : '');
  const [expirationMonth, setExpirationMonth] = useState(
    item.type === 'card' ? String(item.expirationMonth) : '',
  );
  const [expirationYear, setExpirationYear] = useState(
    item.type === 'card' ? String(item.expirationYear) : '',
  );
  const [cvv, setCvv] = useState(item.type === 'card' ? item.cvv : '');
  const [pin, setPin] = useState(item.type === 'card' ? (item.pin ?? '') : '');
  const [cardNotes, setCardNotes] = useState(item.type === 'card' ? (item.notes ?? '') : '');

  // Note fields
  const [content, setContent] = useState(item.type === 'secure-note' ? item.content : '');

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

  const handleSave = async () => {
    setError('');
    setSaving(true);
    try {
      let updates: ItemUpdates;
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (item.type === 'credential') {
        if (!name.trim()) {
          setError('Name is required.');
          return;
        }
        if (!username.trim()) {
          setError('Username is required.');
          return;
        }
        if (!password.trim()) {
          setError('Password is required.');
          return;
        }
        updates = {
          name: name.trim(),
          url: url ? normalizeUrl(url.trim()) : undefined,
          username: username.trim(),
          password: password.trim(),
          notes: credNotes.trim() || undefined,
          tags: parsedTags,
          favorite,
        };
      } else if (item.type === 'card') {
        if (!name.trim()) {
          setError('Name is required.');
          return;
        }
        if (!cardholderName.trim()) {
          setError('Cardholder name is required.');
          return;
        }
        if (!cardNumber.trim()) {
          setError('Card number is required.');
          return;
        }
        const month = parseInt(expirationMonth, 10);
        const year = parseInt(expirationYear, 10);
        if (!expirationMonth || isNaN(month) || month < 1 || month > 12) {
          setError('Valid expiration month (1–12) is required.');
          return;
        }
        if (!expirationYear || isNaN(year) || year < 2000) {
          setError('Valid expiration year is required.');
          return;
        }
        if (!cvv.trim()) {
          setError('CVV is required.');
          return;
        }
        updates = {
          name: name.trim(),
          cardholderName: cardholderName.trim(),
          number: cardNumber.trim(),
          expirationMonth: month,
          expirationYear: year,
          cvv: cvv.trim(),
          pin: pin.trim() || undefined,
          notes: cardNotes.trim() || undefined,
          tags: parsedTags,
          favorite,
        };
      } else {
        if (!name.trim()) {
          setError('Name is required.');
          return;
        }
        updates = {
          name: name.trim(),
          content: content,
          tags: parsedTags,
          favorite,
        };
      }

      const result = (await sendMessage<{ ok?: boolean; error?: string }>({
        type: 'UPDATE_ITEM',
        id: item.id,
        updates,
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

  const renderCredentialFields = () => (
    <>
      <div style={fieldStyle}>
        <label style={labelStyle}>URL</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          style={inputStyle}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Username</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="user@example.com"
          style={inputStyle}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Password</label>
        <div style={{ display: 'flex', gap: theme.spacing.sm }}>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={() => onNavigate('generator')}
            style={{
              padding: `${theme.spacing.sm}px ${theme.spacing.sm}px`,
              background: theme.colors.primaryMuted,
              border: 'none',
              borderRadius: theme.radii.md,
              color: theme.colors.text,
              cursor: 'pointer',
              fontSize: theme.typography.sizes.xs,
              fontWeight: theme.typography.weights.medium,
              whiteSpace: 'nowrap' as const,
            }}
          >
            Generate
          </button>
        </div>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={credNotes}
          onChange={(e) => setCredNotes(e.target.value)}
          placeholder="Optional notes"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' as const }}
        />
      </div>
    </>
  );

  const renderCardFields = () => (
    <>
      <div style={fieldStyle}>
        <label style={labelStyle}>Cardholder Name</label>
        <input
          type="text"
          value={cardholderName}
          onChange={(e) => setCardholderName(e.target.value)}
          placeholder="John Doe"
          style={inputStyle}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Card Number</label>
        <input
          type="text"
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          placeholder="1234 5678 9012 3456"
          style={inputStyle}
        />
      </div>
      <div style={{ display: 'flex', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Exp. Month</label>
          <input
            type="number"
            value={expirationMonth}
            onChange={(e) => setExpirationMonth(e.target.value)}
            placeholder="MM"
            min={1}
            max={12}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Exp. Year</label>
          <input
            type="number"
            value={expirationYear}
            onChange={(e) => setExpirationYear(e.target.value)}
            placeholder="YYYY"
            min={2000}
            style={inputStyle}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>CVV</label>
          <input
            type="text"
            value={cvv}
            onChange={(e) => setCvv(e.target.value)}
            placeholder="123"
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>PIN (optional)</label>
          <input
            type="text"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Optional"
            style={inputStyle}
          />
        </div>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={cardNotes}
          onChange={(e) => setCardNotes(e.target.value)}
          placeholder="Optional notes"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' as const }}
        />
      </div>
    </>
  );

  const renderNoteFields = () => (
    <div style={fieldStyle}>
      <label style={labelStyle}>Content</label>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Your secure note content"
        rows={6}
        style={{ ...inputStyle, resize: 'vertical' as const }}
      />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '480px' }}>
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
          Edit Item
        </div>
      </div>

      {/* Form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: theme.spacing.md }}>
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
        {item.type === 'credential' && renderCredentialFields()}
        {item.type === 'card' && renderCardFields()}
        {item.type === 'secure-note' && renderNoteFields()}

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
            id="edit-favorite"
            checked={favorite}
            onChange={(e) => setFavorite(e.target.checked)}
          />
          <label
            htmlFor="edit-favorite"
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
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
