import { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme';
import { Button } from '@/components/Button';
import type { VaultItem } from '@keykeykey/core';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, removeItem, updateItem } = useVault();
  const router = useRouter();
  const t = useTheme();

  const item = useMemo(() => items.find((i) => i.id === id), [items, id]);
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());

  if (!item) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
        <View style={styles.center}>
          <Text style={{ color: t.colors.textSecondary }}>Item not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const toggleReveal = (field: string) => {
    setRevealedFields((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  };

  const copyToClipboard = async (value: string, label: string) => {
    await Clipboard.setStringAsync(value);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  const handleDelete = () => {
    Alert.alert('Delete Item', `Are you sure you want to delete "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await removeItem(item.id);
          router.back();
        },
      },
    ]);
  };

  const handleToggleFavorite = async () => {
    await updateItem(item.id, { favorite: !item.favorite });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <View style={styles.navHeader}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={t.colors.primary} />
          <Text style={[styles.backText, { color: t.colors.primary }]}>Back</Text>
        </Pressable>
        <View style={styles.navActions}>
          <Pressable onPress={handleToggleFavorite} style={styles.navBtn}>
            <Ionicons
              name={item.favorite ? 'star' : 'star-outline'}
              size={22}
              color={item.favorite ? t.colors.primary : t.colors.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: '/item/edit', params: { id: item.id } })}
            style={styles.navBtn}
          >
            <Ionicons name="create-outline" size={22} color={t.colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.titleRow}>
          <View style={[styles.iconCircle, { backgroundColor: t.colors.primaryMuted }]}>
            <Ionicons
              name={
                item.type === 'credential'
                  ? 'key-outline'
                  : item.type === 'card'
                    ? 'card-outline'
                    : 'document-text-outline'
              }
              size={24}
              color={t.colors.primary}
            />
          </View>
          <View style={styles.titleContent}>
            <Text style={[styles.itemName, { color: t.colors.text }]}>{item.name}</Text>
            <Text style={[styles.itemType, { color: t.colors.textSecondary }]}>
              {item.type === 'credential' ? 'Login' : item.type === 'card' ? 'Card' : 'Secure Note'}
            </Text>
          </View>
        </View>

        {item.type === 'credential' && (
          <>
            {item.url && <DetailField label="URL" value={item.url} onCopy={() => copyToClipboard(item.url!, 'URL')} />}
            <DetailField label="Username" value={item.username} onCopy={() => copyToClipboard(item.username, 'Username')} />
            <DetailField
              label="Password"
              value={item.password}
              hidden={!revealedFields.has('password')}
              onToggle={() => toggleReveal('password')}
              onCopy={() => copyToClipboard(item.password, 'Password')}
            />
            {item.notes && <DetailField label="Notes" value={item.notes} />}
          </>
        )}

        {item.type === 'card' && (
          <>
            <DetailField label="Cardholder" value={item.cardholderName} onCopy={() => copyToClipboard(item.cardholderName, 'Cardholder')} />
            <DetailField
              label="Card Number"
              value={item.number}
              hidden={!revealedFields.has('number')}
              onToggle={() => toggleReveal('number')}
              onCopy={() => copyToClipboard(item.number, 'Card Number')}
            />
            <DetailField label="Expiration" value={`${String(item.expirationMonth).padStart(2, '0')}/${item.expirationYear}`} />
            <DetailField
              label="CVV"
              value={item.cvv}
              hidden={!revealedFields.has('cvv')}
              onToggle={() => toggleReveal('cvv')}
              onCopy={() => copyToClipboard(item.cvv, 'CVV')}
            />
            {item.pin && (
              <DetailField
                label="PIN"
                value={item.pin}
                hidden={!revealedFields.has('pin')}
                onToggle={() => toggleReveal('pin')}
                onCopy={() => copyToClipboard(item.pin!, 'PIN')}
              />
            )}
            {item.notes && <DetailField label="Notes" value={item.notes} />}
          </>
        )}

        {item.type === 'secure-note' && (
          <DetailField label="Content" value={item.content} multiline />
        )}

        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: t.colors.textSecondary }]}>
            Created: {new Date(item.createdAt).toLocaleDateString()}
          </Text>
          <Text style={[styles.metaText, { color: t.colors.textSecondary }]}>
            Updated: {new Date(item.updatedAt).toLocaleDateString()}
          </Text>
        </View>

        <Button title="Delete Item" onPress={handleDelete} variant="danger" style={{ marginTop: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailField({
  label,
  value,
  hidden,
  multiline,
  onToggle,
  onCopy,
}: {
  label: string;
  value: string;
  hidden?: boolean;
  multiline?: boolean;
  onToggle?: () => void;
  onCopy?: () => void;
}) {
  const t = useTheme();

  return (
    <View style={[styles.field, { borderBottomColor: t.colors.border }]}>
      <Text style={[styles.fieldLabel, { color: t.colors.textSecondary }]}>{label}</Text>
      <View style={styles.fieldValueRow}>
        <Text
          style={[styles.fieldValue, { color: t.colors.text }, multiline && styles.multiline]}
          selectable={!hidden}
          numberOfLines={multiline ? undefined : 1}
        >
          {hidden ? '••••••••••' : value}
        </Text>
        <View style={styles.fieldActions}>
          {onToggle && (
            <Pressable onPress={onToggle} style={styles.fieldBtn}>
              <Ionicons
                name={hidden ? 'eye-outline' : 'eye-off-outline'}
                size={18}
                color={t.colors.textSecondary}
              />
            </Pressable>
          )}
          {onCopy && (
            <Pressable onPress={onCopy} style={styles.fieldBtn}>
              <Ionicons name="copy-outline" size={18} color={t.colors.textSecondary} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  navHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: 16,
    marginLeft: 2,
  },
  navActions: {
    flexDirection: 'row',
    gap: 12,
  },
  navBtn: {
    padding: 4,
  },
  scroll: {
    padding: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  titleContent: {
    flex: 1,
  },
  itemName: {
    fontSize: 22,
    fontWeight: '700',
  },
  itemType: {
    fontSize: 13,
    marginTop: 2,
  },
  field: {
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldValue: {
    flex: 1,
    fontSize: 16,
  },
  multiline: {
    lineHeight: 24,
  },
  fieldActions: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldBtn: {
    padding: 6,
  },
  meta: {
    marginTop: 24,
    gap: 4,
  },
  metaText: {
    fontSize: 12,
  },
});
