import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTotpCode } from '@keykeykey/ui';
import { useTheme } from '@/lib/theme-provider';

type Props = {
  input: string;
  label?: string;
  testID?: string;
};

function formatCode(code: string): string {
  const mid = Math.floor(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

export function TotpCodeDisplay({ input, label = 'One-Time Code', testID }: Props) {
  const { theme: t } = useTheme();
  const { code, remainingSeconds, error } = useTotpCode(input);

  const handleCopy = async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied', 'One-time code copied to clipboard');
    setTimeout(() => {
      Clipboard.setStringAsync('');
    }, 30_000);
  };

  return (
    <View style={[styles.container, { borderBottomColor: t.colors.border }]} testID={testID}>
      {label ? (
        <Text style={[styles.label, { color: t.colors.textSecondary }]}>{label}</Text>
      ) : null}
      {error ? (
        <Text style={[styles.error, { color: t.colors.danger ?? '#d00' }]}>{error}</Text>
      ) : code ? (
        <View style={styles.row}>
          <Text
            style={[styles.code, { color: t.colors.text }]}
            accessibilityLabel={`One-time code ${code}`}
          >
            {formatCode(code)}
          </Text>
          <Text
            style={[
              styles.countdown,
              {
                color: remainingSeconds <= 5 ? (t.colors.danger ?? '#d00') : t.colors.textSecondary,
              },
            ]}
          >
            {remainingSeconds}s
          </Text>
          <Pressable
            onPress={handleCopy}
            style={styles.copyBtn}
            hitSlop={8}
            testID="detail-totp-copy"
          >
            <Ionicons name="copy-outline" size={18} color={t.colors.textSecondary} />
          </Pressable>
        </View>
      ) : (
        <Text style={[styles.placeholder, { color: t.colors.textSecondary }]}>
          Enter an otpauth:// URI or Base32 secret to preview.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  code: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  countdown: {
    fontSize: 14,
    marginRight: 12,
    minWidth: 32,
    textAlign: 'right',
  },
  copyBtn: {
    padding: 6,
  },
  error: {
    fontSize: 13,
  },
  placeholder: {
    fontSize: 13,
  },
});
