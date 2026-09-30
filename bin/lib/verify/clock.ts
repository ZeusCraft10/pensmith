// bin/lib/verify/clock.ts — the verifier's clock for the re-check decision
// (VRFY-28, D-20-27).
//
// verify and done re-fetch a citation whose LIBRARY.json `last_verified` is
// null or older than `[verification] recheck_after_days` (default 30). That
// decision — and nothing else — reads verificationNow(). A test ages a
// citation by setting PENSMITH_TEST_NOW to an ISO time; it is honoured ONLY
// under a test context (NODE_TEST_CONTEXT / PENSMITH_TEST=1, http-mock.ts
// isTestContext), so a stray variable in a user's shell never changes what is
// re-checked. The HTTP cache's own clock is untouched: a test moves "now" for
// the recheck decision without making every cached answer look expired.
//
// PURE apart from reading the environment and the system clock.

import { isTestContext } from '../http-mock.js';

/** The environment variable a test sets to move the recheck clock (ISO-8601). */
export const TEST_NOW_ENV = 'PENSMITH_TEST_NOW';

/** The default `[verification] recheck_after_days` (PRD §7.12, §10). */
export const DEFAULT_RECHECK_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Now" for the recheck decision: PENSMITH_TEST_NOW under a test context when
 * it holds a valid time, else the real time.
 */
export function verificationNow(): Date {
  if (isTestContext()) {
    const raw = process.env[TEST_NOW_ENV];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      const t = Date.parse(raw.trim());
      if (Number.isFinite(t)) return new Date(t);
    }
  }
  return new Date();
}

/**
 * True when a citation last verified at `lastVerified` (ISO-8601, or null when
 * it never was) must be re-fetched past the HTTP cache: never verified, an
 * unreadable timestamp, or older than `recheckAfterDays` before `now`. A
 * negative or non-finite day count falls back to the default.
 */
export function needsRecheck(
  lastVerified: string | null | undefined,
  recheckAfterDays: number = DEFAULT_RECHECK_AFTER_DAYS,
  now: Date = verificationNow(),
): boolean {
  if (typeof lastVerified !== 'string' || lastVerified.length === 0) return true;
  const at = Date.parse(lastVerified);
  if (!Number.isFinite(at)) return true;
  const days = Number.isFinite(recheckAfterDays) && recheckAfterDays >= 0 ? recheckAfterDays : DEFAULT_RECHECK_AFTER_DAYS;
  return now.getTime() - at > days * DAY_MS;
}
