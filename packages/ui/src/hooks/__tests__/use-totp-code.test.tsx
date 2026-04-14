import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTotpCode } from '../use-totp-code.js';

// 1_700_000_010 is exactly on a 30s boundary (1_700_000_010 / 30 === 56_666_667),
// so add 10s to sit 10s into the window and give us a 20s countdown.
const BASE_TIME_MS = 1_700_000_020_000;

describe('useTotpCode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null state for empty input', () => {
    const { result } = renderHook(() => useTotpCode(''));
    expect(result.current.code).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.remainingSeconds).toBe(0);
  });

  it('generates a code from a canonical otpauth URI', () => {
    const uri = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
    const { result } = renderHook(() => useTotpCode(uri));

    expect(result.current.error).toBeNull();
    expect(result.current.code).toMatch(/^\d{6}$/);
    expect(result.current.issuer).toBe('Example');
    expect(result.current.label).toBe('Example:alice@example.com');
    expect(result.current.remainingSeconds).toBe(20);
  });

  it('accepts a raw Base32 secret with RFC defaults', () => {
    const { result } = renderHook(() => useTotpCode('JBSWY3DPEHPK3PXP'));
    expect(result.current.error).toBeNull();
    expect(result.current.code).toMatch(/^\d{6}$/);
    expect(result.current.remainingSeconds).toBe(20);
  });

  it('ticks the countdown every second and rotates the code at the period boundary', () => {
    const uri = 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP';
    const { result } = renderHook(() => useTotpCode(uri));

    const initialCode = result.current.code;
    expect(result.current.remainingSeconds).toBe(20);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current.remainingSeconds).toBe(15);
    expect(result.current.code).toBe(initialCode);

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    // Now 30s into the walltime => period rollover; a new code appears.
    expect(result.current.remainingSeconds).toBe(30);
    expect(result.current.code).not.toBe(initialCode);
  });

  it('recomputes when the input changes', () => {
    const uriA = 'otpauth://totp/a?secret=JBSWY3DPEHPK3PXP';
    const uriB = 'otpauth://totp/b?secret=KRSXG5CTMVRXEZLU'; // "Test-1234"

    const { result, rerender } = renderHook(({ uri }: { uri: string }) => useTotpCode(uri), {
      initialProps: { uri: uriA },
    });

    const first = result.current.code;
    rerender({ uri: uriB });
    expect(result.current.code).not.toBe(first);
    expect(result.current.code).toMatch(/^\d{6}$/);
  });

  it('surfaces parse errors without throwing', () => {
    const { result } = renderHook(() => useTotpCode('not an otpauth uri!'));
    expect(result.current.code).toBeNull();
    expect(result.current.error).toMatch(/base32/i);
  });

  it('stops its interval on unmount', () => {
    const uri = 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP';
    const { result, unmount } = renderHook(() => useTotpCode(uri));
    const snapshot = result.current.code;

    unmount();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // After unmount, state is frozen — no re-render, code stays what it was.
    expect(result.current.code).toBe(snapshot);
  });
});
