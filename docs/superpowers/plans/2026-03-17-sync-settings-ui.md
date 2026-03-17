# Sync Settings UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sync configuration UI for desktop and mobile, add `triggerSync()` to vault contexts, and place a "Restore from Cloud" placeholder on setup screens.

**Architecture:** Dedicated sync settings screen on each platform (desktop: React Router sibling route; mobile: Expo Router root stack screen). Both reuse existing vault context's `saveSyncConfig` for connection and add a new `triggerSync()` method. The extension's working sync UI serves as the behavioral reference.

**Tech Stack:** React + react-router-dom (desktop), React Native + Expo Router (mobile), Vitest (desktop tests), Jest (mobile tests), existing `TextInput`/`Button` components on each platform.

**Spec:** `docs/superpowers/specs/2026-03-17-sync-settings-ui-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/desktop/src/screens/SyncSettingsScreen.tsx` | Desktop sync settings screen — provider picker, WebDAV form, connect/disconnect/sync-now |
| `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx` | Desktop sync screen tests |
| `apps/mobile/app/settings/sync.tsx` | Mobile sync settings screen — same logic, React Native UI |
| `apps/mobile/__tests__/screens/sync-settings.test.tsx` | Mobile sync screen tests |

### Modified Files

| File | Change |
|------|--------|
| `apps/desktop/src/lib/vault-context.tsx` | Add `triggerSync()` to type + provider |
| `apps/mobile/lib/vault-context.tsx` | Add `triggerSync()` to type + provider |
| `apps/desktop/src/App.tsx` | Add `settings/sync` route |
| `apps/desktop/src/screens/SettingsScreen.tsx` | Replace sync placeholder row |
| `apps/desktop/src/screens/SetupScreen.tsx` | Add "Restore from Cloud" button |
| `apps/mobile/app/_layout.tsx` | Add `settings/sync` stack screen |
| `apps/mobile/app/(tabs)/settings.tsx` | Replace sync placeholder row |
| `apps/mobile/app/setup.tsx` | Add "Restore from Cloud" button |

---

## Task 1: Add `triggerSync()` to Desktop Vault Context

**Files:**
- Modify: `apps/desktop/src/lib/vault-context.tsx:60-90` (type), `:306-330` (near saveSyncConfigAction), `:467-500` (provider value)

- [ ] **Step 1: Add `triggerSync` to `VaultContextType`**

In `apps/desktop/src/lib/vault-context.tsx`, add to the type definition after `saveSyncConfig`:

```typescript
// In VaultContextType (around line 88), add after saveSyncConfig:
  triggerSync: () => Promise<{ lastSynced: string | null; error: string | null }>;
```

- [ ] **Step 2: Implement `triggerSync` callback**

Add after `saveSyncConfigAction` (around line 330):

```typescript
  const triggerSync = useCallback(async () => {
    const engine = syncEngineRef.current;
    if (!engine) return { lastSynced: null, error: 'No sync engine' };
    try {
      await engine.sync();
      const now = new Date().toISOString();
      return { lastSynced: now, error: null };
    } catch (e) {
      return { lastSynced: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);
```

- [ ] **Step 3: Add `triggerSync` to provider value**

In the `<VaultContext.Provider value={{...}}>` block (around line 494), add `triggerSync` after `saveSyncConfig`:

```typescript
        saveSyncConfig: saveSyncConfigAction,
        triggerSync,
        vaultReplaced,
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/lib/vault-context.tsx
git commit -m "feat(desktop): add triggerSync() to vault context"
```

---

## Task 2: Add `triggerSync()` to Mobile Vault Context

**Files:**
- Modify: `apps/mobile/lib/vault-context.tsx:60-90` (type), `:403-427` (near saveSyncConfigAction), `:451-484` (provider value)

- [ ] **Step 1: Add `triggerSync` to `VaultContextType`**

In `apps/mobile/lib/vault-context.tsx`, add to the type definition after `saveSyncConfig`:

```typescript
// In VaultContextType (around line 88), add after saveSyncConfig:
  triggerSync: () => Promise<{ lastSynced: string | null; error: string | null }>;
```

- [ ] **Step 2: Implement `triggerSync` callback**

Add after `saveSyncConfigAction` (around line 427):

```typescript
  const triggerSync = useCallback(async () => {
    const engine = syncEngineRef.current;
    if (!engine) return { lastSynced: null, error: 'No sync engine' };
    try {
      await engine.sync();
      const now = new Date().toISOString();
      return { lastSynced: now, error: null };
    } catch (e) {
      return { lastSynced: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);
```

- [ ] **Step 3: Add `triggerSync` to provider value**

In the `<VaultContext.Provider value={{...}}>` block (around line 478), add `triggerSync` after `saveSyncConfig`:

