import { useEffect, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { extractDomainBrand, getDefaultStrongPassword } from '@keykeykey/core';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme';
import { AutofillHandoff } from '@/lib/autofill-handoff';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';

type ItemType = 'credential' | 'card' | 'secure-note';

export default function AddItemScreen() {
  const { addItem } = useVault();
  const router = useRouter();
  const t = useTheme();

  const { appId, domain } = useLocalSearchParams<{ appId?: string; domain?: string }>();

  const [type, setType] = useState<ItemType>('credential');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  // Credential fields
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notes, setNotes] = useState('');

  // Card fields
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expMonth, setExpMonth] = useState('');
  const [expYear, setExpYear] = useState('');
  const [cvv, setCvv] = useState('');
  const [pin, setPin] = useState('');

  // App identifiers (for autofill linking)
  const [appIdentifiers, setAppIdentifiers] = useState<string[]>([]);

  // Secure note fields
  const [content, setContent] = useState('');

  useEffect(() => {
    (async () => {
      // Check for Android autofill save data (Kotlin-side singleton)
      if (Platform.OS === 'android') {
        try {
          const { NativeModules } = require('react-native');
          const result = await NativeModules.AutofillSaveData?.consume();
          if (result) {
            setType('credential');
            setUsername(result.username);
            setPassword(result.password);
            if (result.domain) {
              const d = result.domain;
              setUrl(d.startsWith('http') ? d : `https://${d}`);
              setName(extractDomainBrand(d));
            }
            if (result.packageName) {
              setAppIdentifiers([result.packageName]);
            }
            return;
          }
        } catch {
          // Module not available (iOS or tests) — continue
        }
      }

      // Check for Android autofill save flow
      const pending = AutofillHandoff.consume();
      if (pending) {
        setType('credential');
        setUsername(pending.username);
        setPassword(pending.password);
        if (pending.domain) {
          setUrl(
            pending.domain.startsWith('http') ? pending.domain : `https://${pending.domain}`
          );
          setName(extractDomainBrand(pending.domain));
        }
        if (pending.packageName) {
          setAppIdentifiers([pending.packageName]);
        }
        return;
      }
      // Check for deep-link params
      if (appId || domain) {
        setType('credential');
        if (domain) {
          const d = Array.isArray(domain) ? domain[0] : domain;
          setUrl(d.startsWith('http') ? d : `https://${d}`);
          setName(extractDomainBrand(d));
        }
        if (appId) {
          const id = Array.isArray(appId) ? appId[0] : appId;
          setAppIdentifiers([id]);
        }
      }
    })();
  }, []); // Run once on mount

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }

    setLoading(true);
    try {
      if (type === 'credential') {
        if (!username.trim() || !password.trim()) {
          Alert.alert('Error', 'Username and password are required');
          setLoading(false);
          return;
        }
        let normalizedUrl: string | undefined;
        if (url.trim()) {
          normalizedUrl = url.trim();
          if (!/^https?:\/\//i.test(normalizedUrl)) {
            normalizedUrl = `https://${normalizedUrl}`;
          }
        }
        await addItem(
          // @ts-expect-error -- Omit<VaultItem,...> loses discriminated union
          {
            type: 'credential',
            name: name.trim(),
            username: username.trim(),
            password: password.trim(),
            url: normalizedUrl,
            appIdentifiers: appIdentifiers.length > 0 ? appIdentifiers : undefined,
            notes: notes.trim() || undefined,
            tags: [],
            favorite: false,
          },
        );
      } else if (type === 'card') {
        if (!cardholderName.trim() || !cardNumber.trim() || !cvv.trim()) {
          Alert.alert('Error', 'Cardholder name, number, and CVV are required');
          setLoading(false);
          return;
        }
        await addItem(
          // @ts-expect-error -- Omit<VaultItem,...> loses discriminated union
          {
            type: 'card',
            name: name.trim(),
            cardholderName: cardholderName.trim(),
            number: cardNumber.trim(),
            expirationMonth: parseInt(expMonth, 10) || 1,
            expirationYear: parseInt(expYear, 10) || new Date().getFullYear(),
            cvv: cvv.trim(),
            pin: pin.trim() || undefined,
            notes: notes.trim() || undefined,
            tags: [],
            favorite: false,
          },
        );
      } else {
        await addItem(
          // @ts-expect-error -- Omit<VaultItem,...> loses discriminated union
          {
            type: 'secure-note',
            name: name.trim(),
            content: content.trim(),
            tags: [],
            favorite: false,
          },
        );
      }
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
      console.error('Save item failed:', msg);
      Alert.alert('Error', `Failed to save item: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const types: { key: ItemType; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'credential', label: 'Login', icon: 'key-outline' },
    { key: 'card', label: 'Card', icon: 'card-outline' },
    { key: 'secure-note', label: 'Note', icon: 'document-text-outline' },
  ];

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
          <Text style={[styles.modalTitle, { color: t.colors.text }]}>Add Item</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.typeRow}>
            {types.map((tp) => (
              <Pressable
                key={tp.key}
                onPress={() => setType(tp.key)}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor: type === tp.key ? t.colors.primaryMuted : t.colors.surface,
                    borderColor: type === tp.key ? t.colors.primary : t.colors.border,
                    borderRadius: t.radii.md,
                  },
                ]}
              >
                <Ionicons
                  name={tp.icon}
                  size={18}
                  color={type === tp.key ? t.colors.text : t.colors.textSecondary}
                />
                <Text
                  style={[
                    styles.typeLabel,
                    { color: type === tp.key ? t.colors.text : t.colors.textSecondary },
                  ]}
                >
                  {tp.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            label="Name"
            placeholder="e.g. Gmail, Visa Card"
            value={name}
            onChangeText={setName}
          />

          {type === 'credential' && (
            <>
              <TextInput
                label="URL"
                placeholder="https://example.com"
                value={url}
                onChangeText={setUrl}
                keyboardType="url"
              />
              <TextInput
                label="Username"
                placeholder="username or email"
                value={username}
                onChangeText={setUsername}
              />
              <TextInput
                label="Password"
                placeholder="password"
                value={password}
                onChangeText={setPassword}
                isPassword
                onGenerate={() => setPassword(getDefaultStrongPassword())}
              />
              {appIdentifiers.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                  <Text style={{ color: t.colors.textSecondary, fontSize: 12, width: '100%' }}>
                    App Identifiers
                  </Text>
                  {appIdentifiers.map((id) => (
                    <View
                      key={id}
                      style={{
                        backgroundColor: t.colors.surface,
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 12,
                      }}
                    >
                      <Text style={{ color: t.colors.text, fontSize: 12 }}>{id}</Text>
                    </View>
                  ))}
                </View>
              )}
              <TextInput
                label="Notes (optional)"
                placeholder="Additional notes"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
              />
            </>
          )}

          {type === 'card' && (
            <>
              <TextInput
                label="Cardholder Name"
                placeholder="John Doe"
                value={cardholderName}
                onChangeText={setCardholderName}
              />
              <TextInput
                label="Card Number"
                placeholder="4111 1111 1111 1111"
                value={cardNumber}
                onChangeText={setCardNumber}
                keyboardType="numeric"
              />
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <TextInput
                    label="Month (1-12)"
                    placeholder="MM"
                    value={expMonth}
                    onChangeText={setExpMonth}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfInput}>
                  <TextInput
                    label="Year"
                    placeholder="YYYY"
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
                    placeholder="123"
                    value={cvv}
                    onChangeText={setCvv}
                    keyboardType="numeric"
                    isPassword
                  />
                </View>
                <View style={styles.halfInput}>
                  <TextInput
                    label="PIN (optional)"
                    placeholder="••••"
                    value={pin}
                    onChangeText={setPin}
                    keyboardType="numeric"
                    isPassword
                  />
                </View>
              </View>
              <TextInput
                label="Notes (optional)"
                placeholder="Additional notes"
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
              />
            </>
          )}

          {type === 'secure-note' && (
            <TextInput
              label="Content"
              placeholder="Enter your secure note..."
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={8}
              style={{ minHeight: 150, textAlignVertical: 'top' }}
            />
          )}

          <Button title="Save" onPress={handleSave} loading={loading} disabled={!name.trim()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
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
  typeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  typeChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderWidth: 1,
    gap: 6,
  },
  typeLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
});
