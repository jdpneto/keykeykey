import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type Theme } from '@/lib/theme';
import type { VaultItem } from '@keykeykey/core';

type Props = {
  item: VaultItem;
  onPress: () => void;
};

function getIcon(type: VaultItem['type']): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'credential':
      return 'key-outline';
    case 'card':
      return 'card-outline';
    case 'secure-note':
      return 'document-text-outline';
  }
}

function getSubtitle(item: VaultItem): string {
  switch (item.type) {
    case 'credential':
      return item.username;
    case 'card':
      return `•••• ${item.number.slice(-4)}`;
    case 'secure-note':
      return 'Secure Note';
  }
}

export function ItemCard({ item, onPress }: Props) {
  const t = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          borderRadius: t.radii.md,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.iconContainer,
          { backgroundColor: t.colors.primaryMuted, borderRadius: t.radii.sm },
        ]}
      >
        <Ionicons name={getIcon(item.type)} size={20} color={t.colors.primary} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: t.colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.subtitle, { color: t.colors.textSecondary }]} numberOfLines={1}>
          {getSubtitle(item)}
        </Text>
      </View>
      {item.favorite && (
        <Ionicons name="star" size={16} color={t.colors.primary} style={styles.star} />
      )}
      <Ionicons name="chevron-forward" size={18} color={t.colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  iconContainer: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  star: {
    marginRight: 8,
  },
});
