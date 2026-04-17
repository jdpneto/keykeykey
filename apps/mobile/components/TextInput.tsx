import {
  View,
  TextInput as RNTextInput,
  Text,
  StyleSheet,
  Pressable,
  type TextInputProps,
} from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-provider';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  isPassword?: boolean;
  onGenerate?: () => void;
};

export function TextInput({ label, error, isPassword, onGenerate, style, ...props }: Props) {
  const { theme: t } = useTheme();
  const [hidden, setHidden] = useState(isPassword);

  // Derive stable testIDs for the optional eye/generate affordances
  // so E2E flows can tap them. `{testID}-toggle` flips secure entry
  // off/on; `{testID}-generate` triggers the password generator.
  const rootTestID = (props as { testID?: string }).testID;
  const toggleTestID = rootTestID ? `${rootTestID}-toggle` : undefined;
  const generateTestID = rootTestID ? `${rootTestID}-generate` : undefined;

  return (
    <View style={styles.container}>
      {label && <Text style={[styles.label, { color: t.colors.textSecondary }]}>{label}</Text>}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: t.colors.inputBackground,
            borderColor: error ? t.colors.error : t.colors.border,
            borderRadius: t.radii.md,
          },
        ]}
      >
        <RNTextInput
          style={[styles.input, { color: t.colors.text }, style]}
          placeholderTextColor={t.colors.textSecondary}
          secureTextEntry={hidden}
          autoCapitalize="none"
          autoCorrect={false}
          {...props}
        />
        {isPassword && onGenerate && (
          <Pressable testID={generateTestID} onPress={onGenerate} style={styles.eyeButton}>
            <Ionicons name="dice-outline" size={20} color={t.colors.textSecondary} />
          </Pressable>
        )}
        {isPassword && (
          <Pressable
            testID={toggleTestID}
            onPress={() => setHidden(!hidden)}
            style={styles.eyeButton}
          >
            <Ionicons
              name={hidden ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={t.colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
      {error && <Text style={[styles.error, { color: t.colors.error }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  eyeButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  error: {
    fontSize: 12,
    marginTop: 4,
  },
});
