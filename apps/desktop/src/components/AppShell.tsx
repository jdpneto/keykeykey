import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Shield, Dice5, Settings, Lock } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';

const NAV_ITEMS = [
  { to: '/vault', icon: Shield, label: 'Vault' },
  { to: '/vault/generator', icon: Dice5, label: 'Generator' },
  { to: '/vault/settings', icon: Settings, label: 'Settings' },
] as const;

export function AppShell() {
  const { theme } = useTheme();
  const { lock } = useVault();
  const navigate = useNavigate();

  const handleLock = () => {
    lock();
    navigate('/unlock', { replace: true });
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: theme.colors.background }}>
      {/* Sidebar */}
      <nav
        style={{
          width: 220,
          minWidth: 220,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: theme.colors.surface,
          borderRight: `1px solid ${theme.colors.border}`,
          padding: '24px 0',
        }}
      >
        {/* Logo */}
        <div
          style={{
            padding: '0 20px 24px',
            fontSize: 18,
            fontWeight: 700,
            color: theme.colors.primary,
            letterSpacing: '-0.5px',
          }}
        >
          KeyKeyKey
        </div>

        {/* Nav links */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/vault'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? theme.colors.text : theme.colors.textSecondary,
                backgroundColor: isActive ? theme.colors.surfaceAlt : 'transparent',
                borderRight: isActive ? `3px solid ${theme.colors.primary}` : '3px solid transparent',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
              })}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </div>

        {/* Lock button */}
        <button
          onClick={handleLock}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 20px',
            fontSize: 14,
            color: theme.colors.textSecondary,
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = theme.colors.text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = theme.colors.textSecondary)}
        >
          <Lock size={18} />
          Lock Vault
        </button>
      </nav>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 32,
        }}
      >
        <Outlet />
      </main>
    </div>
  );
}
