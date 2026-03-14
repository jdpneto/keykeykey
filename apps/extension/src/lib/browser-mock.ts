/**
 * In-memory mock of browser.* APIs for testing.
 * Provides: storage.local, runtime, alarms, tabs, windows.
 */

type StorageData = Record<string, unknown>;
type Listener = (...args: unknown[]) => void;

export function createBrowserMock() {
  let storageData: StorageData = {};
  const listeners: Record<string, Listener[]> = {};
  const alarms: Record<string, { name: string; scheduledTime: number }> = {};

  return {
    storage: {
      local: {
        get: async (keys: string | string[] | null) => {
          if (keys === null) return { ...storageData };
          const keyList = typeof keys === 'string' ? [keys] : keys;
          const result: StorageData = {};
          for (const k of keyList) {
            if (k in storageData) result[k] = storageData[k];
          }
          return result;
        },
        set: async (items: StorageData) => {
          Object.assign(storageData, items);
        },
        remove: async (keys: string | string[]) => {
          const keyList = typeof keys === 'string' ? [keys] : keys;
          for (const k of keyList) delete storageData[k];
        },
      },
    },
    runtime: {
      onMessage: {
        addListener: (fn: Listener) => {
          listeners['message'] = listeners['message'] ?? [];
          listeners['message'].push(fn);
        },
        removeListener: (fn: Listener) => {
          listeners['message'] = (listeners['message'] ?? []).filter((l) => l !== fn);
        },
      },
      sendMessage: async (msg: unknown) => {
        const fns = listeners['message'] ?? [];
        for (const fn of fns) {
          return new Promise((resolve) => fn(msg, {}, resolve));
        }
      },
    },
    alarms: {
      create: (name: string, info: { delayInMinutes: number }) => {
        alarms[name] = { name, scheduledTime: Date.now() + info.delayInMinutes * 60_000 };
      },
      clear: async (name: string) => {
        delete alarms[name];
        return true;
      },
      get: async (name: string) => alarms[name] ?? null,
      onAlarm: {
        addListener: (fn: Listener) => {
          listeners['alarm'] = listeners['alarm'] ?? [];
          listeners['alarm'].push(fn);
        },
        removeListener: (fn: Listener) => {
          listeners['alarm'] = (listeners['alarm'] ?? []).filter((l) => l !== fn);
        },
      },
      _fire: (name: string) => {
        const fns = listeners['alarm'] ?? [];
        for (const fn of fns) fn({ name });
      },
    },
    tabs: {
      query: async () => [{ url: 'https://github.com/user/repo' }],
    },
    windows: {
      onRemoved: {
        addListener: (fn: Listener) => {
          listeners['windowRemoved'] = listeners['windowRemoved'] ?? [];
          listeners['windowRemoved'].push(fn);
        },
        removeListener: (fn: Listener) => {
          listeners['windowRemoved'] = (listeners['windowRemoved'] ?? []).filter((l) => l !== fn);
        },
      },
      getAll: async () => [{ id: 1 }],
    },
    _reset: () => {
      storageData = {};
      for (const key of Object.keys(listeners)) delete listeners[key];
      for (const key of Object.keys(alarms)) delete alarms[key];
    },
  };
}

export type BrowserMock = ReturnType<typeof createBrowserMock>;
