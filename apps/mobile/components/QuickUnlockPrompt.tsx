import { useState } from 'react';
import { Modal, View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';
import { validatePin } from '@keykeykey/core/pin';

type Props = {
  onDismiss: () => void;
};

type Step = 'offer' | 'pin_setup';

export function QuickUnlockPrompt({ onDismiss }: Props) {
  const { biometricAvailable, enableBiometric, enablePin, dismissQuickUnlockPrompt } = useVault();
  const { theme: t } = useTheme();

  const [step, setStep] = useState<Step>('offer');
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleEnableBiometric = async () => {
    setLoading(true);
    try {
      await enableBiometric();
      await dismissQuickUnlockPrompt();
      onDismiss();
    } catch {
      // If biometric setup fails, fall through to PIN offer
      setStep('pin_setup');
    } finally {
      setLoading(false);
    }
  };

  const handleOfferPin = () => {
    setPinValue('');
    setPinConfirm('');
    setPinError('');
    setStep('pin_setup');
  };

  const handleSkip = async () => {
    await dismissQuickUnlockPrompt();
    onDismiss();
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
    setLoading(true);
    try {
      await enablePin(pinValue);
      await dismissQuickUnlockPrompt();
      onDismiss();
    } catch {
      setPinError('Failed to set up PIN. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" transparent={false} visible>
      <View style={[styles.safe, { backgroundColor: t.colors.background }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.flex}
        >
          <View style={styles.container}>
            {step === 'offer' && (
              <>
                <View style={styles.header}>
                  <Text style={[styles.title, { color: t.colors.text }]}>
                    Speed Up Future Unlocks
                  </Text>
                  <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
                    Set up a quick unlock method so you don&apos;t have to type your master password
                    every time.
                  </Text>
                </View>

                <View style={styles.actions}>
                  {biometricAvailable && (
                    <Button
                      title="Enable Face ID / Touch ID"
                      onPress={handleEnableBiometric}
                      loading={loading}
                      style={styles.actionButton}
                    />
                  )}
                  <Button
                    title="Set Up PIN"
                    onPress={handleOfferPin}
                    variant={biometricAvailable ? 'secondary' : 'primary'}
                    style={styles.actionButton}
                  />
                  <Button
                    title="Skip for Now"
                    onPress={handleSkip}
                    variant="secondary"
                    style={styles.actionButton}
                  />
                </View>
              </>
            )}

            {step === 'pin_setup' && (
              <>
                <View style={styles.header}>
                  <Text style={[styles.title, { color: t.colors.text }]}>Create a PIN</Text>
                  <Text style={[styles.subtitle, { color: t.colors.textSecondary }]}>
                    Choose a 4–8 digit PIN for quick unlock. Avoid simple patterns like 1234 or
                    0000.
                  </Text>
                </View>

                <View style={styles.form}>
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
                  />

                  <Button
                    title="Enable PIN Unlock"
                    onPress={handlePinSave}
                    loading={loading}
                    disabled={!pinValue || !pinConfirm}
                    style={styles.actionButton}
                  />
                  <Button
                    title="Go Back"
                    onPress={() => setStep('offer')}
                    variant="secondary"
                    style={styles.actionButton}
                  />
                  <Button
                    title="Skip"
                    onPress={handleSkip}
                    variant="secondary"
                    style={styles.actionButton}
                  />
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: {
    width: '100%',
  },
  form: {
    width: '100%',
  },
  actionButton: {
    marginBottom: 12,
  },
  errorText: {
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
});
