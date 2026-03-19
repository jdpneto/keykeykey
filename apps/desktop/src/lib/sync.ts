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
// We intercept fetch() and route requests through a Rust HTTP proxy command,
// but ONLY for URLs matching the configured sync server prefix. All other
// requests go through the original fetch() untouched.

interface HttpProxyResponse {
  status: number;
  headers: Record<string, string>;
  body_b64: string;
  body_text: string;
}

const originalFetch = globalThis.fetch;

/** The URL prefix that the proxy is allowed to reach. Null = proxy disabled. */
let allowedUrlPrefix: string | null = null;

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  207: 'Multi-Status',
  301: 'Moved Permanently',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

async function tauriFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';

  // Only proxy URLs matching the configured sync prefix — everything else uses native fetch
  if (!allowedUrlPrefix || !url.startsWith(allowedUrlPrefix)) {
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
    } else if (init.body instanceof ReadableStream) {
      // Consume ReadableStream into bytes
      const reader = init.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      bodyB64 = toBase64(merged);
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

  // Forward response headers from the Rust proxy
  const respHeaders = new Headers();
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      respHeaders.set(k, v);
    }
  }

  return new Response(body, {
    status: result.status,
    statusText: STATUS_TEXT[result.status] ?? (result.status < 400 ? 'OK' : 'Error'),
    headers: respHeaders,
  });
}

/**
 * Install the Tauri fetch proxy. Call once at app startup.
 * After this, fetch() calls to URLs matching the configured sync prefix
 * are routed through Rust, bypassing CORS restrictions. All other fetches
 * pass through to the browser's native fetch.
 */
export function installFetchProxy(): void {
  globalThis.fetch = tauriFetch as typeof globalThis.fetch;
}

/**
 * Set the allowed URL prefix for the fetch proxy and Rust-side SSRF validation.
 * Call when sync is configured. Pass null to disable the proxy.
 */
export async function setSyncUrlPrefix(prefix: string | null): Promise<void> {
  allowedUrlPrefix = prefix;
  await invoke('set_sync_url_prefix', { prefix });
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
