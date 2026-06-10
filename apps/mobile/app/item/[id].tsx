import { useState, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { Button } from '@/components/Button';
import { TotpCodeDisplay } from '@/components/TotpCodeDisplay';

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, removeItem, updateItem, restorePasswordFromHistory } = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  const item = useMemo(() => items.find((i) => i.id === id), [items, id]);
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRevealed, setHistoryRevealed] = useState<Set<number>>(new Set());

  useEffect(() => {
    setRevealedFields(new Set());
    setHistoryOpen(false);
    setHistoryRevealed(new Set());
  }, [id]);

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
    // Auto-clear clipboard after 30 seconds for security
    setTimeout(() => {
      Clipboard.setStringAsync('');
    }, 30_000);
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
        <Pressable testID="detail-back" onPress={() => router.back()} style={styles.backBtn}>
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
            testID="detail-edit"
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
            {item.url && (
              // multiline: long URLs must wrap, not clip. numberOfLines={1}
              // doesn't ellipsize selectable Text on Android — the value
              // wraps anyway and the second line gets cut off by the row.
              <DetailField
                label="URL"
                value={item.url}
                multiline
                onCopy={() => copyToClipboard(item.url!, 'URL')}
              />
            )}
            <DetailField
              label="Username"
              value={item.username}
              onCopy={() => copyToClipboard(item.username, 'Username')}
              copyTestID="detail-copy-username"
            />
            <DetailField
              label="Password"
              value={item.password}
              hidden={!revealedFields.has('password')}
              onToggle={() => toggleReveal('password')}
              onCopy={() => copyToClipboard(item.password, 'Password')}
              toggleTestID="detail-reveal-password"
              copyTestID="detail-copy-password"
            />
            {item.totp && (
              <TotpCodeDisplay
                testID="detail-totp-code"
                copyTestID="detail-totp-copy"
                input={item.totp}
              />
            )}
            {item.notes && <DetailField label="Notes" value={item.notes} />}
          </>
        )}

        {item.type === 'card' && (
          <>
            <DetailField
              label="Cardholder"
              value={item.cardholderName}
              onCopy={() => copyToClipboard(item.cardholderName, 'Cardholder')}
            />
            <DetailField
              label="Card Number"
              value={item.number}
              hidden={!revealedFields.has('number')}
              onToggle={() => toggleReveal('number')}
              onCopy={() => copyToClipboard(item.number, 'Card Number')}
              copyTestID="detail-copy-cardnumber"
            />
            <DetailField
              label="Expiration"
              value={`${String(item.expirationMonth).padStart(2, '0')}/${item.expirationYear}`}
            />
            <DetailField
              label="CVV"
              value={item.cvv}
              hidden={!revealedFields.has('cvv')}
              onToggle={() => toggleReveal('cvv')}
              onCopy={() => copyToClipboard(item.cvv, 'CVV')}
              copyTestID="detail-copy-cvv"
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

        {item.type === 'credential' && item.passwordHistory && item.passwordHistory.length > 0 && (
          <View style={[styles.historySection, { borderColor: t.colors.border }]}>
            <Pressable
              testID="detail-password-history"
              onPress={() => {
                setHistoryOpen((prev) => {
                  if (prev) setHistoryRevealed(new Set());
                  return !prev;
                });
              }}
              style={styles.historyToggle}
            >
              <Text style={[styles.historyToggleText, { color: t.colors.textSecondary }]}>
                Password History ({item.passwordHistory.length})
              </Text>
              <Ionicons
                name={historyOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={t.colors.textSecondary}
              />
            </Pressable>

            {historyOpen && (
              <>
                {[...item.passwordHistory].reverse().map((entry, idx) => {
                  const originalIndex = item.passwordHistory.length - 1 - idx;
                  return (
                    <View
                      key={idx}
                      style={[styles.historyRow, { borderTopColor: t.colors.border }]}
                    >
                      <View style={styles.historyRowContent}>
                        <Text style={[styles.historyPassword, { color: t.colors.text }]}>
                          {historyRevealed.has(idx) ? entry.password : '••••••••••'}
                        </Text>
                        <Text style={[styles.historyDate, { color: t.colors.textSecondary }]}>
                          Changed on {new Date(entry.changedAt).toLocaleDateString()}
                        </Text>
                      </View>
                      <View style={styles.historyActions}>
                        <Pressable
                          onPress={() =>
                            setHistoryRevealed((prev) => {
                              const next = new Set(prev);
                              if (next.has(idx)) next.delete(idx);
                              else next.add(idx);
                              return next;
                            })
                          }
                          style={styles.fieldBtn}
                        >
                          <Ionicons
                            name={historyRevealed.has(idx) ? 'eye-off-outline' : 'eye-outline'}
                            size={18}
                            color={t.colors.textSecondary}
                          />
                        </Pressable>
                        <Pressable
                          onPress={() => copyToClipboard(entry.password, 'Password')}
                          style={styles.fieldBtn}
                        >
                          <Ionicons name="copy-outline" size={18} color={t.colors.textSecondary} />
                        </Pressable>
                        <Pressable
                          onPress={async () => {
                            await restorePasswordFromHistory(item.id, originalIndex);
                            Alert.alert('Restored', 'Previous password moved to history');
                          }}
                          accessibilityLabel="Restore this password"
                          testID={`history-restore-${originalIndex}`}
                          style={styles.fieldBtn}
                        >
                          <Ionicons
                            name="refresh-outline"
                            size={18}
                            color={t.colors.textSecondary}
                          />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}

                <Pressable
                  onPress={() =>
                    Alert.alert(
                      'Clear History',
                      'Clear all password history for this credential?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Clear',
                          style: 'destructive',
                          onPress: () => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- passwordHistory is credential-only
                            updateItem(item.id, { passwordHistory: [] } as any);
                            setHistoryOpen(false);
                          },
                        },
                      ],
                    )
                  }
                  style={[styles.clearHistoryBtn, { borderTopColor: t.colors.border }]}
                >
                  <Text style={[styles.clearHistoryText, { color: t.colors.danger }]}>
                    Clear History
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: t.colors.textSecondary }]}>
            Created: {new Date(item.createdAt).toLocaleDateString()}
          </Text>
          <Text style={[styles.metaText, { color: t.colors.textSecondary }]}>
            Updated: {new Date(item.updatedAt).toLocaleDateString()}
          </Text>
        </View>

        <Button
          testID="detail-delete"
          title="Delete Item"
          onPress={handleDelete}
          variant="danger"
          style={{ marginTop: 24 }}
        />
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
  toggleTestID,
  copyTestID,
}: {
  label: string;
  value: string;
  hidden?: boolean;
  multiline?: boolean;
  onToggle?: () => void;
  onCopy?: () => void;
  toggleTestID?: string;
  copyTestID?: string;
}) {
  const { theme: t } = useTheme();

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
            <Pressable testID={toggleTestID} onPress={onToggle} style={styles.fieldBtn}>
              <Ionicons
                name={hidden ? 'eye-outline' : 'eye-off-outline'}
                size={18}
                color={t.colors.textSecondary}
              />
            </Pressable>
          )}
          {onCopy && (
            <Pressable testID={copyTestID} onPress={onCopy} style={styles.fieldBtn}>
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
  historySection: {
    marginTop: 24,
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  historyToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  historyToggleText: {
    fontSize: 13,
    fontWeight: '500',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  historyRowContent: {
    flex: 1,
  },
  historyPassword: {
    fontSize: 15,
  },
  historyDate: {
    fontSize: 11,
    marginTop: 2,
  },
  historyActions: {
    flexDirection: 'row',
    gap: 4,
  },
  clearHistoryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
  },
  clearHistoryText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
