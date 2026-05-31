// bin/lib/verify/freshness.ts — RSCH-10 source-freshness probe (WARN-only).
//
// Policy (D-10 / PRD §14):
//   A stale DOI (HEAD 4xx/5xx after one retry) → WARN in VERIFICATION.md.
//   A retraction-watch hit → WARN.
//   A transport error (ECONNREFUSED/ETIMEDOUT/UND_ERR_*) → SILENT (not WARN).
//   Freshness verdicts NEVER escalate to FABRICATED or MIS-CITED.
//
// SSRF mitigation (T-04-05):
//   DOI format is validated via bin/lib/doi.ts BEFORE any network request.
//   HEAD targets doi.org only, never an arbitrary URL.
//   Timeout: 10s. Retry: 1 attempt (noRetry semantics — we retry exactly once
//   via a manual wrapper; we use the http.ts noRetry path to avoid the full
//   retry backoff stack which is designed for discovery, not freshness probes).
//
// Offline mode (PR-time CI):
//   When isOfflineMode() is true, the probe short-circuits through
//   loadCassetteFile('freshness', 'doi-head-ok|doi-head-404') without issuing
//   any real HTTP request — mirrors the retraction-watch adapter pattern
//   (http-mock.ts executor deviation note).
//
// Retraction-watch (real adapter, not a Phase-3 stub):
//   retraction-watch.ts IS a real HTTP adapter with its own offline cassette
//   path (loadCassetteFile('retraction-watch', 'fetchById-fake')). We delegate
//   to fetchById() directly — no re-implementation.
//
// Structured retraction_warnings (REVIEW LOW — Gemini):
//   FreshnessResult carries retraction_warnings: { citekey, note }[] so the
//   compile pipeline (Plan 05) can aggregate hits into COMPILE-REPORT
//   "## Advisory Findings" without reading VERIFICATION.md line-by-line.

import { normalizeDoi } from '../doi.js';
import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile } from '../http-mock.js';
import { fetchById as rwFetchById } from '../sources/retraction-watch.js';

export interface RetractionWarning {
  citekey: string;
  note: string;
}

export interface FreshnessResult {
  citekey: string;
  doi: string | null;
  /** True when a validated DOI HEAD returns 4xx/5xx after one retry. */
  warnDoi: boolean;
  /** True when retraction-watch confirms the DOI is retracted. */
  warnRetraction: boolean;
  /** True when any WARN flag is set (warnDoi OR warnRetraction). */
  advisory: boolean;
  /** Structured retraction hits for Plan 05 COMPILE-REPORT aggregation. */
  retraction_warnings: RetractionWarning[];
}

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

const DOI_HEAD_TIMEOUT_MS = 10_000;

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Issue a HEAD request to doi.org for the given canonical DOI.
 * In offline mode, loads from tests/fixtures/cassettes/freshness/
 * using the first cassette entry whose path contains the DOI.
 *
 * Returns the HTTP status code, or null if a transport error occurred.
 * Transport errors are caller-level "silent" — they should NOT produce a WARN.
 */
async function headDoi(canonicalDoi: string): Promise<number | null> {
  if (isOfflineMode()) {
    // Try doi-head-ok first, then doi-head-404.
    // Match by whether the cassette path contains the DOI suffix.
    for (const basename of ['doi-head-ok', 'doi-head-404']) {
      const cassette = loadCassetteFile('freshness', basename);
      if (!cassette) continue;
      const entry = cassette.find(
        (c) =>
          (c.method === 'GET' || c.method === 'POST') &&
          c.path.includes(canonicalDoi),
      );
      if (entry) return entry.status;
    }
    // No matching cassette entry — treat as transport error (silent).
    return null;
  }

  // Live path: HEAD through the http.ts undici chokepoint (D-06).
  const url = `https://doi.org/${canonicalDoi}`;
  try {
    // Use noRetry=true: we manage our own single-retry outside to keep
    // the http.ts retry stack (designed for discovery) off this path.
    const res = await httpFetch(url, {
      method: 'HEAD',
      source: 'generic',
      timeoutMs: DOI_HEAD_TIMEOUT_MS,
      noCache: true,
      noRetry: true,
    });
    if ([429, 500, 502, 503, 504].includes(res.status)) {
      // One retry for server-side transient errors.
      const retry = await httpFetch(url, {
        method: 'HEAD',
        source: 'generic',
        timeoutMs: DOI_HEAD_TIMEOUT_MS,
        noCache: true,
        noRetry: true,
      });
      return retry.status;
    }
    return res.status;
  } catch {
    // Transport error (ECONNREFUSED, ETIMEDOUT, UND_ERR_*) → silent.
    return null;
  }
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Probe the freshness of a single citation's DOI.
 *
 * @param citekey  The citation key (used in result + retraction_warnings)
 * @param doi      Raw DOI string (or null if absent). Validated before use.
 * @returns        FreshnessResult — advisory warnings only, never blocking.
 */
export async function probeFreshness(
  citekey: string,
  doi: string | null,
): Promise<FreshnessResult> {
  const retraction_warnings: RetractionWarning[] = [];

  // Validate DOI format first (SSRF mitigation T-04-05).
  if (!doi) {
    return {
      citekey,
      doi: null,
      warnDoi: false,
      warnRetraction: false,
      advisory: false,
      retraction_warnings,
    };
  }

  const canonicalDoi = normalizeDoi(doi);
  if (!canonicalDoi) {
    // Invalid DOI format — cannot issue HEAD; silent (not WARN).
    return {
      citekey,
      doi,
      warnDoi: false,
      warnRetraction: false,
      advisory: false,
      retraction_warnings,
    };
  }

  // --- DOI HEAD probe ---
  const statusCode = await headDoi(canonicalDoi);
  // statusCode null → transport error → silent.
  // statusCode 4xx/5xx → stale → WARN.
  // statusCode 200/3xx → live → no WARN.
  const warnDoi =
    statusCode !== null && statusCode >= 400;

  // --- Retraction-watch probe ---
  // fetchById delegates to the existing adapter which handles offline mode
  // via its own loadCassetteFile('retraction-watch', 'fetchById-fake') path.
  let warnRetraction = false;
  try {
    const hit = await rwFetchById(canonicalDoi);
    if (hit && hit.retracted) {
      warnRetraction = true;
      const note = hit.retraction_details
        ? `${hit.title} — ${hit.retraction_details}`
        : (hit.title ?? canonicalDoi);
      retraction_warnings.push({ citekey, note });
    }
  } catch {
    // Transport error for retraction-watch → silent.
  }

  const advisory = warnDoi || warnRetraction;
  return {
    citekey,
    doi: canonicalDoi,
    warnDoi,
    warnRetraction,
    advisory,
    retraction_warnings,
  };
}
