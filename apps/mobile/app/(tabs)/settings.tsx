import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  Switch,
  Modal,
  ScrollView,
  ActionSheetIOS,
  Platform,
} from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import {
  ORIENTATION_LABELS,
  type OrientationPreference,
  useOrientationPreference,
} from '@/lib/orientation-preference';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';
import { validatePin } from '@keykeykey/core/pin';
import { runKeychainDiagnostic, getKeychainAccessGroup } from '@/modules/app-group-path';
import * as SecureStore from 'expo-secure-store';

const AUTO_LOCK_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 0, label: 'Never' },
] as const;

const ORIENTATION_OPTIONS = [
  { value: 'system', label: ORIENTATION_LABELS.system },
  { value: 'portrait', label: ORIENTATION_LABELS.portrait },
  { value: 'landscape', label: ORIENTATION_LABELS.landscape },
  { value: 'current', label: ORIENTATION_LABELS.current },
] as const satisfies ReadonlyArray<{ value: OrientationPreference; label: string }>;

export default function SettingsScreen() {
  const {
    lock,
    biometricAvailable,
    biometricEnabled,
    pinConfigured,
    enableBiometric,
    disableBiometric,
    enablePin,
    disablePin,
    resetVault,
    syncConfig,
    autoLockMinutes,
    setAutoLockMinutes,
  } = useVault();
  const router = useRouter();
  const { theme: t, mode, setMode } = useTheme();
  const { preference: orientationPreference, setPreference: setOrientationPreference } =
    useOrientationPreference();

  const themeIcon: keyof typeof Ionicons.glyphMap =
    mode === 'dark' ? 'moon-outline' : mode === 'light' ? 'sunny-outline' : 'desktop-outline';

  const cycleTheme = () => {
    const modes: Array<'system' | 'light' | 'dark'> = ['system', 'light', 'dark'];
    const idx = modes.indexOf(mode);
    setMode(modes[(idx + 1) % modes.length]!);
  };

  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [resetModalVisible, setResetModalVisible] = useState(false);

  const handleAutoLockSelect = (value: number) => {
    if (value === 0) {
      Alert.alert(
        'Disable Auto-Lock?',
        'Your vault will stay unlocked indefinitely. We recommend using biometrics or a PIN for quick unlock instead.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable Auto-Lock',
            style: 'destructive',
            onPress: () => setAutoLockMinutes(0),
          },
        ],
      );
    } else {
      setAutoLockMinutes(value);
    }
  };

  const handleAutoLockChange = () => {
    const labels = AUTO_LOCK_OPTIONS.map((opt) => opt.label);

    if (Platform.OS === 'ios') {
      const cancelIndex = labels.length;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...labels, 'Cancel'],
          cancelButtonIndex: cancelIndex,
          title: 'Auto-Lock Timeout',
        },
        (buttonIndex) => {
          if (buttonIndex !== cancelIndex) {
            handleAutoLockSelect(AUTO_LOCK_OPTIONS[buttonIndex]!.value);
          }
        },
      );
    } else {
      Alert.alert('Auto-Lock Timeout', 'Lock vault after inactivity', [
        ...AUTO_LOCK_OPTIONS.map((opt) => ({
          text: opt.label,
          onPress: () => handleAutoLockSelect(opt.value),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const handleOrientationSelect = async (value: OrientationPreference) => {
    try {
      await setOrientationPreference(value);
    } catch {
      Alert.alert('Error', 'Failed to save orientation preference.');
    }
  };

  const handleOrientationChange = () => {
    const labels = ORIENTATION_OPTIONS.map((opt) => opt.label);

    if (Platform.OS === 'ios') {
      const cancelIndex = labels.length;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...labels, 'Cancel'],
          cancelButtonIndex: cancelIndex,
          title: 'Orientation',
        },
        (buttonIndex) => {
          if (buttonIndex !== cancelIndex) {
            handleOrientationSelect(ORIENTATION_OPTIONS[buttonIndex]!.value);
          }
        },
      );
    } else {
      Alert.alert('Orientation', 'Choose how KeyKeyKey should handle screen orientation.', [
        ...ORIENTATION_OPTIONS.map((opt) => ({
          text: opt.label,
          onPress: () => handleOrientationSelect(opt.value),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

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

  const handleBiometricToggle = async (value: boolean) => {
    setBioLoading(true);
    try {
      if (value) {
        await enableBiometric();
      } else {
        Alert.alert('Disable Biometric Unlock', 'Are you sure?', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              try {
                await disableBiometric();
              } catch {
                Alert.alert('Error', 'Failed to disable biometric unlock.');
              }
            },
          },
        ]);
      }
    } catch {
      Alert.alert('Error', 'Failed to enable biometric unlock.');
    } finally {
      setBioLoading(false);
    }
  };

  const handlePinToggle = (value: boolean) => {
    if (value) {
      setPinValue('');
      setPinConfirm('');
      setPinError('');
      setPinModalVisible(true);
    } else {
      Alert.alert('Disable PIN Unlock', 'Are you sure you want to remove your PIN?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disable',
          style: 'destructive',
          onPress: async () => {
            try {
              await disablePin();
            } catch {
              Alert.alert('Error', 'Failed to disable PIN unlock.');
            }
          },
        },
      ]);
    }
  };

  const handlePinSave = async () => {
    setPinError('');
    const validation = validatePin(pinValue);
    if (!validation.valid) {
      setPinError(validation.error ?? 'Invalid PIN.');
      return;
    }
    if (pinValue !== pinConfirm) {
      setPinError('PINs do not match.');
      return;
    }
    setPinLoading(true);
    try {
      await enablePin(pinValue);
      setPinModalVisible(false);
    } catch {
      setPinError('Failed to set up PIN. Please try again.');
    } finally {
      setPinLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.colors.text }]}>Settings</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>SECURITY</Text>
          <SettingRow
            icon="lock-closed-outline"
            label="Lock Vault Now"
            onPress={handleLockConfirm}
            testID="settings-lock-vault"
          />
          {biometricAvailable && (
            <SettingRowToggle
              icon="finger-print-outline"
              label="Biometric Unlock"
              subtitle="Use Face ID / Touch ID to unlock"
              value={biometricEnabled}
              onValueChange={handleBiometricToggle}
              disabled={bioLoading}
              testID="biometric-unlock-switch"
            />
          )}
          <SettingRowToggle
            icon="keypad-outline"
            label="PIN Unlock"
            subtitle={pinConfigured ? 'Tap to disable' : 'Set a numeric PIN for quick unlock'}
            value={pinConfigured}
            onValueChange={handlePinToggle}
            testID="pin-unlock-switch"
          />
          <SettingRow
            icon="timer-outline"
            label="Auto-Lock Timeout"
            subtitle={
              AUTO_LOCK_OPTIONS.find((o) => o.value === autoLockMinutes)?.label ??
              `${autoLockMinutes} minutes`
            }
            onPress={handleAutoLockChange}
          />
        </View>

        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>APPEARANCE</Text>
          <Pressable
            onPress={cycleTheme}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: t.colors.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons
              name={themeIcon}
              size={20}
              color={t.colors.textSecondary}
              style={styles.rowIcon}
            />
            <View style={styles.rowContent}>
              <Text style={[styles.rowLabel, { color: t.colors.text }]}>Theme</Text>
              <Text style={[styles.rowSubtitle, { color: t.colors.textSecondary }]}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.colors.textSecondary} />
          </Pressable>
          <SettingRow
            icon="phone-portrait-outline"
            label="Orientation"
            subtitle={ORIENTATION_LABELS[orientationPreference]}
            onPress={handleOrientationChange}
            testID="settings-orientation"
          />
        </View>

        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>SYNC</Text>
          <SettingRow
            icon="cloud-outline"
            label="Cloud Sync"
            subtitle={
              syncConfig?.provider === 'webdav'
                ? 'Connected via WebDAV'
                : syncConfig?.provider === 'google-drive'
                  ? 'Connected via Google Drive'
                  : syncConfig?.provider === 'dropbox'
                    ? 'Connected via Dropbox'
                    : syncConfig?.provider === 'onedrive'
                      ? 'Connected via OneDrive'
                      : 'Not configured'
            }
            onPress={() => router.push('/settings/sync')}
            testID="settings-sync"
          />
          <SettingRow
            icon="cloud-upload-outline"
            label="Import Passwords"
            subtitle="Import from CSV or encrypted backup"
            onPress={() => router.push('/settings/import')}
            testID="settings-import"
          />
          <SettingRow
            icon="swap-horizontal-outline"
            label="Export Vault"
            subtitle="Export as CSV or encrypted backup"
            onPress={() => router.push('/settings/export')}
            testID="settings-export"
          />
        </View>

        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.textSecondary }]}>ABOUT</Text>
          <SettingRow icon="information-circle-outline" label="Version" subtitle="0.0.1" disabled />
          {Platform.OS === 'ios' && (
            <>
              <SettingRow
                icon="bug-outline"
                label="Keychain Diagnostic"
                subtitle="Test shared-group write (appex debug)"
                onPress={() => {
                  const report = runKeychainDiagnostic();
                  Alert.alert('Keychain DIAG', report);
                }}
              />
              <SettingRow
                icon="hammer-outline"
                label="SecureStore Probe"
                subtitle="Writes a probe via expo-secure-store, lists result natively"
                onPress={async () => {
                  const group = getKeychainAccessGroup();
                  const lines: string[] = [`group=${group}`];
                  try {
                    await SecureStore.setItemAsync(
                      'probe_ess',
                      'probe-value',
                      group
                        ? ({ keychainAccessGroup: group } as SecureStore.SecureStoreOptions)
                        : undefined,
                    );
                    lines.push('ess.setItemAsync OK');
                  } catch (err) {
                    lines.push(`ess.setItemAsync FAIL: ${String(err)}`);
                  }
                  try {
                    const v = await SecureStore.getItemAsync(
                      'probe_ess',
                      group
                        ? ({ keychainAccessGroup: group } as SecureStore.SecureStoreOptions)
                        : undefined,
                    );
                    lines.push(`ess.getItemAsync result=${v ?? 'null'}`);
                  } catch (err) {
                    lines.push(`ess.getItemAsync FAIL: ${String(err)}`);
                  }
                  lines.push('---');
                  lines.push(runKeychainDiagnostic());
                  Alert.alert('ESS Probe', lines.join('\n'));
                }}
              />
            </>
          )}
        </View>

        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: t.colors.error }]}>DANGER ZONE</Text>
          <SettingRow
            icon="trash-outline"
            label="Reset Vault"
            subtitle="Delete all data and start over"
            onPress={() => setResetModalVisible(true)}
            testID="settings-reset-vault"
          />
        </View>
      </ScrollView>

      {/* PIN Setup Modal */}
      <Modal
        visible={pinModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPinModalVisible(false)}
      >
        <SafeAreaView
          style={[styles.modalSafe, { backgroundColor: t.colors.background }]}
          edges={['top', 'bottom']}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: t.colors.text }]}>Set Up PIN</Text>
            <Pressable
              onPress={() => setPinModalVisible(false)}
              style={styles.modalClose}
              testID="pin-set-close"
            >
              <Ionicons name="close" size={24} color={t.colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.modalContent}>
            <Text style={[styles.modalSubtitle, { color: t.colors.textSecondary }]}>
              Choose a 4–8 digit PIN for quick unlock. Avoid simple patterns like 1234 or 0000.
            </Text>

            {pinError ? (
              <Text style={[styles.errorText, { color: t.colors.error }]}>{pinError}</Text>
            ) : null}

            <TextInput
              label="PIN"
              placeholder="Enter PIN"
              value={pinValue}
              onChangeText={(text) => {
                setPinValue(text);
                setPinError('');
              }}
              isPassword
              keyboardType="number-pad"
              returnKeyType="next"
              testID="pin-set-input"
            />
            <TextInput
              label="Confirm PIN"
              placeholder="Re-enter PIN"
              value={pinConfirm}
              onChangeText={(text) => {
                setPinConfirm(text);
                setPinError('');
              }}
              isPassword
              keyboardType="number-pad"
              returnKeyType="done"
              onSubmitEditing={handlePinSave}
              testID="pin-confirm-input"
            />

            <Button
              title="Enable PIN Unlock"
              onPress={handlePinSave}
              loading={pinLoading}
              disabled={!pinValue || !pinConfirm}
              testID="pin-set-submit"
            />
            <Button
              title="Cancel"
              onPress={() => setPinModalVisible(false)}
              variant="secondary"
              style={{ marginTop: 12 }}
              testID="pin-set-cancel"
            />
          </View>
        </SafeAreaView>
      </Modal>

      {/* Reset Vault Confirmation Modal */}
      <Modal
        visible={resetModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setResetModalVisible(false)}
      >
        <SafeAreaView
          style={[styles.modalSafe, { backgroundColor: t.colors.background }]}
          edges={['top', 'bottom']}
        >
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: t.colors.error }]}>Reset Vault</Text>
            <Pressable onPress={() => setResetModalVisible(false)} style={styles.modalClose}>
              <Ionicons name="close" size={24} color={t.colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.modalContent}>
            <Text style={[styles.modalSubtitle, { color: t.colors.text, fontWeight: 'bold' }]}>
              This will permanently delete your vault from this device.
            </Text>
            <Text style={[styles.modalSubtitle, { color: t.colors.text }]}>
              All stored passwords, cards, and notes will be lost. This action cannot be undone.
            </Text>
            <Text style={[styles.modalSubtitle, { color: t.colors.textSecondary }]}>
              If you have a cloud backup, you can restore your vault by setting up cloud sync again
              after resetting.
            </Text>

            <Button
              testID="settings-reset-confirm"
              title="Reset Vault"
              onPress={async () => {
                await resetVault();
                setResetModalVisible(false);
                router.replace('/setup');
              }}
              style={{ backgroundColor: t.colors.error }}
            />
            <Button
              testID="settings-reset-cancel"
              title="Cancel"
              onPress={() => setResetModalVisible(false)}
              variant="secondary"
              style={{ marginTop: 12 }}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function SettingRow({
  icon,
  label,
  subtitle,
  onPress,
  disabled,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { theme: t } = useTheme();
  return (
    <Pressable
      testID={testID}
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

function SettingRowToggle({
  icon,
  label,
  subtitle,
  value,
  onValueChange,
  disabled,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { theme: t } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: t.colors.border, opacity: disabled ? 0.5 : 1 }]}>
      <Ionicons name={icon} size={20} color={t.colors.textSecondary} style={styles.rowIcon} />
      <View style={styles.rowContent}>
        <Text style={[styles.rowLabel, { color: t.colors.text }]}>{label}</Text>
        {subtitle && (
          <Text style={[styles.rowSubtitle, { color: t.colors.textSecondary }]}>{subtitle}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: t.colors.border, true: t.colors.primary }}
        thumbColor="#FFFFFF"
        testID={testID}
      />
    </View>
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
  modalSafe: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  modalClose: {
    padding: 4,
  },
  modalContent: {
    padding: 20,
  },
  modalSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
});
