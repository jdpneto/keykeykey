import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, X, Shield, KeyRound, CreditCard, FileText, RefreshCw } from 'lucide-react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';
import { ItemCard } from '../components/ui/ItemCard';
import { EmptyState } from '../components/ui/EmptyState';

const FILTERS = [
  { key: 'all', label: 'All', icon: Shield },
  { key: 'credential', label: 'Logins', icon: KeyRound },
  { key: 'card', label: 'Cards', icon: CreditCard },
  { key: 'secure-note', label: 'Notes', icon: FileText },
] as const;

export function VaultListScreen() {
  const { theme } = useTheme();
  const { items, search, triggerSync, syncConfig } = useVault();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [syncing, setSyncing] = useState(false);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await triggerSync();
    } finally {
      setSyncing(false);
    }
  }, [triggerSync]);

  const filteredItems = useMemo(() => {
    let result = query ? search(query) : items;
    if (filter !== 'all') {
      result = result.filter((item) => item.type === filter);
    }
    return result.sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [items, query, filter, search]);

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
        }}
      >
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
          }}
        >
          Vault
        </h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {syncConfig && syncConfig.provider !== 'none' && (
            <button
              onClick={handleSync}
              disabled={syncing}
              title="Sync Now"
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                backgroundColor: theme.colors.surface,
                border: `1px solid ${theme.colors.border}`,
                cursor: syncing ? 'default' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: syncing ? 0.6 : 1,
              }}
            >
              <RefreshCw
                size={16}
                color={theme.colors.textSecondary}
                style={syncing ? { animation: 'spin 1s linear infinite' } : undefined}
              />
            </button>
          )}
          <button
            onClick={() => navigate('/vault/add')}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              backgroundColor: theme.colors.primary,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Plus size={20} color="#000000" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search
          size={16}
          color={theme.colors.textSecondary}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vault..."
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
          onFocus={(e) => (e.currentTarget.style.borderColor = theme.colors.primary)}
          onBlur={(e) => (e.currentTarget.style.borderColor = theme.colors.border)}
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

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {FILTERS.map(({ key, label, icon: Icon }) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: theme.radii.full,
                border: `1px solid ${active ? theme.colors.primary : theme.colors.border}`,
                backgroundColor: active ? theme.colors.primaryMuted : 'transparent',
                color: active ? theme.colors.text : theme.colors.textSecondary,
                fontSize: theme.typography.sizes.xs,
                fontWeight: active
                  ? theme.typography.weights.semibold
                  : theme.typography.weights.regular,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Item list */}
      {filteredItems.length === 0 ? (
        <EmptyState
          icon={Shield}
          title={query ? 'No results' : 'Your vault is empty'}
          subtitle={query ? 'Try a different search term' : 'Add your first item to get started'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredItems.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onPress={() => navigate(`/vault/item/${item.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
