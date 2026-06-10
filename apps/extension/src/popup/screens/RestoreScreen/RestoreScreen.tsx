import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { isSyncProviderEnabled } from '@keykeykey/core/sync';
import { useTheme } from '../../../lib/theme.js';
import { sendMessage } from '../../hooks/useMessage.js';
import type { SyncConfig, SyncProvider } from '../../../lib/messages.js';
import { EyeIcon, EyeOffIcon } from '../../components/icons/index.js';
import { getBrowserKind } from '../../../lib/browser-detect.js';
import { ProviderStep } from './ProviderStep.js';
import { RestoreProgress } from './RestoreProgress.js';

interface RestoreScreenProps {
  onBack: () => void;
  onComplete: () => void;
  /** If set, skip provider selection and go directly to password step. */
  initialProvider?: 'google-drive' | 'dropbox' | 'onedrive';
}

type Step = 'provider' | 'password' | 'restoring' | 'success' | 'created';

export function RestoreScreen({ onBack, onComplete, initialProvider }: RestoreScreenProps) {
  const { theme } = useTheme();

  const canSkipProviderForGoogle =
    initialProvider === 'google-drive' &&
    isSyncProviderEnabled('google-drive') &&
    getBrowserKind() === 'chrome';
  const [step, setStep] = useState<Step>(canSkipProviderForGoogle ? 'password' : 'provider');
  const [error, setError] = useState('');

  // Provider fields
  // Defense in depth: fall back to webdav if initialProvider is not enabled
  const effectiveInitialProvider =
    initialProvider && isSyncProviderEnabled(initialProvider) ? initialProvider : 'webdav';
  const [syncProvider, setSyncProvider] = useState<SyncProvider>(effectiveInitialProvider);
  const [googleRefreshToken, setGoogleRefreshToken] = useState(
    canSkipProviderForGoogle ? 'chrome-identity' : '',
  );
  const [googleClientId, setGoogleClientId] = useState(
    canSkipProviderForGoogle ? 'chrome-identity' : '',
  );
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [dropboxRefreshToken, setDropboxRefreshToken] = useState('');
  const [dropboxClientId, setDropboxClientId] = useState('');
  const [dropboxConnecting, setDropboxConnecting] = useState(false);
  const [onedriveRefreshToken, setOnedriveRefreshToken] = useState('');
  const [onedriveClientId, setOnedriveClientId] = useState('');
  const [onedriveConnecting, setOnedriveConnecting] = useState(false);

  // On popup reopen after launchWebAuthFlow: pick up cached OAuth tokens
  useEffect(() => {
    if (!initialProvider || canSkipProviderForGoogle) return;
    browser.storage.local.get('restore_oauth_tokens').then((result) => {
      const cached = result.restore_oauth_tokens as
        | { provider: string; refreshToken?: string; clientId?: string; clientSecret?: string }
        | undefined;
      if (!cached || cached.provider !== initialProvider) return;
      if (!cached.refreshToken || !cached.clientId) return;
      if (cached.provider === 'google-drive') {
        setGoogleRefreshToken(cached.refreshToken);
        setGoogleClientId(cached.clientId);
        if (cached.clientSecret) setGoogleClientSecret(cached.clientSecret);
      } else if (cached.provider === 'dropbox') {
        setDropboxRefreshToken(cached.refreshToken);
        setDropboxClientId(cached.clientId);
      } else if (cached.provider === 'onedrive') {
        setOnedriveRefreshToken(cached.refreshToken);
        setOnedriveClientId(cached.clientId);
      }
      setSyncProvider(cached.provider as SyncProvider);
      setStep('password');
      browser.storage.local.remove('restore_oauth_tokens');
    });
  }, [initialProvider, canSkipProviderForGoogle]);

  // Master password
  const [masterPassword, setMasterPassword] = useState('');

  // Show/hide password state
  const [showWebdavPassword, setShowWebdavPassword] = useState(false);
  const [showMasterPassword, setShowMasterPassword] = useState(false);

  // Result
  const [itemCount, setItemCount] = useState(0);
  const [recoveryKey, setRecoveryKey] = useState('');

  const canProceedToPassword =
    (syncProvider === 'webdav' &&
      webdavUrl.trim().length > 0 &&
      webdavUsername.trim().length > 0 &&
      webdavPassword.trim().length > 0) ||
    (syncProvider === 'google-drive' && googleRefreshToken.length > 0) ||
    (syncProvider === 'dropbox' && dropboxRefreshToken.length > 0) ||
    (syncProvider === 'onedrive' && onedriveRefreshToken.length > 0);

  const handleNext = () => {
    setError('');
    setStep('password');
  };

  const handleGoogleSignIn = async () => {
    setGoogleConnecting(true);
    setError('');
    try {
      const result = await sendMessage<{
        refreshToken?: string;
        clientId?: string;
        clientSecret?: string;
        error?: string;
      }>({ type: 'GOOGLE_OAUTH_GET_TOKEN' });
      if (result?.error) {
        setError(result.error);
      } else if (result?.refreshToken && result?.clientId) {
        setGoogleRefreshToken(result.refreshToken);
        setGoogleClientId(result.clientId);
        if (result.clientSecret) setGoogleClientSecret(result.clientSecret);
      } else {
        setError('Google sign-in failed');
      }
    } catch {
      setError('Google sign-in failed');
    } finally {
      setGoogleConnecting(false);
    }
  };

  const handleDropboxSignIn = async () => {
    setDropboxConnecting(true);
    setError('');
    try {
      const result = await sendMessage<{
        refreshToken?: string;
        clientId?: string;
        error?: string;
      }>({ type: 'DROPBOX_OAUTH_GET_TOKEN' });
      if (result?.error) {
        setError(result.error);
      } else if (result?.refreshToken && result?.clientId) {
        setDropboxRefreshToken(result.refreshToken);
        setDropboxClientId(result.clientId);
      } else {
        setError('Dropbox sign-in failed');
      }
    } catch {
      setError('Dropbox sign-in failed');
    } finally {
      setDropboxConnecting(false);
    }
  };

  const handleOneDriveSignIn = async () => {
    setOnedriveConnecting(true);
    setError('');
    try {
      const result = await sendMessage<{
        refreshToken?: string;
        clientId?: string;
        error?: string;
      }>({ type: 'ONEDRIVE_OAUTH_GET_TOKEN' });
      if (result?.error) {
        setError(result.error);
      } else if (result?.refreshToken && result?.clientId) {
        setOnedriveRefreshToken(result.refreshToken);
        setOnedriveClientId(result.clientId);
      } else {
        setError('OneDrive sign-in failed');
      }
    } catch {
      setError('OneDrive sign-in failed');
    } finally {
      setOnedriveConnecting(false);
    }
  };

  const handleRestore = async () => {
    if (!masterPassword) return;

    if (syncProvider === 'dropbox' && (!dropboxRefreshToken || !dropboxClientId)) {
      setError('Please sign in to Dropbox first');
      setStep('provider');
      return;
    }
    if (syncProvider === 'onedrive' && (!onedriveRefreshToken || !onedriveClientId)) {
      setError('Please sign in to OneDrive first');
      setStep('provider');
      return;
    }

    setError('');
    setStep('restoring');
    await new Promise((r) => setTimeout(r, 50));
    let config: SyncConfig;
    if (syncProvider === 'google-drive') {
      config = {
        provider: 'google-drive',
        googleDrive: {
          refreshToken: googleRefreshToken,
          clientId: googleClientId,
          clientSecret: googleClientSecret || undefined,
        },
      };
    } else if (syncProvider === 'dropbox') {
      config = {
        provider: 'dropbox',
        dropbox: {
          refreshToken: dropboxRefreshToken,
          clientId: dropboxClientId,
        },
      };
    } else if (syncProvider === 'onedrive') {
      config = {
        provider: 'onedrive',
        onedrive: {
          refreshToken: onedriveRefreshToken,
          clientId: onedriveClientId,
        },
      };
    } else {
      config = {
        provider: 'webdav',
        webdav: {
          url: webdavUrl.trim(),
          username: webdavUsername.trim(),
          password: webdavPassword,
        },
      };
    }
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

        if (err.includes('No vault data found') && initialProvider) {
          try {
            const setupResult = (await sendMessage<{
              recoveryKey?: string;
              error?: string;
            }>({ type: 'SETUP', password: masterPassword })) as {
              recoveryKey?: string;
              error?: string;
            };
            if (setupResult.error) {
              setError(setupResult.error);
              setStep('password');
              return;
            }
            const connectResult = (await sendMessage<{ ok?: boolean; error?: string }>({
              type: 'GOOGLE_OAUTH_CONNECT',
              masterPassword,
            })) as { ok?: boolean; error?: string };
            if (connectResult.error) {
              console.warn('Sync config failed after vault creation:', connectResult.error);
            }
            setRecoveryKey(setupResult.recoveryKey ?? '');
            setStep('created');
          } catch {
            setError('Failed to create vault');
            setStep('password');
          }
          return;
        }

        setError(err);
        const isConnectionError =
          err.includes('network') ||
          err.includes('fetch') ||
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

  const eyeButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: theme.colors.textSecondary,
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '600px',
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
        <ProviderStep
          syncProvider={syncProvider}
          onProviderChange={setSyncProvider}
          webdavUrl={webdavUrl}
          onWebdavUrlChange={setWebdavUrl}
          webdavUsername={webdavUsername}
          onWebdavUsernameChange={setWebdavUsername}
          webdavPassword={webdavPassword}
          onWebdavPasswordChange={setWebdavPassword}
          showWebdavPassword={showWebdavPassword}
          onToggleWebdavPassword={() => setShowWebdavPassword(!showWebdavPassword)}
          googleRefreshToken={googleRefreshToken}
          googleConnecting={googleConnecting}
          onGoogleSignIn={handleGoogleSignIn}
          dropboxRefreshToken={dropboxRefreshToken}
          dropboxConnecting={dropboxConnecting}
          onDropboxSignIn={handleDropboxSignIn}
          onedriveRefreshToken={onedriveRefreshToken}
          onedriveConnecting={onedriveConnecting}
          onOneDriveSignIn={handleOneDriveSignIn}
          canProceedToPassword={canProceedToPassword}
          onNext={handleNext}
          error={error}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
          eyeButtonStyle={eyeButtonStyle}
        />
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
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type={showMasterPassword ? 'text' : 'password'}
                data-testid="restore-master-password"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                placeholder="Enter your master password"
                style={{ ...inputStyle, flex: 1 }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && masterPassword) handleRestore();
                }}
              />
              <button
                onClick={() => setShowMasterPassword(!showMasterPassword)}
                style={eyeButtonStyle}
                aria-label={showMasterPassword ? 'Hide password' : 'Show password'}
                type="button"
              >
                {showMasterPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
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

      {/* Progress/success/created steps */}
      {(step === 'restoring' || step === 'success' || step === 'created') && (
        <RestoreProgress
          step={step}
          itemCount={itemCount}
          recoveryKey={recoveryKey}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}
