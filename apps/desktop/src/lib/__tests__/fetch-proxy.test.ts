import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFetchProxy } from '../fetch-proxy';
import { fromBase64, toBase64 } from '@keykeykey/core/utils';

type MockInvoke = ReturnType<typeof vi.fn>;
type MockBaseFetch = ReturnType<typeof vi.fn>;

function makeProxy(
  initialPrefix: string | null = null,
  invokeOverrides?: (req: Record<string, unknown>) => unknown,
) {
  const invoke: MockInvoke = vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === 'set_sync_url_prefix') return undefined;
    if (cmd === 'http_proxy') {
      if (invokeOverrides) return invokeOverrides(args.req as Record<string, unknown>);
      return {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        body_b64: toBase64(new TextEncoder().encode('hello')),
        body_text: '',
      };
    }
    return undefined;
  });
  const baseFetch: MockBaseFetch = vi.fn(async () => new Response('passthrough'));
  const proxy = createFetchProxy({
    invoke: invoke as Parameters<typeof createFetchProxy>[0]['invoke'],
    baseFetch: baseFetch as unknown as typeof globalThis.fetch,
  });
  return { proxy, invoke, baseFetch, initialPrefix };
}

describe('createFetchProxy', () => {
  describe('passthrough', () => {
    it('routes URLs that do not match the prefix through baseFetch', async () => {
      const { proxy, invoke, baseFetch } = makeProxy();
      await proxy.setUrlPrefix('https://example.com/');
      const res = await proxy.proxiedFetch('https://other.example.org/api');
      expect(await res.text()).toBe('passthrough');
      expect(baseFetch).toHaveBeenCalledTimes(1);
      // The set_sync_url_prefix invoke is the only one we expect.
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith('set_sync_url_prefix', {
        prefix: 'https://example.com/',
      });
    });

    it('routes everything through baseFetch when prefix is unset', async () => {
      const { proxy, invoke, baseFetch } = makeProxy();
      await proxy.proxiedFetch('https://example.com/foo');
      expect(baseFetch).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalled();
    });

    it('setUrlPrefix(null) disables proxying', async () => {
      const { proxy, invoke, baseFetch } = makeProxy();
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.setUrlPrefix(null);
      await proxy.proxiedFetch('https://example.com/foo');
      expect(baseFetch).toHaveBeenCalledTimes(1);
      // Two `set_sync_url_prefix` calls, no `http_proxy` call.
      expect(invoke.mock.calls.filter((c) => c[0] === 'http_proxy')).toHaveLength(0);
    });
  });

  describe('proxied requests', () => {
    it('routes prefix-matching URLs through invoke("http_proxy")', async () => {
      const { proxy, invoke, baseFetch } = makeProxy();
      await proxy.setUrlPrefix('https://example.com/');
      const res = await proxy.proxiedFetch('https://example.com/api/foo');
      expect(await res.text()).toBe('hello');
      expect(baseFetch).not.toHaveBeenCalled();
      const httpCall = invoke.mock.calls.find((c) => c[0] === 'http_proxy');
      expect(httpCall).toBeDefined();
    });

    it('marshals string body as body_text', async () => {
      const captured: Record<string, unknown>[] = [];
      const { proxy } = makeProxy(null, (req) => {
        captured.push(req);
        return { status: 200, headers: {}, body_b64: '', body_text: '' };
      });
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch('https://example.com/foo', { method: 'POST', body: 'hello' });
      expect(captured[0]).toMatchObject({ body_text: 'hello', body_b64: null });
    });

    it('marshals Uint8Array body as body_b64', async () => {
      const captured: Record<string, unknown>[] = [];
      const { proxy } = makeProxy(null, (req) => {
        captured.push(req);
        return { status: 200, headers: {}, body_b64: '', body_text: '' };
      });
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch('https://example.com/foo', {
        method: 'POST',
        body: new Uint8Array([1, 2, 3]),
      });
      expect(captured[0]?.body_b64).toBe(toBase64(new Uint8Array([1, 2, 3])));
      expect(captured[0]?.body_text).toBeNull();
    });

    it('marshals ArrayBuffer body as body_b64', async () => {
      const captured: Record<string, unknown>[] = [];
      const { proxy } = makeProxy(null, (req) => {
        captured.push(req);
        return { status: 200, headers: {}, body_b64: '', body_text: '' };
      });
      const buf = new ArrayBuffer(3);
      new Uint8Array(buf).set([7, 8, 9]);
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch('https://example.com/foo', { method: 'POST', body: buf });
      expect(Array.from(fromBase64(captured[0]?.body_b64 as string))).toEqual([7, 8, 9]);
    });

    it('marshals ReadableStream body by draining it', async () => {
      const captured: Record<string, unknown>[] = [];
      const { proxy } = makeProxy(null, (req) => {
        captured.push(req);
        return { status: 200, headers: {}, body_b64: '', body_text: '' };
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4, 5]));
          controller.close();
        },
      });
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch('https://example.com/foo', { method: 'POST', body: stream });
      expect(Array.from(fromBase64(captured[0]?.body_b64 as string))).toEqual([1, 2, 3, 4, 5]);
    });

    it('marshals headers from a Headers instance', async () => {
      const captured: Record<string, unknown>[] = [];
      const { proxy } = makeProxy(null, (req) => {
        captured.push(req);
        return { status: 200, headers: {}, body_b64: '', body_text: '' };
      });
      const headers = new Headers();
      headers.set('Authorization', 'Basic abc');
      headers.set('X-Custom', 'value');
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch('https://example.com/foo', { method: 'GET', headers });
      // Headers normalises keys to lowercase
      expect((captured[0]?.headers as Record<string, string>).authorization).toBe('Basic abc');
      expect((captured[0]?.headers as Record<string, string>)['x-custom']).toBe('value');
    });

    it('marshals headers from a plain-object init', async () => {
      const captured: Record<string, unknown>[] = [];
      const { proxy } = makeProxy(null, (req) => {
        captured.push(req);
        return { status: 200, headers: {}, body_b64: '', body_text: '' };
      });
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch('https://example.com/foo', {
        headers: { Authorization: 'Bearer x' },
      });
      expect((captured[0]?.headers as Record<string, string>)['Authorization']).toBe('Bearer x');
    });

    it('marshals headers from an entry-tuple array', async () => {
      const captured: Record<string, unknown>[] = [];
      const { proxy } = makeProxy(null, (req) => {
        captured.push(req);
        return { status: 200, headers: {}, body_b64: '', body_text: '' };
      });
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch('https://example.com/foo', {
        headers: [
          ['X-A', '1'],
          ['X-B', '2'],
        ],
      });
      const sent = captured[0]?.headers as Record<string, string>;
      expect(sent['X-A']).toBe('1');
      expect(sent['X-B']).toBe('2');
    });

    it('accepts URL instances and Request instances as input', async () => {
      const captured: Record<string, unknown>[] = [];
      const { proxy } = makeProxy(null, (req) => {
        captured.push(req);
        return { status: 200, headers: {}, body_b64: '', body_text: '' };
      });
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch(new URL('https://example.com/url-form'));
      await proxy.proxiedFetch(new Request('https://example.com/req-form'));
      expect(captured[0]?.url).toBe('https://example.com/url-form');
      expect(captured[1]?.url).toBe('https://example.com/req-form');
    });
  });

  describe('response handling', () => {
    // 101 is technically in the production NULL_BODY_STATUSES set, but the
    // Response constructor refuses to construct a 101 response (status range
    // 200-599 only) so it's untestable here. No real server returns 101.
    it.each([204, 205, 304])('returns null body for status %d', async (status) => {
      const { proxy } = makeProxy(null, () => ({
        status,
        headers: {},
        body_b64: toBase64(new TextEncoder().encode('would be discarded')),
        body_text: '',
      }));
      await proxy.setUrlPrefix('https://example.com/');
      const res = await proxy.proxiedFetch('https://example.com/foo');
      expect(res.status).toBe(status);
      expect(res.body).toBeNull();
    });

    it('decodes body_b64 into the response body for non-null statuses', async () => {
      const payload = new Uint8Array([10, 20, 30]);
      const { proxy } = makeProxy(null, () => ({
        status: 200,
        headers: {},
        body_b64: toBase64(payload),
        body_text: '',
      }));
      await proxy.setUrlPrefix('https://example.com/');
      const res = await proxy.proxiedFetch('https://example.com/foo');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Array.from(bytes)).toEqual([10, 20, 30]);
    });

    it('uses friendly statusText for known status codes', async () => {
      const { proxy } = makeProxy(null, () => ({
        status: 404,
        headers: {},
        body_b64: '',
        body_text: '',
      }));
      await proxy.setUrlPrefix('https://example.com/');
      const res = await proxy.proxiedFetch('https://example.com/foo');
      expect(res.statusText).toBe('Not Found');
    });

    it('falls back to "OK"/"Error" for unknown status codes', async () => {
      const { proxy } = makeProxy(null, () => ({
        status: 218,
        headers: {},
        body_b64: '',
        body_text: '',
      }));
      await proxy.setUrlPrefix('https://example.com/');
      const res1 = await proxy.proxiedFetch('https://example.com/a');
      expect(res1.statusText).toBe('OK');

      const { proxy: proxy2 } = makeProxy(null, () => ({
        status: 599,
        headers: {},
        body_b64: '',
        body_text: '',
      }));
      await proxy2.setUrlPrefix('https://example.com/');
      const res2 = await proxy2.proxiedFetch('https://example.com/a');
      expect(res2.statusText).toBe('Error');
    });

    it('forwards response headers verbatim', async () => {
      const { proxy } = makeProxy(null, () => ({
        status: 200,
        headers: { 'content-type': 'application/xml', etag: '"abc"' },
        body_b64: '',
        body_text: '',
      }));
      await proxy.setUrlPrefix('https://example.com/');
      const res = await proxy.proxiedFetch('https://example.com/foo');
      expect(res.headers.get('content-type')).toBe('application/xml');
      expect(res.headers.get('etag')).toBe('"abc"');
    });
  });

  describe('scheme downgrade detection', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('sets the flag and warns once when the proxy reports a downgrade', async () => {
      const { proxy } = makeProxy(null, () => ({
        status: 200,
        headers: { 'x-keykeykey-scheme-downgrade': 'true' },
        body_b64: '',
        body_text: '',
      }));
      await proxy.setUrlPrefix('https://example.com/');
      expect(proxy.wasSchemeDowngradeDetected()).toBe(false);
      await proxy.proxiedFetch('https://example.com/a');
      expect(proxy.wasSchemeDowngradeDetected()).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      // Subsequent downgrade events do NOT spam the console.
      await proxy.proxiedFetch('https://example.com/b');
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('strips the internal downgrade header from the response headers', async () => {
      const { proxy } = makeProxy(null, () => ({
        status: 200,
        headers: { 'x-keykeykey-scheme-downgrade': 'true', 'content-type': 'text/plain' },
        body_b64: '',
        body_text: '',
      }));
      await proxy.setUrlPrefix('https://example.com/');
      const res = await proxy.proxiedFetch('https://example.com/a');
      expect(res.headers.get('x-keykeykey-scheme-downgrade')).toBeNull();
      expect(res.headers.get('content-type')).toBe('text/plain');
    });

    it('clearSchemeDowngradeFlag resets the flag', async () => {
      const { proxy } = makeProxy(null, () => ({
        status: 200,
        headers: { 'x-keykeykey-scheme-downgrade': 'true' },
        body_b64: '',
        body_text: '',
      }));
      await proxy.setUrlPrefix('https://example.com/');
      await proxy.proxiedFetch('https://example.com/a');
      expect(proxy.wasSchemeDowngradeDetected()).toBe(true);
      proxy.clearSchemeDowngradeFlag();
      expect(proxy.wasSchemeDowngradeDetected()).toBe(false);
    });
  });

  describe('install', () => {
    it('replaces globalThis.fetch with the proxied fetch', async () => {
      const original = globalThis.fetch;
      const { proxy } = makeProxy();
      try {
        proxy.install();
        expect(globalThis.fetch).toBe(proxy.proxiedFetch);
      } finally {
        globalThis.fetch = original;
      }
    });

    it('captures the pre-install fetch as the baseFetch fallback', async () => {
      const original = globalThis.fetch;
      const fakeFetch = vi.fn(async () => new Response('captured'));
      globalThis.fetch = fakeFetch as unknown as typeof globalThis.fetch;
      const proxy = createFetchProxy({
        invoke: (async () => undefined) as Parameters<typeof createFetchProxy>[0]['invoke'],
        // No baseFetch — should be picked up from globalThis.fetch on install.
      });
      try {
        proxy.install();
        // No prefix → passthrough → uses captured fakeFetch.
        const res = await proxy.proxiedFetch('https://anywhere.example/');
        expect(await res.text()).toBe('captured');
        expect(fakeFetch).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = original;
      }
    });
  });
});
