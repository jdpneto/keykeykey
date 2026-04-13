# Sync Settings UI Deduplication — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared `useSyncSettings` hook and web components from desktop/extension SyncSettingsScreen into `@keykeykey/ui`, then rewire all three platforms to use them.

**Architecture:** A `SyncSettingsDriver` interface abstracts platform I/O. A `useSyncSettings(driver)` hook in `@keykeykey/ui` owns all state and orchestration. Four shared web components (ProviderSelector, MismatchDialog, SyncStatusCard, ConnectingOverlay) render the UI. Desktop + extension consume both hook and components; mobile consumes the hook only.

**Tech Stack:** TypeScript, React, Vitest (jsdom), @testing-library/react, tsup

---

## File Map

| Action | File                                                                         | Responsibility                                   |
| ------ | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| Create | `packages/ui/src/hooks/use-sync-settings.ts`                                 | Hook: all state + orchestration                  |
| Create | `packages/ui/src/hooks/sync-settings-types.ts`                               | Types: driver, state, SyncStatus, MismatchInfo   |
| Create | `packages/ui/src/hooks/__tests__/use-sync-settings.test.tsx`                 | Hook tests with mock driver                      |
| Create | `packages/ui/src/components/sync-settings/ProviderSelector.tsx`              | Provider dropdown + credential fields            |
| Create | `packages/ui/src/components/sync-settings/MismatchDialog.tsx`                | Vault mismatch overlay modal                     |
| Create | `packages/ui/src/components/sync-settings/SyncStatusCard.tsx`                | Connected state + actions                        |
| Create | `packages/ui/src/components/sync-settings/ConnectingOverlay.tsx`             | Spinner modal during connect                     |
| Create | `packages/ui/src/components/sync-settings/index.ts`                          | Barrel export for components                     |
| Modify | `packages/ui/src/index.ts`                                                   | Add hook + component exports                     |
| Modify | `packages/ui/tsup.config.ts`                                                 | No change needed (src/index.ts already an entry) |
| Modify | `apps/desktop/src/screens/SyncSettingsScreen.tsx`                            | Rewire to hook + shared components               |
| Modify | `apps/extension/src/popup/screens/SyncSettingsScreen/SyncSettingsScreen.tsx` | Rewire to hook + shared components               |
| Delete | `apps/extension/src/popup/screens/SyncSettingsScreen/ProviderSelector.tsx`   | Replaced by shared component                     |
| Delete | `apps/extension/src/popup/screens/SyncSettingsScreen/OAuthPanel.tsx`         | Logic absorbed into shared components            |
| Delete | `apps/extension/src/popup/screens/SyncSettingsScreen/MismatchResolver.tsx`   | Replaced by shared component                     |
| Modify | `apps/mobile/app/settings/sync.tsx`                                          | Rewire to hook (keep RN rendering)               |

---

### Task 1: Define types and driver interface

**Files:**

- Create: `packages/ui/src/hooks/sync-settings-types.ts`

- [ ] **Step 1: Create the types file**

