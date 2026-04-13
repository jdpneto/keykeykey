import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry } from './fetch-with-retry.js';

function jsonResponse(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('fetchWithRetry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the response immediately on 2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const res = await fetchWithRetry('https://example.com');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 4xx other than 429', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404));
    const res = await fetchWithRetry('https://example.com', undefined, { maxRetries: 3 });
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and returns the eventual 200', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(429))
      .mockResolvedValueOnce(jsonResponse(200));
    const promise = fetchWithRetry('https://example.com', undefined, {
      maxRetries: 3,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on 5xx errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503)).mockResolvedValueOnce(jsonResponse(200));
    const promise = fetchWithRetry('https://example.com', undefined, {
      maxRetries: 3,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and returns the final 429', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429));
    const promise = fetchWithRetry('https://example.com', undefined, {
      maxRetries: 2,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(429);
    // Initial call + 2 retries = 3 total
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('honors a numeric Retry-After header (seconds)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, {}, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(jsonResponse(200));
    const promise = fetchWithRetry('https://example.com', undefined, {
      maxRetries: 3,
      baseDelayMs: 10_000,
    });
    // Advance 1900ms — Retry-After says 2000ms, so still pending
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Advance past 2000ms — second call fires
    await vi.advanceTimersByTimeAsync(200);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network errors', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network down'))
      .mockResolvedValueOnce(jsonResponse(200));
    const promise = fetchWithRetry('https://example.com', undefined, {
      maxRetries: 2,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-throws network errors after maxRetries', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network down'));
    // Attach the catch handler up front so the rejection can't become
    // unhandled while we're driving fake timers forward.
    const outcome = fetchWithRetry('https://example.com', undefined, {
      maxRetries: 1,
      baseDelayMs: 10,
    }).then(
      () => ({ kind: 'resolved' as const }),
      (err: unknown) => ({ kind: 'rejected' as const, err }),
    );
    await vi.runAllTimersAsync();
    const result = await outcome;
    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.err).toBeInstanceOf(TypeError);
      expect((result.err as Error).message).toBe('Network down');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
