import { describe, it, expect } from 'vitest';
import { wrapDekWithPin, unwrapDekWithPin } from './pin.js';

describe('PIN DEK wrapping', () => {
  const testDek = new Uint8Array(32);
  testDek.fill(0xab);

  it('should round-trip wrap and unwrap DEK with correct PIN', async () => {
    const pin = '1234';
    const { wrappedDek, salt } = await wrapDekWithPin(testDek, pin);
    expect(wrappedDek).toBeTruthy();
    expect(salt).toBeTruthy();

    const recovered = await unwrapDekWithPin(wrappedDek, salt, pin);
    expect(recovered).toEqual(testDek);
  });

  it('should fail to unwrap with wrong PIN', async () => {
    const { wrappedDek, salt } = await wrapDekWithPin(testDek, '1234');
    await expect(unwrapDekWithPin(wrappedDek, salt, '9999')).rejects.toThrow();
  });

  it('should produce different output for different PINs', { timeout: 30_000 }, async () => {
    const result1 = await wrapDekWithPin(testDek, '1234');
    const result2 = await wrapDekWithPin(testDek, '5678');
    // Different PINs + different random salts = different wrapped DEKs
    expect(result1.wrappedDek).not.toEqual(result2.wrappedDek);
  });
});
