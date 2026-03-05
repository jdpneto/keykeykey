import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme';

export default function SettingsScreen() {
  const { lock } = useVault();
  const router = useRouter();
  const t = useTheme();

  const handleLock = () => {
    lock();
    router.replace('/unlock');
  };

  const handleLockConfirm = () => {
    Alert.alert('Lock Vault', 'Are you sure you want to lock the vault?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Lock', style: 'destructive', onPress: handleLock },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.colors.text }]}>Settings</Text>
      </View>

      <View style={styles.content}>
        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>SECURITY</Text>
          <SettingRow
            icon="lock-closed-outline"
            label="Lock Vault Now"
            onPress={handleLockConfirm}
          />
          <SettingRow
            icon="finger-print-outline"
            label="Biometric Unlock"
            subtitle="Coming soon"
            disabled
          />
          <SettingRow
            icon="timer-outline"
            label="Auto-Lock Timeout"
            subtitle="5 minutes"
            disabled
          />
        </View>

        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>SYNC</Text>
          <SettingRow
            icon="cloud-outline"
            label="Cloud Sync"
            subtitle="Not configured"
            disabled
          />
          <SettingRow
            icon="swap-horizontal-outline"
            label="Export Vault"
            subtitle="Coming soon"
            disabled
          />
        </View>

        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>ABOUT</Text>
          <SettingRow
            icon="information-circle-outline"
            label="Version"
            subtitle="0.0.1"
            disabled
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function SettingRow({
  icon,
  label,
  subtitle,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: t.colors.border, opacity: pressed ? 0.7 : disabled ? 0.5 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={t.colors.textSecondary} style={styles.rowIcon} />
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, { color: t.colors.text }]}>{label}</Text>
        {subtitle && (
          <Text style={[styles.rowSubtitle, { color: t.colors.textSecondary }]}>{subtitle}</Text>
        )}
      </View>
      {!disabled && <Ionicons name="chevron-forward" size={18} color={t.colors.textSecondary} />}
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  rowIcon: {
    marginRight: 12,
  },
  rowContent: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
  rowSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
});
