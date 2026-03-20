import { useState, useId, useEffect, useRef } from 'react';
import { Eye, EyeOff, Dice5 } from 'lucide-react';
import { useTheme } from '../../lib/theme';

type TextInputProps = {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  error?: string;
  autoFocus?: boolean;
  multiline?: boolean;
  onSubmit?: () => void;
  disabled?: boolean;
  onGenerate?: () => void;
  /** Test ID for automated testing — enables programmatic value changes via custom events */
  testId?: string;
};

export function TextInput({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  error,
  autoFocus = false,
  multiline = false,
  onSubmit,
  disabled = false,
  onGenerate,
  testId,
}: TextInputProps) {
  const { theme } = useTheme();
  const generatedId = useId();
  const inputId = label ? `input-${generatedId}` : undefined;
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Listen for custom 'test-set-value' events for automated testing (Tauri MCP, Playwright, etc.)
  // This allows programmatic value changes that properly update React state.
  // Only active in development builds to minimize production attack surface.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const el = inputRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const value = (e as CustomEvent).detail;
      if (typeof value === 'string') onChangeText(value);
    };
    el.addEventListener('test-set-value', handler);
    return () => el.removeEventListener('test-set-value', handler);
  }, [onChangeText]);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 16px',
    paddingRight: secureTextEntry ? (onGenerate ? 80 : 48) : 16,
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    border: `1px solid ${error ? theme.colors.error : theme.colors.border}`,
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.md,
    outline: 'none',
    transition: 'border-color 0.15s ease',
    resize: multiline ? 'vertical' : 'none',
  };

  const Component = multiline ? 'textarea' : 'input';

  return (
    <div style={{ marginBottom: 16 }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{
            display: 'block',
            marginBottom: 6,
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
            color: theme.colors.textSecondary,
          }}
        >
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        <Component
          ref={inputRef as React.Ref<HTMLInputElement & HTMLTextAreaElement>}
          id={inputId}
          data-testid={testId}
          value={value}
          onChange={(e) => onChangeText(e.target.value)}
          placeholder={placeholder}
          type={secureTextEntry && !showPassword ? 'password' : 'text'}
          autoFocus={autoFocus}
          disabled={disabled}
          style={inputStyle}
          rows={multiline ? 4 : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !multiline && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = theme.colors.primary;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error ? theme.colors.error : theme.colors.border;
          }}
        />
        {secureTextEntry && onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            tabIndex={-1}
            title="Generate password"
            style={{
              position: 'absolute',
              right: 40,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.colors.textSecondary,
              padding: 4,
              display: 'flex',
            }}
          >
            <Dice5 size={18} />
          </button>
        )}
        {secureTextEntry && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            tabIndex={-1}
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.colors.textSecondary,
              padding: 4,
              display: 'flex',
            }}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
      {error && (
        <p
          style={{
            marginTop: 4,
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.error,
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
