/**
 * dev-tauri-mock.ts — In-browser Tauri IPC stub (dev only)
 *
 * When the desktop Vite dev server is visited in a plain browser (no Tauri
 * runtime), `window.__TAURI_INTERNALS__` is undefined, so every `invoke`
 * call throws immediately and the app hangs on the boot spinner. This module
 * installs a minimal localStorage-backed mock of the Tauri IPC surface so the
 * full React UI can run in a browser — useful for Playwright E2E specs that
 * test against the Vite dev server (project=desktop).
 *
 * Guard: only active in development builds AND when no Tauri runtime is
 * present. In production the entire module is dead-code-eliminated by Vite
 * because every code path is behind `import.meta.env.DEV`.
 *
 * This module also exports `devArgon2Adapter` — a lightweight argon2id adapter
 * using minimal KDF parameters (t=1, m=64) so vault creation/unlock in E2E
 * tests completes in milliseconds instead of the 10–30 seconds the full
 * m=19456 pure-TS argon2 takes on a browser main thread.
 */

import { jsArgon2Adapter } from '@keykeykey/core';
import type { Argon2Adapter } from '@keykeykey/core';

/** The shape `@tauri-apps/api/core` delegates to. */
interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>, options?: unknown): Promise<T>;
  transformCallback(callback: (...args: unknown[]) => unknown, once?: boolean): number;
  [key: string]: unknown;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const PREFIX = 'devmock:';
const KEY_SETUP_COMPLETE = `${PREFIX}vault_setup_complete`;
const KEY_VAULT_HEADER = `${PREFIX}vault_header`;
const KEY_ITEMS = `${PREFIX}encrypted_items`;
const KEY_SYNC_CONFIG = `${PREFIX}sync_config`;

// Generic keyring map: devmock:keyring:<key>
function keyringKey(key: string): string {
  return `${PREFIX}keyring:${key}`;
}

// ---------------------------------------------------------------------------
// StoredItem shape (must match tauri-storage.ts)
// ---------------------------------------------------------------------------

