import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, CreditCard, FileText } from 'lucide-react';
import type { VaultItem } from '@keykeykey/core';
import { getDefaultStrongPassword } from '@keykeykey/core';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { TextInput } from '../components/ui/TextInput';
import { TotpCodeDisplay } from '../components/ui/TotpCodeDisplay';

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
  const [totp, setTotp] = useState('');
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    setFieldErrors({});
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
          totp: totp.trim() || undefined,
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
      if (
        err instanceof Error &&
        'issues' in err &&
        Array.isArray((err as { issues: unknown[] }).issues)
      ) {
        const zodErr = err as { issues: { path: (string | number)[]; message: string }[] };
        const errors: Record<string, string> = {};
        for (const issue of zodErr.issues) {
          const field = issue.path[issue.path.length - 1];
          if (field) errors[String(field)] = issue.message;
        }
        setFieldErrors(errors);
        setError('Please fix the errors below.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save item');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        maxWidth: 520,
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 64px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          flexShrink: 0,
        }}
      >
        <h1
          style={{
            flex: 1,
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
          }}
        >
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
                  fontWeight: active
                    ? theme.typography.weights.semibold
                    : theme.typography.weights.regular,
                  cursor: 'pointer',
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            );
          })}
        </div>

        {error && (
          <p
            style={{
              color: theme.colors.error,
              fontSize: theme.typography.sizes.sm,
              marginBottom: 16,
              padding: '8px 12px',
              backgroundColor: theme.colors.errorLight,
              borderRadius: theme.radii.sm,
            }}
          >
            {error}
          </p>
        )}

        {/* Name (shared) */}
        <TextInput
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g., Gmail, Chase Visa"
          error={fieldErrors['name']}
          testId="add-name"
        />

        {/* Credential fields */}
        {type === 'credential' && (
          <>
            <TextInput
              label="URL"
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com"
              error={fieldErrors['url']}
              testId="add-url"
            />
            <TextInput
              label="Username"
              value={username}
              onChangeText={setUsername}
              placeholder="user@example.com"
              error={fieldErrors['username']}
              testId="add-username"
            />
            <TextInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry
              onGenerate={() => setPassword(getDefaultStrongPassword())}
              error={fieldErrors['password']}
              testId="add-password"
            />
            <TextInput
              label="TOTP / 2FA"
              value={totp}
              onChangeText={setTotp}
              placeholder="otpauth://totp/... or Base32 secret"
              error={fieldErrors['totp']}
              testId="add-totp"
            />
            {totp.trim() && (
              <div style={{ marginBottom: 16 }}>
                <TotpCodeDisplay input={totp} label="Preview" />
              </div>
            )}
            <TextInput
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes"
              multiline
            />
          </>
        )}

        {/* Card fields */}
        {type === 'card' && (
          <>
            <TextInput
              label="Cardholder Name"
              value={cardholderName}
              onChangeText={setCardholderName}
              placeholder="John Doe"
              error={fieldErrors['cardholderName']}
              testId="add-cardholder"
            />
            <TextInput
              label="Card Number"
              value={cardNumber}
              onChangeText={setCardNumber}
              placeholder="4111 1111 1111 1111"
              error={fieldErrors['number']}
              testId="add-cardnumber"
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <TextInput
                  label="Month"
                  value={expiryMonth}
                  onChangeText={setExpiryMonth}
                  placeholder="MM"
                  error={fieldErrors['expirationMonth']}
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextInput
                  label="Year"
                  value={expiryYear}
                  onChangeText={setExpiryYear}
                  placeholder="YYYY"
                  error={fieldErrors['expirationYear']}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <TextInput
                  label="CVV"
                  value={cvv}
                  onChangeText={setCvv}
                  placeholder="123"
                  secureTextEntry
                  error={fieldErrors['cvv']}
                />
              </div>
              <div style={{ flex: 1 }}>
                <TextInput
                  label="PIN"
                  value={pin}
                  onChangeText={setPin}
                  placeholder="Optional"
                  secureTextEntry
                  error={fieldErrors['pin']}
                />
              </div>
            </div>
            <TextInput
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              placeholder="Optional notes"
              multiline
            />
          </>
        )}

        {/* Secure note fields */}
        {type === 'secure-note' && (
          <TextInput
            label="Content"
            value={content}
            onChangeText={setContent}
            placeholder="Enter your secure note"
            testId="add-content"
            multiline
          />
        )}
      </div>

      <div style={{ flexShrink: 0, paddingTop: 12 }} />
    </div>
  );
}
