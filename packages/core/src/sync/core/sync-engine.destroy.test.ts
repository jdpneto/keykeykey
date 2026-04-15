/**
 * Regression: after SyncEngine.destroy() the debounce timer scheduled by
 * scheduleSync() must not fire a sync. A stale debounce call on a destroyed
 * engine was the root cause of spurious canRestore: false mismatches during
 * mergeVaults / replaceRemote — the old engine re-ran _runSync against a blob
 * written with the new engine's mek and triggered onVaultMismatch after
 * mergeVaults had already cleared the mismatch state.
 */

import { describe, it, expect, vi } from 'vitest';
import { SyncEngine } from './sync-engine.js';
import type { SyncableStore, VaultMismatchInfo } from './sync-engine.js';
import { MemoryAdapter } from '../adapters/memory-adapter.js';
import { randomBytes } from '@noble/hashes/utils';

function stubStore(): SyncableStore {
  return {
    getState: () => ({
      status: 'unlocked',
      items: [],
      encryptItem: () => new Uint8Array(0),
      getDEK: () => new Uint8Array(32),
    }),
    setState: () => {},
    getVaultId: () => 'test-vault-id',
    subscribe: () => () => {},
  } as unknown as SyncableStore;
}

describe('SyncEngine.destroy', () => {
  it('clears the pending debounce timer so scheduleSync does not fire after teardown', async () => {
    vi.useFakeTimers();
    try {
      const adapter = new MemoryAdapter();
      const readSpy = vi.spyOn(adapter, 'readVaultBlob');
      const onVaultMismatch = vi.fn();

      const engine = new SyncEngine({
        adapter,
        store: stubStore(),
        mek: randomBytes(32),
        syncSalt: randomBytes(16),
        vaultHeaderBytes: new Uint8Array(64),
        argon2Params: { t: 1, m: 8192, p: 1, dkLen: 32 },
        onVaultMismatch,
      });

      engine.scheduleSync();
      engine.destroy();
      // Advance beyond the 2s debounce — the callback must have been cancelled.
      await vi.advanceTimersByTimeAsync(5000);

      expect(readSpy).not.toHaveBeenCalled();
      expect(onVaultMismatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sync() becomes a no-op after destroy', async () => {
    const adapter = new MemoryAdapter();
    const readSpy = vi.spyOn(adapter, 'readVaultBlob');
    const onVaultMismatch = vi.fn<[VaultMismatchInfo], void>();

    const engine = new SyncEngine({
      adapter,
      store: stubStore(),
      mek: randomBytes(32),
      syncSalt: randomBytes(16),
      vaultHeaderBytes: new Uint8Array(64),
      argon2Params: { t: 1, m: 8192, p: 1, dkLen: 32 },
      onVaultMismatch,
    });

    engine.destroy();
    await engine.sync();

    expect(readSpy).not.toHaveBeenCalled();
    expect(onVaultMismatch).not.toHaveBeenCalled();
  });

  it('does not fire its destroyed check for the current engine', async () => {
    // Sanity: a non-destroyed engine still processes _runSync normally, even
    // after a prior sync() completes.
    const adapter = new MemoryAdapter();
    const onVaultMismatch = vi.fn<[VaultMismatchInfo], void>();
    const engine = new SyncEngine({
      adapter,
      store: stubStore(),
      mek: randomBytes(32),
      syncSalt: randomBytes(16),
      vaultHeaderBytes: new Uint8Array(64),
      argon2Params: { t: 1, m: 8192, p: 1, dkLen: 32 },
      onVaultMismatch,
    });

    // No remote blob — _runSync should return empty without firing mismatch.
    await engine.sync();
    expect(onVaultMismatch).not.toHaveBeenCalled();
  });

  it('_runSync does not fire onVaultMismatch when the engine is destroyed mid-read', async () => {
    // Simulates the real race: sync() is already past its entry guard when
    // the lifecycle tears the engine down and replaces it with a fresh one.
    // The stale engine's decryption of the OLD blob against the NEW mek (or
    // decryption of the NEW blob against the OLD mek, depending on timing)
    // would otherwise fire a spurious canRestore: false mismatch.
    const adapter = new MemoryAdapter();
    // Produce an unencrypted blob — decryptVaultBlob will throw.
    await adapter.writeVaultBlob(new Uint8Array(100));

    const onVaultMismatch = vi.fn<[VaultMismatchInfo], void>();
    const engine = new SyncEngine({
      adapter,
      store: stubStore(),
      mek: randomBytes(32),
      syncSalt: randomBytes(16),
      vaultHeaderBytes: new Uint8Array(64),
      argon2Params: { t: 1, m: 8192, p: 1, dkLen: 32 },
      onVaultMismatch,
    });

    // Race readVaultBlob: destroy the engine while the read is in flight.
    const originalRead = adapter.readVaultBlob.bind(adapter);
    adapter.readVaultBlob = async () => {
      const promise = originalRead();
      engine.destroy();
      return promise;
    };

    await engine.sync();

    expect(onVaultMismatch).not.toHaveBeenCalled();
  });
});
