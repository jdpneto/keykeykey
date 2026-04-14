import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput as RNTextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { TotpCodeDisplay } from '@/components/TotpCodeDisplay';
import type { VaultItem } from '@keykeykey/core';

type TotpCredential = Extract<VaultItem, { type: 'credential' }> & { totp: string };

export default function AuthenticatorTab() {
  const { theme: t } = useTheme();
  const { items } = useVault();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const totpItems = useMemo<TotpCredential[]>(() => {
    const all = items.filter((i): i is TotpCredential => i.type === 'credential' && !!i.totp);
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
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.colors.text }]}>Authenticator</Text>
      </View>

      <View style={styles.searchRow}>
        <View
          style={[
            styles.searchField,
            { backgroundColor: t.colors.inputBackground, borderColor: t.colors.border },
          ]}
        >
          <Ionicons name="search-outline" size={16} color={t.colors.textSecondary} />
          <RNTextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search 2FA codes"
            placeholderTextColor={t.colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: t.colors.text }]}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={t.colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>

      {totpItems.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="shield-checkmark-outline" size={48} color={t.colors.textSecondary} />
          <Text style={[styles.emptyTitle, { color: t.colors.text }]}>
            {query ? 'No matching codes' : 'No 2FA codes yet'}
          </Text>
          <Text style={[styles.emptyMsg, { color: t.colors.textSecondary }]}>
            {query
              ? 'Try a different search term.'
              : 'Add a TOTP secret to any credential to see it here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={totpItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: t.colors.surface,
                  borderColor: t.colors.border,
                  borderRadius: t.radii.md,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.itemName, { color: t.colors.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.username ? (
                    <Text
                      style={[styles.itemSub, { color: t.colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {item.username}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.colors.textSecondary} />
              </View>
              <TotpCodeDisplay input={item.totp} label="" />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
  },
  searchRow: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 24,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  emptyMsg: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  card: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
    borderWidth: 1,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '500',
  },
  itemSub: {
    fontSize: 13,
    marginTop: 2,
  },
});
