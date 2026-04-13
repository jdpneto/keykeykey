import React from 'react';
import { useTheme } from '../../../lib/theme.js';
import type { SyncProvider, SyncStatus } from '../../../lib/messages.js';
import { EyeIcon, EyeOffIcon } from '../../components/icons/index.js';

interface ProviderSelectorProps {
  syncProvider: SyncProvider;
  onProviderChange: (provider: SyncProvider) => void;
  isConnected: boolean;
  syncStatus: SyncStatus | null;
  // WebDAV fields
  webdavUrl: string;
  onWebdavUrlChange: (url: string) => void;
  webdavUsername: string;
  onWebdavUsernameChange: (username: string) => void;
  webdavPassword: string;
  onWebdavPasswordChange: (password: string) => void;
  showWebdavPassword: boolean;
  onToggleWebdavPassword: () => void;
  // Master password
  masterPassword: string;
  onMasterPasswordChange: (password: string) => void;
  showMasterPassword: boolean;
  onToggleMasterPassword: () => void;
  // Styles
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  eyeButtonStyle: React.CSSProperties;
  sectionStyle: React.CSSProperties;
}

export function ProviderSelector({
  syncProvider,
  onProviderChange,
  isConnected,
  syncStatus,
  webdavUrl,
  onWebdavUrlChange,
  webdavUsername,
  onWebdavUsernameChange,
  webdavPassword,
  onWebdavPasswordChange,
  showWebdavPassword,
  onToggleWebdavPassword,
  masterPassword,
  onMasterPasswordChange,
  showMasterPassword,
  onToggleMasterPassword,
  inputStyle,
  labelStyle,
  eyeButtonStyle,
  sectionStyle,
}: ProviderSelectorProps) {
  const { theme } = useTheme();

  return (
    <div style={sectionStyle}>
      <div style={{ marginBottom: theme.spacing.sm }}>
        <label style={labelStyle}>Provider</label>
        <select
          data-testid="sync-provider"
          value={syncProvider}
          onChange={(e) => onProviderChange(e.target.value as SyncProvider)}
          disabled={isConnected}
          style={{
            ...inputStyle,
            cursor: isConnected ? 'not-allowed' : 'pointer',
            opacity: isConnected ? 0.6 : 1,
          }}
        >
          <option value="none">None</option>
          <option value="webdav">WebDAV</option>
          <option value="google-drive">Google Drive</option>
          <option value="dropbox">Dropbox</option>
          <option value="onedrive">OneDrive</option>
        </select>
      </div>

      {/* WebDAV fields — only when not connected */}
      {syncProvider === 'webdav' && !isConnected && (
        <>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>WebDAV URL</label>
            <input
              type="url"
              data-testid="sync-webdav-url"
              value={webdavUrl}
              onChange={(e) => onWebdavUrlChange(e.target.value)}
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
              onChange={(e) => onWebdavUsernameChange(e.target.value)}
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
                onChange={(e) => onWebdavPasswordChange(e.target.value)}
                placeholder="Password"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={onToggleWebdavPassword}
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
                onChange={(e) => onMasterPasswordChange(e.target.value)}
                placeholder="Vault master password"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={onToggleMasterPassword}
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

      {/* OAuth provider fields (Google Drive, Dropbox, OneDrive) — only when not connected */}
      {(syncProvider === 'google-drive' ||
        syncProvider === 'dropbox' ||
        syncProvider === 'onedrive') &&
        !isConnected && (
          <>
            <div style={{ marginBottom: theme.spacing.sm }}>
              <label style={labelStyle}>Master Password</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type={showMasterPassword ? 'text' : 'password'}
                  data-testid="sync-master-password"
                  value={masterPassword}
                  onChange={(e) => onMasterPasswordChange(e.target.value)}
                  placeholder="Required for sync encryption"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={onToggleMasterPassword}
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

      {/* Sync status display */}
      {isConnected && syncStatus && (
        <div
          style={{
            fontSize: theme.typography.sizes.xs,
            color: theme.colors.textSecondary,
            marginBottom: theme.spacing.sm,
          }}
        >
          {syncStatus.isSyncing
            ? 'Syncing...'
            : syncStatus.lastSynced
              ? `Last synced: ${new Date(syncStatus.lastSynced).toLocaleString()}`
              : 'Never synced'}
          {syncStatus.error && (
            <div style={{ color: theme.colors.error, marginTop: 4 }}>{syncStatus.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
