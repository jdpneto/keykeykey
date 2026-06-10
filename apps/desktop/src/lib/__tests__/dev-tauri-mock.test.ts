import { describe, it, expect, beforeEach } from 'vitest';

// dev-tauri-mock reads window.__TAURI_INTERNALS__ and import.meta.env.DEV.
// Vitest sets DEV=true by default; jsdom provides localStorage.
//
// NOTE: We call window.__TAURI_INTERNALS__.invoke directly instead of
// @tauri-apps/api/core's invoke, because test-setup.ts mocks the whole
// @tauri-apps/api/core module with a vi.fn() that always returns undefined.

// Helper to call mock invoke directly
async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const internals = (window as any).__TAURI_INTERNALS__;
  if (!internals) throw new Error('Mock not installed');
  return internals.invoke(cmd, args ?? {});
}

describe('dev-tauri-mock', () => {
  // Each test clears TAURI_INTERNALS and localStorage before running.
  beforeEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    localStorage.clear();
  });

  it('returns false and is a no-op when Tauri runtime is already present', async () => {
    // Pre-install a stub representing the real Tauri runtime
    const stubInvoke = () => Promise.resolve(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__TAURI_INTERNALS__ = { invoke: stubInvoke, transformCallback: () => 0 };

    const { installDevTauriMock } = await import('../dev-tauri-mock');
    const result = installDevTauriMock();

    expect(result).toBe(false);
    // The original stub should still be in place (our mock didn't replace it)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window as any).__TAURI_INTERNALS__.invoke).toBe(stubInvoke);
  });

  it('returns true and installs the mock when no Tauri runtime is present', async () => {
    const { installDevTauriMock } = await import('../dev-tauri-mock');
    const result = installDevTauriMock();

    expect(result).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = (window as any).__TAURI_INTERNALS__;
    expect(internals).toBeDefined();
    expect(typeof internals.invoke).toBe('function');
  });

  describe('vault header round-trip', () => {
    it('save_vault_header / load_vault_header persists and retrieves header', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      const testHeader = 'dGVzdGhlYWRlcg=='; // base64 "testheader"
      await mockInvoke('save_vault_header', { data: testHeader });
      const loaded = await mockInvoke<string | null>('load_vault_header');

      expect(loaded).toBe(testHeader);
    });

    it('load_vault_header returns null when no header stored', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      const loaded = await mockInvoke<string | null>('load_vault_header');
      expect(loaded).toBeNull();
    });

    it('save_vault_header with empty string removes the header', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      await mockInvoke('save_vault_header', { data: 'somedata' });
      await mockInvoke('save_vault_header', { data: '' }); // clear
      const loaded = await mockInvoke<string | null>('load_vault_header');
      expect(loaded).toBeNull();
    });
  });

  describe('encrypted items round-trip', () => {
    it('save_encrypted_item / load_all_encrypted_items / delete_encrypted_item', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      await mockInvoke('save_encrypted_item', {
        id: 'item-1',
        itemType: 'credential',
        dataB64: 'ZW5jcnlwdGVk',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const items = await mockInvoke<Array<{ id: string; type: string; encrypted_data: string }>>(
        'load_all_encrypted_items',
      );
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'item-1',
        type: 'credential',
        encrypted_data: 'ZW5jcnlwdGVk',
      });

      await mockInvoke('delete_encrypted_item', { id: 'item-1' });
      const remaining = await mockInvoke<unknown[]>('load_all_encrypted_items');
      expect(remaining).toHaveLength(0);
    });
  });

  describe('vault setup flag', () => {
    it('is_vault_setup_complete defaults to false', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      const result = await mockInvoke<boolean>('is_vault_setup_complete');
      expect(result).toBe(false);
    });

    it('set_vault_setup_complete / is_vault_setup_complete round-trips', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      await mockInvoke('set_vault_setup_complete', { complete: true });
      expect(await mockInvoke<boolean>('is_vault_setup_complete')).toBe(true);

      await mockInvoke('set_vault_setup_complete', { complete: false });
      expect(await mockInvoke<boolean>('is_vault_setup_complete')).toBe(false);
    });
  });

  describe('keyring commands', () => {
    it('save_to_keyring / load_from_keyring / delete_from_keyring round-trips', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      await mockInvoke('save_to_keyring', { key: 'my_key', value: 'my_value' });
      expect(await mockInvoke<string | null>('load_from_keyring', { key: 'my_key' })).toBe(
        'my_value',
      );

      await mockInvoke('delete_from_keyring', { key: 'my_key' });
      expect(await mockInvoke<string | null>('load_from_keyring', { key: 'my_key' })).toBeNull();
    });

    it('load_from_keyring returns null for unknown key', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      const result = await mockInvoke<string | null>('load_from_keyring', { key: 'nonexistent' });
      expect(result).toBeNull();
    });
  });

  describe('biometric commands', () => {
    it('biometric_is_available returns false (browser has no biometrics)', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      const available = await mockInvoke<boolean>('biometric_is_available');
      expect(available).toBe(false);
    });
  });

  describe('unhandled command', () => {
    it('rejects with a descriptive error for unknown commands', async () => {
      const { installDevTauriMock } = await import('../dev-tauri-mock');
      installDevTauriMock();

      await expect(mockInvoke('totally_unknown_command')).rejects.toThrow(
        'dev-tauri-mock: unhandled command "totally_unknown_command"',
      );
    });
  });

  describe('devArgon2Adapter', () => {
    it('uses lightweight params (m=64, t=1) for fast browser hashing', async () => {
      const { devArgon2Adapter } = await import('../dev-tauri-mock');
      const password = new Uint8Array([1, 2, 3, 4]);
      const salt = new Uint8Array(16);

      const t0 = Date.now();
      const result = await devArgon2Adapter.hash(password, salt, {
        t: 2,
        m: 19_456,
        p: 1,
        dkLen: 32,
      });
      const elapsed = Date.now() - t0;

      // Should produce a 32-byte key
      expect(result).toHaveLength(32);
      // Should complete fast (< 2000ms) because we override m=64, t=1
      expect(elapsed).toBeLessThan(2000);
    });

    it('produces the same output for the same inputs (deterministic)', async () => {
      const { devArgon2Adapter } = await import('../dev-tauri-mock');
      const password = new Uint8Array([10, 20, 30]);
      const salt = new Uint8Array(16).fill(5);
      const params = { t: 2, m: 19_456, p: 1, dkLen: 32 };

      const result1 = await devArgon2Adapter.hash(password, salt, params);
      const result2 = await devArgon2Adapter.hash(password, salt, params);

      expect(result1).toEqual(result2);
    });
  });
});
