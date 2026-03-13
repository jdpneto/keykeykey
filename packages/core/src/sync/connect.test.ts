import { describe, it, expect, vi } from 'vitest';
import { connectSyncEngine } from './connect.js';
import { SyncEngine } from './sync-engine.js';
import { MemoryAdapter } from './memory-adapter.js';
import { createVaultStore } from '../store/vault-store.js';
import { createVaultHeader } from '../crypto/vault-header.js';
import { generateRecoveryKey } from '../crypto/recovery.js';
import type { Argon2Params } from '../crypto/constants.js';

const TEST_PARAMS: Argon2Params = { t: 1, m: 256, p: 1, dkLen: 32 };

async function makeUnlockedStore() {
  const { raw: recoveryRaw } = generateRecoveryKey();
  const { header } = await createVaultHeader('test-pass', recoveryRaw, TEST_PARAMS);
  const store = createVaultStore();
  store.getState().loadHeader(header);
  await store.getState().unlock('test-pass', []);
  return store;
}

describe('connectSyncEngine', () => {
  it('should schedule sync when items change', async () => {
    const store = await makeUnlockedStore();
    const engine = new SyncEngine({ adapter: new MemoryAdapter(), store });
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');

    const disconnect = connectSyncEngine(store, engine);

    store.getState().addItem({
      type: 'credential',
      name: 'Test',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(scheduleSpy).toHaveBeenCalled();
    disconnect();
  });

  it('should not schedule sync when engine is syncing', async () => {
    const store = await makeUnlockedStore();
    const engine = new SyncEngine({ adapter: new MemoryAdapter(), store });
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');
    vi.spyOn(engine, 'isSyncing').mockReturnValue(true);

    const disconnect = connectSyncEngine(store, engine);

    store.getState().addItem({
      type: 'credential',
      name: 'Test',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(scheduleSpy).not.toHaveBeenCalled();
    disconnect();
  });

  it('should not schedule sync when vault is locked', async () => {
    const store = await makeUnlockedStore();
    const engine = new SyncEngine({ adapter: new MemoryAdapter(), store });
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');

    const disconnect = connectSyncEngine(store, engine);
    store.getState().lock();

    await new Promise((r) => setTimeout(r, 10));
    expect(scheduleSpy).not.toHaveBeenCalled();
    disconnect();
  });

  it('should return a disconnect function that stops syncing', async () => {
    const store = await makeUnlockedStore();
    const engine = new SyncEngine({ adapter: new MemoryAdapter(), store });
    const scheduleSpy = vi.spyOn(engine, 'scheduleSync');

    const disconnect = connectSyncEngine(store, engine);
    disconnect();

    store.getState().addItem({
      type: 'credential',
      name: 'Test',
      tags: [],
      favorite: false,
      username: 'user',
      password: 'pass',
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(scheduleSpy).not.toHaveBeenCalled();
  });
});
