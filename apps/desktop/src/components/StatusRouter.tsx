import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVault } from '../lib/vault-context';
import { useTheme } from '../lib/theme';

export function StatusRouter() {
  const { status, initialize } = useVault();
  const { theme } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (status === 'needs_setup') {
      navigate('/setup', { replace: true });
    } else if (status === 'locked') {
      navigate('/unlock', { replace: true });
    } else if (status === 'unlocked') {
      navigate('/vault', { replace: true });
    }
  }, [status, navigate]);

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
