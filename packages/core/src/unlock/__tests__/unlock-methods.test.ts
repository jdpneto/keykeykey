import { describe, it, expect } from 'vitest';
import { getDefaultMethod, type UnlockAvailability } from '../unlock-methods.js';

describe('getDefaultMethod', () => {
  it('returns biometric when all methods available', () => {
    const availability: UnlockAvailability = { biometric: true, pin: true, password: true };
    expect(getDefaultMethod(availability)).toBe('biometric');
  });

  it('returns pin when biometric unavailable', () => {
    const availability: UnlockAvailability = { biometric: false, pin: true, password: true };
    expect(getDefaultMethod(availability)).toBe('pin');
  });

  it('returns password when only password available', () => {
    const availability: UnlockAvailability = { biometric: false, pin: false, password: true };
    expect(getDefaultMethod(availability)).toBe('password');
  });

  it('returns password when nothing else available', () => {
    const availability: UnlockAvailability = { biometric: false, pin: false, password: false };
    expect(getDefaultMethod(availability)).toBe('password');
  });

  it('returns biometric over pin when both available', () => {
    const availability: UnlockAvailability = { biometric: true, pin: true, password: true };
    expect(getDefaultMethod(availability)).toBe('biometric');
  });
});
