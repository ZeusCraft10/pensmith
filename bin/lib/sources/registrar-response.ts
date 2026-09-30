// bin/lib/sources/registrar-response.ts — how a registrar adapter turns one
// HTTP exchange into an outcome (SRC-05, D-19-05; Phase 19 stream adapters).
//
// Every registrar adapter (crossref, openalex, arxiv, pubmed, semanticscholar,
// unpaywall, books, and the retraction lookup) sends its request through the
// one egress gate (bin/lib/http.ts) itself — each call names its own response
// cap, SEC-03 — and hands the result here. This module never sends a request.
//
// Three outcomes:
//   ok      — HTTP 200 whose body passed the adapter's shape check (the
//             service's answer, never an error document served with a 200);
//   status  — any other HTTP status the adapter interprets itself (404 is a
//             definitive "no such record"; another 4xx is a failure whose
//             reason names the service's own message);
//   failed  — the question could not be answered: a 429 or 5xx after the
//             transport's retries, an exhausted host (Retry-After beyond the
//             cap), an open circuit breaker, a redirect or SSRF refusal, a
//             transport error, or a 200 whose body is not the service's answer.
// The typed OfflineEgressError (sources offline without an exact fixture, or
// --dry-run) is rethrown untouched: it is a mode, not an outcome (RUN-03).
//
// The same shape check is handed to the transport as `validate`, so a body
// that is not the service's answer is never cached and never recorded
// (SRC-17). The transport does not run `validate` on a fixture-served answer
// offline, so the check runs again here: a synthetic error body replays as a
// failure, exactly as it would live.

import {
  isOfflineEgressError,
  RateLimitExhaustedError,
  CircuitOpenError,
  type HttpResponse,
} from '../http.js';
import { recordedErrorBody, isTestContext } from '../http-mock.js';
import { parseRetryAfter } from '../retry.js';
import { errorFailureReason, httpFailureReason } from './search-failure.js';

/** Why a 200 body is not the service's answer, or null when it is. */
export type ShapeCheck = (res: HttpResponse) => string | null;

export type Exchange =
  | { readonly kind: 'ok'; readonly res: HttpResponse }
  | { readonly kind: 'status'; readonly res: HttpResponse }
  | { readonly kind: 'failed'; readonly reason: string; readonly status?: number; readonly retryAfterMs?: number };

/** What a rate-limit answer looked like, for an adapter's own hint. */
export interface RateLimitInfo {
  /** How long the service asked callers to wait, when it said so. */
  readonly retryAfterMs?: number;
  /** The transport marked the host exhausted (Retry-After beyond its cap). */
  readonly exhausted: boolean;
  /** The body of the last 429, when there was one (bounded). */
  readonly body?: string;
  /** The headers of the response that rate-limited the request, when there was one. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ExchangeOptions {
  /** The service's display name in reasons: `response is not a <service> answer`. */
  readonly service: string;
  /** The adapter's shape check for a 200 body. */
  readonly check: ShapeCheck;
  /** The adapter's reason for a rate-limited answer (429, exhausted host, breaker opened on 429s). */
  readonly rateLimited?: (info: RateLimitInfo) => string;
}

/** The article for a service name in a reason (`an OpenAlex answer`, `a Crossref answer`). */
function article(service: string): string {
  return /^[aeiou]/i.test(service) ? 'an' : 'a';
}

