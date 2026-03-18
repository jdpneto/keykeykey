import { invoke } from '@tauri-apps/api/core';
import { encryptSyncConfig, decryptSyncConfig, DEFAULT_SYNC_CONFIG } from '@keykeykey/core/sync';
import type { SyncConfig } from '@keykeykey/core/sync';

// Re-export shared helpers from core for vault-context to use
export { createSyncEngineFromConfig, initSyncEngine } from '@keykeykey/core/sync';

// ---------------------------------------------------------------------------
// Tauri fetch proxy — bypasses CORS for WebDAV/sync HTTP requests
// ---------------------------------------------------------------------------
// Tauri's webview runs in a browser context where fetch() is subject to CORS.
// WebDAV servers typically don't support CORS preflight (OPTIONS without auth).
// We intercept fetch() and route requests through a Rust HTTP proxy command.

interface HttpProxyResponse {
  status: number;
  body_b64: string;
  body_text: string;
}

const originalFetch = globalThis.fetch;

async function tauriFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';

  // Only proxy external HTTP(S) requests — let Tauri/Vite internal requests through
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return originalFetch(input, init);
  }

  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        headers[k] = v;
      }
    } else {
      Object.assign(headers, init.headers);
    }
  }

  let bodyB64: string | undefined;
  let bodyText: string | undefined;
  if (init?.body) {
    if (init.body instanceof Uint8Array) {
      bodyB64 = toBase64(init.body);
    } else if (typeof init.body === 'string') {
      bodyText = init.body;
    } else if (init.body instanceof ArrayBuffer) {
      bodyB64 = toBase64(new Uint8Array(init.body));
    }
  }

  const result = await invoke<HttpProxyResponse>('http_proxy', {
    req: { url, method, headers, body_b64: bodyB64 ?? null, body_text: bodyText ?? null },
  });

  // HTTP 204 (No Content) and 304 (Not Modified) must not have a body per spec.
  // The browser will throw "Response cannot have a body with the given status" otherwise.
  const nullBodyStatuses = [101, 204, 205, 304];
  const body = nullBodyStatuses.includes(result.status)
    ? null
    : result.body_b64
      ? fromBase64(result.body_b64)
      : new Uint8Array(0);

  return new Response(body, {
    status: result.status,
    statusText: result.status >= 200 && result.status < 300 ? 'OK' : 'Error',
  });
}

/**
 * Install the Tauri fetch proxy. Call once at app startup.
 * After this, all fetch() calls to external URLs are routed through Rust,
 * bypassing CORS restrictions.
 */
export function installFetchProxy(): void {
  globalThis.fetch = tauriFetch as typeof globalThis.fetch;
}

// --- Sync config persistence via Tauri invoke commands ---

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function loadSyncConfig(dek: Uint8Array): Promise<SyncConfig> {
  const b64 = await invoke<string | null>('load_sync_config');
  if (!b64) return DEFAULT_SYNC_CONFIG;
  try {
    return decryptSyncConfig(fromBase64(b64), dek);
  } catch {
    return DEFAULT_SYNC_CONFIG; // Corrupted config, reset to default
  }
}

export async function saveSyncConfig(config: SyncConfig, dek: Uint8Array): Promise<void> {
  const encrypted = encryptSyncConfig(config, dek);
  await invoke('save_sync_config', { dataB64: toBase64(encrypted) });
}

export async function clearSyncConfigData(): Promise<void> {
  await invoke('delete_sync_config');
}
