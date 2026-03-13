import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, CreditCard, FileText } from 'lucide-react';
import type { VaultItem } from '@keykeykey/core';
import { getDefaultStrongPassword } from '@keykeykey/core';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';

type ItemType = 'credential' | 'card' | 'secure-note';

const TYPE_OPTIONS = [
  { key: 'credential' as const, label: 'Login', icon: KeyRound },
  { key: 'card' as const, label: 'Card', icon: CreditCard },
  { key: 'secure-note' as const, label: 'Note', icon: FileText },
];

export function AddItemScreen() {
  const { theme } = useTheme();
  const { addItem } = useVault();
  const navigate = useNavigate();

  const [type, setType] = useState<ItemType>('credential');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notes, setNotes] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  const [cvv, setCvv] = useState('');
  const [pin, setPin] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      let normalizedUrl = url.trim();
      if (normalizedUrl && !normalizedUrl.match(/^https?:\/\//)) {
        normalizedUrl = `https://${normalizedUrl}`;
      }

      if (type === 'credential') {
        await addItem({
          type: 'credential',
          name: name.trim(),
          username: username.trim(),
          password: password,
          url: normalizedUrl || undefined,
          notes: notes.trim() || undefined,
          favorite: false,
          tags: [],
        } as Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>);
      } else if (type === 'card') {
        await addItem({
          type: 'card',
          name: name.trim(),
          cardholderName: cardholderName.trim(),
          number: cardNumber.trim(),
          expirationMonth: expiryMonth.trim() ? Number(expiryMonth.trim()) : 1,
          expirationYear: expiryYear.trim() ? Number(expiryYear.trim()) : 2025,
          cvv: cvv || '000',
          pin: pin || undefined,
          notes: notes.trim() || undefined,
          favorite: false,
          tags: [],
        } as Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>);
      } else {
        await addItem({
          type: 'secure-note',
          name: name.trim(),
          content: content.trim() || '',
          favorite: false,
          tags: [],
        } as Omit<VaultItem, 'id' | 'createdAt' | 'updatedAt'>);
      }
      navigate('/vault', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexShrink: 0 }}>
        <h1 style={{ flex: 1, fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold, color: theme.colors.text }}>
          Add Item
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleSave}
            disabled={loading || !name.trim()}
            style={{
              background: 'none',
              border: 'none',
              cursor: loading || !name.trim() ? 'default' : 'pointer',
              color: loading || !name.trim() ? theme.colors.textSecondary : theme.colors.primary,
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
              padding: '4px 8px',
              opacity: loading || !name.trim() ? 0.5 : 1,
            }}
          >
            {loading ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.colors.textSecondary,
              fontSize: theme.typography.sizes.sm,
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
      {/* Type selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {TYPE_OPTIONS.map(({ key, label, icon: Icon }) => {
          const active = type === key;
          return (
            <button
              key={key}
              onClick={() => setType(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: theme.radii.full,
                border: `1.5px solid ${active ? theme.colors.primary : theme.colors.border}`,
                backgroundColor: active ? theme.colors.primaryMuted : 'transparent',
                color: active ? theme.colors.text : theme.colors.textSecondary,
                fontSize: theme.typography.sizes.sm,
                fontWeight: active ? theme.typography.weights.semibold : theme.typography.weights.regular,
                cursor: 'pointer',
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Name (shared) */}
      <TextInput label="Name" value={name} onChangeText={setName} placeholder="e.g., Gmail, Chase Visa" />

      {/* Credential fields */}
      {type === 'credential' && (
        <>
          <TextInput label="URL" value={url} onChangeText={setUrl} placeholder="https://example.com" />
          <TextInput label="Username" value={username} onChangeText={setUsername} placeholder="user@example.com" />
          <TextInput label="Password" value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry onGenerate={() => setPassword(getDefaultStrongPassword())} />
          <TextInput label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional notes" multiline />
        </>
      )}

      {/* Card fields */}
      {type === 'card' && (
        <>
          <TextInput label="Cardholder Name" value={cardholderName} onChangeText={setCardholderName} placeholder="John Doe" />
          <TextInput label="Card Number" value={cardNumber} onChangeText={setCardNumber} placeholder="4111 1111 1111 1111" />
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <TextInput label="Month" value={expiryMonth} onChangeText={setExpiryMonth} placeholder="MM" />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput label="Year" value={expiryYear} onChangeText={setExpiryYear} placeholder="YY" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <TextInput label="CVV" value={cvv} onChangeText={setCvv} placeholder="123" secureTextEntry />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput label="PIN" value={pin} onChangeText={setPin} placeholder="Optional" secureTextEntry />
            </div>
          </div>
          <TextInput label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional notes" multiline />
        </>
      )}

      {/* Secure note fields */}
      {type === 'secure-note' && (
        <TextInput label="Content" value={content} onChangeText={setContent} placeholder="Enter your secure note" multiline />
      )}

      {error && (
        <p style={{ color: theme.colors.error, fontSize: theme.typography.sizes.sm, marginBottom: 16 }}>{error}</p>
      )}
      </div>

      <div style={{ flexShrink: 0, paddingTop: 12 }}>
        <Button title="Save" onPress={handleSave} loading={loading} disabled={!name.trim()} />
      </div>
    </div>
  );
}
