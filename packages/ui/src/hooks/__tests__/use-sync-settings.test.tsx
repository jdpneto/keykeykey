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
    let resolveValidate!: (value: boolean) => void;
    const mockDriver = createMockDriver({
      validateMasterPassword: () => new Promise<boolean>((r) => { resolveValidate = r; }),
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

    // Start connect without awaiting — connecting flag should be true immediately
    let connectDone = false;
    const promise = result.current.handleWebdavConnect().then(() => { connectDone = true; });

    // Give React a tick to process the setConnecting(true) call
    await act(async () => { await Promise.resolve(); });

    expect(result.current.connecting).toBe(true);

    // Unblock and finish
    await act(async () => {
      resolveValidate(true);
      await promise;
    });

    expect(connectDone).toBe(true);
    expect(result.current.connecting).toBe(false);
  });
});
