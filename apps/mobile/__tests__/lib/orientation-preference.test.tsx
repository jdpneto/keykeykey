import React from 'react';
import { Alert } from 'react-native';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  applyOrientationPreference,
  loadOrientationPreference,
  ORIENTATION_LABELS,
  OrientationPreferenceController,
  OrientationPreferenceProvider,
  saveOrientationPreference,
  useOrientationPreference,
} from '../../lib/orientation-preference';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('expo-screen-orientation', () => ({
  Orientation: {
    UNKNOWN: 0,
    PORTRAIT_UP: 1,
    PORTRAIT_DOWN: 2,
    LANDSCAPE_LEFT: 3,
    LANDSCAPE_RIGHT: 4,
  },
  OrientationLock: {
    DEFAULT: 0,
    PORTRAIT: 2,
    PORTRAIT_UP: 3,
    LANDSCAPE: 5,
  },
  getOrientationAsync: jest.fn(),
  lockAsync: jest.fn(),
  supportsOrientationLockAsync: jest.fn(),
  unlockAsync: jest.fn(),
}));

const STORAGE_KEY = 'keykeykey-orientation-preference';
const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedScreenOrientation = ScreenOrientation as jest.Mocked<typeof ScreenOrientation>;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <OrientationPreferenceProvider>{children}</OrientationPreferenceProvider>
);

describe('orientation preference storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedScreenOrientation.getOrientationAsync.mockResolvedValue(
      ScreenOrientation.Orientation.PORTRAIT_UP,
    );
    mockedScreenOrientation.supportsOrientationLockAsync.mockResolvedValue(true);
  });

  it('defaults to system when storage is empty', async () => {
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    await expect(loadOrientationPreference()).resolves.toBe('system');
    expect(mockedAsyncStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('defaults to system when storage is invalid', async () => {
    mockedAsyncStorage.getItem.mockResolvedValue('upside-down');
    await expect(loadOrientationPreference()).resolves.toBe('system');
  });

  it('saves a valid preference using the exact key', async () => {
    await saveOrientationPreference('landscape');
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'landscape');
  });

  it('applies system by unlocking without locking', async () => {
    await applyOrientationPreference('system');
    expect(mockedScreenOrientation.unlockAsync).toHaveBeenCalledTimes(1);
    expect(mockedScreenOrientation.lockAsync).not.toHaveBeenCalled();
  });

  it('applies portrait and landscape locks after support checks', async () => {
    await applyOrientationPreference('portrait');
    expect(mockedScreenOrientation.supportsOrientationLockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
    expect(mockedScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );

    jest.clearAllMocks();
    mockedScreenOrientation.supportsOrientationLockAsync.mockResolvedValue(true);

    await applyOrientationPreference('landscape');
    expect(mockedScreenOrientation.supportsOrientationLockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );
    expect(mockedScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  });

  it('maps current landscape orientation family to the landscape lock', async () => {
    mockedScreenOrientation.getOrientationAsync.mockResolvedValue(
      ScreenOrientation.Orientation.LANDSCAPE_RIGHT,
    );

    await applyOrientationPreference('current');

    expect(mockedScreenOrientation.supportsOrientationLockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );
    expect(mockedScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  });

  it('maps current non-landscape orientation family to the portrait lock', async () => {
    mockedScreenOrientation.getOrientationAsync.mockResolvedValue(
      ScreenOrientation.Orientation.PORTRAIT_DOWN,
    );

    await applyOrientationPreference('current');

    expect(mockedScreenOrientation.supportsOrientationLockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
    expect(mockedScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT_UP,
    );
  });

  it('throws the expected error for unsupported locks', async () => {
    mockedScreenOrientation.supportsOrientationLockAsync.mockResolvedValue(false);

    await expect(applyOrientationPreference('landscape')).rejects.toThrow(
      'Orientation lock landscape is not supported on this device.',
    );
    expect(mockedScreenOrientation.lockAsync).not.toHaveBeenCalled();
  });

  it('loads provider state and persists updates', async () => {
    mockedAsyncStorage.getItem.mockResolvedValue('landscape');

    const { result } = renderHook(() => useOrientationPreference(), { wrapper });

    expect(result.current.preference).toBe('system');
    await waitFor(() => expect(result.current.preference).toBe('landscape'));

    await act(async () => {
      await result.current.setPreference('portrait');
    });

    expect(result.current.preference).toBe('portrait');
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'portrait');
  });

  it('does not let a delayed initial load overwrite a user-set preference', async () => {
    let resolveStoredPreference: (value: string) => void = () => {};
    mockedAsyncStorage.getItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStoredPreference = resolve;
        }),
    );

    const { result } = renderHook(() => useOrientationPreference(), { wrapper });

    await act(async () => {
      await result.current.setPreference('portrait');
    });

    expect(result.current.preference).toBe('portrait');

    await act(async () => {
      resolveStoredPreference('landscape');
    });

    expect(result.current.preference).toBe('portrait');
  });

  it('rejects failed saves without changing provider state', async () => {
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedAsyncStorage.setItem.mockRejectedValue(new Error('storage unavailable'));

    const { result } = renderHook(() => useOrientationPreference(), { wrapper });
    await waitFor(() => expect(mockedAsyncStorage.getItem).toHaveBeenCalledWith(STORAGE_KEY));

    await act(async () => {
      await expect(result.current.setPreference('landscape')).rejects.toThrow(
        'storage unavailable',
      );
    });

    expect(result.current.preference).toBe('system');
  });

  it('throws when the hook is used outside the provider', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useOrientationPreference());
    }).toThrow('useOrientationPreference must be used within OrientationPreferenceProvider');

    errorSpy.mockRestore();
  });

  it('shows a non-blocking alert when the controller cannot apply the preference', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockedAsyncStorage.getItem.mockResolvedValue('portrait');
    mockedScreenOrientation.supportsOrientationLockAsync.mockResolvedValue(false);

    render(
      <OrientationPreferenceProvider>
        <OrientationPreferenceController />
      </OrientationPreferenceProvider>,
    );

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Orientation unavailable',
        'This device or window does not support the selected orientation lock.',
      );
    });

    alertSpy.mockRestore();
  });

  it('provides labels for settings display', () => {
    expect(ORIENTATION_LABELS).toEqual({
      system: 'System',
      portrait: 'Portrait',
      landscape: 'Landscape',
      current: 'Lock current',
    });
  });
});
