import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { setupPin, unwrapDekWithPin } from '../pin-unlock.js';
import { validatePin } from '../pin-validation.js';

// Generate valid PINs: 4-8 digits, not all same, not sequential
const validPinArb = fc
  .integer({ min: 4, max: 8 })
  .chain((len) =>
    fc.string({ minLength: len, maxLength: len, unit: fc.constantFrom(...'0123456789'.split('')) }),
  )
  .filter((pin) => validatePin(pin).valid);

describe('PIN DEK wrapping (property-based)', () => {
  it('round-trips for any valid PIN and random DEK', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        validPinArb,
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        async (pin, dek) => {
          const pinData = await setupPin(pin, dek);
          const recovered = await unwrapDekWithPin(pin, pinData);
          expect(recovered).toEqual(dek);
        },
      ),
      { numRuns: 3 }, // Argon2id is slow, keep runs low
    );
  });

  it('wrong PIN never returns the original DEK', { timeout: 120_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        validPinArb,
        validPinArb,
        fc.uint8Array({ minLength: 32, maxLength: 32 }),
        async (pin1, pin2, dek) => {
          fc.pre(pin1 !== pin2);
          const pinData = await setupPin(pin1, dek);
          const result = await unwrapDekWithPin(pin2, pinData);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 2 },
    );
  });
});