/** One line, bounded. */
function oneLine(s: string, max = 160): string {
  const line = (s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '').trim().replace(/\s+/g, ' ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Parse a JSON body; undefined when it is not JSON. */
export function parseJsonBody(res: Pick<HttpResponse, 'body'>): unknown {
  const t = res.body.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A shape check for a JSON service: the body parses, is not an API error
 * document, and `accept(body)` holds (else the reason names `what` is missing).
 */
export function jsonShape(accept: (body: unknown) => boolean, what: string): ShapeCheck {
  return (res) => {
    const body = parseJsonBody(res);
    if (body === undefined) return 'unreadable JSON';
    const errorDoc = recordedErrorBody(200, body);
    if (errorDoc !== null) return `an error document: ${errorDoc}`;
    return accept(body) ? null : `no ${what}`;
  };
}

/** The `validate` option for the transport: only a 200 is judged by the shape check. */
export function validator(check: ShapeCheck): (res: HttpResponse) => string | null {
  return (res) => (res.status === 200 ? check(res) : null);
}

/** The service's own message in an error body (`message`, `error`, `detail`), one line — or null. */
export function bodyMessage(body: string): string | null {
  const t = body.trim();
  if (t.length === 0) return null;
  const parsed = parseJsonBody({ body: t });
  if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
    const o = parsed as Record<string, unknown>;
    for (const k of ['message', 'detail', 'error', 'title']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim().length > 0) return oneLine(v);
      if (k === 'error' && typeof v === 'object' && v !== null) {
        const m = (v as Record<string, unknown>)['message'];
        if (typeof m === 'string' && m.trim().length > 0) return oneLine(m);
      }
      if (k === 'message' && Array.isArray(v)) {
        const first = v.find((x) => typeof x === 'object' && x !== null) as Record<string, unknown> | undefined;
        const m = first?.['message'];
        if (typeof m === 'string' && m.trim().length > 0) return oneLine(m);
      }
    }
    return null;
  }
  // A short plain-text answer (e.g. Crossref's `Resource not found.`) is its own message.
  if (!t.startsWith('<') && t.length <= 200) return oneLine(t);
  return null;
}

/** `HTTP 422: Email address required …` — the status, then the service's own message when it sent one. */
export function statusReason(res: Pick<HttpResponse, 'status' | 'body'>): string {
  const msg = bodyMessage(res.body);
  return msg !== null ? `${httpFailureReason(res.status)}: ${msg}` : httpFailureReason(res.status);
}

function retryAfterOf(res: Pick<HttpResponse, 'headers'> | undefined): number | undefined {
  const raw = res?.headers['retry-after'];
  if (typeof raw !== 'string') return undefined;
  const ms = parseRetryAfter(raw, Date.now());
  return ms > 0 ? ms : undefined;
}

function rateLimitedFailure(opts: ExchangeOptions, info: RateLimitInfo, status: number, fallback: string): Exchange {
  const reason = opts.rateLimited ? opts.rateLimited(info) : fallback;
  return {
    kind: 'failed',
    reason,
    status,
    ...(info.retryAfterMs !== undefined ? { retryAfterMs: info.retryAfterMs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Test seam (active ONLY under a test context — http-mock.ts isTestContext)
// ---------------------------------------------------------------------------
// The transport's host-availability refusals (RateLimitExhaustedError,
// CircuitOpenError) depend on per-host state the transport keeps; a test that
// checks how an adapter REPORTS them replaces the one request with a function
// that throws them (or answers). Refused outside a test context.

type SendOverride = () => Promise<HttpResponse>;
let sendOverride: SendOverride | null = null;

/** Test-only: answer (or fail) every registrar request with `fn` until reset with null. */
export function __setRegistrarSendForTest(fn: SendOverride | null): void {
  if (fn !== null && !isTestContext()) throw new Error('__setRegistrarSendForTest is a test-only seam');
  sendOverride = fn;
}

/**
 * Run `send` (one request through the egress gate) and classify the result.
 * Never throws, except the typed OfflineEgressError.
 */
export async function exchange(send: () => Promise<HttpResponse>, opts: ExchangeOptions): Promise<Exchange> {
  let res: HttpResponse;
  try {
    res = await (sendOverride !== null && isTestContext() ? sendOverride() : send());
  } catch (err) {
    if (isOfflineEgressError(err)) throw err;
    if (err instanceof RateLimitExhaustedError) {
      return rateLimitedFailure(
        opts,
        {
          retryAfterMs: err.retryAfterMs,
          exhausted: true,
          ...(err.detail?.body !== undefined ? { body: err.detail.body } : {}),
          ...(err.detail?.headers !== undefined ? { headers: err.detail.headers } : {}),
        },
        err.status,
        errorFailureReason(err),
      );
    }
    if (err instanceof CircuitOpenError) {
      if (err.lastStatus === 429 && opts.rateLimited) {
        return rateLimitedFailure(opts, { exhausted: false }, 429, errorFailureReason(err));
      }
      return { kind: 'failed', reason: errorFailureReason(err), status: err.lastStatus };
    }
    const e = err as { status?: unknown; response?: HttpResponse } | null;
    if (typeof e?.status === 'number') {
      const status = e.status;
      const retryAfterMs = retryAfterOf(e.response);
      if (status === 429) {
        return rateLimitedFailure(
          opts,
          {
            exhausted: false,
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
            ...(e.response ? { body: e.response.body.slice(0, 2000), headers: e.response.headers } : {}),
          },
          429,
          httpFailureReason(429),
        );
      }
      return {
        kind: 'failed',
        reason: httpFailureReason(status),
        status,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      };
    }
    return { kind: 'failed', reason: errorFailureReason(err) };
  }

  if (res.status === 200) {
    const why = opts.check(res);
    if (why !== null) {
      return { kind: 'failed', reason: `response is not ${article(opts.service)} ${opts.service} answer (${why})`, status: 200 };
    }
    return { kind: 'ok', res };
  }
  // A fixture-served (offline) or un-retried 429 / 5xx arrives as a response.
  if (res.status === 429) {
    const retryAfterMs = retryAfterOf(res);
    return rateLimitedFailure(
      opts,
      { exhausted: false, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}), body: res.body.slice(0, 2000), headers: res.headers },
      429,
      statusReason(res),
    );
  }
  if (res.status >= 500) return { kind: 'failed', reason: httpFailureReason(res.status), status: res.status };
  return { kind: 'status', res };
}