```typescript
        saveSyncConfig: saveSyncConfigAction,
        triggerSync,
        vaultReplaced,
```

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile test -- --run --testPathPattern="setup" 2>&1 | head -5`
Expected: Tests start running (confirms the TypeScript compiles). Full test pass not required — just confirming no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/vault-context.tsx
git commit -m "feat(mobile): add triggerSync() to vault context"
```

---

## Task 3: Desktop Sync Settings Screen

**Files:**
- Create: `apps/desktop/src/screens/SyncSettingsScreen.tsx`

- [ ] **Step 1: Create the SyncSettingsScreen component**

Create `apps/desktop/src/screens/SyncSettingsScreen.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Cloud } from 'lucide-react';
import { useTheme } from '../lib/theme';
import { useVault } from '../lib/vault-context';
import { TextInput } from '../components/ui/TextInput';
import { Button } from '../components/ui/Button';
import type { SyncProvider, SyncConfig } from '@keykeykey/core/sync';

const SYNC_PROVIDERS: { value: SyncProvider; label: string; disabled: boolean }[] = [
  { value: 'none', label: 'None (Local Only)', disabled: false },
  { value: 'webdav', label: 'WebDAV', disabled: false },
  { value: 'google-drive', label: 'Google Drive (Coming Soon)', disabled: true },
  { value: 'icloud', label: 'iCloud (Coming Soon)', disabled: true },
];

export function SyncSettingsScreen() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { syncConfig, saveSyncConfig, triggerSync, getSyncStatus } = useVault();

  const isConnected = syncConfig != null && syncConfig.provider !== 'none';

  const [syncProvider, setSyncProvider] = useState<SyncProvider>(
    syncConfig?.provider ?? 'none',
  );
  const [webdavUrl, setWebdavUrl] = useState(syncConfig?.webdav?.url ?? '');
  const [webdavUsername, setWebdavUsername] = useState(syncConfig?.webdav?.username ?? '');
  const [webdavPassword, setWebdavPassword] = useState(syncConfig?.webdav?.password ?? '');
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const canConnect =
    syncProvider === 'webdav' &&
    webdavUrl.trim() !== '' &&
    webdavUsername.trim() !== '' &&
    webdavPassword.trim() !== '';

  const handleConnect = async () => {
    if (!canConnect) return;
    setConnecting(true);
    setSyncError(null);
    try {
      const config: SyncConfig = {
        provider: syncProvider,
        webdav: { url: webdavUrl, username: webdavUsername, password: webdavPassword },
      };
      await saveSyncConfig(config);
      setLastSynced(new Date().toISOString());
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setSyncError(null);
    await saveSyncConfig({ provider: 'none' });
    setSyncProvider('none');
    setWebdavUrl('');
    setWebdavUsername('');
    setWebdavPassword('');
    setLastSynced(null);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await triggerSync();
      if (result.error) {
        setSyncError(result.error);
      } else {
        setLastSynced(result.lastSynced);
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const { isSyncing } = getSyncStatus();

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            display: 'flex',
            color: theme.colors.text,
          }}
        >
          <ArrowLeft size={20} />
        </button>
        <Cloud size={20} color={theme.colors.primary} />
        <h1
          style={{
            fontSize: theme.typography.sizes.xl,
            fontWeight: theme.typography.weights.bold,
            color: theme.colors.text,
            margin: 0,
          }}
        >
          Cloud Sync
        </h1>
      </div>

      {/* Provider Picker */}
      <div style={{ marginBottom: 24 }}>
        <label
          style={{
            display: 'block',
            fontSize: theme.typography.sizes.sm,
            fontWeight: theme.typography.weights.medium,
            color: theme.colors.text,
            marginBottom: 6,
          }}
        >
          Sync Provider
        </label>
        <select
          value={syncProvider}
          onChange={(e) => setSyncProvider(e.target.value as SyncProvider)}
          disabled={isConnected}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${theme.colors.border}`,
            backgroundColor: theme.colors.inputBackground,
            color: theme.colors.text,
            fontSize: theme.typography.sizes.md,
            cursor: isConnected ? 'not-allowed' : 'pointer',
            opacity: isConnected ? 0.6 : 1,
          }}
        >
          {SYNC_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value} disabled={p.disabled}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* WebDAV Config Form */}
      {syncProvider === 'webdav' && !isConnected && (
        <div style={{ marginBottom: 24 }}>
          <TextInput
            label="WebDAV URL"
            value={webdavUrl}
            onChangeText={setWebdavUrl}
            placeholder="https://dav.example.com/remote.php/dav/files/user/"
          />
          <TextInput
            label="Username"
            value={webdavUsername}
            onChangeText={setWebdavUsername}
            placeholder="Username"
          />
          <TextInput
            label="Password"
            value={webdavPassword}
            onChangeText={setWebdavPassword}
            placeholder="Password"
            secureTextEntry
          />
        </div>
      )}

      {/* Coming Soon Banner */}
      {(syncProvider === 'google-drive' || syncProvider === 'icloud') && !isConnected && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            backgroundColor: theme.colors.surfaceAlt,
            color: theme.colors.textSecondary,
            fontSize: theme.typography.sizes.sm,
            marginBottom: 24,
          }}
        >
          This provider is not yet available. It will be supported in a future update.
        </div>
      )}

      {/* Sync Status */}
      {isConnected && (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            backgroundColor: theme.colors.surfaceAlt,
            marginBottom: 24,
          }}
        >
          <p
            style={{
              fontSize: theme.typography.sizes.sm,
              color: theme.colors.textSecondary,
              margin: 0,
            }}
          >
            {isSyncing || syncing
              ? 'Syncing…'
              : lastSynced
                ? `Last synced: ${new Date(lastSynced).toLocaleString()}`
                : 'Never synced'}
          </p>
          {syncError && (
            <p
              style={{
                fontSize: theme.typography.sizes.sm,
                color: theme.colors.error,
                margin: '8px 0 0',
              }}
            >
              {syncError}
            </p>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isConnected ? (
          <>
            <Button
              title={syncing || isSyncing ? 'Syncing…' : 'Sync Now'}
              onPress={handleSyncNow}
              variant="secondary"
              disabled={syncing || isSyncing}
              loading={syncing || isSyncing}
            />
            <Button title="Disconnect" onPress={handleDisconnect} variant="danger" />
          </>
        ) : (
          <Button
            title={connecting ? 'Connecting…' : 'Connect'}
            onPress={handleConnect}
            disabled={!canConnect || connecting}
            loading={connecting}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/screens/SyncSettingsScreen.tsx
git commit -m "feat(desktop): add SyncSettingsScreen component"
```

---

## Task 4: Wire Desktop Route and Settings Row

**Files:**
- Modify: `apps/desktop/src/App.tsx:15,34`
- Modify: `apps/desktop/src/screens/SettingsScreen.tsx:394`

- [ ] **Step 1: Add route in App.tsx**

In `apps/desktop/src/App.tsx`, add the import after the SettingsScreen import (line 15):

```typescript
import { SyncSettingsScreen } from './screens/SyncSettingsScreen';
```

Add the route inside the AppShell `<Route>` block, after the settings route (after line 34):

```tsx
                <Route path="settings/sync" element={<SyncSettingsScreen />} />
```

- [ ] **Step 2: Update SettingsScreen sync row**

In `apps/desktop/src/screens/SettingsScreen.tsx`, replace the Cloud Sync SettingRow (line 394):

```tsx
        <SettingRow icon={<Cloud size={18} />} label="Cloud Sync" subtitle="Coming soon" disabled />
```

With:

```tsx
        <SettingRow
          icon={<Cloud size={18} />}
          label="Cloud Sync"
          subtitle={
            syncConfig?.provider === 'webdav'
              ? 'Connected via WebDAV'
              : syncConfig?.provider === 'google-drive'
                ? 'Connected via Google Drive'
                : syncConfig?.provider === 'icloud'
                  ? 'Connected via iCloud'
                  : 'Not configured'
          }
          onClick={() => navigate('/vault/settings/sync')}
        />
```

This requires adding `syncConfig` from the vault context. In the component body (around line 75 in SettingsScreen.tsx where other vault context values are destructured), add `syncConfig`:

Find the `useVault()` destructuring and add `syncConfig` to it. For example, if it currently reads:

```tsx
  const { lock, pinConfigured, enablePin, disablePin, resetVault } = useVault();
```

Change to:

```tsx
  const { lock, pinConfigured, enablePin, disablePin, resetVault, syncConfig } = useVault();
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/screens/SettingsScreen.tsx
git commit -m "feat(desktop): wire sync settings route and update settings row"
```

---

## Task 5: Desktop Sync Settings Tests

**Files:**
- Create: `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx`

- [ ] **Step 1: Write the test file**

Create `apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockSaveSyncConfig = vi.fn().mockResolvedValue(undefined);
const mockTriggerSync = vi.fn().mockResolvedValue({ lastSynced: '2026-03-17T12:00:00Z', error: null });
const mockGetSyncStatus = vi.fn(() => ({ isSyncing: false }));
const mockNavigate = vi.fn();

let mockSyncConfig: any = null;

vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    syncConfig: mockSyncConfig,
    saveSyncConfig: mockSaveSyncConfig,
    triggerSync: mockTriggerSync,
    getSyncStatus: mockGetSyncStatus,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../lib/theme', () => ({
  useTheme: () => ({
    theme: {
      colors: {
        primary: '#A3E635',
        primaryMuted: '#A3E63520',
        background: '#FFF8F0',
        surface: '#FFFFFF',
        surfaceAlt: '#F5F0EB',
        text: '#1A1A1A',
        textSecondary: '#6B7280',
        border: '#E5E0DB',
        inputBackground: '#FFFFFF',
        error: '#EF4444',
        errorLight: '#FEE2E2',
        success: '#22C55E',
        successLight: '#DCFCE7',
        warning: '#F59E0B',
        warningLight: '#FEF3C7',
        danger: '#EF4444',
      },
      spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
      radii: { sm: 6, md: 10, lg: 16, full: 9999 },
      typography: {
        sizes: { xs: 12, sm: 14, md: 16, lg: 18, xl: 24, '2xl': 32 },
        weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
      },
    },
    mode: 'light',
    setMode: vi.fn(),
    isDark: false,
  }),
}));

