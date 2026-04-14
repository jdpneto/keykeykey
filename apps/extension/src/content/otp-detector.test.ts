import { describe, it, expect, afterEach } from 'vitest';
import { detectOtpFields } from './otp-detector';

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

function makeInput(attrs: Record<string, string>): HTMLInputElement {
  const input = document.createElement('input');
  for (const [k, v] of Object.entries(attrs)) {
    input.setAttribute(k, v);
  }
  document.body.appendChild(input);
  return input;
}

describe('detectOtpFields — autocomplete=one-time-code', () => {
  it('detects an input with autocomplete="one-time-code"', () => {
    const input = makeInput({ type: 'text', autocomplete: 'one-time-code' });
    expect(detectOtpFields()).toEqual([input]);
  });

  it('detects within a multi-token autocomplete string', () => {
    const input = makeInput({ type: 'text', autocomplete: 'shipping one-time-code' });
    expect(detectOtpFields()).toEqual([input]);
  });
});

describe('detectOtpFields — heuristics', () => {
  it('detects numeric inputmode + maxlength=6 + name suggests OTP', () => {
    const input = makeInput({
      type: 'text',
      inputmode: 'numeric',
      maxlength: '6',
      name: 'otp_code',
    });
    expect(detectOtpFields()).toEqual([input]);
  });

  it('detects when id matches OTP patterns', () => {
    const input = makeInput({
      type: 'text',
      inputmode: 'numeric',
      maxlength: '6',
      id: 'verification-code',
    });
    expect(detectOtpFields()).toEqual([input]);
  });

  it('detects when name says totp/2fa', () => {
    const a = makeInput({
      type: 'text',
      inputmode: 'numeric',
      maxlength: '6',
      name: 'totp',
    });
    const b = makeInput({
      type: 'text',
      inputmode: 'numeric',
      maxlength: '6',
      name: 'two_factor_code',
    });
    expect(detectOtpFields()).toEqual([a, b]);
  });

  it('accepts maxlength 6, 7, or 8 (per RFC 4226)', () => {
    const six = makeInput({
      type: 'text',
      inputmode: 'numeric',
      maxlength: '6',
      name: 'otp',
    });
    const seven = makeInput({
      type: 'text',
      inputmode: 'numeric',
      maxlength: '7',
      name: 'otp',
    });
    const eight = makeInput({
      type: 'text',
      inputmode: 'numeric',
      maxlength: '8',
      name: 'otp',
    });
    expect(detectOtpFields()).toEqual([six, seven, eight]);
  });
});

describe('detectOtpFields — negatives', () => {
  it('ignores password fields', () => {
    makeInput({ type: 'password', name: 'password' });
    expect(detectOtpFields()).toEqual([]);
  });

  it('ignores plain text inputs without OTP signal', () => {
    makeInput({ type: 'text', name: 'firstname' });
    expect(detectOtpFields()).toEqual([]);
  });

  it('ignores numeric inputs that are too long to be a TOTP code', () => {
    // Phone number, credit card, etc. — never an OTP code.
    makeInput({ type: 'text', inputmode: 'numeric', maxlength: '16', name: 'card-number' });
    expect(detectOtpFields()).toEqual([]);
  });

  it('does not match the same input twice', () => {
    // autocomplete + heuristics could otherwise both fire.
    const input = makeInput({
      type: 'text',
      autocomplete: 'one-time-code',
      inputmode: 'numeric',
      maxlength: '6',
      name: 'otp',
    });
    expect(detectOtpFields()).toEqual([input]);
  });
});