```ts
import type { SyncConfig, SyncProvider } from '@keykeykey/core/sync';

// ---------------------------------------------------------------------------
// Platform Driver Interface
// ---------------------------------------------------------------------------

export interface SyncStatus {
  provider: SyncProvider;
  lastSynced: string | null;
  isSyncing: boolean;
  error: string | null;
}

export interface MismatchInfo {
  canRestore: boolean;
  remoteItemCount?: number;
}

export interface SyncSettingsDriver {
  validateMasterPassword(password: string): Promise<boolean>;
  saveConfig(config: SyncConfig): Promise<void>;
  getInitialState(): Promise<{
    syncStatus: SyncStatus | null;
    mismatchInfo: MismatchInfo | null;
  }>;
  refreshStatus(): Promise<{
    syncStatus: SyncStatus | null;
    mismatchInfo: MismatchInfo | null;
  }>;
  triggerSync(): Promise<{ lastSynced?: string; error?: string }>;
  disconnect(provider: SyncProvider): Promise<void>;
  startOAuth(
    provider: 'google-drive' | 'dropbox' | 'onedrive',
    masterPassword: string,
  ): Promise<void>;
  mergeVaults(): Promise<void>;
  replaceLocal(): Promise<void>;
  replaceRemote(): Promise<void>;
  clearMismatch(): Promise<void>;
  onConnected?(): void;
  onDisconnected?(): void;
}

// ---------------------------------------------------------------------------
// Hook Return Type
// ---------------------------------------------------------------------------

export type OAuthProvider = 'google-drive' | 'dropbox' | 'onedrive';

export interface SyncSettingsState {
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

  // Derived
  isConnected: boolean;
  canConnect: boolean;

  // Status
  syncStatus: SyncStatus | null;
  mismatchInfo: MismatchInfo | null;
  error: string | null;
  loading: boolean;

  // Operation flags
  connecting: boolean;
  syncing: boolean;
  merging: boolean;
  replacingLocal: boolean;
  replacingRemote: boolean;
  showDisconnectConfirm: boolean;
  setShowDisconnectConfirm: (v: boolean) => void;

  // Actions
  handleWebdavConnect: () => Promise<void>;
  handleOAuthConnect: (provider: OAuthProvider) => Promise<void>;
  handleSyncNow: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  handleMismatchMerge: () => Promise<void>;
  handleMismatchReplaceLocal: () => Promise<void>;
  handleMismatchReplaceRemote: () => Promise<void>;
  handleMismatchCancel: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
cd packages/ui && npx tsc --noEmit src/hooks/sync-settings-types.ts
```

Expected: No errors. The file imports `SyncConfig` and `SyncProvider` from `@keykeykey/core/sync`, which is a workspace dep.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/sync-settings-types.ts
git commit -m "feat(ui): add SyncSettingsDriver and SyncSettingsState types"
```

---

### Task 2: Implement useSyncSettings hook

**Files:**

- Create: `packages/ui/src/hooks/use-sync-settings.ts`

- [ ] **Step 1: Create the hook**

This hook is the extracted state and orchestration logic from desktop's SyncSettingsScreen.tsx (lines 46-338) and extension's SyncSettingsScreen.tsx (lines 40-375). The patterns are identical — validate master password, save config, trigger sync, handle errors, mismatch resolution.

```ts
import { useState, useEffect, useCallback, useRef } from 'react';
import type { SyncProvider } from '@keykeykey/core/sync';
import type {
  SyncSettingsDriver,
  SyncSettingsState,
  SyncStatus,
  MismatchInfo,
  OAuthProvider,
} from './sync-settings-types.js';

