import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Cloud, Shield, Check, AlertTriangle } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';
import type { SyncConfig, SyncProvider } from '@keykeykey/core/sync';

type Step = 'provider' | 'password' | 'restoring' | 'success';

export function RestoreScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { restoreFromCloud } = useVault();

  const [step, setStep] = useState<Step>('provider');
  const [error, setError] = useState('');

  // Provider fields
  const [syncProvider, setSyncProvider] = useState<SyncProvider>('webdav');
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const el = selectRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const value = (e as CustomEvent).detail;
      if (typeof value === 'string') setSyncProvider(value as SyncProvider);
    };
    el.addEventListener('test-set-value', handler);
    return () => el.removeEventListener('test-set-value', handler);
  }, []);
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

  const buildSyncConfig = (): SyncConfig => ({
    provider: 'webdav',
    webdav: {
      url: webdavUrl.trim(),
      username: webdavUsername.trim(),
      password: webdavPassword,
    },
  });

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
    const config = buildSyncConfig();
    const result = await restoreFromCloud(config, masterPassword);
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
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: theme.colors.background,
        padding: '16px 24px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        {/* Back button (not shown during restoring or success) */}
        {step !== 'restoring' && step !== 'success' && (
          <button
            onClick={() => {
              if (step === 'password') {
                setStep('provider');
                setError('');
              } else {
                navigate('/setup');
              }
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.colors.textSecondary,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 0',
              marginBottom: 12,
              fontSize: theme.typography.sizes.sm,
            }}
          >
            <ArrowLeft size={18} />
            {step === 'password' ? 'Back' : 'Back to Setup'}
          </button>
        )}

        {/* Icon */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              backgroundColor: theme.colors.primaryMuted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {step === 'success' ? (
              <Check size={24} color={theme.colors.success} />
            ) : (
              <Cloud size={24} color={theme.colors.primary} />
            )}
          </div>
        </div>

        {/* Step: Provider + Credentials */}
        {step === 'provider' && (
          <>
            <h1
              style={{
                fontSize: theme.typography.sizes.xl,
                fontWeight: theme.typography.weights.bold,
                color: theme.colors.text,
                textAlign: 'center',
                marginBottom: 4,
              }}
            >
              Restore from Cloud
            </h1>
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                textAlign: 'center',
                marginBottom: 16,
              }}
            >
              Connect to your cloud sync provider to restore an existing vault.
            </p>

            {/* Provider picker */}
            <div style={{ marginBottom: 12 }}>
              <label
                style={{
                  display: 'block',
                  fontSize: theme.typography.sizes.sm,
                  fontWeight: theme.typography.weights.medium,
                  color: theme.colors.textSecondary,
                  marginBottom: 6,
                }}
              >
                Sync Provider
              </label>
              <select
                ref={selectRef}
                data-testid="restore-provider"
                value={syncProvider}
                onChange={(e) => setSyncProvider(e.target.value as SyncProvider)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: theme.colors.inputBackground,
                  color: theme.colors.text,
                  border: `1px solid ${theme.colors.border}`,
                  borderRadius: theme.radii.md,
                  fontSize: theme.typography.sizes.md,
                  outline: 'none',
                  cursor: 'pointer',
                }}
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

            {/* WebDAV credentials */}
            {syncProvider === 'webdav' && (
              <div style={{ marginBottom: 8 }}>
                <TextInput
                  label="WebDAV URL"
                  value={webdavUrl}
                  onChangeText={setWebdavUrl}
                  placeholder="https://dav.example.com/keykeykey/"
                  autoFocus
                  testId="restore-webdav-url"
                />
                <TextInput
                  label="Username"
                  value={webdavUsername}
                  onChangeText={setWebdavUsername}
                  placeholder="your-username"
                  testId="restore-webdav-username"
                />
                <TextInput
                  label="Password"
                  value={webdavPassword}
                  onChangeText={setWebdavPassword}
                  placeholder="your-password"
                  secureTextEntry
                  testId="restore-webdav-password"
                />
              </div>
            )}

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '10px 12px',
                  background: theme.colors.errorLight,
                  border: `1px solid ${theme.colors.error}`,
                  borderRadius: theme.radii.sm,
                  marginBottom: 16,
                }}
              >
                <AlertTriangle
                  size={15}
                  style={{ color: theme.colors.error, flexShrink: 0, marginTop: 1 }}
                />
                <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
                  {error}
                </span>
              </div>
            )}

            <Button
              title="Next"
              onPress={handleNext}
              variant="primary"
              disabled={!canProceedToPassword}
            />
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
                marginBottom: 4,
              }}
            >
              Enter Master Password
            </h1>
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                textAlign: 'center',
                marginBottom: 16,
              }}
            >
              Enter the master password for the vault stored on your cloud provider.
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <Shield size={16} color={theme.colors.textSecondary} />
              <span
                style={{ fontSize: theme.typography.sizes.sm, color: theme.colors.textSecondary }}
              >
                Your password is used locally to decrypt the vault and is never sent to the server.
              </span>
            </div>

            <TextInput
              label="Master Password"
              value={masterPassword}
              onChangeText={setMasterPassword}
              placeholder="Enter your master password"
              secureTextEntry
              autoFocus
              onSubmit={handleRestore}
              testId="restore-master-password"
            />

            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '10px 12px',
                  background: theme.colors.errorLight,
                  border: `1px solid ${theme.colors.error}`,
                  borderRadius: theme.radii.sm,
                  marginBottom: 16,
                }}
              >
                <AlertTriangle
                  size={15}
                  style={{ color: theme.colors.error, flexShrink: 0, marginTop: 1 }}
                />
                <span style={{ fontSize: theme.typography.sizes.xs, color: theme.colors.error }}>
                  {error}
                </span>
              </div>
            )}

            <Button
              title="Restore Vault"
              onPress={handleRestore}
              variant="primary"
              disabled={!masterPassword}
            />
          </>
        )}

        {/* Step: Restoring (progress) */}
        {step === 'restoring' && (
          <div style={{ textAlign: 'center' }}>
            <h1
              style={{
                fontSize: theme.typography.sizes['2xl'],
                fontWeight: theme.typography.weights.bold,
                color: theme.colors.text,
                marginBottom: 8,
              }}
            >
              Restoring Vault
            </h1>
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                marginBottom: 32,
              }}
            >
              Downloading and decrypting your vault...
            </p>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
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
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Step: Success */}
        {step === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <h1
              style={{
                fontSize: theme.typography.sizes['2xl'],
                fontWeight: theme.typography.weights.bold,
                color: theme.colors.text,
                marginBottom: 8,
              }}
            >
              Vault Restored
            </h1>
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.textSecondary,
                marginBottom: 32,
              }}
            >
              Successfully restored {itemCount} {itemCount === 1 ? 'item' : 'items'} from the cloud.
            </p>
            <Button
              title="Go to Vault"
              onPress={() => navigate('/vault', { replace: true })}
              variant="primary"
            />
          </div>
        )}
      </div>
    </div>
  );
}
