/**
 * Tauri fetch proxy — bypasses CORS for sync HTTP requests.
 *
 * Tauri's webview runs in a browser context where `fetch()` is subject to CORS.
 * Most WebDAV servers don't support CORS preflight (`OPTIONS` without auth) and
 * Google/Dropbox/OneDrive token endpoints reject browser-origin requests
 * outright. We patch `globalThis.fetch` so URLs matching the configured sync
 * prefix are routed through a Rust HTTP command (`http_proxy`); everything
 * else uses the original fetch untouched.
 *
 * This module owns *all* fetch-proxy state — the patched fetch handle, the
 * allowed URL prefix, and the HTTPS→HTTP downgrade flag — inside a closure
 * created by `createFetchProxy()`. A module-level singleton (`defaultProxy`)
 * provides the production singletons that production callers import; tests
 * construct fresh instances with injected `invoke`/`baseFetch` to avoid
 * mutating real `globalThis.fetch`.
 */

import { invoke } from '@tauri-apps/api/core';
import { fromBase64, toBase64 } from '@keykeykey/core/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HttpProxyResponse {
  status: number;
  headers: Record<string, string>;
  body_b64: string;
  body_text: string;
}

/** Generic shape of `@tauri-apps/api/core`'s `invoke`. */
type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

export interface FetchProxy {
  /** Patch `globalThis.fetch` so prefix-matching URLs route through Tauri. Idempotent. */
  install(): void;
  /**
   * Set the URL prefix the proxy is allowed to reach (also informs the Rust
   * SSRF gate). `null` disables proxying — every fetch falls through to the
   * original.
   */
  setUrlPrefix(prefix: string | null): Promise<void>;
  /** Whether the proxy observed an HTTPS→HTTP downgrade since the flag was last cleared. */
  wasSchemeDowngradeDetected(): boolean;
  /** Reset the downgrade flag (e.g. when the user dismisses the warning). */
  clearSchemeDowngradeFlag(): void;
  /**
   * The proxied fetch function itself. Production callers don't touch this —
   * `install()` puts it on `globalThis.fetch`. Tests use it to exercise the
   * proxy without patching globals.
   */
  proxiedFetch: typeof globalThis.fetch;
}

export interface FetchProxyDeps {
  /** Override Tauri's `invoke` (tests use this to assert against a mock). */
  invoke?: TauriInvoke;
  /** Base fetch for non-prefix-matching URLs. Defaults to `globalThis.fetch` at install time. */
  baseFetch?: typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// Status text mapping (browsers reject `Response` with a missing/blank statusText)
// ---------------------------------------------------------------------------

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

/** HTTP statuses that the `Response` constructor refuses to pair with a body. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

const SCHEME_DOWNGRADE_HEADER = 'x-keykeykey-scheme-downgrade';

// ---------------------------------------------------------------------------
// Body marshalling — the Rust side speaks base64 bytes or plain text
// ---------------------------------------------------------------------------

interface MarshalledBody {
  bodyB64?: string;
  bodyText?: string;
}

async function marshalBody(body: BodyInit | null | undefined): Promise<MarshalledBody> {
  if (!body) return {};
  if (body instanceof Uint8Array) return { bodyB64: toBase64(body) };
  if (typeof body === 'string') return { bodyText: body };
  if (body instanceof ArrayBuffer) return { bodyB64: toBase64(new Uint8Array(body)) };
  if (body instanceof ReadableStream) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return { bodyB64: toBase64(merged) };
  }
  // FormData / Blob / URLSearchParams aren't used by sync today; let them fall
  // through to the proxy as an unset body rather than silently corrupting them.
  return {};
}

function marshalHeaders(init: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!init) return headers;
  if (init instanceof Headers) {
    init.forEach((v, k) => {
      headers[k] = v;
    });
    return headers;
  }
  if (Array.isArray(init)) {
    for (const [k, v] of init) headers[k] = v;
    return headers;
  }
  Object.assign(headers, init);
  return headers;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createFetchProxy(deps: FetchProxyDeps = {}): FetchProxy {
  const invokeImpl: TauriInvoke = deps.invoke ?? (invoke as TauriInvoke);
  let baseFetch: typeof globalThis.fetch = deps.baseFetch ?? globalThis.fetch.bind(globalThis);
  let allowedUrlPrefix: string | null = null;
  let schemeDowngradeDetected = false;

  const proxiedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';

    if (!allowedUrlPrefix || !url.startsWith(allowedUrlPrefix)) {
      return baseFetch(input, init);
    }

    const headers = marshalHeaders(init?.headers);
    const { bodyB64, bodyText } = await marshalBody(init?.body);

    const result = await invokeImpl<HttpProxyResponse>('http_proxy', {
      req: {
        url,
        method,
        headers,
        body_b64: bodyB64 ?? null,
        body_text: bodyText ?? null,
      },
    });

    const body = NULL_BODY_STATUSES.has(result.status)
      ? null
      : result.body_b64
        ? fromBase64(result.body_b64)
        : new Uint8Array(0);

    if (result.headers?.[SCHEME_DOWNGRADE_HEADER] === 'true' && !schemeDowngradeDetected) {
      console.warn(
        '[Sync] Your WebDAV server redirected from HTTPS to HTTP. ' +
          'This may indicate a misconfigured reverse proxy. ' +
          'Check your server configuration to ensure HTTPS is used end-to-end.',
      );
      schemeDowngradeDetected = true;
    }

    const respHeaders = new Headers();
    if (result.headers) {
      for (const [k, v] of Object.entries(result.headers)) {
        if (k === SCHEME_DOWNGRADE_HEADER) continue;
        respHeaders.set(k, v);
      }
    }

    return new Response(body, {
      status: result.status,
      statusText: STATUS_TEXT[result.status] ?? (result.status < 400 ? 'OK' : 'Error'),
      headers: respHeaders,
    });
  };

  return {
    install(): void {
      // Capture whatever fetch is current at install time, then patch.
      // Calling install() twice is a no-op past the first because we only
      // capture baseFetch the first time it isn't already proxiedFetch.
      const current = globalThis.fetch;
      if (current !== proxiedFetch) baseFetch = current.bind(globalThis);
      globalThis.fetch = proxiedFetch;
    },
    async setUrlPrefix(prefix: string | null): Promise<void> {
      allowedUrlPrefix = prefix;
      await invokeImpl('set_sync_url_prefix', { prefix });
    },
    wasSchemeDowngradeDetected: () => schemeDowngradeDetected,
    clearSchemeDowngradeFlag: () => {
      schemeDowngradeDetected = false;
    },
    proxiedFetch,
  };
}

// ---------------------------------------------------------------------------
// Module singleton — production callers use these named exports unchanged
// ---------------------------------------------------------------------------

const defaultProxy = createFetchProxy();

/** Patch `globalThis.fetch`. Call once at app boot. */
export const installFetchProxy = (): void => defaultProxy.install();

/** Set the allowed URL prefix; null disables proxying. */
export const setSyncUrlPrefix = (prefix: string | null): Promise<void> =>
  defaultProxy.setUrlPrefix(prefix);

/** True if the proxy has observed an HTTPS→HTTP downgrade since the flag was last cleared. */
export const wasSchemeDowngradeDetected = (): boolean => defaultProxy.wasSchemeDowngradeDetected();

/** Reset the downgrade flag. */
export const clearSchemeDowngradeFlag = (): void => defaultProxy.clearSchemeDowngradeFlag();
