import { describe, it, expect, beforeEach } from 'vitest';
import { createBiometricAdapter } from './create-biometric-adapter.js';
import type { OSBiometricStore, LoadBytesResult } from './os-biometric-store.js';
import { MAX_DEK_AGE_MS, encodeDEKPayload } from './dek-payload.js';

type StubStore = OSBiometricStore & {
  saved: string[];
  cleared: number;
  loadResult: LoadBytesResult;
  isAvailableValue: boolean;
};

function makeStubStore(): StubStore {
  const stub: StubStore = {
    saved: [],
    cleared: 0,
    loadResult: { status: 'absent' },
    isAvailableValue: true,
    isAvailable: async () => stub.isAvailableValue,
    saveBytes: async (v: string) => {
      stub.saved.push(v);
    },
    loadBytes: async () => stub.loadResult,
    clearBytes: async () => {
      stub.cleared++;
    },
  };
  return stub;
}

describe('createBiometricAdapter', () => {
  let store: ReturnType<typeof makeStubStore>;

  beforeEach(() => {
    store = makeStubStore();
  });

  describe('isAvailable', () => {
    it('passes through to the store', async () => {
      const adapter = createBiometricAdapter(store);
      store.isAvailableValue = false;
      expect(await adapter.isAvailable()).toBe(false);
      store.isAvailableValue = true;
      expect(await adapter.isAvailable()).toBe(true);
    });
  });

  describe('saveDEK', () => {
    it('encodes the DEK as a JSON envelope and persists via the store', async () => {
      const adapter = createBiometricAdapter(store);
      await adapter.saveDEK(new Uint8Array([1, 2, 3]));
      expect(store.saved).toHaveLength(1);
      const parsed = JSON.parse(store.saved[0]!) as Record<string, unknown>;
      expect(typeof parsed.dek).toBe('string');
      expect(typeof parsed.savedAt).toBe('string');
    });
  });

  describe('loadDEK', () => {
    it('returns invalidated when the store has nothing', async () => {
      store.loadResult = { status: 'absent' };
      const adapter = createBiometricAdapter(store);
      expect(await adapter.loadDEK()).toEqual({ status: 'invalidated' });
    });

    it('returns cancelled when the store reports cancellation', async () => {
      store.loadResult = { status: 'cancelled' };
      const adapter = createBiometricAdapter(store);
      expect(await adapter.loadDEK()).toEqual({ status: 'cancelled' });
      expect(store.cleared).toBe(0); // do NOT auto-clear on cancel
    });

    it('returns invalidated AND clears bytes when the store reports invalidated', async () => {
      store.loadResult = { status: 'invalidated' };
      const adapter = createBiometricAdapter(store);
      const result = await adapter.loadDEK();
      expect(result).toEqual({ status: 'invalidated' });
      expect(store.cleared).toBe(1);
    });

    it('returns error with message on store error', async () => {
      store.loadResult = { status: 'error', message: 'hardware exploded' };
      const adapter = createBiometricAdapter(store);
      expect(await adapter.loadDEK()).toEqual({ status: 'error', message: 'hardware exploded' });
    });

    it('returns success with decoded DEK when the envelope is fresh', async () => {
      const dek = new Uint8Array([7, 8, 9]);
      store.loadResult = { status: 'ok', value: encodeDEKPayload(dek) };
      const adapter = createBiometricAdapter(store);
      const result = await adapter.loadDEK();
      expect(result.status).toBe('success');
      if (result.status === 'success') {
        expect(Array.from(result.dek)).toEqual([7, 8, 9]);
      }
    });

    it('returns invalidated AND clears bytes when the envelope is expired', async () => {
      const dek = new Uint8Array([1]);
      const ancient = new Date(Date.now() - MAX_DEK_AGE_MS - 1000);
      store.loadResult = { status: 'ok', value: encodeDEKPayload(dek, ancient) };
      const adapter = createBiometricAdapter(store);
      const result = await adapter.loadDEK();
      expect(result).toEqual({ status: 'invalidated' });
      expect(store.cleared).toBe(1);
    });

    it('returns invalidated AND clears bytes when the envelope is corrupt', async () => {
      store.loadResult = { status: 'ok', value: 'not json' };
      const adapter = createBiometricAdapter(store);
      const result = await adapter.loadDEK();
      expect(result).toEqual({ status: 'invalidated' });
      expect(store.cleared).toBe(1);
    });
  });

  describe('clearDEK', () => {
    it('passes through to the store', async () => {
      const adapter = createBiometricAdapter(store);
      await adapter.clearDEK();
      expect(store.cleared).toBe(1);
    });
  });
});
