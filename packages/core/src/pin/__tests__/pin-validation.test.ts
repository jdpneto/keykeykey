import { describe, it, expect } from 'vitest';
import { validatePin } from '../pin-validation.js';

describe('validatePin', () => {
  it('accepts valid 4-digit PIN', () => {
    expect(validatePin('4829')).toEqual({ valid: true });
  });

  it('accepts valid 6-digit PIN', () => {
    expect(validatePin('482917')).toEqual({ valid: true });
  });

  it('accepts valid 8-digit PIN', () => {
    expect(validatePin('48291735')).toEqual({ valid: true });
  });

  it('rejects empty string', () => {
    const result = validatePin('');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects PIN shorter than 4 digits', () => {
    const result = validatePin('123');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/4.*8/);
  });

  it('rejects PIN longer than 8 digits', () => {
    const result = validatePin('123456789');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/4.*8/);
  });

  it('rejects non-numeric characters', () => {
    const result = validatePin('12ab');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/digits/i);
  });

  it('rejects all-same digits: 1111', () => {
    const result = validatePin('1111');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/repeated/i);
  });

  it('rejects all-same digits: 000000', () => {
    const result = validatePin('000000');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/repeated/i);
  });

  it('rejects ascending sequential: 1234', () => {
    const result = validatePin('1234');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequential/i);
  });

  it('rejects descending sequential: 4321', () => {
    const result = validatePin('4321');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequential/i);
  });

  it('rejects longer ascending sequential: 12345678', () => {
    const result = validatePin('12345678');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequential/i);
  });

  it('rejects ascending from mid-range: 3456', () => {
    const result = validatePin('3456');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/sequential/i);
  });

  it('accepts non-sequential non-repeated: 1357', () => {
    expect(validatePin('1357')).toEqual({ valid: true });
  });

  it('accepts PIN with some repeated digits: 1121', () => {
    expect(validatePin('1121')).toEqual({ valid: true });
  });
});
