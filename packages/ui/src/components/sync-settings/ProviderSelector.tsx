import React, { useState } from 'react';
import { ENABLED_SYNC_PROVIDERS } from '@keykeykey/core/sync';
import type { SyncProvider } from '@keykeykey/core/sync';
import type { SyncSettingsTheme } from './types.js';

// ---------------------------------------------------------------------------
// Inline SVG icon helpers (no external icon-library dependency)
// ---------------------------------------------------------------------------

function SvgIcon({
  size,
  color,
  children,
}: {
  size: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function EyeIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <SvgIcon size={size} color={color}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx={12} cy={12} r={3} />
    </SvgIcon>
  );
}

function EyeOffIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <SvgIcon size={size} color={color}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1={1} y1={1} x2={23} y2={23} />
    </SvgIcon>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProviderSelectorProps {
  // Form fields
  syncProvider: SyncProvider;
  setSyncProvider: (p: SyncProvider) => void;
  webdavUrl: string;
  setWebdavUrl: (v: string) => void;
  webdavUsername: string;
  setWebdavUsername: (v: string) => void;
  webdavPassword: string;
  setWebdavPassword: (v: string) => void;
  masterPassword: string;
  setMasterPassword: (v: string) => void;

  // Derived / status
  isConnected: boolean;
  canConnect: boolean;
  connecting: boolean;

  // Actions
  onConnect: () => void;
  onOAuthConnect: (provider: 'google-drive' | 'dropbox' | 'onedrive') => void;

  // Styling
  theme: SyncSettingsTheme;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProviderSelector({
  syncProvider,
  setSyncProvider,
  webdavUrl,
  setWebdavUrl,
  webdavUsername,
  setWebdavUsername,
  webdavPassword,
  setWebdavPassword,
  masterPassword,
  setMasterPassword,
  isConnected,
  canConnect,
  connecting,
  onConnect,
  onOAuthConnect,
  theme,
}: ProviderSelectorProps) {
  const [showWebdavPassword, setShowWebdavPassword] = useState(false);
  const [showMasterPassword, setShowMasterPassword] = useState(false);

  // ---- shared styles ----
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.textSecondary,
    marginBottom: 6,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    backgroundColor: theme.colors.inputBackground,
    color: theme.colors.text,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.md,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const eyeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    color: theme.colors.textSecondary,
  };

  const buttonBase: React.CSSProperties = {
    padding: '10px 20px',
    borderRadius: theme.radii.md,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    border: 'none',
    cursor: 'pointer',
    textAlign: 'center',
  };

  const primaryButton = (disabled?: boolean): React.CSSProperties => ({
    ...buttonBase,
    backgroundColor: theme.colors.primary,
    color: theme.colors.text,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  const isOAuth =
    syncProvider === 'google-drive' || syncProvider === 'dropbox' || syncProvider === 'onedrive';

  const oauthLabel: Record<string, string> = {
    'google-drive': 'Google',
    dropbox: 'Dropbox',
    onedrive: 'OneDrive',
  };

  const providerLabel: Record<SyncProvider, string> = {
    none: 'None',
    webdav: 'WebDAV',
    'google-drive': 'Google Drive',
    dropbox: 'Dropbox',
    onedrive: 'OneDrive',
  };

  return (
    <div>
      {/* Provider select */}
      <div style={{ marginBottom: theme.spacing.sm }}>
        <label style={labelStyle}>Provider</label>
        <select
          data-testid="sync-provider"
          value={syncProvider}
          onChange={(e) => setSyncProvider(e.target.value as SyncProvider)}
          disabled={isConnected}
          style={{
            ...inputStyle,
            cursor: isConnected ? 'not-allowed' : 'pointer',
            opacity: isConnected ? 0.6 : 1,
          }}
        >
          {ENABLED_SYNC_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {providerLabel[p]}
            </option>
          ))}
        </select>
      </div>

      {/* WebDAV credential fields -- only when not connected */}
      {syncProvider === 'webdav' && !isConnected && (
        <>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>WebDAV URL</label>
            <input
              type="url"
              data-testid="sync-webdav-url"
              value={webdavUrl}
              onChange={(e) => setWebdavUrl(e.target.value)}
              placeholder="https://dav.example.com"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>Username</label>
            <input
              type="text"
              data-testid="sync-webdav-username"
              value={webdavUsername}
              onChange={(e) => setWebdavUsername(e.target.value)}
              placeholder="Username"
              style={inputStyle}
            />
          </div>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>Password</label>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type={showWebdavPassword ? 'text' : 'password'}
                data-testid="sync-webdav-password"
                value={webdavPassword}
                onChange={(e) => setWebdavPassword(e.target.value)}
                placeholder="Password"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={() => setShowWebdavPassword((v) => !v)}
                style={eyeButtonStyle}
                aria-label={showWebdavPassword ? 'Hide password' : 'Show password'}
                type="button"
              >
                {showWebdavPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>Master Password</label>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type={showMasterPassword ? 'text' : 'password'}
                data-testid="sync-master-password"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                placeholder="Vault master password"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={() => setShowMasterPassword((v) => !v)}
                style={eyeButtonStyle}
                aria-label={showMasterPassword ? 'Hide password' : 'Show password'}
                type="button"
              >
                {showMasterPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
          </div>
        </>
      )}

      {/* OAuth provider -- master password field only when not connected */}
      {isOAuth && !isConnected && (
        <div style={{ marginBottom: theme.spacing.sm }}>
          <label style={labelStyle}>Master Password</label>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type={showMasterPassword ? 'text' : 'password'}
              data-testid="sync-master-password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="Required for sync encryption"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => setShowMasterPassword((v) => !v)}
              style={eyeButtonStyle}
              aria-label={showMasterPassword ? 'Hide password' : 'Show password'}
              type="button"
            >
              {showMasterPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>
        </div>
      )}

      {/* Connect / Sign-in buttons -- only when not connected */}
      {syncProvider !== 'none' && !isConnected && (
        <div style={{ display: 'flex', gap: 8, marginTop: theme.spacing.sm }}>
          {syncProvider === 'webdav' && (
            <button
              onClick={onConnect}
              disabled={!canConnect || connecting}
              style={primaryButton(!canConnect || connecting)}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
          {isOAuth && (
            <button
              onClick={() =>
                onOAuthConnect(syncProvider as 'google-drive' | 'dropbox' | 'onedrive')
              }
              disabled={connecting || !masterPassword}
              style={primaryButton(connecting || !masterPassword)}
            >
              {connecting ? 'Signing in\u2026' : `Sign in with ${oauthLabel[syncProvider]}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
