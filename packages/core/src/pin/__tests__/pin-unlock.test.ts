import { describe, it, expect } from 'vitest';
import { setupPin, unwrapDekWithPin, MAX_PIN_ATTEMPTS } from '../pin-unlock.js';

describe('PIN DEK wrapping', () => {
  const testDek = new Uint8Array(32);
  testDek.fill(0xab);

  it('round-trips wrap and unwrap with correct PIN', async () => {
    const pinData = await setupPin('4829', testDek);
    expect(pinData.wrappedDEK).toBeInstanceOf(Uint8Array);
    expect(pinData.salt).toBeInstanceOf(Uint8Array);
    expect(pinData.salt.length).toBe(16);

    const recovered = await unwrapDekWithPin('4829', pinData);
    expect(recovered).toEqual(testDek);
  });

  it('returns null for wrong PIN', async () => {
    const pinData = await setupPin('4829', testDek);
    const result = await unwrapDekWithPin('9999', pinData);
    expect(result).toBeNull();
  });

  it('produces different wrapped DEKs for different PINs', { timeout: 30_000 }, async () => {
    const result1 = await setupPin('4829', testDek);
    const result2 = await setupPin('7531', testDek);
    expect(result1.wrappedDEK).not.toEqual(result2.wrappedDEK);
  });

  it(
    'produces different wrapped DEKs for same PIN (different salts)',
    { timeout: 30_000 },
    async () => {
      const result1 = await setupPin('4829', testDek);
      const result2 = await setupPin('4829', testDek);
      expect(result1.salt).not.toEqual(result2.salt);
      expect(result1.wrappedDEK).not.toEqual(result2.wrappedDEK);
    },
  );

  it('does not mutate the input DEK', async () => {
    const dek = new Uint8Array(32);
    dek.fill(0xcd);
    const original = new Uint8Array(dek);
    await setupPin('4829', dek);
    expect(dek).toEqual(original);
  });

  it('exports MAX_PIN_ATTEMPTS as 5', () => {
    expect(MAX_PIN_ATTEMPTS).toBe(5);
  });

  it('rejects invalid PIN in setupPin', async () => {
    const dek = new Uint8Array(32);
    await expect(setupPin('1234', dek)).rejects.toThrow(/sequential/i);
  });

  it('rejects too-short PIN in setupPin', async () => {
    const dek = new Uint8Array(32);
    await expect(setupPin('12', dek)).rejects.toThrow(/Invalid PIN/);
  });
});
