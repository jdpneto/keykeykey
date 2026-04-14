import React, { useEffect, useMemo, useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { TotpCodeDisplay } from '../components/TotpCodeDisplay.js';
import type { VaultItem } from '@keykeykey/core';

interface AuthenticatorScreenProps {
  onBack: () => void;
  onNavigate: (target: string) => void;
}

export function AuthenticatorScreen({ onBack, onNavigate }: AuthenticatorScreenProps) {
  const { theme } = useTheme();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = (await sendMessage<{ items?: VaultItem[] }>({
          type: 'GET_ITEMS',
        })) as { items?: VaultItem[] };
        setItems(result.items ?? []);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const totpItems = useMemo(() => {
    const all = items.filter(
      (i): i is VaultItem & { type: 'credential'; totp: string } =>
        i.type === 'credential' && !!i.totp,
    );
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.type === 'credential' && i.username.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const sectionStyle: React.CSSProperties = {
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    background: theme.colors.surface,
    borderRadius: theme.radii.md,
    marginBottom: theme.spacing.sm,
    cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
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
          Authenticator
        </div>
      </div>

      <div style={{ padding: `${theme.spacing.sm}px ${theme.spacing.md}px` }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 2FA codes\u2026"
          style={{
            width: '100%',
            padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
            background: theme.colors.inputBackground,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: theme.radii.full,
            color: theme.colors.text,
            fontSize: theme.typography.sizes.sm,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${theme.spacing.md}px` }}>
        {loading ? (
          <div
            style={{
              textAlign: 'center',
              color: theme.colors.textSecondary,
              fontSize: theme.typography.sizes.sm,
              paddingTop: theme.spacing.xl,
            }}
          >
            Loading\u2026
          </div>
        ) : totpItems.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              paddingTop: theme.spacing.xl,
              color: theme.colors.textSecondary,
              fontSize: theme.typography.sizes.sm,
            }}
          >
            {query
              ? 'No matching 2FA codes.'
              : 'No 2FA codes yet. Add a TOTP secret to any credential to see it here.'}
          </div>
        ) : (
          totpItems.map((item) => (
            <div
              key={item.id}
              style={sectionStyle}
              role="button"
              tabIndex={0}
              onClick={() => onNavigate(`detail:${item.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onNavigate(`detail:${item.id}`);
                }
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: theme.typography.weights.medium,
                  color: theme.colors.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.name}
              </div>
              {item.type === 'credential' && item.username && (
                <div
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    color: theme.colors.textSecondary,
                    marginBottom: theme.spacing.xs,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.username}
                </div>
              )}
              <div onClick={(e) => e.stopPropagation()}>
                <TotpCodeDisplay input={item.totp} label="" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
