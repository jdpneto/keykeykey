import React, { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { ItemCard } from '../components/ItemCard.js';
import type { VaultItem } from '@keykeykey/core';

type FilterType = 'all' | 'credential' | 'card' | 'secure-note';

interface VaultListScreenProps {
  onNavigate: (screen: string) => void;
}

export function VaultListScreen({ onNavigate }: VaultListScreenProps) {
  const { theme } = useTheme();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncConnected, setSyncConnected] = useState(false);

  const refreshItems = useCallback(async () => {
    const result = (await sendMessage<{ items?: VaultItem[] }>({
      type: 'GET_ITEMS',
    })) as { items?: VaultItem[] };
    setItems(result.items ?? []);
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await sendMessage({ type: 'TRIGGER_SYNC' });
      await refreshItems();
    } finally {
      setSyncing(false);
    }
  }, [refreshItems]);

  // Load items and sync status on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [itemsResult, syncResult] = await Promise.all([
          sendMessage<{ items?: VaultItem[] }>({ type: 'GET_ITEMS' }),
          sendMessage<{ provider?: string }>({ type: 'GET_SYNC_STATUS' }),
        ]);
        setItems((itemsResult as { items?: VaultItem[] }).items ?? []);
        const provider = (syncResult as { provider?: string }).provider;
        setSyncConnected(!!provider && provider !== 'none');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Search when query changes
  useEffect(() => {
    if (!query.trim()) {
      sendMessage<{ items?: VaultItem[] }>({ type: 'GET_ITEMS' }).then((result) => {
        const r = result as { items?: VaultItem[] };
        setItems(r.items ?? []);
      });
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const result = (await sendMessage<{ items?: VaultItem[] }>({
          type: 'SEARCH',
          query: query.trim(),
        })) as { items?: VaultItem[] };
        setItems(result.items ?? []);
      } catch {
        // ignore
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [query]);

  const filteredItems = filter === 'all' ? items : items.filter((item) => item.type === filter);

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'credential', label: 'Logins' },
    { key: 'card', label: 'Cards' },
    { key: 'secure-note', label: 'Notes' },
  ];

  const chipStyle = (active: boolean): React.CSSProperties => ({
    padding: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
    borderRadius: theme.radii.full,
    border: `1px solid ${active ? theme.colors.primary : theme.colors.border}`,
    background: active ? theme.colors.primary : 'none',
    color: active ? '#000' : theme.colors.textSecondary,
    fontSize: theme.typography.sizes.xs,
    fontWeight: active ? theme.typography.weights.semibold : theme.typography.weights.regular,
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap' as const,
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '600px',
        position: 'relative',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
          borderBottom: `1px solid ${theme.colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: theme.spacing.sm,
        }}
      >
        <div
          style={{
            fontWeight: theme.typography.weights.bold,
            fontSize: theme.typography.sizes.md,
            color: theme.colors.text,
            flex: 1,
          }}
        >
          KeyKeyKey
        </div>
        {syncConnected && (
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              background: 'none',
              border: 'none',
              color: theme.colors.textSecondary,
              cursor: syncing ? 'default' : 'pointer',
              fontSize: theme.typography.sizes.md,
              padding: theme.spacing.xs,
              borderRadius: theme.radii.sm,
              opacity: syncing ? 0.5 : 1,
            }}
            title="Sync Now"
          >
            &#8635;
          </button>
        )}
        <button
          onClick={() => onNavigate('settings')}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.md,
            padding: theme.spacing.xs,
            borderRadius: theme.radii.sm,
          }}
          title="Settings"
        >
          &#9881;
        </button>
        <button
          onClick={() => onNavigate('generator')}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.md,
            padding: theme.spacing.xs,
            borderRadius: theme.radii.sm,
          }}
          title="Password Generator"
        >
          &#128273;
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: `${theme.spacing.sm}px ${theme.spacing.md}px` }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vault\u2026"
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

      {/* Filter chips */}
      <div
        style={{
          display: 'flex',
          gap: theme.spacing.xs,
          padding: `0 ${theme.spacing.md}px ${theme.spacing.sm}px`,
          overflowX: 'auto',
        }}
      >
        {filters.map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)} style={chipStyle(filter === key)}>
            {label}
          </button>
        ))}
      </div>

      {/* Item list */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: `0 ${theme.spacing.md}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: theme.spacing.xs,
          paddingBottom: 64,
        }}
      >
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
        ) : filteredItems.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              paddingTop: theme.spacing.xl,
              color: theme.colors.textSecondary,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: theme.spacing.sm }}>&#128274;</div>
            <div style={{ fontSize: theme.typography.sizes.sm }}>
              {query ? 'No results found.' : 'No items yet. Add your first item!'}
            </div>
          </div>
        ) : (
          filteredItems.map((item) => (
            <ItemCard key={item.id} item={item} onClick={() => onNavigate(`detail:${item.id}`)} />
          ))
        )}
      </div>

      {/* Floating add button */}
      <button
        onClick={() => onNavigate('add')}
        style={{
          position: 'absolute',
          bottom: theme.spacing.md,
          right: theme.spacing.md,
          width: 48,
          height: 48,
          borderRadius: theme.radii.full,
          background: theme.colors.primary,
          color: '#000',
          border: 'none',
          fontSize: 24,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          fontWeight: theme.typography.weights.bold,
        }}
        title="Add item"
      >
        +
      </button>
    </div>
  );
}
