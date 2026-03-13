import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Copy, Check, Star, Pencil, Trash2 } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme, type Theme } from '../lib/theme';
import { copyWithAutoClear } from '../lib/clipboard';
import { useToast } from '../components/ui/Toast';

export function ItemDetailScreen() {
  const { theme } = useTheme();
  const { id } = useParams<{ id: string }>();
  const { items, updateItem, removeItem } = useVault();
  const navigate = useNavigate();
  const toast = useToast();

  const item = useMemo(() => items.find((i) => i.id === id), [items, id]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!item) {
    return <div style={{ padding: 32, color: theme.colors.textSecondary }}>Item not found.</div>;
  }

  const toggleReveal = (field: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const handleCopy = async (field: string, value: string) => {
    await copyWithAutoClear(value);
    setCopiedField(field);
    toast.show('Copied!');
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleFavorite = async () => {
    await updateItem(item.id, { favorite: !item.favorite });
  };

  const handleDelete = async () => {
    if (window.confirm(`Delete "${item.name}"? This cannot be undone.`)) {
      await removeItem(item.id);
      navigate('/vault', { replace: true });
    }
  };

  const fields: { label: string; value?: string; sensitive?: boolean }[] = [];
  if (item.type === 'credential') {
    if (item.url) fields.push({ label: 'URL', value: item.url });
    if (item.username) fields.push({ label: 'Username', value: item.username });
    if (item.password) fields.push({ label: 'Password', value: item.password, sensitive: true });
    if (item.notes) fields.push({ label: 'Notes', value: item.notes });
  } else if (item.type === 'card') {
    if (item.cardholderName) fields.push({ label: 'Cardholder', value: item.cardholderName });
    if (item.number) fields.push({ label: 'Card Number', value: item.number, sensitive: true });
    if (item.expirationMonth || item.expirationYear)
      fields.push({
        label: 'Expiry',
        value: `${item.expirationMonth || '??'}/${item.expirationYear || '??'}`,
      });
    if (item.cvv) fields.push({ label: 'CVV', value: item.cvv, sensitive: true });
    if (item.pin) fields.push({ label: 'PIN', value: item.pin, sensitive: true });
    if (item.notes) fields.push({ label: 'Notes', value: item.notes });
  } else if (item.type === 'secure-note') {
    if (item.content) fields.push({ label: 'Content', value: item.content });
  }

  return (
    <div style={{ maxWidth: 520 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => navigate('/vault')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: theme.colors.textSecondary,
            display: 'flex',
            padding: 4,
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <h1
          style={{
            flex: 1,
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
          }}
        >
          {item.name}
        </h1>
        <button
          onClick={handleFavorite}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
          }}
        >
          <Star
            size={20}
            color={theme.colors.warning}
            fill={item.favorite ? theme.colors.warning : 'none'}
          />
        </button>
      </div>

      {/* Type label */}
      <div
        style={{
          display: 'inline-block',
          padding: '4px 12px',
          borderRadius: theme.radii.full,
          backgroundColor: theme.colors.primaryMuted,
          color: theme.colors.text,
          fontSize: theme.typography.sizes.xs,
          fontWeight: theme.typography.weights.medium,
          marginBottom: 24,
          textTransform: 'capitalize',
        }}
      >
        {item.type === 'secure-note' ? 'Secure Note' : item.type}
      </div>

      {/* Fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
        {fields.map(({ label, value, sensitive }) => (
          <DetailField
            key={label}
            label={label}
            value={value || ''}
            sensitive={sensitive}
            isRevealed={revealed.has(label)}
            onToggleReveal={() => toggleReveal(label)}
            onCopy={() => handleCopy(label, value || '')}
            isCopied={copiedField === label}
            theme={theme}
          />
        ))}
      </div>

      {/* Timestamps */}
      <div
        style={{
          fontSize: theme.typography.sizes.xs,
          color: theme.colors.textSecondary,
          marginBottom: 32,
        }}
      >
        <div>Created: {new Date(item.createdAt).toLocaleString()}</div>
        <div>Updated: {new Date(item.updatedAt).toLocaleString()}</div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={() => navigate(`/vault/edit/${item.id}`)}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 16px',
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            backgroundColor: 'transparent',
            color: theme.colors.text,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
          }}
        >
          <Pencil size={16} />
          Edit
        </button>
        <button
          onClick={handleDelete}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 16px',
            border: `1px solid ${theme.colors.danger}`,
            borderRadius: theme.radii.md,
            backgroundColor: 'transparent',
            color: theme.colors.danger,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
          }}
        >
          <Trash2 size={16} />
          Delete
        </button>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  sensitive,
  isRevealed,
  onToggleReveal,
  onCopy,
  isCopied,
  theme,
}: {
  label: string;
  value: string;
  sensitive?: boolean;
  isRevealed: boolean;
  onToggleReveal: () => void;
  onCopy: () => void;
  isCopied: boolean;
  theme: Theme;
}) {
  const displayValue =
    sensitive && !isRevealed ? '\u2022'.repeat(Math.min(value.length, 20)) : value;

  return (
    <div>
      <div
        style={{
          fontSize: theme.typography.sizes.xs,
          color: theme.colors.textSecondary,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          backgroundColor: theme.colors.surface,
          border: `1px solid ${theme.colors.border}`,
          borderRadius: theme.radii.sm,
        }}
      >
        <span
          className={sensitive && !isRevealed ? undefined : 'mono'}
          style={{
            flex: 1,
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
            userSelect: isRevealed || !sensitive ? 'all' : 'none',
          }}
        >
          {displayValue}
        </span>
        {sensitive && (
          <button
            onClick={onToggleReveal}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.colors.textSecondary,
              display: 'flex',
              padding: 2,
            }}
          >
            {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
        <button
          onClick={onCopy}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: isCopied ? theme.colors.success : theme.colors.textSecondary,
            display: 'flex',
            padding: 2,
          }}
        >
          {isCopied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}
