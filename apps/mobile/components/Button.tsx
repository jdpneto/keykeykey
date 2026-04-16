import { Pressable, Text, StyleSheet, ActivityIndicator, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme-provider';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  testID?: string;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, style, testID }: Props) {
  const { theme: t } = useTheme();

  const bgColor =
    variant === 'danger'
      ? t.colors.danger
      : variant === 'secondary'
        ? t.colors.surface
        : t.colors.primary;

  const textColor =
    variant === 'danger' ? '#FFFFFF' : variant === 'secondary' ? t.colors.text : '#1a2e05';

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bgColor,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          borderRadius: t.radii.md,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: t.colors.border,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <Text style={[styles.text, { color: textColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
});
