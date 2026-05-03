import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  NativeModules,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { extractDomainBrand, getDefaultStrongPassword } from '@keykeykey/core';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { AutofillHandoff } from '@/lib/autofill-handoff';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';
import { TotpCodeDisplay } from '@/components/TotpCodeDisplay';
import { TotpScanHandoff } from '@/lib/totp-scan-handoff';

type ItemType = 'credential' | 'card' | 'secure-note';

export default function AddItemScreen() {
  const { addItem } = useVault();
  const router = useRouter();
  const { theme: t } = useTheme();

  const { appId, domain } = useLocalSearchParams<{ appId?: string; domain?: string }>();

  const [type, setType] = useState<ItemType>('credential');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  // Credential fields
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
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

  // Pick up a scanned otpauth:// URI when returning from the QR scanner modal.
  useFocusEffect(
    useCallback(() => {
      const scanned = TotpScanHandoff.consume();
      if (scanned) setTotp(scanned);
    }, []),
  );

  useEffect(() => {
    (async () => {
      // Check for Android autofill save data (Kotlin-side singleton)
      if (Platform.OS === 'android') {
        try {
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
          setUrl(pending.domain.startsWith('http') ? pending.domain : `https://${pending.domain}`);
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
        if (!username.trim() && !password.trim()) {
          Alert.alert('Error', 'Username or password is required');
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
        await addItem({
          type: 'credential',
          name: name.trim(),
          username: username.trim(),
          password: password.trim(),
          url: normalizedUrl,
          appIdentifiers: appIdentifiers.length > 0 ? appIdentifiers : undefined,
          totp: totp.trim() || undefined,
          notes: notes.trim() || undefined,
          tags: [],
          favorite: false,
        });
      } else if (type === 'card') {
        if (!cardholderName.trim() || !cardNumber.trim() || !cvv.trim()) {
          Alert.alert('Error', 'Cardholder name, number, and CVV are required');
          setLoading(false);
          return;
        }
        await addItem({
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
        });
      } else {
        await addItem({
          type: 'secure-note',
          name: name.trim(),
          content: content.trim(),
          tags: [],
          favorite: false,
        });
      }
      router.back();
    } catch (e: unknown) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
      console.error('Save item failed:', msg);
      if (
        e instanceof Error &&
        'issues' in e &&
        Array.isArray((e as { issues: unknown[] }).issues)
      ) {
        const zodErr = e as { issues: { path: (string | number)[]; message: string }[] };
        const messages = zodErr.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
        Alert.alert('Validation Error', messages);
      } else {
        Alert.alert('Error', `Failed to save item: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const types: {
    key: ItemType;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    testID: string;
  }[] = [
    { key: 'credential', label: 'Login', icon: 'key-outline', testID: 'add-tab-login' },
    { key: 'card', label: 'Card', icon: 'card-outline', testID: 'add-tab-card' },
    { key: 'secure-note', label: 'Note', icon: 'document-text-outline', testID: 'add-tab-note' },
  ];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.modalHeader}>
          <Pressable testID="add-cancel" onPress={() => router.back()}>
            <Text style={[styles.cancelText, { color: t.colors.textSecondary }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.modalTitle, { color: t.colors.text }]}>Add Item</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.typeRow}>
            {types.map((tp) => (
              <Pressable
                key={tp.key}
                testID={tp.testID}
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
            testID="add-name"
            label="Name"
            placeholder="e.g. Gmail, Visa Card"
            value={name}
            onChangeText={setName}
          />

          {type === 'credential' && (
            <>
              <TextInput
                testID="add-url"
                label="URL"
                placeholder="https://example.com"
                value={url}
                onChangeText={setUrl}
                keyboardType="url"
              />
              <TextInput
                testID="add-username"
                label="Username"
                placeholder="username or email"
                value={username}
                onChangeText={setUsername}
              />
              <TextInput
                testID="add-password"
                label="Password"
                placeholder="password"
                value={password}
                onChangeText={setPassword}
                isPassword
                onGenerate={() => setPassword(getDefaultStrongPassword())}
              />
              <TextInput
                testID="add-totp"
                label="TOTP / 2FA (optional)"
                placeholder="otpauth://totp/... or Base32 secret"
                value={totp}
                onChangeText={setTotp}
                autoCapitalize="none"
              />
              <Pressable
                onPress={() => router.push('/item/qr-scan')}
                style={[
                  styles.scanButton,
                  { borderColor: t.colors.border, backgroundColor: t.colors.surface },
                ]}
              >
                <Ionicons name="qr-code-outline" size={18} color={t.colors.primary} />
                <Text style={[styles.scanButtonText, { color: t.colors.text }]}>Scan QR code</Text>
              </Pressable>
              {totp.trim().length > 0 && <TotpCodeDisplay input={totp} label="Preview" />}
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
                testID="add-notes"
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
                testID="add-cardholder"
                label="Cardholder Name"
                placeholder="John Doe"
                value={cardholderName}
                onChangeText={setCardholderName}
                onEndEditing={(event) => setCardholderName(event.nativeEvent.text)}
              />
              <TextInput
                testID="add-cardnumber"
                label="Card Number"
                placeholder="4111 1111 1111 1111"
                value={cardNumber}
                onChangeText={setCardNumber}
                onEndEditing={(event) => setCardNumber(event.nativeEvent.text)}
                keyboardType="numeric"
              />
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <TextInput
                    testID="add-month"
                    label="Month (1-12)"
                    placeholder="MM"
                    value={expMonth}
                    onChangeText={setExpMonth}
                    onEndEditing={(event) => setExpMonth(event.nativeEvent.text)}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.halfInput}>
                  <TextInput
                    testID="add-year"
                    label="Year"
                    placeholder="YYYY"
                    value={expYear}
                    onChangeText={setExpYear}
                    onEndEditing={(event) => setExpYear(event.nativeEvent.text)}
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <View style={styles.row}>
                <View style={styles.halfInput}>
                  <TextInput
                    testID="add-cvv"
                    label="CVV"
                    placeholder="123"
                    value={cvv}
                    onChangeText={setCvv}
                    onEndEditing={(event) => setCvv(event.nativeEvent.text)}
                    keyboardType="numeric"
                    isPassword
                  />
                </View>
                <View style={styles.halfInput}>
                  <TextInput
                    testID="add-card-pin"
                    label="PIN (optional)"
                    placeholder="••••"
                    value={pin}
                    onChangeText={setPin}
                    onEndEditing={(event) => setPin(event.nativeEvent.text)}
                    keyboardType="numeric"
                    isPassword
                  />
                </View>
              </View>
              <TextInput
                testID="add-notes"
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
              testID="add-content"
              label="Content"
              placeholder="Enter your secure note..."
              value={content}
              onChangeText={setContent}
              multiline
              numberOfLines={8}
              style={{ minHeight: 150, textAlignVertical: 'top' }}
            />
          )}

          <Button
            testID="add-save"
            title="Save"
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
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
    marginTop: -8,
  },
  scanButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