export function useSyncSettings(driver: SyncSettingsDriver): SyncSettingsState {
  // Form fields
  const [syncProvider, setSyncProvider] = useState<SyncProvider>('none');
  const [webdavUrl, setWebdavUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');

  // Status
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [mismatchInfo, setMismatchInfo] = useState<MismatchInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Operation flags
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [replacingLocal, setReplacingLocal] = useState(false);
  const [replacingRemote, setReplacingRemote] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Ref to track mount state for async operations
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Derived
  const isConnected = syncStatus != null && syncStatus.provider !== 'none';
  const canConnect =
    syncProvider === 'webdav' &&
    webdavUrl.trim().length > 0 &&
    webdavUsername.trim().length > 0 &&
    webdavPassword.trim().length > 0 &&
    masterPassword.trim() !== '';

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await driver.getInitialState();
        if (cancelled) return;
        setSyncStatus(state.syncStatus);
        setMismatchInfo(state.mismatchInfo);
        if (state.syncStatus?.provider && state.syncStatus.provider !== 'none') {
          setSyncProvider(state.syncStatus.provider);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [driver]);

  // Refresh status (callable by platform for external state changes)
  const refreshStatus = useCallback(async () => {
    try {
      const state = await driver.refreshStatus();
      if (!mountedRef.current) return;
      setSyncStatus(state.syncStatus);
      setMismatchInfo(state.mismatchInfo);
      if (state.syncStatus?.provider && state.syncStatus.provider !== 'none') {
        setSyncProvider(state.syncStatus.provider);
      }
    } catch {
      // Refresh failures are non-fatal
    }
  }, [driver]);

  // --- Actions ---

  const handleWebdavConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      const valid = await driver.validateMasterPassword(masterPassword);
      if (!valid) {
        setError('Incorrect master password');
        return;
      }
      await driver.saveConfig({
        provider: 'webdav',
        masterPassword,
        webdav: { url: webdavUrl, username: webdavUsername, password: webdavPassword },
      });
      const result = await driver.triggerSync();
      if (!mountedRef.current) return;
      if (result.error) {
        setError(result.error);
      } else {
        setSyncStatus((prev) => ({
          provider: 'webdav',
          lastSynced: result.lastSynced ?? null,
          isSyncing: false,
          error: null,
          ...prev,
          ...(result.lastSynced ? { lastSynced: result.lastSynced } : {}),
        }));
      }
      setMasterPassword('');
      setWebdavPassword('');
      driver.onConnected?.();
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
      }
    } finally {
      if (mountedRef.current) setConnecting(false);
    }
  }, [driver, masterPassword, webdavUrl, webdavUsername, webdavPassword, refreshStatus]);

  const handleOAuthConnect = useCallback(
    async (provider: OAuthProvider) => {
      setError(null);
      setConnecting(true);
      try {
        const valid = await driver.validateMasterPassword(masterPassword);
        if (!valid) {
          setError('Incorrect master password');
          return;
        }
        await driver.startOAuth(provider, masterPassword);
        if (!mountedRef.current) return;
        setMasterPassword('');
        driver.onConnected?.();
        await refreshStatus();
      } catch (err) {
        if (mountedRef.current) {
          const providerName =
            provider === 'google-drive'
              ? 'Google'
              : provider === 'dropbox'
                ? 'Dropbox'
                : 'Microsoft';
          setError(err instanceof Error ? err.message : `${providerName} sign-in failed`);
        }
      } finally {
        if (mountedRef.current) setConnecting(false);
      }
    },
    [driver, masterPassword, refreshStatus],
  );

  const handleSyncNow = useCallback(async () => {
    setError(null);
    setSyncing(true);
    try {
      const result = await driver.triggerSync();
      if (!mountedRef.current) return;
      if (result.error) {
        setError(result.error);
      }
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Sync failed');
      }
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  }, [driver, refreshStatus]);

  const handleDisconnect = useCallback(async () => {
    try {
      await driver.disconnect(syncProvider);
      if (!mountedRef.current) return;
      setSyncStatus(null);
      setSyncProvider('none');
      setWebdavUrl('');
      setWebdavUsername('');
      setWebdavPassword('');
      setMasterPassword('');
      setError(null);
      setShowDisconnectConfirm(false);
      driver.onDisconnected?.();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Disconnect failed');
      }
    }
  }, [driver, syncProvider]);

  const handleMismatchMerge = useCallback(async () => {
    setMerging(true);
    try {
      await driver.mergeVaults();
      if (!mountedRef.current) return;
      setMismatchInfo(null);
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Merge failed');
      }
    } finally {
      if (mountedRef.current) setMerging(false);
    }
  }, [driver, refreshStatus]);

  const handleMismatchReplaceLocal = useCallback(async () => {
    setReplacingLocal(true);
    try {
      await driver.replaceLocal();
      if (!mountedRef.current) return;
      setMismatchInfo(null);
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Replace failed');
      }
    } finally {
      if (mountedRef.current) setReplacingLocal(false);
    }
  }, [driver, refreshStatus]);

  const handleMismatchReplaceRemote = useCallback(async () => {
    setReplacingRemote(true);
    try {
      await driver.replaceRemote();
      if (!mountedRef.current) return;
      setMismatchInfo(null);
      await refreshStatus();
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Replace failed');
      }
    } finally {
      if (mountedRef.current) setReplacingRemote(false);
    }
  }, [driver, refreshStatus]);

  const handleMismatchCancel = useCallback(async () => {
    try {
      await driver.clearMismatch();
      if (!mountedRef.current) return;
      setMismatchInfo(null);
      // Reset to disconnected state
      setSyncStatus(null);
      setSyncProvider('none');
      driver.onDisconnected?.();
    } catch {
      // Cancel failures are non-fatal
    }
  }, [driver]);

  return {
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
    syncStatus,
    mismatchInfo,
    error,
    loading,
    connecting,
    syncing,
    merging,
    replacingLocal,
    replacingRemote,
    showDisconnectConfirm,
    setShowDisconnectConfirm,
    handleWebdavConnect,
    handleOAuthConnect,
    handleSyncNow,
    handleDisconnect,
    handleMismatchMerge,
    handleMismatchReplaceLocal,
    handleMismatchReplaceRemote,
    handleMismatchCancel,
    refreshStatus,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run:

```bash
pnpm --filter @keykeykey/ui build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/use-sync-settings.ts
git commit -m "feat(ui): implement useSyncSettings hook"
```

---

### Task 3: Test the useSyncSettings hook

**Files:**

- Create: `packages/ui/src/hooks/__tests__/use-sync-settings.test.tsx`

- [ ] **Step 1: Write hook tests**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSyncSettings } from '../use-sync-settings.js';
import type { SyncSettingsDriver } from '../sync-settings-types.js';

