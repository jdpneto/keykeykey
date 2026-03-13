import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getDefaultStrongPassword } from '@keykeykey/core';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';

export function EditItemScreen() {
  const { theme } = useTheme();
  const { id } = useParams<{ id: string }>();
  const { items, updateItem } = useVault();
  const navigate = useNavigate();

  const item = useMemo(() => items.find((i) => i.id === id), [items, id]);

  const [name, setName] = useState(item?.name ?? '');
  const [url, setUrl] = useState(item?.type === 'credential' ? (item.url ?? '') : '');
  const [username, setUsername] = useState(item?.type === 'credential' ? (item.username ?? '') : '');
  const [password, setPassword] = useState(item?.type === 'credential' ? (item.password ?? '') : '');
  const [notes, setNotes] = useState(
    item?.type === 'credential' || item?.type === 'card' ? (item.notes ?? '') : '',
  );
  const [cardholderName, setCardholderName] = useState(item?.type === 'card' ? (item.cardholderName ?? '') : '');
  const [cardNumber, setCardNumber] = useState(item?.type === 'card' ? (item.number ?? '') : '');
  const [expiryMonth, setExpiryMonth] = useState(item?.type === 'card' ? String(item.expirationMonth ?? '') : '');
  const [expiryYear, setExpiryYear] = useState(item?.type === 'card' ? String(item.expirationYear ?? '') : '');
  const [cvv, setCvv] = useState(item?.type === 'card' ? (item.cvv ?? '') : '');
  const [pin, setPin] = useState(item?.type === 'card' ? (item.pin ?? '') : '');
  const [content, setContent] = useState(item?.type === 'secure-note' ? (item.content ?? '') : '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!item) {
    return <div style={{ padding: 32, color: theme.colors.textSecondary }}>Item not found.</div>;
  }

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

      const updates: Record<string, unknown> = { name: name.trim() };

      if (item.type === 'credential') {
        updates.url = normalizedUrl || undefined;
        updates.username = username.trim() || undefined;
        updates.password = password || undefined;
        updates.notes = notes.trim() || undefined;
      } else if (item.type === 'card') {
        updates.cardholderName = cardholderName.trim() || undefined;
        updates.number = cardNumber.trim() || undefined;
        updates.expirationMonth = expiryMonth.trim() ? Number(expiryMonth.trim()) : undefined;
        updates.expirationYear = expiryYear.trim() ? Number(expiryYear.trim()) : undefined;
        updates.cvv = cvv || undefined;
        updates.pin = pin || undefined;
        updates.notes = notes.trim() || undefined;
      } else {
        updates.content = content.trim() || '';
      }

      await updateItem(item.id, updates);
      navigate(`/vault/item/${item.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexShrink: 0 }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textSecondary, display: 'flex', padding: 4 }}
        >
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ flex: 1, fontSize: theme.typography.sizes.xl, fontWeight: theme.typography.weights.bold, color: theme.colors.text }}>
          Edit Item
        </h1>
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
      </div>

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingRight: 4 }}>
        <TextInput label="Name" value={name} onChangeText={setName} placeholder="Item name" />

        {item.type === 'credential' && (
        <>
          <TextInput label="URL" value={url} onChangeText={setUrl} placeholder="https://example.com" />
          <TextInput label="Username" value={username} onChangeText={setUsername} placeholder="user@example.com" />
          <TextInput label="Password" value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry onGenerate={() => setPassword(getDefaultStrongPassword())} />
          <TextInput label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional notes" multiline />
        </>
      )}

      {item.type === 'card' && (
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

      {item.type === 'secure-note' && (
        <TextInput label="Content" value={content} onChangeText={setContent} placeholder="Enter your secure note" multiline />
      )}

        {error && (
          <p style={{ color: theme.colors.error, fontSize: theme.typography.sizes.sm, marginBottom: 16 }}>{error}</p>
        )}
      </div>

      <div style={{ flexShrink: 0, paddingTop: 12 }}>
        <Button title="Save Changes" onPress={handleSave} loading={loading} disabled={!name.trim()} />
      </div>

    </div>
  );
}
