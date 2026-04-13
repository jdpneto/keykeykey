/**
 * `fetch` wrapper with transparent retry for rate-limit and transient server
 * errors. Honors the `Retry-After` response header (both seconds and
 * HTTP-date forms) and falls back to exponential backoff with jitter.
 *
 * Intended for the sync adapters so a single 429 from Dropbox / Google
 * Drive / OneDrive does not abort a whole sync cycle or, worse, surface as
 * an uncaught promise rejection from a fire-and-forget periodic sync.
 */

export interface FetchRetryOptions {
  /** Maximum number of retry attempts after the initial request. Default 3. */
  maxRetries?: number;
  /** Initial backoff in ms; doubles on each retry. Default 1000. */
  baseDelayMs?: number;
  /** Upper bound on any single backoff delay. Default 30_000. */
  maxDelayMs?: number;
  /** HTTP status codes that trigger a retry. Default: 429 + 5xx. */
  retryStatuses?: readonly number[];
}

const DEFAULT_RETRY_STATUSES: readonly number[] = [429, 500, 502, 503, 504];

/**
 * Like `fetch`, but retries on 429 / 5xx responses. On every other outcome
 * (2xx, 3xx, 4xx other than 429, network failure) the response or error is
 * returned / thrown unchanged so callers can handle it with their existing
 * logic.
 *
 * Retry-After handling:
 * - If the header is an integer, it is used as a seconds value (clamped to
 *   `maxDelayMs`).
 * - If the header is an HTTP-date, it is parsed and the delay is computed
 *   relative to `Date.now()` (clamped to `maxDelayMs`).
 * - Otherwise, exponential backoff with jitter is used.
 *
 * Note: the body passed in `init` must be replayable (Uint8Array, string,
 * Blob, etc.) — streaming bodies cannot be retried.
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30_000;
  const retryStatuses = new Set(options?.retryStatuses ?? DEFAULT_RETRY_STATUSES);

  let attempt = 0;
  while (true) {
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch (err) {
      // Network error — retry up to maxRetries, then re-throw
      if (attempt >= maxRetries) throw err;
      await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs));
      attempt++;
      continue;
    }

    if (!retryStatuses.has(res.status) || attempt >= maxRetries) {
      return res;
    }

    // Need to retry — compute delay, respecting Retry-After if present.
    const retryAfter = res.headers.get('Retry-After');
    const delayMs = computeDelay(retryAfter, attempt, baseDelayMs, maxDelayMs);
    // Discard the body so the connection can be freed before we sleep.
    try {
      await res.body?.cancel();
    } catch {
      // ignore
    }
    await sleep(delayMs);
    attempt++;
  }
}

function computeDelay(
  retryAfter: string | null,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, maxDelayMs);
    }
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      const delta = asDate - Date.now();
      if (delta > 0) return Math.min(delta, maxDelayMs);
    }
  }
  return backoffDelay(attempt, baseDelayMs, maxDelayMs);
}

function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exp + jitter, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