function createMockDriver(overrides?: Partial<SyncSettingsDriver>): SyncSettingsDriver {
  return {
    validateMasterPassword: vi.fn().mockResolvedValue(true),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    getInitialState: vi.fn().mockResolvedValue({ syncStatus: null, mismatchInfo: null }),
    refreshStatus: vi.fn().mockResolvedValue({ syncStatus: null, mismatchInfo: null }),
    triggerSync: vi.fn().mockResolvedValue({ lastSynced: '2026-01-01T00:00:00Z' }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    startOAuth: vi.fn().mockResolvedValue(undefined),
    mergeVaults: vi.fn().mockResolvedValue(undefined),
    replaceLocal: vi.fn().mockResolvedValue(undefined),
    replaceRemote: vi.fn().mockResolvedValue(undefined),
    clearMismatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('useSyncSettings', () => {
  let driver: SyncSettingsDriver;

  beforeEach(() => {
    driver = createMockDriver();
  });

  it('loads initial state from driver', async () => {
    const mockDriver = createMockDriver({
      getInitialState: vi.fn().mockResolvedValue({
        syncStatus: { provider: 'webdav', lastSynced: '2026-01-01', isSyncing: false, error: null },
        mismatchInfo: null,
      }),
    });
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.syncStatus?.provider).toBe('webdav');
    expect(result.current.isConnected).toBe(true);
    expect(result.current.syncProvider).toBe('webdav');
  });

  it('starts with loading=true, then resolves', async () => {
    const { result } = renderHook(() => useSyncSettings(driver));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('canConnect requires all WebDAV fields + master password', async () => {
    const { result } = renderHook(() => useSyncSettings(driver));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.canConnect).toBe(false);

    act(() => {
      result.current.setSyncProvider('webdav');
      result.current.setWebdavUrl('https://dav.example.com');
      result.current.setWebdavUsername('user');
      result.current.setWebdavPassword('pass');
      result.current.setMasterPassword('master');
    });

    expect(result.current.canConnect).toBe(true);
  });

  it('handleWebdavConnect validates password, saves config, triggers sync', async () => {
    const mockDriver = createMockDriver();
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSyncProvider('webdav');
      result.current.setWebdavUrl('https://dav.example.com');
      result.current.setWebdavUsername('user');
      result.current.setWebdavPassword('pass');
      result.current.setMasterPassword('master');
    });

    await act(() => result.current.handleWebdavConnect());

    expect(mockDriver.validateMasterPassword).toHaveBeenCalledWith('master');
    expect(mockDriver.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'webdav',
        masterPassword: 'master',
        webdav: { url: 'https://dav.example.com', username: 'user', password: 'pass' },
      }),
    );
    expect(mockDriver.triggerSync).toHaveBeenCalled();
    expect(result.current.masterPassword).toBe('');
  });

  it('handleWebdavConnect shows error on invalid password', async () => {
    const mockDriver = createMockDriver({
      validateMasterPassword: vi.fn().mockResolvedValue(false),
    });
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setMasterPassword('wrong');
      result.current.setSyncProvider('webdav');
      result.current.setWebdavUrl('https://dav.example.com');
      result.current.setWebdavUsername('user');
      result.current.setWebdavPassword('pass');
    });

    await act(() => result.current.handleWebdavConnect());

    expect(result.current.error).toBe('Incorrect master password');
    expect(mockDriver.saveConfig).not.toHaveBeenCalled();
  });

  it('handleOAuthConnect validates password then starts OAuth', async () => {
    const mockDriver = createMockDriver();
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.setMasterPassword('master'));
    await act(() => result.current.handleOAuthConnect('google-drive'));

    expect(mockDriver.validateMasterPassword).toHaveBeenCalledWith('master');
    expect(mockDriver.startOAuth).toHaveBeenCalledWith('google-drive', 'master');
    expect(result.current.masterPassword).toBe('');
  });

  it('handleSyncNow triggers sync and refreshes status', async () => {
    const mockDriver = createMockDriver();
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.handleSyncNow());

    expect(mockDriver.triggerSync).toHaveBeenCalled();
    expect(mockDriver.refreshStatus).toHaveBeenCalled();
  });

  it('handleDisconnect resets all state', async () => {
    const mockDriver = createMockDriver({
      getInitialState: vi.fn().mockResolvedValue({
        syncStatus: { provider: 'webdav', lastSynced: '2026-01-01', isSyncing: false, error: null },
        mismatchInfo: null,
      }),
    });
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.isConnected).toBe(true));

    await act(() => result.current.handleDisconnect());

    expect(mockDriver.disconnect).toHaveBeenCalledWith('webdav');
    expect(result.current.syncProvider).toBe('none');
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('handleMismatchMerge calls driver and clears mismatch', async () => {
    const mockDriver = createMockDriver({
      getInitialState: vi.fn().mockResolvedValue({
        syncStatus: { provider: 'webdav', lastSynced: null, isSyncing: false, error: null },
        mismatchInfo: { canRestore: true, remoteItemCount: 5 },
      }),
    });
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.mismatchInfo).not.toBeNull());

    await act(() => result.current.handleMismatchMerge());

    expect(mockDriver.mergeVaults).toHaveBeenCalled();
    expect(result.current.mismatchInfo).toBeNull();
  });

  it('handleMismatchCancel clears mismatch and resets provider', async () => {
    const mockDriver = createMockDriver({
      getInitialState: vi.fn().mockResolvedValue({
        syncStatus: { provider: 'webdav', lastSynced: null, isSyncing: false, error: null },
        mismatchInfo: { canRestore: true },
      }),
    });
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.mismatchInfo).not.toBeNull());

    await act(() => result.current.handleMismatchCancel());

    expect(mockDriver.clearMismatch).toHaveBeenCalled();
    expect(result.current.mismatchInfo).toBeNull();
    expect(result.current.syncProvider).toBe('none');
  });

  it('sets connecting flag during WebDAV connect', async () => {
    let resolveConnect!: () => void;
    const mockDriver = createMockDriver({
      saveConfig: () =>
        new Promise((r) => {
          resolveConnect = r as () => void;
        }),
    });
    const { result } = renderHook(() => useSyncSettings(mockDriver));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSyncProvider('webdav');
      result.current.setWebdavUrl('https://dav.example.com');
      result.current.setWebdavUsername('user');
      result.current.setWebdavPassword('pass');
      result.current.setMasterPassword('master');
    });

    const promise = act(() => result.current.handleWebdavConnect());
    expect(result.current.connecting).toBe(true);
    resolveConnect();
    await promise;
    expect(result.current.connecting).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