interface StoredItem {
  id: string;
  type: string;
  encrypted_data: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Items map helper
// ---------------------------------------------------------------------------

function loadItemsMap(): Record<string, StoredItem> {
  try {
    const raw = localStorage.getItem(KEY_ITEMS);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, StoredItem>;
  } catch {
    return {};
  }
}

function saveItemsMap(map: Record<string, StoredItem>): void {
  localStorage.setItem(KEY_ITEMS, JSON.stringify(map));
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

function dispatch<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  switch (cmd) {
    // --- Vault setup flag ---
    case 'is_vault_setup_complete': {
      const val = localStorage.getItem(KEY_SETUP_COMPLETE);
      return Promise.resolve((val === 'true') as unknown as T);
    }
    case 'set_vault_setup_complete': {
      localStorage.setItem(KEY_SETUP_COMPLETE, String(args.complete));
      return Promise.resolve(undefined as unknown as T);
    }

    // --- Vault header ---
    case 'save_vault_header': {
      const data = args.data as string | undefined;
      if (data !== undefined && data !== '') {
        localStorage.setItem(KEY_VAULT_HEADER, data);
      } else {
        localStorage.removeItem(KEY_VAULT_HEADER);
      }
      return Promise.resolve(undefined as unknown as T);
    }
    case 'load_vault_header': {
      const val = localStorage.getItem(KEY_VAULT_HEADER);
      return Promise.resolve((val ?? null) as unknown as T);
    }

    // --- Encrypted items ---
    case 'save_encrypted_item': {
      const map = loadItemsMap();
      const id = args.id as string;
      const now = new Date().toISOString();
      map[id] = {
        id,
        type: args.itemType as string,
        encrypted_data: args.dataB64 as string,
        created_at: (args.createdAt as string | undefined) ?? now,
        updated_at: (args.updatedAt as string | undefined) ?? now,
      };
      saveItemsMap(map);
      return Promise.resolve(undefined as unknown as T);
    }
    case 'load_all_encrypted_items': {
      const map = loadItemsMap();
      return Promise.resolve(Object.values(map) as unknown as T);
    }
    case 'delete_encrypted_item': {
      const map = loadItemsMap();
      delete map[args.id as string];
      saveItemsMap(map);
      return Promise.resolve(undefined as unknown as T);
    }

    // --- Keyring (generic key/value store) ---
    case 'save_to_keyring': {
      localStorage.setItem(keyringKey(args.key as string), args.value as string);
      return Promise.resolve(undefined as unknown as T);
    }
    case 'load_from_keyring': {
      const val = localStorage.getItem(keyringKey(args.key as string));
      return Promise.resolve((val ?? null) as unknown as T);
    }
    case 'delete_from_keyring': {
      localStorage.removeItem(keyringKey(args.key as string));
      return Promise.resolve(undefined as unknown as T);
    }

    // --- Biometric — always reports "not available" in browser ---
    case 'biometric_is_available': {
      return Promise.resolve(false as unknown as T);
    }
    case 'biometric_save_dek':
    case 'biometric_clear_dek': {
      return Promise.resolve(undefined as unknown as T);
    }
    case 'biometric_load_dek': {
      return Promise.resolve(null as unknown as T);
    }

    // --- Sync config ---
    case 'save_sync_config': {
      localStorage.setItem(KEY_SYNC_CONFIG, args.dataB64 as string);
      return Promise.resolve(undefined as unknown as T);
    }
    case 'load_sync_config': {
      const val = localStorage.getItem(KEY_SYNC_CONFIG);
      return Promise.resolve((val ?? null) as unknown as T);
    }
    case 'delete_sync_config': {
      localStorage.removeItem(KEY_SYNC_CONFIG);
      return Promise.resolve(undefined as unknown as T);
    }

    // --- Fetch proxy / sync URL prefix ---
    // These are only triggered during sync operations; the mock ignores them
    // so boot/setup/unlock/CRUD work without erroring.
    case 'set_sync_url_prefix': {
      return Promise.resolve(undefined as unknown as T);
    }

    // --- Argon2 hash command (only reached if tauri adapter is used by mistake) ---
    case 'argon2_hash': {
      return Promise.reject(
        new Error(
          'dev-tauri-mock: argon2_hash should not be invoked in browser mode — ' +
            'ensure jsArgon2Adapter is installed via setArgon2Adapter()',
        ),
      );
    }

    // --- Clipboard ---
    case 'clear_clipboard': {
      return Promise.resolve(undefined as unknown as T);
    }

    default:
      return Promise.reject(new Error(`dev-tauri-mock: unhandled command "${cmd}"`));
  }
}

// ---------------------------------------------------------------------------
// Dev argon2 adapter — fast KDF for E2E / browser dev mode
// ---------------------------------------------------------------------------

/**
 * Lightweight Argon2id adapter for dev/browser mode.
 *
 * Uses t=1, m=64 (minimum viable params) instead of the production m=19456
 * so vault creation and unlock complete in milliseconds in a browser tab.
 * Vault headers written with these params are only valid in dev mode —
 * they must never leak into production vaults.
 *
 * This adapter is only exported (and used by main.tsx) when
 * `installDevTauriMock()` returns true, i.e., DEV mode without Tauri.
 */
export const devArgon2Adapter: Argon2Adapter = {
  async hash(password, salt, params) {
    return jsArgon2Adapter.hash(password, salt, {
      ...params,
      // Override memory and time costs for fast browser execution.
      // 64 KiB is the argon2 minimum; 1 iteration is the minimum time cost.
      m: 64,
      t: 1,
    });
  },
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Install the in-browser Tauri IPC mock.
 *
 * Returns `true` if the mock was installed (dev mode, no Tauri runtime),
 * `false` otherwise (production or Tauri runtime is present).
 *
 * Call this once at app boot, before any Tauri `invoke` is executed.
 */
export function installDevTauriMock(): boolean {
  if (!import.meta.env.DEV) return false;
  if (window.__TAURI_INTERNALS__ !== undefined) return false;

  console.log('[dev-tauri-mock] Tauri runtime not detected — using in-browser mock (dev only)');

  let callbackIdCounter = 0;

  window.__TAURI_INTERNALS__ = {
    invoke<T>(cmd: string, args?: Record<string, unknown>, _options?: unknown): Promise<T> {
      return dispatch<T>(cmd, args ?? {});
    },
    transformCallback(callback: (...args: unknown[]) => unknown, _once?: boolean): number {
      const id = ++callbackIdCounter;
      // Store on window so Tauri's Channel cleanup can reach it (best-effort)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any)[`__TAURI_CB_${id}`] = callback;
      return id;
    },
  };

  return true;
}
