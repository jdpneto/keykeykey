import { useEffect } from 'react';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';

/**
 * Landing page at "/". Calls initialize() to determine vault status,
 * then NavigationGuard handles the redirect based on status.
 */
export function StatusRouter() {
  const { initialize } = useVault();
  const { theme } = useTheme();

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: theme.colors.background,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: `3px solid ${theme.colors.border}`,
          borderTopColor: theme.colors.primary,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
