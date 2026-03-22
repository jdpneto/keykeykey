import { useState, useCallback } from 'react';

const STORAGE_KEY = 'keykeykey_autoLockMinutes';
const DEFAULT_MINUTES = 60;
const ALLOWED_VALUES = new Set([0, 5, 15, 30, 60, 240, 480, 1440]);

function readFromStorage(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_MINUTES;
  const parsed = Number(raw);
  if (!ALLOWED_VALUES.has(parsed)) return DEFAULT_MINUTES;
  return parsed;
}

export function useAutoLockSetting() {
  const [autoLockMinutes, setAutoLockMinutesState] = useState(readFromStorage);

  const setAutoLockMinutes = useCallback((minutes: number) => {
    if (!ALLOWED_VALUES.has(minutes)) return;
    localStorage.setItem(STORAGE_KEY, String(minutes));
    setAutoLockMinutesState(minutes);
  }, []);

  return { autoLockMinutes, setAutoLockMinutes } as const;
}
