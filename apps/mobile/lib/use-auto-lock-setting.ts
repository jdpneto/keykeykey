import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'keykeykey_autoLockMinutes';
const DEFAULT_MINUTES = 5;
const ALLOWED_VALUES = new Set([0, 5, 15, 30, 60, 240]);

function parseMinutes(raw: string | null): number {
  if (raw === null) return DEFAULT_MINUTES;
  const parsed = Number(raw);
  if (!ALLOWED_VALUES.has(parsed)) return DEFAULT_MINUTES;
  return parsed;
}

export function useAutoLockSetting() {
  const [autoLockMinutes, setAutoLockMinutesState] = useState(DEFAULT_MINUTES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        setAutoLockMinutesState(parseMinutes(raw));
      })
      .catch(() => {
        // Fall back to default on storage failure — never leave loading=true
        // as that would silently disable auto-lock (security degradation).
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const setAutoLockMinutes = useCallback(async (minutes: number) => {
    if (!ALLOWED_VALUES.has(minutes)) return;
    await AsyncStorage.setItem(STORAGE_KEY, String(minutes));
    setAutoLockMinutesState(minutes);
  }, []);

  return { autoLockMinutes, setAutoLockMinutes, loading } as const;
}