Run:

```bash
pnpm --filter @keykeykey/ui test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/hooks/__tests__/use-sync-settings.test.tsx
git commit -m "test(ui): add useSyncSettings hook tests"
```

---

### Task 4: Create shared web components

**Files:**

- Create: `packages/ui/src/components/sync-settings/ProviderSelector.tsx`
- Create: `packages/ui/src/components/sync-settings/MismatchDialog.tsx`
- Create: `packages/ui/src/components/sync-settings/SyncStatusCard.tsx`
- Create: `packages/ui/src/components/sync-settings/ConnectingOverlay.tsx`
- Create: `packages/ui/src/components/sync-settings/index.ts`

These components are extracted from the extension's existing sub-components (ProviderSelector.tsx, MismatchResolver.tsx, OAuthPanel.tsx) and desktop's inline rendering. They accept `theme` as a prop rather than calling `useTheme()` directly, since the ThemeProvider context lives in each app.

- [ ] **Step 1: Create ProviderSelector**

Create `packages/ui/src/components/sync-settings/ProviderSelector.tsx`. This component renders:

- Provider `<select>` dropdown (disabled when connected)
- WebDAV credential fields (url, username, password) when provider is `webdav` and not connected
- Master password field for OAuth providers when not connected
- Eye-toggle buttons for password fields

