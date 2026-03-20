import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useVault } from '../lib/vault-context';

/**
 * Global navigation guard that redirects based on vault status.
 *
 * Placed inside BrowserRouter in App.tsx, before Routes. Ensures that
 * status changes (lock, reset, unlock) always navigate to the correct
 * screen, regardless of which page the user is currently on.
 */
export function NavigationGuard() {
  const { status } = useVault();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;

    if (status === 'needs_setup') {
      if (path !== '/setup' && path !== '/restore') {
        navigate('/setup', { replace: true });
      }
    } else if (status === 'locked') {
      if (path !== '/unlock') {
        navigate('/unlock', { replace: true });
      }
    } else if (status === 'unlocked') {
      if (path === '/' || path === '/setup' || path === '/unlock') {
        navigate('/vault', { replace: true });
      }
    }
  }, [status, location.pathname, navigate]);

  return null;
}
