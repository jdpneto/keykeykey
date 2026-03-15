import { describe, it, expect } from 'vitest';
import { setupPin, unwrapDekWithPin } from '@keykeykey/core/pin';

describe('PIN DEK wrapping (core)', () => {
  const testDek = new Uint8Array(32);
  testDek.fill(0xab);

  it('should round-trip wrap and unwrap DEK with correct PIN', async () => {
    const pin = '4829';
    const pinData = await setupPin(pin, testDek);
    expect(pinData.wrappedDEK).toBeTruthy();
    expect(pinData.salt).toBeTruthy();

    const recovered = await unwrapDekWithPin(pin, pinData);
    expect(recovered).toEqual(testDek);
  });

  it('should return null for wrong PIN', async () => {
    const pinData = await setupPin('4829', testDek);
    const result = await unwrapDekWithPin('9999', pinData);
    expect(result).toBeNull();
  });

  it('should produce different output for different PINs', { timeout: 30_000 }, async () => {
    const result1 = await setupPin('4829', testDek);
    const result2 = await setupPin('7531', testDek);
    expect(result1.wrappedDEK).not.toEqual(result2.wrappedDEK);
  });
});
