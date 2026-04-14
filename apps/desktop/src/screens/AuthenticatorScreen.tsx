import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, ShieldCheck, ExternalLink } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { EmptyState } from '../components/ui/EmptyState';
import { TotpCodeDisplay } from '../components/ui/TotpCodeDisplay';

export function AuthenticatorScreen() {
  const { theme } = useTheme();
  const { items } = useVault();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const totpItems = useMemo(() => {
    const all = items.filter(
      (i): i is Extract<(typeof items)[number], { type: 'credential' }> & { totp: string } =>
        i.type === 'credential' && !!i.totp,
    );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.username.toLowerCase().includes(q) ||
        (i.url ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <h1
          style={{
            flex: 1,
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
          }}
        >
          Authenticator
        </h1>
      </div>

      <div style={{ position: 'relative', marginBottom: 20 }}>
        <Search
          size={16}
          color={theme.colors.textSecondary}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 2FA codes..."
          style={{
            width: '100%',
            padding: '10px 36px',
            backgroundColor: theme.colors.inputBackground,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.md,
            fontSize: theme.typography.sizes.sm,
            color: theme.colors.text,
            outline: 'none',
          }}
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.colors.textSecondary,
              padding: 4,
              display: 'flex',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {totpItems.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={query ? 'No matching codes' : 'No 2FA codes yet'}
          subtitle={
            query
              ? 'Try a different search term'
              : 'Add a TOTP secret to any credential to see it here.'
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {totpItems.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: 14,
                backgroundColor: theme.colors.surface,
                border: `1px solid ${theme.colors.border}`,
                borderRadius: theme.radii.md,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: theme.typography.sizes.md,
                      fontWeight: theme.typography.weights.medium,
                      color: theme.colors.text,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {item.name}
                  </div>
                  {item.username && (
                    <div
                      style={{
                        fontSize: theme.typography.sizes.sm,
                        color: theme.colors.textSecondary,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {item.username}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/vault/item/${item.id}`)}
                  title="Open credential"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: theme.colors.textSecondary,
                    display: 'flex',
                    padding: 4,
                  }}
                >
                  <ExternalLink size={16} />
                </button>
              </div>
              <TotpCodeDisplay input={item.totp} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
