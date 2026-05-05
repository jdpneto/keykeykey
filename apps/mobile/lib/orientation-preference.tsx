import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

export type OrientationPreference = 'system' | 'portrait' | 'landscape' | 'current';

type OrientationPreferenceContextValue = {
  preference: OrientationPreference;
  setPreference: (next: OrientationPreference) => Promise<void>;
};

const STORAGE_KEY = 'keykeykey-orientation-preference';
const VALID_PREFERENCES = new Set<OrientationPreference>([
  'system',
  'portrait',
  'landscape',
  'current',
]);

export const ORIENTATION_LABELS: Record<OrientationPreference, string> = {
  system: 'System',
  portrait: 'Portrait',
  landscape: 'Landscape',
  current: 'Lock current',
};

const OrientationPreferenceContext = createContext<OrientationPreferenceContextValue | null>(null);

function parseOrientationPreference(raw: string | null): OrientationPreference {
  if (raw === null) return 'system';
  if (VALID_PREFERENCES.has(raw as OrientationPreference)) return raw as OrientationPreference;
  return 'system';
}

async function lockSupportedOrientation(
  preference: OrientationPreference,
  lock: ScreenOrientation.OrientationLock,
): Promise<void> {
  const supported = await ScreenOrientation.supportsOrientationLockAsync(lock);
  if (!supported) {
    throw new Error(`Orientation lock ${preference} is not supported on this device.`);
  }
  await ScreenOrientation.lockAsync(lock);
}

export async function loadOrientationPreference(): Promise<OrientationPreference> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return parseOrientationPreference(raw);
  } catch {
    return 'system';
  }
}

export async function saveOrientationPreference(
  preference: OrientationPreference,
): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, preference);
}

export async function applyOrientationPreference(
  preference: OrientationPreference,
): Promise<void> {
  if (preference === 'system') {
    await ScreenOrientation.unlockAsync();
    return;
  }

  if (preference === 'portrait') {
    await lockSupportedOrientation(preference, ScreenOrientation.OrientationLock.PORTRAIT_UP);
    return;
  }

  if (preference === 'landscape') {
    await lockSupportedOrientation(preference, ScreenOrientation.OrientationLock.LANDSCAPE);
    return;
  }

  const currentOrientation = await ScreenOrientation.getOrientationAsync();
  const currentLock =
    currentOrientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
    currentOrientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
      ? ScreenOrientation.OrientationLock.LANDSCAPE
      : ScreenOrientation.OrientationLock.PORTRAIT_UP;

  await lockSupportedOrientation(preference, currentLock);
}

export function OrientationPreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [preference, setPreferenceState] = useState<OrientationPreference>('system');
  const hasInSessionPreferenceRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    loadOrientationPreference()
      .then((storedPreference) => {
        if (mounted && !hasInSessionPreferenceRef.current) {
          setPreferenceState(storedPreference);
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = useCallback(async (next: OrientationPreference) => {
    hasInSessionPreferenceRef.current = true;
    try {
      await saveOrientationPreference(next);
      setPreferenceState(next);
    } catch (error) {
      hasInSessionPreferenceRef.current = false;
      throw error;
    }
  }, []);

  return (
    <OrientationPreferenceContext.Provider value={{ preference, setPreference }}>
      {children}
    </OrientationPreferenceContext.Provider>
  );
}

export function OrientationPreferenceController() {
  const { preference } = useOrientationPreference();

  useEffect(() => {
    let mounted = true;

    applyOrientationPreference(preference).catch(() => {
      if (!mounted) return;
      Alert.alert(
        'Orientation unavailable',
        'This device or window does not support the selected orientation lock.',
      );
    });

    return () => {
      mounted = false;
    };
  }, [preference]);

  return null;
}

export function useOrientationPreference(): OrientationPreferenceContextValue {
  const context = useContext(OrientationPreferenceContext);
  if (!context) {
    throw new Error('useOrientationPreference must be used within OrientationPreferenceProvider');
  }
  return context;
}
