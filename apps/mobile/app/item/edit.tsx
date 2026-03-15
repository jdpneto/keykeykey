import { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';
import { getDefaultStrongPassword } from '@keykeykey/core';
import type { VaultItem } from '@keykeykey/core';

export default function EditItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, updateItem } = useVault();
  const router = useRouter();
  const t = useTheme();

  const item = useMemo(() => items.find((i) => i.id === id), [items, id]);

  const [name, setName] = useState(item?.name ?? '');
  const [loading, setLoading] = useState(false);

  // Credential
  const [url, setUrl] = useState(item?.type === 'credential' ? (item.url ?? '') : '');
  const [username, setUsername] = useState(item?.type === 'credential' ? item.username : '');
  const [password, setPassword] = useState(item?.type === 'credential' ? item.password : '');
  const [notes, setNotes] = useState(
    item?.type === 'credential' || item?.type === 'card' ? (item.notes ?? '') : '',
  );
  const [appIdentifiers, setAppIdentifiers] = useState<string[]>(
    item?.type === 'credential' ? ((item as any).appIdentifiers ?? []) : [],
  );

  // Card
  const [cardholderName, setCardholderName] = useState(
    item?.type === 'card' ? item.cardholderName : '',
  );
  const [cardNumber, setCardNumber] = useState(item?.type === 'card' ? item.number : '');
  const [expMonth, setExpMonth] = useState(
    item?.type === 'card' ? String(item.expirationMonth) : '',
  );
  const [expYear, setExpYear] = useState(item?.type === 'card' ? String(item.expirationYear) : '');
  const [cvv, setCvv] = useState(item?.type === 'card' ? item.cvv : '');
  const [pin, setPin] = useState(item?.type === 'card' ? (item.pin ?? '') : '');

  // Secure note
  const [content, setContent] = useState(item?.type === 'secure-note' ? item.content : '');

  if (!item) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
        <View style={styles.center}>
          <Text style={{ color: t.colors.textSecondary }}>Item not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }

    setLoading(true);
    try {
      const updates: Partial<Omit<VaultItem, 'id' | 'type' | 'createdAt'>> = {
        name: name.trim(),
      };

      if (item.type === 'credential') {
        Object.assign(updates, {
          username: username.trim(),
          password: password.trim(),
          url: url.trim() || undefined,
          notes: notes.trim() || undefined,
          appIdentifiers: appIdentifiers.length > 0 ? appIdentifiers : undefined,
        });
      } else if (item.type === 'card') {
        Object.assign(updates, {
          cardholderName: cardholderName.trim(),
          number: cardNumber.trim(),
          expirationMonth: parseInt(expMonth, 10) || 1,
          expirationYear: parseInt(expYear, 10) || new Date().getFullYear(),
          cvv: cvv.trim(),
          pin: pin.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      } else {
        Object.assign(updates, {
          content: content.trim(),
        });
      }

      await updateItem(item.id, updates);
      router.back();
    } catch {
      Alert.alert('Error', 'Failed to update item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.modalHeader}>
          <Pressable onPress={() => router.back()}>
            <Text style={[styles.cancelText, { color: t.colors.textSecondary }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.modalTitle, { color: t.colors.text }]}>Edit Item</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TextInput label="Name" value={name} onChangeText={setName} />

          {item.type === 'credential' && (
            <>
              <TextInput label="URL" value={url} onChangeText={setUrl} keyboardType="url" />
              <TextInput label="Username" value={username} onChangeText={setUsername} />
              <TextInput
                label="Password"
                value={password}
                onChangeText={setPassword}
                isPassword
                onGenerate={() => setPassword(getDefaultStrongPassword())}
              />
              <TextInput
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
              />

              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: t.colors.textSecondary }]}>
                  App Identifiers
                </Text>
                {appIdentifiers.length > 0 && (
                  <View style={styles.chipContainer}>
                    {appIdentifiers.map((id) => (
                      <View
                        key={id}
                        style={[styles.chip, { backgroundColor: t.colors.surface }]}
                      >
                        <Text style={[styles.chipText, { color: t.colors.text }]}>{id}</Text>
                        <Pressable
                          onPress={() =>
                            setAppIdentifiers((prev) => prev.filter((v) => v !== id))
                          }
                          hitSlop={8}
                        >
                          <Text style={[styles.chipRemove, { color: t.colors.textSecondary }]}>
                            ✕
                          </Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )}
                <TextInput
                  label="Add identifier (e.g. com.example.app)"
                  onSubmitEditing={(e: any) => {
                    const value = e.nativeEvent.text.trim().toLowerCase();
                    if (value && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(value)) {
                      setAppIdentifiers((prev) => [...new Set([...prev, value])]);
                    }
                  }}
                />
              </View>
            </>
          )}

          {item.type === 'card' && (
            <>
              <TextInput
                label="Cardholder Name"
                value={cardholderName}
                onChangeText={setCardholderName}
              />
              <TextInput
                label="Card Number"
                value={cardNumber}
                onChangeText={setCardNumber}
                keyboardType="numeric"
              />
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <TextInput
                    label="Month"
                    value={expMonth}
                    onChangeText={setExpMonth}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfInput}>
                  <TextInput
                    label="Year"
                    value={expYear}
                    onChangeText={setExpYear}
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <TextInput
                    label="CVV"
                    value={cvv}
                    onChangeText={setCvv}
                    keyboardType="numeric"
                    isPassword
                  />
                </View>
                <View style={styles.halfInput}>
                  <TextInput
                    label="PIN"
                    value={pin}
                    onChangeText={setPin}
                    keyboardType="numeric"
                    isPassword
                  />
                </View>
              </View>
              <TextInput
                label="Notes"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
              />
            </>
          )}

          {item.type === 'secure-note' && (
            <TextInput
              label="Content"
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={8}
              style={{ minHeight: 150, textAlignVertical: 'top' }}
            />
          )}

          <Button
            title="Save Changes"
            onPress={handleSave}
            loading={loading}
            disabled={!name.trim()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  cancelText: {
    fontSize: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  scroll: {
    padding: 20,
    paddingTop: 0,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  fieldGroup: {
    marginTop: 8,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  chipText: {
    fontSize: 13,
  },
  chipRemove: {
    fontSize: 13,
    fontWeight: '600',
  },
});