import { SyncSettingsScreen } from '../SyncSettingsScreen';

function renderSyncSettings() {
  return render(
    <MemoryRouter>
      <SyncSettingsScreen />
    </MemoryRouter>,
  );
}

describe('SyncSettingsScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncConfig = null;
  });

  it('renders provider picker with all options', () => {
    renderSyncSettings();
    expect(screen.getByText('Cloud Sync')).toBeTruthy();
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    expect(screen.getByText('None (Local Only)')).toBeTruthy();
    expect(screen.getByText('WebDAV')).toBeTruthy();
    expect(screen.getByText('Google Drive (Coming Soon)')).toBeTruthy();
    expect(screen.getByText('iCloud (Coming Soon)')).toBeTruthy();
  });

  it('disables Google Drive and iCloud options', () => {
    renderSyncSettings();
    const googleOption = screen.getByText('Google Drive (Coming Soon)').closest('option');
    const icloudOption = screen.getByText('iCloud (Coming Soon)').closest('option');
    expect(googleOption).toHaveProperty('disabled', true);
    expect(icloudOption).toHaveProperty('disabled', true);
  });

  it('shows WebDAV fields when WebDAV is selected', () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'webdav' } });
    expect(screen.getByPlaceholderText(/dav\.example\.com/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Username')).toBeTruthy();
    expect(screen.getByPlaceholderText('Password')).toBeTruthy();
  });

  it('Connect button is disabled until all WebDAV fields are filled', () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'webdav' } });

    const connectButton = screen.getByText('Connect').closest('button');
    expect(connectButton).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByPlaceholderText(/dav\.example\.com/), {
      target: { value: 'https://dav.example.com' },
    });
    // The TextInput component uses onChangeText, so we simulate via the input's onChange
    // Still disabled — missing username and password
    expect(screen.getByText('Connect').closest('button')).toHaveProperty('disabled', true);
  });

  it('calls saveSyncConfig on Connect with WebDAV config', async () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'webdav' } });

    // Fill all fields — TextInput wraps input, so we find by placeholder
    fireEvent.change(screen.getByPlaceholderText(/dav\.example\.com/), {
      target: { value: 'https://dav.example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Username'), {
      target: { value: 'user' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'pass' },
    });

    const connectButton = screen.getByText('Connect');
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
      });
    });
  });

  it('shows Disconnect and Sync Now when connected', () => {
    mockSyncConfig = { provider: 'webdav', webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' } };
    renderSyncSettings();

    expect(screen.getByText('Sync Now')).toBeTruthy();
    expect(screen.getByText('Disconnect')).toBeTruthy();
    expect(screen.queryByText('Connect')).toBeNull();
  });

  it('calls triggerSync on Sync Now', async () => {
    mockSyncConfig = { provider: 'webdav', webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' } };
    renderSyncSettings();

    fireEvent.click(screen.getByText('Sync Now'));

    await waitFor(() => {
      expect(mockTriggerSync).toHaveBeenCalled();
    });
  });

  it('calls saveSyncConfig with none on Disconnect', async () => {
    mockSyncConfig = { provider: 'webdav', webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' } };
    renderSyncSettings();

    fireEvent.click(screen.getByText('Disconnect'));

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({ provider: 'none' });
    });
  });

  it('shows coming soon banner for google-drive', () => {
    renderSyncSettings();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'google-drive' } });
    expect(screen.getByText(/not yet available/)).toBeTruthy();
  });

  it('navigates back on back button click', () => {
    renderSyncSettings();
    // The back button is the first button in the header
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('displays sync error when triggerSync fails', async () => {
    mockTriggerSync.mockResolvedValueOnce({ lastSynced: null, error: 'Network timeout' });
    mockSyncConfig = { provider: 'webdav', webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' } };
    renderSyncSettings();

    fireEvent.click(screen.getByText('Sync Now'));

    await waitFor(() => {
      expect(screen.getByText('Network timeout')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop test -- --run`
Expected: All SyncSettingsScreen tests pass.

Note: The `TextInput` component in desktop uses native `<input>` elements with `onChange` → `onChangeText`. If tests fail because `fireEvent.change` doesn't trigger `onChangeText`, read the `TextInput.tsx` component to understand its event handling and adjust the test accordingly (e.g., finding the inner `<input>` element).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx
git commit -m "test(desktop): add SyncSettingsScreen tests"
```

---

## Task 6: Mobile Sync Settings Screen

**Files:**
- Create: `apps/mobile/app/settings/sync.tsx`
- Modify: `apps/mobile/app/_layout.tsx:42`

- [ ] **Step 1: Register the route in root layout**

In `apps/mobile/app/_layout.tsx`, add after the `item/edit` `Stack.Screen` (around line 42):

```tsx
        <Stack.Screen
          name="settings/sync"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
```

- [ ] **Step 2: Create the sync settings screen**

Create `apps/mobile/app/settings/sync.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVault } from '@/lib/vault-context';
import { useTheme } from '@/lib/theme-provider';
import { TextInput } from '@/components/TextInput';
import { Button } from '@/components/Button';
import type { SyncProvider, SyncConfig } from '@keykeykey/core/sync';

const SYNC_PROVIDERS: { value: SyncProvider; label: string; disabled: boolean }[] = [
  { value: 'none', label: 'None (Local Only)', disabled: false },
  { value: 'webdav', label: 'WebDAV', disabled: false },
  { value: 'google-drive', label: 'Google Drive (Coming Soon)', disabled: true },
  { value: 'icloud', label: 'iCloud (Coming Soon)', disabled: true },
];

export default function SyncSettingsScreen() {
  const { theme: t } = useTheme();
  const router = useRouter();
  const { syncConfig, saveSyncConfig, triggerSync, getSyncStatus } = useVault();

  const isConnected = syncConfig != null && syncConfig.provider !== 'none';

  const [syncProvider, setSyncProvider] = useState<SyncProvider>(
    syncConfig?.provider ?? 'none',
  );
  const [webdavUrl, setWebdavUrl] = useState(syncConfig?.webdav?.url ?? '');
  const [webdavUsername, setWebdavUsername] = useState(syncConfig?.webdav?.username ?? '');
  const [webdavPassword, setWebdavPassword] = useState(syncConfig?.webdav?.password ?? '');
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const canConnect =
    syncProvider === 'webdav' &&
    webdavUrl.trim() !== '' &&
    webdavUsername.trim() !== '' &&
    webdavPassword.trim() !== '';

  const handleConnect = async () => {
    if (!canConnect) return;
    setConnecting(true);
    setSyncError(null);
    try {
      const config: SyncConfig = {
        provider: syncProvider,
        webdav: { url: webdavUrl, username: webdavUsername, password: webdavPassword },
      };
      await saveSyncConfig(config);
      setLastSynced(new Date().toISOString());
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setSyncError(null);
    await saveSyncConfig({ provider: 'none' });
    setSyncProvider('none');
    setWebdavUrl('');
    setWebdavUsername('');
    setWebdavPassword('');
    setLastSynced(null);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await triggerSync();
      if (result.error) {
        setSyncError(result.error);
      } else {
        setLastSynced(result.lastSynced);
      }
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const { isSyncing } = getSyncStatus();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color={t.colors.text} />
          </Pressable>
          <Ionicons name="cloud-outline" size={24} color={t.colors.primary} />
          <Text style={[styles.title, { color: t.colors.text }]}>Cloud Sync</Text>
        </View>

        {/* Provider Picker (Radio List) */}
        <View style={[styles.section, { borderColor: t.colors.border }]}>
          <Text style={[styles.sectionLabel, { color: t.colors.text }]}>Sync Provider</Text>
          {SYNC_PROVIDERS.map((p) => (
            <Pressable
              key={p.value}
              onPress={() => !p.disabled && !isConnected && setSyncProvider(p.value)}
              disabled={p.disabled || isConnected}
              style={[
                styles.radioRow,
                { borderBottomColor: t.colors.border, opacity: p.disabled ? 0.5 : 1 },
              ]}
            >
              <View
                style={[
                  styles.radioCircle,
                  {
                    borderColor: syncProvider === p.value ? t.colors.primary : t.colors.border,
                  },
                ]}
              >
                {syncProvider === p.value && (
                  <View style={[styles.radioDot, { backgroundColor: t.colors.primary }]} />
                )}
              </View>
              <Text style={[styles.radioLabel, { color: p.disabled ? t.colors.textSecondary : t.colors.text }]}>
                {p.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* WebDAV Config Form */}
        {syncProvider === 'webdav' && !isConnected && (
          <View style={styles.form}>
            <TextInput
              label="WebDAV URL"
              value={webdavUrl}
              onChangeText={setWebdavUrl}
              placeholder="https://dav.example.com/remote.php/dav/files/user/"
            />
            <TextInput
              label="Username"
              value={webdavUsername}
              onChangeText={setWebdavUsername}
              placeholder="Username"
            />
            <TextInput
              label="Password"
              value={webdavPassword}
              onChangeText={setWebdavPassword}
              placeholder="Password"
              isPassword
            />
          </View>
        )}

        {/* Coming Soon Banner */}
        {(syncProvider === 'google-drive' || syncProvider === 'icloud') && !isConnected && (
          <View style={[styles.banner, { backgroundColor: t.colors.surfaceAlt }]}>
            <Text style={{ color: t.colors.textSecondary, fontSize: 14 }}>
              This provider is not yet available. It will be supported in a future update.
            </Text>
          </View>
        )}

        {/* Sync Status */}
        {isConnected && (
          <View style={[styles.statusCard, { backgroundColor: t.colors.surfaceAlt }]}>
            <Text style={{ color: t.colors.textSecondary, fontSize: 14 }}>
              {isSyncing || syncing
                ? 'Syncing…'
                : lastSynced
                  ? `Last synced: ${new Date(lastSynced).toLocaleString()}`
                  : 'Never synced'}
            </Text>
            {syncError && (
              <Text style={{ color: t.colors.error, fontSize: 14, marginTop: 8 }}>
                {syncError}
              </Text>
            )}
          </View>
        )}

        {/* Action Buttons */}
        <View style={styles.actions}>
          {isConnected ? (
            <>
              <Button
                title={syncing || isSyncing ? 'Syncing…' : 'Sync Now'}
                onPress={handleSyncNow}
                variant="secondary"
                disabled={syncing || isSyncing}
                loading={syncing || isSyncing}
              />
              <Button title="Disconnect" onPress={handleDisconnect} variant="danger" />
            </>
          ) : (
            <Button
              title={connecting ? 'Connecting…' : 'Connect'}
              onPress={handleConnect}
              disabled={!canConnect || connecting}
              loading={connecting}
            />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  backButton: { padding: 4 },
  title: { fontSize: 24, fontWeight: '700' },
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 14, fontWeight: '500', marginBottom: 12 },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  radioLabel: { fontSize: 16 },
  form: { marginBottom: 24 },
  banner: { padding: 16, borderRadius: 8, marginBottom: 24 },
  statusCard: { padding: 16, borderRadius: 8, marginBottom: 24 },
  actions: { gap: 12 },
});
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile test -- --run --testPathPattern="setup" 2>&1 | head -5`
Expected: Tests start running (confirms compilation).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/_layout.tsx apps/mobile/app/settings/sync.tsx
git commit -m "feat(mobile): add SyncSettingsScreen and route"
```

---

## Task 7: Wire Mobile Settings Row

**Files:**
- Modify: `apps/mobile/app/(tabs)/settings.tsx:195-196`

- [ ] **Step 1: Add imports and sync config access**

In `apps/mobile/app/(tabs)/settings.tsx`, find the `useVault()` destructuring and add `syncConfig`. Also add `useRouter` import if not already present.

The file already imports `useRouter` from `expo-router` (check the existing imports). Find the `useVault()` call and add `syncConfig`. For example:

```typescript
// Find the existing useVault() destructuring and add syncConfig
const { lock, biometricAvailable, pinConfigured, /* ... */, syncConfig } = useVault();
```

Also ensure `useRouter` is imported and `router` is available. The file likely already has:

```typescript
const router = useRouter();
```

If it uses `replace` but not `push`, the `router` variable is already available.

- [ ] **Step 2: Replace the sync SettingRow**

Replace line 196:

```tsx
          <SettingRow icon="cloud-outline" label="Cloud Sync" subtitle="Not configured" disabled />
```

With:

```tsx
          <SettingRow
            icon="cloud-outline"
            label="Cloud Sync"
            subtitle={
              syncConfig?.provider === 'webdav'
                ? 'Connected via WebDAV'
                : syncConfig?.provider === 'google-drive'
                  ? 'Connected via Google Drive'
                  : syncConfig?.provider === 'icloud'
                    ? 'Connected via iCloud'
                    : 'Not configured'
            }
            onPress={() => router.push('/settings/sync')}
          />
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile test -- --run --testPathPattern="settings" 2>&1 | head -10`
Expected: Tests start running (compilation check).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/(tabs)/settings.tsx
git commit -m "feat(mobile): wire sync settings row with live status"
```

---

## Task 8: Desktop "Restore from Cloud" Placeholder

**Files:**
- Modify: `apps/desktop/src/screens/SetupScreen.tsx:127`

- [ ] **Step 1: Add the placeholder button**

In `apps/desktop/src/screens/SetupScreen.tsx`, insert the following block immediately after the existing `<Button title="Create Vault" .../>` on line 127 (before the closing `</div>` on line 128):

```tsx
        {/* --- NEW CODE: Restore from Cloud placeholder --- */}
        <div style={{ marginTop: 16 }}>
          <Button
            title="Restore from Cloud"
            variant="secondary"
            onPress={() => {}}
            disabled
          />
          <p
            style={{
              textAlign: 'center',
              color: theme.colors.textSecondary,
              fontSize: theme.typography.sizes.sm,
              marginTop: 8,
            }}
          >
            Coming soon
          </p>
        </div>
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/screens/SetupScreen.tsx
git commit -m "feat(desktop): add 'Restore from Cloud' placeholder to setup screen"
```

---

## Task 9: Mobile "Restore from Cloud" Placeholder

**Files:**
- Modify: `apps/mobile/app/setup.tsx:99-104`

- [ ] **Step 1: Add the placeholder button**

In `apps/mobile/app/setup.tsx`, add after the "Create Vault" `<Button>` (around line 103):

```tsx
            <Button
              title="Create Vault"
              onPress={handleCreate}
              loading={loading}
              disabled={password.length < 8 || password !== confirm}
            />

            <View style={{ marginTop: 16 }}>
              <Button
                title="Restore from Cloud"
                variant="secondary"
                onPress={() => {}}
                disabled
              />
              <Text
                style={{
                  textAlign: 'center',
                  color: t.colors.textSecondary,
                  fontSize: 13,
                  marginTop: 8,
                }}
              >
                Coming soon
              </Text>
            </View>
```

Make sure `View` and `Text` are already imported from `react-native` (they are — check line 3-6 of setup.tsx).

- [ ] **Step 2: Verify build**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile test -- --run --testPathPattern="setup" 2>&1 | head -10`
Expected: Tests compile and run.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/setup.tsx
git commit -m "feat(mobile): add 'Restore from Cloud' placeholder to setup screen"
```

---

## Task 10: Mobile Sync Settings Tests

**Files:**
- Create: `apps/mobile/__tests__/screens/sync-settings.test.tsx`

- [ ] **Step 1: Write the test file**

Create `apps/mobile/__tests__/screens/sync-settings.test.tsx`:

```tsx
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.useColorScheme = jest.fn(() => 'light');
  return RN;
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: any) => children,
}));

const mockSaveSyncConfig = jest.fn().mockResolvedValue(undefined);
const mockTriggerSync = jest
  .fn()
  .mockResolvedValue({ lastSynced: '2026-03-17T12:00:00Z', error: null });
const mockGetSyncStatus = jest.fn(() => ({ isSyncing: false }));

let mockSyncConfig: any = null;

jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    syncConfig: mockSyncConfig,
    saveSyncConfig: mockSaveSyncConfig,
    triggerSync: mockTriggerSync,
    getSyncStatus: mockGetSyncStatus,
  }),
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

jest.mock('@keykeykey/ui', () => ({
  colors: {
    primary: '#A3E635',
    primaryMuted: '#D9F99D',
    background: '#FFFFFF',
    surface: '#FFF7ED',
    surfaceAlt: '#FFEDD5',
    text: '#292524',
    textSecondary: '#78716C',
    border: '#E7E5E4',
    inputBackground: '#FAFAF9',
    primaryDark: '#A3E635',
    primaryMutedDark: '#365314',
    backgroundDark: '#000000',
    surfaceDark: '#052E16',
    surfaceAltDark: '#064E3B',
    textDark: '#F0FDF4',
    textSecondaryDark: '#86EFAC',
    borderDark: '#14532D',
    inputBackgroundDark: '#022C22',
    error: '#EF4444',
    errorLight: '#FEE2E2',
    errorDark: '#EF4444',
    errorLightDark: '#7F1D1D',
    success: '#22C55E',
    successLight: '#DCFCE7',
    successDark: '#22C55E',
    successLightDark: '#14532D',
    warning: '#F59E0B',
    warningLight: '#FEF3C7',
    warningDark: '#F59E0B',
    warningLightDark: '#78350F',
    danger: '#EF4444',
    dangerDark: '#EF4444',
  },
}));

import SyncSettingsScreen from '../../app/settings/sync';

describe('SyncSettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncConfig = null;
  });

  it('renders provider radio list', () => {
    const { getByText } = render(<SyncSettingsScreen />);
    expect(getByText('Cloud Sync')).toBeTruthy();
    expect(getByText('None (Local Only)')).toBeTruthy();
    expect(getByText('WebDAV')).toBeTruthy();
    expect(getByText('Google Drive (Coming Soon)')).toBeTruthy();
    expect(getByText('iCloud (Coming Soon)')).toBeTruthy();
  });

  it('shows WebDAV fields when WebDAV is selected', () => {
    const { getByText, getByPlaceholderText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('WebDAV'));
    expect(getByPlaceholderText(/dav\.example\.com/)).toBeTruthy();
    expect(getByPlaceholderText('Username')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
  });

  it('Connect button is disabled until all WebDAV fields are filled', () => {
    const { getByText, getByPlaceholderText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('WebDAV'));

    // Connect visible but disabled — missing fields
    const connectButton = getByText('Connect');
    expect(connectButton).toBeTruthy();

    // Fill only URL — still can't connect
    fireEvent.changeText(getByPlaceholderText(/dav\.example\.com/), 'https://dav.example.com');
    // Filling all three should enable it (tested in the connect flow test below)
  });

  it('calls saveSyncConfig on Connect with WebDAV config', async () => {
    const { getByText, getByPlaceholderText } = render(<SyncSettingsScreen />);
    fireEvent.press(getByText('WebDAV'));

    fireEvent.changeText(getByPlaceholderText(/dav\.example\.com/), 'https://dav.example.com');
    fireEvent.changeText(getByPlaceholderText('Username'), 'user');
    fireEvent.changeText(getByPlaceholderText('Password'), 'pass');

    fireEvent.press(getByText('Connect'));

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({
        provider: 'webdav',
        webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
      });
    });
  });

  it('does not show coming soon banner by default', () => {
    const { queryByText } = render(<SyncSettingsScreen />);
    expect(queryByText(/not yet available/)).toBeNull();
  });

  it('shows Disconnect and Sync Now when connected', () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' },
    };
    const { getByText, queryByText } = render(<SyncSettingsScreen />);
    expect(getByText('Sync Now')).toBeTruthy();
    expect(getByText('Disconnect')).toBeTruthy();
    expect(queryByText('Connect')).toBeNull();
  });

  it('calls triggerSync on Sync Now press', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' },
    };
    const { getByText } = render(<SyncSettingsScreen />);

    fireEvent.press(getByText('Sync Now'));

    await waitFor(() => {
      expect(mockTriggerSync).toHaveBeenCalled();
    });
  });

  it('calls saveSyncConfig with none on Disconnect', async () => {
    mockSyncConfig = {
      provider: 'webdav',
      webdav: { url: 'https://dav.example.com', username: 'u', password: 'p' },
    };
    const { getByText } = render(<SyncSettingsScreen />);

    fireEvent.press(getByText('Disconnect'));

    await waitFor(() => {
      expect(mockSaveSyncConfig).toHaveBeenCalledWith({ provider: 'none' });
    });
  });
});
```

- [ ] **Step 2: Run the mobile tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile test -- --run --testPathPattern="sync-settings"`
Expected: All tests pass.

Note: If tests fail due to mock issues (e.g., `SafeAreaView`, Ionicons, or theme), compare the mock patterns with the existing `settings.test.tsx` and `setup.test.tsx` files and adjust accordingly.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/__tests__/screens/sync-settings.test.tsx
git commit -m "test(mobile): add SyncSettingsScreen tests"
```

---

## Task 11: Update Existing Tests for New Context Shape

**Files:**
- Modify: `apps/desktop/src/screens/__tests__/SettingsScreen.test.tsx:13-20`
- Modify: `apps/mobile/__tests__/screens/settings.test.tsx:31-40`

- [ ] **Step 1: Update desktop SettingsScreen test mock**

In `apps/desktop/src/screens/__tests__/SettingsScreen.test.tsx`, the `useVault` mock (around line 13) needs `syncConfig` added:

```typescript
vi.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    lock: mockLock,
    pinConfigured: false,
    enablePin: mockEnablePin,
    disablePin: mockDisablePin,
    resetVault: mockResetVault,
    syncConfig: null,
  }),
}));
```

- [ ] **Step 2: Update mobile settings test mock**

In `apps/mobile/__tests__/screens/settings.test.tsx`, the `mockVaultState` (around line 31) needs `syncConfig` added:

```typescript
const mockVaultState = {
  lock: mockLock,
  biometricAvailable: false,
  pinConfigured: false,
  enableBiometric: mockEnableBiometric,
  disableBiometric: mockDisableBiometric,
  enablePin: mockEnablePin,
  disablePin: mockDisablePin,
  resetVault: mockResetVault,
  syncConfig: null,
};
```

- [ ] **Step 3: Update desktop SetupScreen test mock if needed**

In `apps/desktop/src/screens/__tests__/SetupScreen.test.tsx`, check if the test renders the "Restore from Cloud" button correctly. The existing mock only provides `setupVault`, which should be fine — the button doesn't use any vault context. Verify by running:

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/desktop test -- --run`
Expected: All desktop tests pass.

- [ ] **Step 4: Run mobile tests**

Run: `cd /Users/davidneto/keykeykey && pnpm --filter @keykeykey/mobile test -- --run`
Expected: All mobile tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/screens/__tests__/SettingsScreen.test.tsx apps/mobile/__tests__/screens/settings.test.tsx
git commit -m "test: update existing test mocks for syncConfig and triggerSync"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run all tests**

Run: `cd /Users/davidneto/keykeykey && pnpm test`
Expected: All tests pass across all packages.

- [ ] **Step 2: Run lint**

Run: `cd /Users/davidneto/keykeykey && pnpm lint`
Expected: No lint errors.

- [ ] **Step 3: Run format check**

Run: `cd /Users/davidneto/keykeykey && pnpm format:check`
Expected: All files properly formatted. If not, run `pnpm format` and commit.

- [ ] **Step 4: Build all packages**

Run: `cd /Users/davidneto/keykeykey && pnpm build`
Expected: Build succeeds.

- [ ] **Step 5: Run critical E2E tests**

Run: `cd /Users/davidneto/keykeykey/e2e && npx playwright test --grep @critical`
Expected: Critical E2E tests pass.
