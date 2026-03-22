import { useState, useCallback } from 'react';

const STORAGE_KEY = 'keykeykey_autoLockMinutes';
const DEFAULT_MINUTES = 60;

function readFromStorage(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_MINUTES;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_MINUTES;
  return parsed;
}

export function useAutoLockSetting() {
  const [autoLockMinutes, setAutoLockMinutesState] = useState(readFromStorage);

  const setAutoLockMinutes = useCallback((minutes: number) => {
    localStorage.setItem(STORAGE_KEY, String(minutes));
    setAutoLockMinutesState(minutes);
  }, []);

  return { autoLockMinutes, setAutoLockMinutes } as const;
}
