// bin/lib/retry.ts — full-jitter retry shim per RESEARCH §RQ-9 + Key Finding #2.
//
// AWS full-jitter formula (https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/):
//   delay(attempt) = random_between(0, min(capMs, baseMs * 2^(attempt-1)))
//
// Why hand-rolled (not p-retry @^6's `randomize:true`):
//   p-retry@6 supports `randomize:true` but the bound is multiplicative
//   between `randomizeStart` (default 1.0) and `randomizeEnd` (default 2.0).
//   That is bounded multiplicative jitter, NOT full jitter — adversarial
//   servers can still synchronize retries because the floor is non-zero.
//   AWS' full-jitter randomizes uniformly across [0, exp_backoff] which
//   maximally decorrelates retries across N clients sharing a queue.
//
// p-retry remains installed (W0 dep) so consumers may use it directly for
// non-HTTP scenarios; bin/lib/http.ts is the only required caller of
// retry() here.
//
// Dispatch order inside retry():
//   1. attempt = 1: call fn(); on success return
//   2. on throw: invoke onAttempt(attempt, err), then check
//      retryOn(err, attempt) AND attempt < maxAttempts
//   3. if both conditions true, sleep fullJitterDelayMs(attempt, base, cap),
//      attempt += 1, GOTO 1
//   4. else throw the LAST error (preserving the original stack)
//
// This shim is dependency-free at runtime so it can be unit-tested without
// nock / undici.

export interface RetryOptions {
  /** Maximum number of attempts (1-based). Default: 5. */
  maxAttempts?: number;
  /** Base delay in milliseconds (the "1" in 1*2^attempt). Default: 200. */
  baseMs?: number;
  /** Cap on delay in milliseconds — protects against runaway exponentials. Default: 30_000. */
  capMs?: number;
  /**
   * Predicate deciding whether a thrown error is retryable.
   * Receives the error and the 1-based attempt number that just failed.
   * Default: () => true (retry every error).
   */
  retryOn?: (err: unknown, attempt: number) => boolean;
  /** Observation hook — fires after every failed attempt (including the last). */
  onAttempt?: (attempt: number, err: unknown) => void;
}

interface ResolvedOptions {
  maxAttempts: number;
  baseMs: number;
  capMs: number;
  retryOn: (err: unknown, attempt: number) => boolean;
  onAttempt: (attempt: number, err: unknown) => void;
}

const DEFAULT_OPTS: ResolvedOptions = {
  maxAttempts: 5,
  baseMs: 200,
  capMs: 30_000,
  retryOn: () => true,
  onAttempt: () => {},
};

/**
 * Compute the AWS full-jitter delay for the given 1-based `attempt` number,
 * using `baseMs` and `capMs`. Formula:
 *
 *   exp = min(capMs, baseMs * 2^(attempt - 1))
 *   delay = random_between(0, exp)   // uniform, integer
 *
 * Guarantees:
 *   - returned value is a non-negative integer
 *   - returned value <= min(capMs, baseMs * 2^(attempt-1))
 *   - exposed for tests to assert the math directly
 */
export function fullJitterDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
): number {
  if (attempt < 1) {
    throw new Error(`fullJitterDelayMs: attempt must be >= 1; got ${attempt}`);
  }
  if (baseMs < 0 || capMs < 0) {
    throw new Error(`fullJitterDelayMs: baseMs and capMs must be >= 0`);
  }
  // 2^(attempt-1) — but bound the exponent so attempt=64 doesn't overflow.
  // capMs caps the result anyway, but Math.pow(2, 1023) is Infinity which
  // poisons the Math.min comparison on some runtimes.
  const exponent = Math.min(attempt - 1, 30);
  const expBackoff = baseMs * Math.pow(2, exponent);
  const upper = Math.min(capMs, expBackoff);
  if (upper <= 0) return 0;
  // Uniform integer in [0, upper] (inclusive on both ends, hence the +1).
  return Math.floor(Math.random() * (upper + 1));
}

/**
 * Parse a Retry-After header value into a delay in milliseconds.
 *
 * Per RFC 7231 §7.1.3, Retry-After may be either:
 *   (a) a non-negative integer count of delta-seconds, e.g. "120"
 *   (b) an HTTP-date, e.g. "Wed, 21 Oct 2026 07:28:00 GMT"
 *
 * X-Rate-Limit-Reset is Unix-epoch seconds and is NOT handled here —
 * the http.ts call site converts it to milliseconds-from-now before
 * deciding which delay to use.
 *
 * Guarantees:
 *   - Returns a non-negative integer in milliseconds
 *   - Never throws (invalid input collapses to 0 so the caller may
 *     safely fall back to fullJitterDelayMs)
 *   - Past HTTP-dates and negative delta-seconds return 0
 */
export function parseRetryAfter(headerValue: string | undefined, now: number): number {
  if (!headerValue) return 0;
  const trimmed = headerValue.trim();
  if (trimmed === '') return 0;
  // (a) delta-seconds form — pure-digit integer
  if (/^-?\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    if (Number.isNaN(seconds) || seconds < 0) return 0;
    return seconds * 1000;
  }
  // (b) HTTP-date form — RFC 7231 accepts the IMF-fixdate / RFC 850 /
  //     asctime() formats; Date.parse handles IMF-fixdate which is the
  //     RFC-7231 preferred form. Servers that emit non-IMF dates are
  //     non-compliant; we collapse to 0 (caller falls back to jitter).
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return 0;
  const delta = parsed - now;
  if (delta <= 0) return 0;
  return delta;
}

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run `fn` with full-jitter exponential-backoff retry.
 *
 * Stops retrying when EITHER `attempt >= maxAttempts` OR `retryOn(err, attempt)`
 * returns false. Throws the LAST captured error in either case.
 *
 * Idiom (HTTP layer):
 *
 *   await retry(async () => {
 *     const r = await callOnce();
 *     if (RETRYABLE_STATUSES.has(r.status)) throw mkErr(r.status);
 *     return r;
 *   }, { retryOn: (e) => isRetryableErr(e) });
 *
 * Throwing inside `fn` is the trigger for backoff — non-throwing returns
 * are returned immediately to the caller.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const o: ResolvedOptions = {
    maxAttempts: opts.maxAttempts ?? DEFAULT_OPTS.maxAttempts,
    baseMs: opts.baseMs ?? DEFAULT_OPTS.baseMs,
    capMs: opts.capMs ?? DEFAULT_OPTS.capMs,
    retryOn: opts.retryOn ?? DEFAULT_OPTS.retryOn,
    onAttempt: opts.onAttempt ?? DEFAULT_OPTS.onAttempt,
  };
  if (o.maxAttempts < 1) {
    throw new Error(`retry: maxAttempts must be >= 1; got ${o.maxAttempts}`);
  }
  let lastErr: unknown;
  for (let attempt = 1; attempt <= o.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      o.onAttempt(attempt, err);
      if (attempt >= o.maxAttempts) break;
      if (!o.retryOn(err, attempt)) break;
      const delay = fullJitterDelayMs(attempt, o.baseMs, o.capMs);
      await sleep(delay);
    }
  }
  throw lastErr;
}
