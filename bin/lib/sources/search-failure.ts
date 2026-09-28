// bin/lib/sources/search-failure.ts — how a source adapter's search reports a
// failed request to the research log (D-17-10: RESEARCH.md lists per-adapter
// counts AND failures).
//
// An adapter's search() keeps its contract — it returns [] when the service
// fails, so `add` and other callers never see a throw — but a caller that
// passes `onFailure` learns WHY the list is empty: `HTTP 429 after retries`,
// `HTTP 503 after retries`, `HTTP 400`, or the transport error. The research
// orchestrator records that as `failed (…)` instead of `no results`.

import { isRetryableStatus } from '../http.js';

/** The options every source adapter's search() accepts. */
export interface SearchOptions {
  limit?: number;
  /** Called once with a one-line reason when the search request failed (the result is then []). */
  onFailure?: (reason: string) => void;
}

/** `HTTP 429 after retries` for a status http.ts retried, else `HTTP <status>`. */
export function httpFailureReason(status: number): string {
  return `HTTP ${status}${isRetryableStatus(status) ? ' after retries' : ''}`;
}

/**
 * The reason for a thrown search failure: a retryable status fetch() gave up on
 * (the error carries `status`) reads like an HTTP failure; anything else is the
 * first line of the error (bounded).
 */
export function errorFailureReason(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return httpFailureReason(status);
  const msg = err instanceof Error ? `${err.name !== 'Error' ? `${err.name}: ` : ''}${err.message}` : String(err);
  return (msg.split(/\r?\n/)[0] ?? '').slice(0, 160);
}
