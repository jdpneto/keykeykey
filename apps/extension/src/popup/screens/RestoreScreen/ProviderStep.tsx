import React from 'react';
import { useTheme } from '../../../lib/theme.js';
import type { SyncProvider } from '../../../lib/messages.js';
import { EyeIcon, EyeOffIcon } from '../../components/icons/index.js';

interface ProviderStepProps {
  syncProvider: SyncProvider;
  onProviderChange: (provider: SyncProvider) => void;
  // WebDAV fields
  webdavUrl: string;
  onWebdavUrlChange: (url: string) => void;
  webdavUsername: string;
  onWebdavUsernameChange: (username: string) => void;
  webdavPassword: string;
  onWebdavPasswordChange: (password: string) => void;
  showWebdavPassword: boolean;
  onToggleWebdavPassword: () => void;
  // OAuth state
  googleRefreshToken: string;
  googleConnecting: boolean;
  onGoogleSignIn: () => void;
  dropboxRefreshToken: string;
  dropboxConnecting: boolean;
  onDropboxSignIn: () => void;
  onedriveRefreshToken: string;
  onedriveConnecting: boolean;
  onOneDriveSignIn: () => void;
  // Navigation
  canProceedToPassword: boolean;
  onNext: () => void;
  error: string;
  // Styles
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  eyeButtonStyle: React.CSSProperties;
}