The component receives the form field slices from `SyncSettingsState`, plus a `theme` prop for styling, plus `onConnect` and `onOAuthConnect` callbacks for action buttons.

The code should be extracted from the extension's ProviderSelector.tsx (200 lines) and OAuthPanel.tsx (91 lines), merged into a single component that handles both the credential form AND the connect/sign-in buttons. Match the existing inline-style patterns used across both apps.

- [ ] **Step 2: Create MismatchDialog**

Create `packages/ui/src/components/sync-settings/MismatchDialog.tsx`. This is a direct extraction of the extension's MismatchResolver.tsx (119 lines). Full-screen overlay modal with:

- "Remote Vault Detected" title when `canRestore` is true
- "Incompatible Remote Vault" title when `canRestore` is false
- Item count display if available
- Merge / Replace Local / Replace Remote / Cancel buttons
- All buttons disabled during any operation (merging || replacingLocal || replacingRemote)

Props: `mismatchInfo`, operation flags, action callbacks from `SyncSettingsState`, plus `theme`.

- [ ] **Step 3: Create SyncStatusCard**

Create `packages/ui/src/components/sync-settings/SyncStatusCard.tsx`. Shows the connected state:

- Sync status row (syncing spinner, last-synced timestamp, or error)
- Error banner
- "Sync Now" button (disabled while syncing)
- "Disconnect" button (opens disconnect confirmation)
- Disconnect confirmation dialog

Props: relevant slices from `SyncSettingsState`, plus `theme`.

- [ ] **Step 4: Create ConnectingOverlay**

Create `packages/ui/src/components/sync-settings/ConnectingOverlay.tsx`. A simple full-screen overlay with a spinner and "Connecting to Cloud" text. Shows during OAuth/WebDAV connection flows.

Props: `connecting: boolean`, `onCancel: () => void`, `theme`.

- [ ] **Step 5: Create barrel export**

Create `packages/ui/src/components/sync-settings/index.ts`:

```ts
export { ProviderSelector } from './ProviderSelector.js';
export { MismatchDialog } from './MismatchDialog.js';
export { SyncStatusCard } from './SyncStatusCard.js';
export { ConnectingOverlay } from './ConnectingOverlay.js';
```

- [ ] **Step 6: Build and verify**

Run:

```bash
pnpm --filter @keykeykey/ui build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/sync-settings/
git commit -m "feat(ui): add shared sync settings web components"
```

---

### Task 5: Update barrel exports

**Files:**

- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Update the barrel**

Replace `packages/ui/src/index.ts` content:

