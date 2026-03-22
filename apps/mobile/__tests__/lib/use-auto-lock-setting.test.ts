import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAutoLockSetting } from '../../lib/use-auto-lock-setting';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

const STORAGE_KEY = 'keykeykey_autoLockMinutes';

describe('useAutoLockSetting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('returns loading=true initially, then resolves to default 5', async () => {
    const { result } = renderHook(() => useAutoLockSetting());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoLockMinutes).toBe(5);
  });

  it('reads persisted value from AsyncStorage', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('30');
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoLockMinutes).toBe(30);
  });

  it('persists value to AsyncStorage on set', async () => {
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.setAutoLockMinutes(15));
    expect(result.current.autoLockMinutes).toBe(15);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '15');
  });

  it('falls back to default for non-numeric value', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('banana');
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoLockMinutes).toBe(5);
  });

  it('falls back to default for negative value', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('-5');
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.autoLockMinutes).toBe(5);
  });

  it('allows 0 (Never)', async () => {
    const { result } = renderHook(() => useAutoLockSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.setAutoLockMinutes(0));
    expect(result.current.autoLockMinutes).toBe(0);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, '0');
  });
});
