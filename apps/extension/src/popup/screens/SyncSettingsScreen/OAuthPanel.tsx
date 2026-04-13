import React from 'react';
import type { SyncProvider } from '../../../lib/messages.js';

interface OAuthPanelProps {
  syncProvider: SyncProvider;
  isConnected: boolean;
  connecting: boolean;
  syncing: boolean;
  canConnect: boolean;
  masterPassword: string;
  onConnect: () => void;
  onGoogleConnect: () => void;
  onDropboxConnect: () => void;
  onOneDriveConnect: () => void;
  onDisconnect: () => void;
  onSyncNow: () => void;
  buttonStyle: (
    variant: 'primary' | 'secondary' | 'danger',
    disabled?: boolean,
  ) => React.CSSProperties;
}

export function OAuthPanel({
  syncProvider,
  isConnected,
  connecting,
  syncing,
  canConnect,
  masterPassword,
  onConnect,
  onGoogleConnect,
  onDropboxConnect,
  onOneDriveConnect,
  onDisconnect,
  onSyncNow,
  buttonStyle,
}: OAuthPanelProps) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {isConnected ? (
        <>
          <button onClick={onSyncNow} disabled={syncing} style={buttonStyle('primary', syncing)}>
            {syncing ? 'Syncing...' : 'Sync Now'}
          </button>
          <button onClick={onDisconnect} style={buttonStyle('secondary')}>
            Disconnect
          </button>
        </>
      ) : (
        <>
          {syncProvider === 'webdav' && (
            <button
              onClick={onConnect}
              disabled={!canConnect || connecting}
              style={buttonStyle('primary', !canConnect || connecting)}
            >
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
          {syncProvider === 'google-drive' && (
            <button
              onClick={onGoogleConnect}
              disabled={connecting || !masterPassword}
              style={buttonStyle('primary', connecting || !masterPassword)}
            >
              {connecting ? 'Signing in\u2026' : 'Sign in with Google'}
            </button>
          )}
          {syncProvider === 'dropbox' && (
            <button
              onClick={onDropboxConnect}
              disabled={connecting || !masterPassword}
              style={buttonStyle('primary', connecting || !masterPassword)}
            >
              {connecting ? 'Signing in\u2026' : 'Sign in with Dropbox'}
            </button>
          )}
          {syncProvider === 'onedrive' && (
            <button
              onClick={onOneDriveConnect}
              disabled={connecting || !masterPassword}
              style={buttonStyle('primary', connecting || !masterPassword)}
            >
              {connecting ? 'Signing in\u2026' : 'Sign in with OneDrive'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