export function ProviderStep({
  syncProvider,
  onProviderChange,
  webdavUrl,
  onWebdavUrlChange,
  webdavUsername,
  onWebdavUsernameChange,
  webdavPassword,
  onWebdavPasswordChange,
  showWebdavPassword,
  onToggleWebdavPassword,
  googleRefreshToken,
  googleConnecting,
  onGoogleSignIn,
  dropboxRefreshToken,
  dropboxConnecting,
  onDropboxSignIn,
  onedriveRefreshToken,
  onedriveConnecting,
  onOneDriveSignIn,
  canProceedToPassword,
  onNext,
  error,
  inputStyle,
  labelStyle,
  eyeButtonStyle,
}: ProviderStepProps) {
  const { theme } = useTheme();

  return (
    <>
      <h1
        style={{
          fontSize: theme.typography.sizes.xl,
          fontWeight: theme.typography.weights.bold,
          color: theme.colors.text,
          textAlign: 'center',
          margin: `0 0 ${theme.spacing.xs}px 0`,
        }}
      >
        Restore from Cloud
      </h1>
      <p
        style={{
          fontSize: theme.typography.sizes.xs,
          color: theme.colors.textSecondary,
          textAlign: 'center',
          margin: `0 0 ${theme.spacing.md}px 0`,
        }}
      >
        Connect to your cloud provider to restore an existing vault.
      </p>

      <div style={{ marginBottom: theme.spacing.sm }}>
        <label style={labelStyle}>Sync Provider</label>
        <select
          data-testid="restore-provider"
          value={syncProvider}
          onChange={(e) => onProviderChange(e.target.value as SyncProvider)}
          style={inputStyle}
        >
          <option value="webdav">WebDAV</option>
          <option value="google-drive">Google Drive</option>
          <option value="dropbox">Dropbox</option>
          <option value="onedrive">OneDrive</option>
        </select>
      </div>

      {syncProvider === 'webdav' && (
        <>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>WebDAV URL</label>
            <input
              type="url"
              data-testid="restore-webdav-url"
              value={webdavUrl}
              onChange={(e) => onWebdavUrlChange(e.target.value)}
              placeholder="https://dav.example.com/keykeykey/"
              style={inputStyle}
              autoFocus
            />
          </div>
          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>Username</label>
            <input
              type="text"
              data-testid="restore-webdav-username"
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
                data-testid="restore-webdav-password"
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
        </>
      )}

      {syncProvider === 'google-drive' && (
        <div style={{ marginBottom: theme.spacing.sm }}>
          {googleRefreshToken ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: theme.spacing.sm,
                background: theme.colors.successLight,
                border: `1px solid ${theme.colors.success}`,
                borderRadius: theme.radii.md,
                color: theme.colors.success,
                fontSize: theme.typography.sizes.xs,
              }}
            >
              Connected to Google Drive
            </div>
          ) : (
            <button
              onClick={onGoogleSignIn}
              disabled={googleConnecting}
              style={{
                width: '100%',
                padding: `${theme.spacing.sm}px`,
                background: googleConnecting ? theme.colors.border : theme.colors.primary,
                border: 'none',
                borderRadius: theme.radii.md,
                color: googleConnecting ? theme.colors.textSecondary : '#000',
                cursor: googleConnecting ? 'not-allowed' : 'pointer',
                fontSize: theme.typography.sizes.sm,
                fontWeight: theme.typography.weights.semibold,
              }}
            >
              {googleConnecting ? 'Signing in...' : 'Sign in with Google'}
            </button>
          )}
        </div>
      )}

      {syncProvider === 'dropbox' && (
        <div style={{ marginBottom: theme.spacing.sm }}>
          {dropboxRefreshToken ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: theme.spacing.sm,
                background: theme.colors.successLight,
                border: `1px solid ${theme.colors.success}`,
                borderRadius: theme.radii.md,
                color: theme.colors.success,
                fontSize: theme.typography.sizes.xs,
              }}
            >
              Connected to Dropbox
            </div>
          ) : (
            <button
              onClick={onDropboxSignIn}
              disabled={dropboxConnecting}
              style={{
                width: '100%',
                padding: `${theme.spacing.sm}px`,
                background: dropboxConnecting ? theme.colors.border : theme.colors.primary,
                border: 'none',
                borderRadius: theme.radii.md,
                color: dropboxConnecting ? theme.colors.textSecondary : '#000',
                cursor: dropboxConnecting ? 'not-allowed' : 'pointer',
                fontSize: theme.typography.sizes.sm,
                fontWeight: theme.typography.weights.semibold,
              }}
            >
              {dropboxConnecting ? 'Signing in...' : 'Sign in with Dropbox'}
            </button>
          )}
        </div>
      )}

      {syncProvider === 'onedrive' && (
        <div style={{ marginBottom: theme.spacing.sm }}>
          {onedriveRefreshToken ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: theme.spacing.sm,
                background: theme.colors.successLight,
                border: `1px solid ${theme.colors.success}`,
                borderRadius: theme.radii.md,
                color: theme.colors.success,
                fontSize: theme.typography.sizes.xs,
              }}
            >
              Connected to OneDrive
            </div>
          ) : (
            <button
              onClick={onOneDriveSignIn}
              disabled={onedriveConnecting}
              style={{
                width: '100%',
                padding: `${theme.spacing.sm}px`,
                background: onedriveConnecting ? theme.colors.border : theme.colors.primary,
                border: 'none',
                borderRadius: theme.radii.md,
                color: onedriveConnecting ? theme.colors.textSecondary : '#000',
                cursor: onedriveConnecting ? 'not-allowed' : 'pointer',
                fontSize: theme.typography.sizes.sm,
                fontWeight: theme.typography.weights.semibold,
              }}
            >
              {onedriveConnecting ? 'Signing in...' : 'Sign in with OneDrive'}
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: theme.spacing.sm,
            background: theme.colors.errorLight,
            border: `1px solid ${theme.colors.error}`,
            borderRadius: theme.radii.md,
            color: theme.colors.error,
            fontSize: theme.typography.sizes.xs,
            marginBottom: theme.spacing.sm,
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={onNext}
        disabled={!canProceedToPassword}
        style={{
          width: '100%',
          padding: `${theme.spacing.sm}px`,
          background: canProceedToPassword ? theme.colors.primary : theme.colors.border,
          border: 'none',
          borderRadius: theme.radii.md,
          color: canProceedToPassword ? '#000' : theme.colors.textSecondary,
          cursor: canProceedToPassword ? 'pointer' : 'not-allowed',
          fontSize: theme.typography.sizes.sm,
          fontWeight: theme.typography.weights.semibold,
        }}
      >
        Next
      </button>
    </>
  );
}
