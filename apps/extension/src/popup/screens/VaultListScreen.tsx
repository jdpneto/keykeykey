import React, { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import { ItemCard } from '../components/ItemCard.js';
import {
  SyncIcon,
  PlusIcon,
  DiceIcon,
  ShieldIcon,
  LockIcon,
  GearIcon,
} from '../components/icons/index.js';
import type { VaultItem } from '@keykeykey/core';

type FilterType = 'all' | 'credential' | 'card' | 'secure-note';

interface VaultListScreenProps {
  onNavigate: (screen: string) => void;
  onLock: () => void;
}

export function VaultListScreen({ onNavigate, onLock }: VaultListScreenProps) {
  const { theme } = useTheme();
  const [items, setItems] = useState<VaultItem[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set());
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

  const handleLock = async () => {
    await sendMessage({ type: 'LOCK' });
    onLock();
  };

  const handleFill = useCallback(
    async (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item || item.type !== 'credential') return;

      // Warn if credential doesn't match the current tab's domain
      if (!matchedIds.has(itemId)) {
        const confirmed = window.confirm(
          `This credential is for "${item.name}" but the current page is a different site.\n\nFill anyway?`,
        );
        if (!confirmed) return;
      }

      await sendMessage({
        type: 'FILL_ACTIVE_TAB',
        username: item.username,
        password: item.password,
      });
      window.close();
    },
    [items, matchedIds],
  );

  const toolbarButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: theme.colors.textSecondary,
    cursor: 'pointer',
    padding: 4,
    borderRadius: theme.radii.sm,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
  };

  // Load items and sync status on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const tabResult = (await sendMessage<{ url?: string | null }>({
          type: 'GET_ACTIVE_TAB_URL',
        })) as { url?: string | null };

        let hostname: string | null = null;
        if (tabResult.url) {
          try {
            hostname = new URL(tabResult.url).hostname;
          } catch {
            // ignore invalid URLs
          }
        }

        const [itemsResult, syncResult] = await Promise.all([
          hostname
            ? sendMessage<{ items?: VaultItem[]; matchedIds?: string[] }>({
                type: 'GET_ITEMS_FOR_HOST',
                hostname,
              })
            : sendMessage<{ items?: VaultItem[] }>({ type: 'GET_ITEMS' }),
          sendMessage<{ provider?: string }>({ type: 'GET_SYNC_STATUS' }),
        ]);

        const r = itemsResult as { items?: VaultItem[]; matchedIds?: string[] };
        setItems(r.items ?? []);
        setMatchedIds(new Set(r.matchedIds ?? []));
        const provider = (syncResult as { provider?: string }).provider;
        setSyncConnected(!!provider && provider !== 'none');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Search when query or filter changes. Filter is part of the dep list so
  // switching tabs (e.g. All → Notes) re-runs the search with deep fields.
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
        // Cards / Notes tabs opt into deep-field search; All / Logins stay
        // shallow.
        const deep = filter === 'card' || filter === 'secure-note';
        const result = (await sendMessage<{ items?: VaultItem[] }>({
          type: 'SEARCH',
          query: query.trim(),
          types: filter === 'all' ? undefined : [filter],
          deepFields: deep,
        })) as { items?: VaultItem[] };
        setItems(result.items ?? []);
      } catch {
        // ignore
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [query, filter]);

  // When there's no query, items come from GET_ITEMS (unfiltered) and we
  // post-filter for the chip. With a query, the SEARCH message already
  // applied `types`, so we don't filter again.
  const filteredItems = query.trim()
    ? items
    : filter === 'all'
      ? items
      : items.filter((item) => item.type === filter);

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
              ...toolbarButtonStyle,
              opacity: syncing ? 0.5 : 1,
              cursor: syncing ? 'default' : 'pointer',
            }}
            aria-label="Sync Now"
          >
            <SyncIcon />
          </button>
        )}
        <button onClick={() => onNavigate('add')} style={toolbarButtonStyle} aria-label="Add item">
          <PlusIcon />
        </button>
        <button
          onClick={() => onNavigate('authenticator')}
          style={toolbarButtonStyle}
          aria-label="Authenticator"
          title="Authenticator"
        >
          <ShieldIcon />
        </button>
        <button
          onClick={() => onNavigate('generator')}
          style={toolbarButtonStyle}
          aria-label="Password Generator"
        >
          <DiceIcon />
        </button>
        <button onClick={handleLock} style={toolbarButtonStyle} aria-label="Lock vault">
          <LockIcon />
        </button>
        <button
          onClick={() => onNavigate('settings')}
          style={toolbarButtonStyle}
          aria-label="Settings"
        >
          <GearIcon />
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: `${theme.spacing.sm}px ${theme.spacing.md}px` }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search vault…"
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
          <>
            {/* "For this site" section */}
            {matchedIds.size > 0 && filter === 'all' && !query && (
              <>
                <div
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    fontWeight: theme.typography.weights.semibold,
                    color: theme.colors.textSecondary,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.05em',
                    paddingTop: theme.spacing.xs,
                  }}
                >
                  For this site
                </div>
                {filteredItems
                  .filter((item) => matchedIds.has(item.id))
                  .map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      onClick={() => onNavigate(`detail:${item.id}`)}
                      onFill={item.type === 'credential' ? () => handleFill(item.id) : undefined}
                    />
                  ))}
                <div
                  style={{
                    fontSize: theme.typography.sizes.xs,
                    fontWeight: theme.typography.weights.semibold,
                    color: theme.colors.textSecondary,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.05em',
                    paddingTop: theme.spacing.sm,
                  }}
                >
                  All items
                </div>
              </>
            )}
            {filteredItems
              .filter((item) =>
                !query && matchedIds.size > 0 && filter === 'all' ? !matchedIds.has(item.id) : true,
              )
              .map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  onClick={() => onNavigate(`detail:${item.id}`)}
                  onFill={item.type === 'credential' ? () => handleFill(item.id) : undefined}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
