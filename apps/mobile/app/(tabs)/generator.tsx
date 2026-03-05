import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/lib/theme';
import { Button } from '@/components/Button';

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';

function generatePassword(length: number, options: { upper: boolean; digits: boolean; symbols: boolean }): string {
  let chars = LOWERCASE;
  if (options.upper) chars += UPPERCASE;
  if (options.digits) chars += DIGITS;
  if (options.symbols) chars += SYMBOLS;

  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (v) => chars[v % chars.length]).join('');
}

export default function GeneratorScreen() {
  const t = useTheme();
  const [length, setLength] = useState(20);
  const [upper, setUpper] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [password, setPassword] = useState(() => generatePassword(20, { upper: true, digits: true, symbols: true }));
  const [copied, setCopied] = useState(false);

  const regenerate = useCallback(() => {
    setPassword(generatePassword(length, { upper, digits, symbols }));
    setCopied(false);
  }, [length, upper, digits, symbols]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(password);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.colors.text }]}>Generator</Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.passwordBox, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.md }]}>
          <Text style={[styles.passwordText, { color: t.colors.text }]} selectable numberOfLines={2}>
            {password}
          </Text>
          <View style={styles.passwordActions}>
            <Pressable onPress={handleCopy} style={styles.iconBtn}>
              <Ionicons
                name={copied ? 'checkmark-circle' : 'copy-outline'}
                size={22}
                color={copied ? t.colors.success : t.colors.textSecondary}
              />
            </Pressable>
            <Pressable onPress={regenerate} style={styles.iconBtn}>
              <Ionicons name="refresh-outline" size={22} color={t.colors.textSecondary} />
            </Pressable>
          </View>
        </View>

        <View style={styles.option}>
          <Text style={[styles.optionLabel, { color: t.colors.text }]}>Length: {length}</Text>
          <View style={styles.lengthControls}>
            <Pressable
              onPress={() => setLength(Math.max(8, length - 2))}
              style={[styles.lengthBtn, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
            >
              <Ionicons name="remove" size={18} color={t.colors.text} />
            </Pressable>
            <View style={[styles.lengthBar, { backgroundColor: t.colors.border }]}>
              <View
                style={[
                  styles.lengthFill,
                  { backgroundColor: t.colors.primary, width: `${((length - 8) / 56) * 100}%` },
                ]}
              />
            </View>
            <Pressable
              onPress={() => setLength(Math.min(64, length + 2))}
              style={[styles.lengthBtn, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
            >
              <Ionicons name="add" size={18} color={t.colors.text} />
            </Pressable>
          </View>
        </View>

        <ToggleOption label="Uppercase (A-Z)" value={upper} onToggle={() => setUpper(!upper)} />
        <ToggleOption label="Numbers (0-9)" value={digits} onToggle={() => setDigits(!digits)} />
        <ToggleOption label="Symbols (!@#$)" value={symbols} onToggle={() => setSymbols(!symbols)} />

        <Button title="Generate New Password" onPress={regenerate} style={{ marginTop: 24 }} />
      </View>
    </SafeAreaView>
  );
}

function ToggleOption({ label, value, onToggle }: { label: string; value: boolean; onToggle: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onToggle} style={[styles.toggleRow, { borderBottomColor: t.colors.border }]}>
      <Text style={[styles.optionLabel, { color: t.colors.text }]}>{label}</Text>
      <View
        style={[
          styles.toggle,
          { backgroundColor: value ? t.colors.primary : t.colors.border },
        ]}
      >
        <View
          style={[
            styles.toggleDot,
            { transform: [{ translateX: value ? 18 : 2 }] },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  content: {
    padding: 20,
  },
  passwordBox: {
    padding: 16,
    borderWidth: 1,
    marginBottom: 24,
  },
  passwordText: {
    fontSize: 17,
    fontFamily: 'monospace',
    lineHeight: 26,
    marginBottom: 12,
  },
  passwordActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  iconBtn: {
    padding: 4,
  },
  option: {
    marginBottom: 20,
  },
  optionLabel: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  lengthControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  lengthBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lengthBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  lengthFill: {
    height: '100%',
    borderRadius: 3,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
  },
  toggleDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
});