```ts
export * from './tokens/index.js';
export { useSyncSettings } from './hooks/use-sync-settings.js';
export type {
  SyncSettingsDriver,
  SyncSettingsState,
  SyncStatus,
  MismatchInfo,
  OAuthProvider,
} from './hooks/sync-settings-types.js';
export {
  ProviderSelector,
  MismatchDialog,
  SyncStatusCard,
  ConnectingOverlay,
} from './components/sync-settings/index.js';
```

- [ ] **Step 2: Build all**

Run:

```bash
pnpm --filter @keykeykey/ui build && pnpm --filter @keykeykey/ui test
```

Expected: Build succeeds, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/index.ts
git commit -m "feat(ui): export useSyncSettings hook and sync settings components"
```

---

### Task 6: Rewire desktop SyncSettingsScreen

**Files:**

- Modify: `apps/desktop/src/screens/SyncSettingsScreen.tsx`

- [ ] **Step 1: Rewrite the desktop screen**

Replace the 880-line monolith with a ~80-line file that:

1. Creates a `SyncSettingsDriver` from `useVault()` context + Tauri OAuth functions
2. Calls `useSyncSettings(driver)`
3. Renders shared components: `ConnectingOverlay`, `MismatchDialog`, `ProviderSelector`, `SyncStatusCard`
4. Adds desktop-only HTTPS downgrade warning (reads `wasSchemeDowngradeDetected()`)

The driver implementation maps:

- `validateMasterPassword` → `vault.validateMasterPassword`
- `saveConfig` → `vault.saveSyncConfig`
- `getInitialState` → reads `vault.syncConfig` + `vault.vaultMismatchInfo`
- `refreshStatus` → returns current `vault.syncConfig` + `vault.vaultMismatchInfo`
- `triggerSync` → `vault.triggerSync`
- `disconnect` → revoke tokens (best-effort) + `vault.saveSyncConfig({ provider: 'none' })`
- `startOAuth` → calls `startGoogleOAuth()`, `startDropboxOAuth()`, or `startOneDriveOAuth()` from Tauri helpers, then saves config + triggers sync
- `mergeVaults` → `vault.mergeRemoteVault`
- `replaceLocal` → `vault.replaceLocalVault`
- `replaceRemote` → `vault.replaceRemoteVault`
- `clearMismatch` → `vault.clearVaultMismatch`
- `onDisconnected` → `clearSchemeDowngradeFlag()`

- [ ] **Step 2: Build and run desktop tests**

Run:

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/desktop test
```

Expected: All desktop tests pass. Some test expectations may need updating since the component structure changed — update the test file to match the new shared component rendering.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/screens/SyncSettingsScreen.tsx apps/desktop/src/screens/__tests__/SyncSettingsScreen.test.tsx
git commit -m "refactor(desktop): rewire SyncSettingsScreen to shared hook and components"
```

---

### Task 7: Rewire extension SyncSettingsScreen

**Files:**

- Modify: `apps/extension/src/popup/screens/SyncSettingsScreen/SyncSettingsScreen.tsx`
- Delete: `apps/extension/src/popup/screens/SyncSettingsScreen/ProviderSelector.tsx`
- Delete: `apps/extension/src/popup/screens/SyncSettingsScreen/OAuthPanel.tsx`
- Delete: `apps/extension/src/popup/screens/SyncSettingsScreen/MismatchResolver.tsx`

- [ ] **Step 1: Rewrite the extension screen**

Replace SyncSettingsScreen.tsx (~570 lines) with a ~60-line file that:

1. Creates a `SyncSettingsDriver` from `sendMessage()` calls
2. Calls `useSyncSettings(driver)`
3. Renders shared components
4. Adds a `useEffect` for `browser.storage.onChanged` that calls `refreshStatus` when `sync_connect_state` changes

The driver implementation maps:

- `validateMasterPassword` → `sendMessage({ type: 'VALIDATE_MASTER_PASSWORD', ... })`
- `saveConfig` → `sendMessage({ type: 'CONFIGURE_SYNC', ... })`
- `getInitialState` → fetches `GET_SYNC_STATUS` + `GET_MISMATCH_INFO`
- `refreshStatus` → same as getInitialState
- `triggerSync` → `sendMessage({ type: 'TRIGGER_SYNC' })`
- `disconnect` → sends `*_OAUTH_DISCONNECT` or `DISCONNECT_SYNC` based on provider
- `startOAuth` → sends `GOOGLE_OAUTH_CONNECT`, `DROPBOX_OAUTH_CONNECT`, or `ONEDRIVE_OAUTH_CONNECT`
- `mergeVaults` → `sendMessage({ type: 'MERGE_VAULTS' })`
- `replaceLocal` → `sendMessage({ type: 'REPLACE_LOCAL' })`
- `replaceRemote` → `sendMessage({ type: 'REPLACE_REMOTE' })`
- `clearMismatch` → `sendMessage({ type: 'CLEAR_MISMATCH' })`

- [ ] **Step 2: Delete old sub-components**

Delete:

- `apps/extension/src/popup/screens/SyncSettingsScreen/ProviderSelector.tsx`
- `apps/extension/src/popup/screens/SyncSettingsScreen/OAuthPanel.tsx`
- `apps/extension/src/popup/screens/SyncSettingsScreen/MismatchResolver.tsx`

- [ ] **Step 3: Build and run extension tests**

Run:

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/extension test
```

