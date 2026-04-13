import React, { useEffect, useState } from 'react';
import browser from 'webextension-polyfill';
import { useTheme } from '../../lib/theme.js';
import { sendMessage } from '../hooks/useMessage.js';
import type { SyncConfig, SyncProvider } from '../../lib/messages.js';
import { EyeIcon, EyeOffIcon } from '../components/icons/index.js';
import { getBrowserKind } from '../../lib/browser-detect.js';

interface RestoreScreenProps {
  onBack: () => void;
  onComplete: () => void;
  /** If set, skip provider selection and go directly to password step. */
  initialProvider?: 'google-drive' | 'dropbox' | 'onedrive';
}

type Step = 'provider' | 'password' | 'restoring' | 'success' | 'created';

export function RestoreScreen({ onBack, onComplete, initialProvider }: RestoreScreenProps) {
  const { theme } = useTheme();

  // On Chrome, Google-Drive can skip straight to the password step because
  // chrome.identity silently reuses the cached token. On all other browsers
  // (Firefox, Safari), launchWebAuthFlow opens a tab that closes the popup.
  // In that case the background persists the OAuth tokens to storage (see
  // restore_oauth_tokens in the *_OAUTH_GET_TOKEN handlers), and we read
  // them on mount to skip re-authentication.
  const canSkipProviderForGoogle =
    initialProvider === 'google-drive' && getBrowserKind() === 'chrome';
  const [step, setStep] = useState<Step>(canSkipProviderForGoogle ? 'password' : 'provider');
  const [error, setError] = useState('');

  // Provider fields
  const [syncProvider, setSyncProvider] = useState<SyncProvider>(initialProvider ?? 'webdav');
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
  // that the background persisted before the popup was destroyed. This
  // lets us skip re-authentication and go straight to the password step.
  useEffect(() => {
    if (!initialProvider || canSkipProviderForGoogle) return;
    browser.storage.local.get('restore_oauth_tokens').then((result) => {
      const cached = result.restore_oauth_tokens as
        | { provider: string; refreshToken?: string; clientId?: string; clientSecret?: string }
        | undefined;
      if (!cached || cached.provider !== initialProvider) return;
      if (!cached.refreshToken || !cached.clientId) return;
      // Populate the right provider's state and skip to password
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
      // Clean up — tokens should only be used once
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

    // Guard against missing OAuth credentials — without these the adapter
    // token refresh will fail deep in the background with "invalid_client".
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
    // Yield to let spinner render
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

        // If no vault exists on cloud and we came from a shortcut (initialProvider),
        // create a new vault with the same password and configure sync automatically.
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
            // Configure sync with the provider
            const connectResult = (await sendMessage<{ ok?: boolean; error?: string }>({
              type: 'GOOGLE_OAUTH_CONNECT',
              masterPassword,
            })) as { ok?: boolean; error?: string };
            if (connectResult.error) {
              // Vault created but sync config failed — still show success
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
        // Route connection/network errors back to provider step, auth errors to password step
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
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    type={showWebdavPassword ? 'text' : 'password'}
                    data-testid="restore-webdav-password"
                    value={webdavPassword}
                    onChange={(e) => setWebdavPassword(e.target.value)}
                    placeholder="Password"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={() => setShowWebdavPassword(!showWebdavPassword)}
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
                  onClick={handleGoogleSignIn}
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
                  onClick={handleDropboxSignIn}
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
                  onClick={handleOneDriveSignIn}
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
      {/* Step: Created (new vault + sync configured) */}
      {step === 'created' && (
        <div
          style={{
            textAlign: 'center',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: theme.spacing.sm }}>&#9989;</div>
          <h1
            style={{
              fontSize: theme.typography.sizes.xl,
              fontWeight: theme.typography.weights.bold,
              color: theme.colors.text,
              margin: `0 0 ${theme.spacing.sm}px 0`,
            }}
          >
            Vault Created
          </h1>
          <p
            style={{
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.textSecondary,
              margin: `0 0 ${theme.spacing.md}px 0`,
            }}
          >
            No existing vault was found on Google Drive, so a new one was created and sync
            configured.
          </p>
          {recoveryKey && (
            <div
              style={{
                background: theme.colors.warningLight,
                border: `1px solid ${theme.colors.warning}`,
                borderRadius: theme.radii.md,
                padding: theme.spacing.md,
                marginBottom: theme.spacing.md,
                textAlign: 'left',
              }}
            >
              <div
                style={{
                  fontSize: theme.typography.sizes.xs,
                  fontWeight: theme.typography.weights.semibold,
                  color: theme.colors.warning,
                  marginBottom: theme.spacing.xs,
                }}
              >
                Save your recovery key
              </div>
              <div
                style={{
                  fontFamily: 'monospace',
                  fontSize: theme.typography.sizes.xs,
                  color: theme.colors.text,
                  wordBreak: 'break-all',
                  userSelect: 'all',
                }}
              >
                {recoveryKey}
              </div>
            </div>
          )}
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
