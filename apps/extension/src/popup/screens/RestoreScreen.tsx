import React, { useState } from 'react';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import type { SyncConfig, SyncProvider } from '../../lib/messages.js';

interface RestoreScreenProps {
  onBack: () => void;
  onComplete: () => void;
}

type Step = 'provider' | 'password' | 'restoring' | 'success';

export function RestoreScreen({ onBack, onComplete }: RestoreScreenProps) {
  const { theme } = useTheme();

  const [step, setStep] = useState<Step>('provider');
  const [error, setError] = useState('');

  // Provider fields
  const [syncProvider, setSyncProvider] = useState<SyncProvider>('webdav');
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');

  // Master password
  const [masterPassword, setMasterPassword] = useState('');

  // Result
  const [itemCount, setItemCount] = useState(0);

  const canProceedToPassword =
    syncProvider === 'webdav' &&
    webdavUrl.trim().length > 0 &&
    webdavUsername.trim().length > 0 &&
    webdavPassword.trim().length > 0;

  const handleNext = () => {
    setError('');
    setStep('password');
  };

  const handleRestore = async () => {
    if (!masterPassword) return;
    setError('');
    setStep('restoring');
    // Yield to let spinner render
    await new Promise((r) => setTimeout(r, 50));
    const config: SyncConfig = {
      provider: 'webdav',
      webdav: {
        url: webdavUrl.trim(),
        username: webdavUsername.trim(),
        password: webdavPassword,
      },
    };
    try {
      const result = (await sendMessage<{
        success?: boolean;
        itemCount?: number;
        error?: string;
      }>({
        type: 'RESTORE_FROM_CLOUD',
        config,
        masterPassword,
      })) as { success?: boolean; itemCount?: number; error?: string };
      if (result.success) {
        setItemCount(result.itemCount ?? 0);
        setStep('success');
      } else {
        const err = result.error ?? 'Restore failed';
        setError(err);
        // Route connection/network errors back to provider step, auth errors to password step
        const isConnectionError =
          err.includes('network') ||
          err.includes('fetch') ||
          err.includes('No vault data found') ||
          err.includes('ECONNREFUSED') ||
          err.includes('URL not allowed');
        setStep(isConnectionError ? 'provider' : 'password');
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Restore failed';
      setError(err);
      setStep('provider');
    }
  };

  const handleBackStep = () => {
    if (step === 'password') {
      setStep('provider');
      setError('');
    } else {
      onBack();
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: `${theme.spacing.sm}px ${theme.spacing.md}px`,
    background: theme.colors.inputBackground,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    color: theme.colors.text,
    fontSize: theme.typography.sizes.sm,
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.textSecondary,
    fontWeight: theme.typography.weights.medium,
    marginBottom: 4,
    display: 'block',
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '480px',
        padding: theme.spacing.lg,
      }}
    >
      {/* Back button (not shown during restoring or success) */}
      {step !== 'restoring' && step !== 'success' && (
        <button
          onClick={handleBackStep}
          style={{
            background: 'none',
            border: 'none',
            color: theme.colors.textSecondary,
            cursor: 'pointer',
            fontSize: theme.typography.sizes.sm,
            padding: 0,
            marginBottom: theme.spacing.md,
            textAlign: 'left',
          }}
          aria-label="Back"
        >
          &#8592; {step === 'password' ? 'Back' : 'Back to Setup'}
        </button>
      )}

      {/* Icon */}
      <div
        style={{
          textAlign: 'center',
          marginBottom: theme.spacing.md,
          fontSize: 32,
        }}
      >
        {step === 'success' ? '\u2705' : '\u2601\uFE0F'}
      </div>

      {/* Step: Provider */}
      {step === 'provider' && (
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
              onChange={(e) => setSyncProvider(e.target.value as SyncProvider)}
              style={inputStyle}
            >
              <option value="webdav">WebDAV</option>
              <option value="google-drive" disabled>
                Google Drive (Coming Soon)
              </option>
              <option value="icloud" disabled>
                iCloud (Coming Soon)
              </option>
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
                  onChange={(e) => setWebdavUrl(e.target.value)}
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
                  onChange={(e) => setWebdavUsername(e.target.value)}
                  placeholder="Username"
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: theme.spacing.sm }}>
                <label style={labelStyle}>Password</label>
                <input
                  type="password"
                  data-testid="restore-webdav-password"
                  value={webdavPassword}
                  onChange={(e) => setWebdavPassword(e.target.value)}
                  placeholder="Password"
                  style={inputStyle}
                />
              </div>
            </>
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
            onClick={handleNext}
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
      )}

      {/* Step: Master Password */}
      {step === 'password' && (
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
            Enter Master Password
          </h1>
          <p
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
              textAlign: 'center',
              margin: `0 0 ${theme.spacing.md}px 0`,
            }}
          >
            Enter the master password for the vault stored on your cloud provider.
          </p>

          <div
            style={{
              fontSize: theme.typography.sizes.xs,
              color: theme.colors.textSecondary,
              marginBottom: theme.spacing.md,
              display: 'flex',
              alignItems: 'center',
              gap: theme.spacing.sm,
            }}
          >
            <span>&#128274;</span>
            <span>
              Your password is used locally to decrypt the vault and is never sent to the server.
            </span>
          </div>

          <div style={{ marginBottom: theme.spacing.sm }}>
            <label style={labelStyle}>Master Password</label>
            <input
              type="password"
              data-testid="restore-master-password"
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              placeholder="Enter your master password"
              style={inputStyle}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && masterPassword) handleRestore();
              }}
            />
          </div>

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
            onClick={handleRestore}
            disabled={!masterPassword}
            style={{
              width: '100%',
              padding: `${theme.spacing.sm}px`,
              background: masterPassword ? theme.colors.primary : theme.colors.border,
              border: 'none',
              borderRadius: theme.radii.md,
              color: masterPassword ? '#000' : theme.colors.textSecondary,
              cursor: masterPassword ? 'pointer' : 'not-allowed',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
            }}
          >
            Restore Vault
          </button>
        </>
      )}

      {/* Step: Restoring (progress) */}
      {step === 'restoring' && (
        <div
          style={{
            textAlign: 'center',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <h1
            style={{
              fontSize: theme.typography.sizes.xl,
              fontWeight: theme.typography.weights.bold,
              color: theme.colors.text,
              margin: `0 0 ${theme.spacing.sm}px 0`,
            }}
          >
            Restoring Vault
          </h1>
          <p
            style={{
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.textSecondary,
              margin: `0 0 ${theme.spacing.lg}px 0`,
            }}
          >
            Downloading and decrypting your vault...
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div
              style={{
                width: 28,
                height: 28,
                border: `3px solid ${theme.colors.border}`,
                borderTopColor: theme.colors.primary,
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Step: Success */}
      {step === 'success' && (
        <div
          style={{
            textAlign: 'center',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <h1
            style={{
              fontSize: theme.typography.sizes.xl,
              fontWeight: theme.typography.weights.bold,
              color: theme.colors.text,
              margin: `0 0 ${theme.spacing.sm}px 0`,
            }}
          >
            Vault Restored
          </h1>
          <p
            style={{
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.textSecondary,
              margin: `0 0 ${theme.spacing.lg}px 0`,
            }}
          >
            Successfully restored {itemCount} {itemCount === 1 ? 'item' : 'items'} from the cloud.
          </p>
          <button
            onClick={onComplete}
            style={{
              width: '100%',
              padding: `${theme.spacing.sm}px`,
              background: theme.colors.primary,
              border: 'none',
              borderRadius: theme.radii.md,
              color: '#000',
              cursor: 'pointer',
              fontSize: theme.typography.sizes.sm,
              fontWeight: theme.typography.weights.semibold,
            }}
          >
            Go to Vault
          </button>
        </div>
      )}
    </div>
  );
}
