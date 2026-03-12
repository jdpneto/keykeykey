import { describe, it, expect, afterEach } from 'vitest';
import {
  setArgon2Adapter,
  jsArgon2Adapter,
  getArgon2Adapter,
  type Argon2Adapter,
} from './argon2-adapter.js';

describe('Argon2 adapter', () => {
  afterEach(() => {
    // Reset to default after each test
    setArgon2Adapter(jsArgon2Adapter);
  });

  it('should default to JS adapter', () => {
    expect(getArgon2Adapter()).toBe(jsArgon2Adapter);
  });

  it('should allow setting a custom adapter', () => {
    const mockAdapter: Argon2Adapter = {
      hash: async () => new Uint8Array(32),
    };
    setArgon2Adapter(mockAdapter);
    expect(getArgon2Adapter()).toBe(mockAdapter);
  });

  it('JS adapter should produce correct output', async () => {
    const password = new TextEncoder().encode('test');
    const salt = new Uint8Array(16).fill(0xab);
    const result = await jsArgon2Adapter.hash(password, salt, {
      t: 1,
      m: 256,
      p: 1,
      dkLen: 32,
    });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(32);
  });

  it('JS adapter should produce deterministic output', async () => {
    const password = new TextEncoder().encode('deterministic');
    const salt = new Uint8Array(16).fill(0x42);
    const params = { t: 1, m: 256, p: 1, dkLen: 32 };

    const result1 = await jsArgon2Adapter.hash(password, salt, params);
    const result2 = await jsArgon2Adapter.hash(password, salt, params);

    expect(result1).toEqual(result2);
  });

  it('custom adapter should be used by getArgon2Adapter', async () => {
    const customOutput = new Uint8Array(32).fill(0xff);
    const customAdapter: Argon2Adapter = {
      hash: async () => customOutput,
    };

    setArgon2Adapter(customAdapter);
    const adapter = getArgon2Adapter();
    const result = await adapter.hash(new Uint8Array(0), new Uint8Array(16), {
      t: 1,
      m: 256,
      p: 1,
      dkLen: 32,
    });

    expect(result).toBe(customOutput);
  });
});
