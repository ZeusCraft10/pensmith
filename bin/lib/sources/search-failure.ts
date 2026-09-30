// bin/lib/sources/search-failure.ts — how a source adapter's search reports a
// failed request to the research log (D-17-10: RESEARCH.md lists per-adapter
// counts AND failures).
//
// An adapter's search() keeps its contract — it returns [] when the service
// fails, so `add` and other callers never see a throw — but a caller that
// passes `onFailure` learns WHY the list is empty: `HTTP 429 after retries`,
// `HTTP 503 after retries`, `HTTP 400`, or the transport error. The research
// orchestrator records that as `failed (…)` instead of `no results`.

import {
  isRetryableStatus,
  RateLimitExhaustedError,
  CircuitOpenError,
  RedirectError,
  SsrfBlockedError,
  ResponseTooLargeError,
  formatRetryAfter,
} from '../http.js';

/** The options every source adapter's search() accepts. */
export interface SearchOptions {
  limit?: number;
  /** Called once with a one-line reason when the search request failed (the result is then []). */
  onFailure?: (reason: string) => void;
  /**
   * Called with a one-line note when the search answered but part of what it
   * adds could not be fetched (Phase 20, D-20-16: PubMed's efetch abstracts —
   * `abstracts unavailable (…)`). The results are still returned; the
   * research log shows the note on the adapter's status line.
   */
  onWarning?: (note: string) => void;
  /**
   * Phase 19 seam S-B (SRC-10): only works published in or after this year,
   * pushed down into the service's own filter where it has one (Crossref
   * `from-pub-date`, OpenAlex `from_publication_date`, PubMed `mindate`,
   * Semantic Scholar `year=`); adapters without one ignore it and the
   * research policy filter ([sources] min_year) still applies.
   */
  fromYear?: number;
  /**
   * Phase 19 seam S-B (SRC-11): restrict to one DOI registrant prefix — the
   * `nber` source preference is Crossref search with `10.3386`. Adapters that
   * cannot filter by prefix ignore it.
   */
  doiPrefix?: string;
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
  // Phase 19 seam S-B (SRC-17, SRC-01): the transport's own refusals read as
  // what happened, not as a raw error name.
  if (err instanceof RateLimitExhaustedError) return `rate limit exhausted (retry after ${formatRetryAfter(err.retryAfterMs)})`;
  if (err instanceof CircuitOpenError) return `skipped after ${err.summary}`;
  if (err instanceof RedirectError) return err.message;
  if (err instanceof SsrfBlockedError) return err.message;
  if (err instanceof ResponseTooLargeError) return 'response too large';
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return httpFailureReason(status);
  const msg = err instanceof Error ? `${err.name !== 'Error' ? `${err.name}: ` : ''}${err.message}` : String(err);
  return (msg.split(/\r?\n/)[0] ?? '').slice(0, 160);
}
