import { View, TextInput as RNTextInput, Text, StyleSheet, Pressable, type TextInputProps } from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

type Props = TextInputProps & {
  label?: string;
  error?: string;
  isPassword?: boolean;
};

export function TextInput({ label, error, isPassword, style, ...props }: Props) {
  const t = useTheme();
  const [hidden, setHidden] = useState(isPassword);

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, { color: t.colors.textSecondary }]}>{label}</Text>
      )}
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
        {isPassword && (
          <Pressable onPress={() => setHidden(!hidden)} style={styles.eyeButton}>
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