Expected: All extension tests pass. Update test file if needed.

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/popup/screens/SyncSettingsScreen/
git commit -m "refactor(extension): rewire SyncSettingsScreen to shared hook and components"
```

---

### Task 8: Rewire mobile sync screen

**Files:**

- Modify: `apps/mobile/app/settings/sync.tsx`

- [ ] **Step 1: Rewrite the mobile screen**

Replace the 635-line monolith with ~200 lines that:

1. Creates a `SyncSettingsDriver` from mobile's vault context
2. Calls `useSyncSettings(driver)`
3. Keeps all React Native rendering (radio buttons, TextInput, Modal, etc.)
4. Removes all duplicated state management and orchestration logic

The driver implementation maps:

- `validateMasterPassword` → `vault.validateMasterPassword`
- `saveConfig` → `vault.saveSyncConfig`
- `getInitialState` → reads `vault.syncConfig` + `vault.vaultMismatchInfo`
- `refreshStatus` → returns current `vault.syncConfig` + `vault.vaultMismatchInfo`
- `triggerSync` → `vault.triggerSync`
- `disconnect` → revoke tokens (best-effort) + `vault.saveSyncConfig({ provider: 'none' })`
- `startOAuth` → calls mobile OAuth helpers + saves config + triggers sync
- `mergeVaults` → `vault.mergeRemoteVault`
- `replaceLocal` → `vault.replaceLocalVault`
- `replaceRemote` → `vault.replaceRemoteVault`
- `clearMismatch` → `vault.clearVaultMismatch`

- [ ] **Step 2: Build and run mobile tests**

Run:

```bash
pnpm --filter @keykeykey/core --filter @keykeykey/ui build && pnpm --filter @keykeykey/mobile test
```

Expected: All mobile tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/settings/sync.tsx
git commit -m "refactor(mobile): rewire sync settings to shared useSyncSettings hook"
```

---

### Task 9: Full test suite and rebuild

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

Run:

```bash
pnpm build
```

Expected: Clean build across all packages.

- [ ] **Step 2: Run all tests**

Run:

```bash
pnpm test
```

Expected: All tests pass across all packages.

- [ ] **Step 3: Run lint and format**

Run:

```bash
pnpm lint && pnpm format:check
```

Expected: No lint errors, no format issues.

- [ ] **Step 4: Run critical E2E tests**

Run:

```bash
cd e2e && npx playwright test --grep @critical
```

Expected: Critical E2E tests pass (sync UI behavior unchanged).

- [ ] **Step 5: Fix any issues and commit**

If lint/format/test issues:

```bash
pnpm format
git add -u
git commit -m "style: fix formatting in sync settings refactor"
```
