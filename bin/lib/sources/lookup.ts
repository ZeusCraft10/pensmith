// bin/lib/sources/lookup.ts — the three-way identifier lookup contract every
// source adapter implements (Phase 19 seam S-B; SRC-05, used by VRFY-12).
//
// SEAM FILE (Phase 19 plan, S-B). Every Phase 19 stream applies it
// byte-identically from .planning/phases/19-sources/seams/; no stream edits it
// during Phase 19.
//
// An identifier lookup has THREE outcomes, never two:
//   found      — the registrar answered with a record (the candidate);
//   not-found  — the registrar answered definitively that it has no such
//                record (HTTP 404, or an empty result for an exact-id query);
//   failed     — the lookup could not be answered: a non-200 status after
//                retries (429, 5xx), a rate-limit budget exhausted, an open
//                circuit breaker, a transport error, a timeout, a body that is
//                not the registrar's schema (an error document inside a 200
//                included), a missing precondition such as Unpaywall's required
//                contact email.
// A failure is never "not found": Pass 1 turns it into UNVERIFIABLE (S-03,
// VRFY-12), `add` reports it and adds nothing, Pass 3 reports the text as
// unavailable with the reason.
//
// Each adapter exports
//     lookupById(id: string): Promise<LookupResult>
// and keeps
//     fetchById(id: string): Promise<SourceCandidate | null>
// as `unwrapLookup(await lookupById(id), <adapter>, id)`: the candidate, null
// for not-found, and a thrown SourceLookupError for failed — so no caller can
// read a failed lookup as a missing record. The typed OfflineEgressError
// (sources offline with no exact fixture, or --dry-run) is still thrown as-is
// by both functions: it is a mode, not a lookup outcome (RUN-03).

import { PensmithError, EXIT_ERROR } from '../exit-codes.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

export interface LookupFound {
  readonly kind: 'found';
  readonly candidate: SourceCandidate;
}

export interface LookupNotFound {
  readonly kind: 'not-found';
  /** One line: why the registrar's answer means "no such record" (e.g. `HTTP 404`). */
  readonly reason: string;
}

export interface LookupFailed {
  readonly kind: 'failed';
  /** One user-facing line, hint included (e.g. `HTTP 503 after retries`, `Unpaywall skipped: set PENSMITH_CONTACT_EMAIL`). */
  readonly reason: string;
  /** The last HTTP status, when there was a response. */
  readonly status?: number;
  /** How long the service asked callers to wait, when it said so (Retry-After). */
  readonly retryAfterMs?: number;
  /**
   * True when the registrar DID answer, definitively, with a record that cannot
   * be used (e.g. Crossref's record of a standard lists no author or editor):
   * asking again gives the same answer, so a caller never says "retry".
   */
  readonly permanent?: boolean;
}

export type LookupResult = LookupFound | LookupNotFound | LookupFailed;

export function lookupFound(candidate: SourceCandidate): LookupFound {
  return { kind: 'found', candidate };
}

export function lookupNotFound(reason: string): LookupNotFound {
  return { kind: 'not-found', reason };
}

export function lookupFailed(
  reason: string,
  extra: { status?: number; retryAfterMs?: number; permanent?: boolean } = {},
): LookupFailed {
  return {
    kind: 'failed',
    reason,
    ...(extra.status !== undefined ? { status: extra.status } : {}),
    ...(extra.retryAfterMs !== undefined ? { retryAfterMs: extra.retryAfterMs } : {}),
    ...(extra.permanent === true ? { permanent: true } : {}),
  };
}

/**
 * A lookup that could not be answered, thrown by an adapter's fetchById. It is
 * an expected, user-reportable condition (one line, no stack): the verb that
 * receives it says the lookup failed and why, and never treats the identifier
 * as unknown to the registrar.
 */
export class SourceLookupError extends PensmithError {
  readonly source: string;
  readonly id: string;
  readonly reason: string;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  /** The registrar's definitive answer is unusable; retrying cannot help (LookupFailed.permanent). */
  readonly permanent: boolean;
  constructor(source: string, id: string, failed: Pick<LookupFailed, 'reason' | 'status' | 'retryAfterMs' | 'permanent'>) {
    super(`${source} lookup of ${id} failed: ${failed.reason}`, EXIT_ERROR);
    this.name = 'SourceLookupError';
    this.source = source;
    this.id = id;
    this.reason = failed.reason;
    this.status = failed.status;
    this.retryAfterMs = failed.retryAfterMs;
    this.permanent = failed.permanent === true;
  }
}

export function isSourceLookupError(e: unknown): e is SourceLookupError {
  return e instanceof SourceLookupError;
}

/**
 * The fetchById view of a lookup: the candidate, null for a definitive
 * not-found, and a thrown SourceLookupError for a failed lookup.
 */
export function unwrapLookup(result: LookupResult, source: string, id: string): SourceCandidate | null {
  switch (result.kind) {
    case 'found':
      return result.candidate;
    case 'not-found':
      return null;
    case 'failed':
      throw new SourceLookupError(source, id, result);
  }
}
