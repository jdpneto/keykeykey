import { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { SwipeableItemRow } from '@/components/SwipeableItemRow';
import { EmptyState } from '@/components/EmptyState';

type FilterType = 'all' | 'credential' | 'card' | 'secure-note';

export default function VaultScreen() {
  const { items, search, triggerSync, removeItem } = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await triggerSync();
    } finally {
      setRefreshing(false);
    }
  }, [triggerSync]);

  const filteredItems = useMemo(() => {
    let result;
    if (query) {
      // Cards / Notes tabs opt into deep-field search (card body, note
      // content). All / Logins stay shallow.
      const deep = filter === 'card' || filter === 'secure-note';
      result = search(query, {
        types: filter === 'all' ? undefined : [filter],
        deepFields: deep,
      });
    } else {
      result = filter === 'all' ? items : items.filter((item) => item.type === filter);
    }
    // Sort: favorites first, then by updatedAt descending
    return [...result].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [items, query, filter, search]);

  const filters: { key: FilterType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'all', label: 'All', icon: 'apps-outline' },
    { key: 'credential', label: 'Logins', icon: 'key-outline' },
    { key: 'card', label: 'Cards', icon: 'card-outline' },
    { key: 'secure-note', label: 'Notes', icon: 'document-text-outline' },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.colors.text }]}>Vault</Text>
        <Pressable
          testID="vault-add-button"
          onPress={() => router.push('/item/add')}
          style={[styles.addButton, { backgroundColor: t.colors.primary }]}
        >
          <Ionicons name="add" size={24} color="#1a2e05" />
        </Pressable>
      </View>

      <View
        style={[
          styles.searchContainer,
          {
            backgroundColor: t.colors.inputBackground,
            borderColor: t.colors.border,
            borderRadius: t.radii.md,
          },
        ]}
      >
        <Ionicons name="search-outline" size={18} color={t.colors.textSecondary} />
        <TextInput
          testID="vault-search"
          style={[styles.searchInput, { color: t.colors.text }]}
          placeholder="Search vault..."
          placeholderTextColor={t.colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={t.colors.textSecondary} />
          </Pressable>
        )}
      </View>

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[
              styles.filterChip,
              {
                backgroundColor: filter === f.key ? t.colors.primaryMuted : t.colors.surface,
                borderColor: filter === f.key ? t.colors.primary : t.colors.border,
                borderRadius: t.radii.full,
              },
            ]}
          >
            <Ionicons
              name={f.icon}
              size={14}
              color={filter === f.key ? t.colors.text : t.colors.textSecondary}
            />
            <Text
              style={[
                styles.filterLabel,
                { color: filter === f.key ? t.colors.text : t.colors.textSecondary },
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filteredItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, filteredItems.length === 0 && styles.emptyList]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.primary}
          />
        }
        renderItem={({ item }) => (
          <SwipeableItemRow
            testID={`vault-item-${item.id}`}
            item={item}
            onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
            onEdit={() => router.push({ pathname: '/item/edit', params: { id: item.id } })}
            onDelete={() => {
              // Confirmation lives inside SwipeableItemRow; this fires only
              // after the user confirms.
              void removeItem(item.id);
            }}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="shield-outline"
            title={query ? 'No results found' : 'Your vault is empty'}
            subtitle={query ? 'Try a different search term' : 'Tap + to add your first item'}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    marginLeft: 8,
    padding: 0,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    gap: 4,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  emptyList: {
    flex: 1,
  },
});
