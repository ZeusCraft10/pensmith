// bin/lib/verify/freshness.ts — RSCH-10 source-freshness probe (D-10, WARN-only).
//
// Advisory side-channel for the verifier. For each resolved citekey the probe:
//   1. issues an HTTP HEAD against https://doi.org/<doi> (via the bin/lib/http.ts
//      chokepoint — never a direct undici/fetch), and
//   2. cross-checks the DOI against the Retraction Watch adapter
//      (bin/lib/sources/retraction-watch.ts::fetchById — a REAL cassette-backed
//      adapter, NOT a Phase-3 stub).
//
// WARN-only policy (D-10 / PRD §14):
//   - DOI HEAD 200            → ok, no warning
//   - DOI HEAD 4xx/5xx (real HTTP status, after 1 retry) → WARN
//   - retraction-watch hit    → WARN
//   - transport error (ECONNREFUSED / ETIMEDOUT / no response) → SILENT
//     (network noise is not source staleness — optional DEBUG only)
//
// Freshness verdicts NEVER escalate to FABRICATED / MIS-CITED. The hard-block
// path is reserved for Pass 1 (DOI/author/title) and Pass 3 (quote presence).
//
// SSRF mitigation (T-04-05): the DOI is format-validated via bin/lib/doi.ts
// BEFORE any request, and the HEAD target is always constructed as
// `https://doi.org/<normalized-doi>` — never an arbitrary caller-supplied URL.

import { normalizeDoi } from '../doi.js';
import { fetch as httpFetch } from '../http.js';
import { isOfflineMode, loadCassetteFile } from '../http-mock.js';
import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js';
import { Semaphore } from '../budget.js';

export type FreshnessProbe = 'DOI HEAD' | 'retraction-watch';
export type FreshnessStatus = 'WARN';

export interface FreshnessWarning {
  /** Which probe produced this warning. */
  probe: FreshnessProbe;
  /** Always 'WARN' — freshness is advisory-only by construction (D-10). */
  status: FreshnessStatus;
  /** Human-readable detail for the VERIFICATION.md table. */
  detail: string;
}

export interface FreshnessResult {
  citekey: string;
  /** DOI that was probed (normalized) or null when none was available. */
  doi: string | null;
  /** Zero or more advisory warnings. Empty array == no staleness signal. */
  warnings: FreshnessWarning[];
}

function debug(msg: string): void {
  if (process.env['PENSMITH_DEBUG'] === '1') {
    process.stderr.write(`[freshness] ${msg}\n`);
  }
}

/**
 * Offline HEAD lookup against the doi-head cassette family. In offline mode
 * (the PR-time default) bin/lib/http.ts is bypassed exactly as the
 * retraction-watch adapter bypasses it — nock@14 cannot intercept undici, so
 * adapters read cassettes directly. Returns the HTTP status, or null when no
 * cassette matches (treated as transport noise, NOT staleness).
 */
function offlineHeadStatus(doi: string): number | null {
  // The path the live HEAD would hit: /<doi>. We match across all doi-head
  // cassette files by exact path equality.
  const target = `/${doi}`;
  for (const basename of ['head-ok', 'head-404']) {
    const cassette = loadCassetteFile('doi-head', basename);
    if (!cassette) continue;
    const hit = cassette.find(
      (c) => String(c.method).toUpperCase() === 'HEAD' && c.path === target,
    );
    if (hit) return hit.status;
  }
  return null;
}

/**
 * Probe one source's freshness. Returns a FreshnessResult whose `warnings`
 * array is empty when the source looks fresh. Never throws on network/transport
 * failures — those are swallowed as noise per D-10.
 */
export async function probeFreshness(
  citekey: string,
  doi: string | null,
): Promise<FreshnessResult> {
  const warnings: FreshnessWarning[] = [];

  // SSRF mitigation: validate DOI format before issuing ANY request.
  const normalized = doi ? normalizeDoi(doi) : null;
  if (doi && !normalized) {
    debug(`citekey=${citekey} doi=${JSON.stringify(doi)} failed normalization — skipping HEAD`);
  }

  if (normalized) {
    // --- DOI HEAD probe ---
    if (isOfflineMode()) {
      const status = offlineHeadStatus(normalized);
      if (status === null) {
        // No cassette match == no real HTTP response == transport noise. SILENT.
        debug(`citekey=${citekey} doi=${normalized} no HEAD cassette — silent (transport noise)`);
      } else if (status >= 400) {
        warnings.push({
          probe: 'DOI HEAD',
          status: 'WARN',
          detail: `DOI HEAD returned ${status} — source may be stale or moved`,
        });
      }
    } else {
      try {
        // HEAD goes ONLY to doi.org (SSRF mitigation), 10s timeout, 1 retry
        // via the http chokepoint's built-in retry wrapper.
        const res = await httpFetch(`https://doi.org/${normalized}`, {
          method: 'HEAD',
          timeoutMs: 10_000,
        });
        if (res.status >= 400) {
          warnings.push({
            probe: 'DOI HEAD',
            status: 'WARN',
            detail: `DOI HEAD returned ${res.status} — source may be stale or moved`,
          });
        }
      } catch (err) {
        // Transport error (ECONNREFUSED / ETIMEDOUT / DNS) is network noise,
        // NOT source staleness (D-10). Silent — optional DEBUG only.
        debug(`citekey=${citekey} doi=${normalized} HEAD transport error: ${String(err)} — silent`);
      }
    }

    // --- Retraction Watch cross-check (real cassette-backed adapter) ---
    try {
      const hit = await retractionWatchFetchById(normalized);
      if (hit) {
        const why = hit.retraction_details ? ` (${hit.retraction_details})` : '';
        warnings.push({
          probe: 'retraction-watch',
          status: 'WARN',
          detail: `cited work appears in Retraction Watch${why}`,
        });
      }
    } catch (err) {
      // Same noise policy as the HEAD probe — never block on a probe failure.
      debug(`citekey=${citekey} doi=${normalized} retraction-watch error: ${String(err)} — silent`);
    }
  }

  return { citekey, doi: normalized, warnings };
}

/**
 * Probe many sources concurrently under a Semaphore(5) HEAD fan-out cap
 * (same primitive as the wave scheduler — no new dependency). Results preserve
 * input order. Persists nothing (in-memory for the run, per D-04 spirit).
 */
export async function probeFreshnessAll(
  sources: ReadonlyArray<{ citekey: string; doi: string | null }>,
): Promise<FreshnessResult[]> {
  const sem = new Semaphore(5);
  return Promise.all(
    sources.map((s) => sem.withLock(() => probeFreshness(s.citekey, s.doi))),
  );
}

/**
 * Render the `## Source Freshness (RSCH-10)` table for VERIFICATION.md.
 * Deterministic, no LLM. Sources with no warnings emit an "ok" row so the
 * reader can see the probe actually ran (RESEARCH §J table shape).
 */
export function renderFreshnessTable(results: ReadonlyArray<FreshnessResult>): string {
  const lines = [
    '## Source Freshness (RSCH-10)',
    '',
    '| Citekey | Probe | Status | Detail |',
    '|---------|-------|--------|--------|',
  ];
  if (results.length === 0) {
    lines.push('| _(none)_ | — | — | no DOIs to probe |');
    return lines.join('\n');
  }
  for (const r of results) {
    if (r.warnings.length === 0) {
      lines.push(`| ${r.citekey} | DOI HEAD | ok | |`);
      continue;
    }
    for (const w of r.warnings) {
      lines.push(`| ${r.citekey} | ${w.probe} | ${w.status} | ${w.detail} |`);
    }
  }
  return lines.join('\n');
}
