import { renderHook, act } from '@testing-library/react';
import { useAutoLockSetting } from '../use-auto-lock-setting';

const STORAGE_KEY = 'keykeykey_autoLockMinutes';

describe('useAutoLockSetting', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns 60 as default when nothing stored', () => {
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.autoLockMinutes).toBe(60);
  });

  it('reads persisted value from localStorage', () => {
    localStorage.setItem(STORAGE_KEY, '15');
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.autoLockMinutes).toBe(15);
  });

  it('persists value to localStorage on set', () => {
    const { result } = renderHook(() => useAutoLockSetting());
    act(() => result.current.setAutoLockMinutes(30));
    expect(result.current.autoLockMinutes).toBe(30);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('30');
  });

  it('falls back to default for non-numeric value', () => {
    localStorage.setItem(STORAGE_KEY, 'banana');
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.autoLockMinutes).toBe(60);
  });

  it('falls back to default for negative value', () => {
    localStorage.setItem(STORAGE_KEY, '-5');
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.autoLockMinutes).toBe(60);
  });

  it('allows 0 (Never)', () => {
    const { result } = renderHook(() => useAutoLockSetting());
    act(() => result.current.setAutoLockMinutes(0));
    expect(result.current.autoLockMinutes).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
  });
});
