// bin/lib/verify/freshness.ts — RSCH-10 source-freshness probe (D-10, WARN-only;
// Phase 20 VRFY-15 / VRFY-28 carry-over 1, D-20-13, D-20-15).
//
// Advisory side-channel for the verifier: it never feeds a blocking verdict
// (Pass 1 records those). For each cited key the table says exactly what was
// probed — never an `ok` for a probe that was not sent (carry-over 1):
//
//   - a key missing from CITATIONS.bib: `not in CITATIONS.bib — see its Pass-1
//     row` (Pass 1 calls it FABRICATED);
//   - a key with no DOI: `no DOI — checked at <registrar> by Pass 1` (arXiv,
//     PubMed, the books registries), or `no DOI, arXiv id, PMID or ISBN — see
//     its Pass-1 row`;
//   - a DOI:
//       DOI HEAD — an HTTP HEAD of https://doi.org/<doi> through the one egress
//         gate, never followed (the handle's redirect IS the answer): 2xx / 3xx
//         → `ok`; 4xx / 5xx → WARN; no answer (a transport error, a refused or
//         unavailable host) → `unavailable` with the reason; offline /
//         --dry-run → `skipped (offline)` / `skipped (dry-run)` (RUN-03: a HEAD
//         answer is never replayed);
//       retraction-watch — the DOI's registration agency first (Crossref's
//         record of it — the same answer Pass 1 just fetched, served from the
//         HTTP cache or the recorded fixture — else doi.org's agency lookup of
//         its prefix; a DataCite arXiv DOI is DataCite's): Crossref → the
//         Retraction Watch lookup: a notice → WARN, none → `ok`, no answer →
//         `unavailable`; another agency → `unknown` (`retraction status unknown
//         (no retraction data for <agency> DOIs)` — reported, never shown as
//         clean, D-20-13).
//
// A key whose LIBRARY.json retraction status is `unknown` (research could not
// decide it) is RE-CHECKED on every verify (with the rest of the probe) and
// done (only those keys, before export: runFreshnessForDraft `onlyRecheck`;
// a retraction found blocks, and done records the answers once it exports),
// never from the HTTP cache (`refresh`); a decided answer (clear / retracted)
// is recorded through the library writer (library.ts recordRetractionStatuses,
// under its lock).
//
// SSRF mitigation (T-04-05): the DOI is format-validated via doi.ts BEFORE any
// request, and the HEAD target is always `https://doi.org/<normalized-doi>`.

import { normalizeDoi, isReservedDryRunId } from '../doi.js';
import { fetch as httpFetch, isOfflineEgressError, isHostUnavailableError, offlineLabel } from '../http.js';
import { errorFailureReason } from '../sources/search-failure.js';
import { networkMode } from '../http-mock.js';
import { fetchById as retractionWatchFetchById, isRetractionLookupError } from '../sources/retraction-watch.js';
import { sources } from '../sources/index.js';
import { registrationAgency } from '../sources/doi-ra.js';
import { isDataCiteArxivDoi } from '../full-text.js';
import { recordRetractionStatuses } from '../library.js';
import { Semaphore } from '../budget.js';

export type FreshnessProbe = 'DOI HEAD' | 'retraction-watch' | 'registrar' | 'CITATIONS.bib';
export type FreshnessStatus = 'WARN';

export interface FreshnessWarning {
  /** Which probe produced this warning. */
  probe: FreshnessProbe;
  /** Always 'WARN' — freshness is advisory-only by construction (D-10). */
  status: FreshnessStatus;
  /** Human-readable detail for the VERIFICATION.md table. */
  detail: string;
}

/** One cited key as the probe sees it. */
export interface FreshnessSource {
  readonly citekey: string;
  /** False when the key is not in CITATIONS.bib. */
  readonly inBib: boolean;
  readonly doi: string | null;
  /** Where Pass 1 checks a DOI-less entry (`arXiv`, `PubMed`, `the books registries`), or null for none. */
  readonly registrar: string | null;
  /** LIBRARY.json records its retraction status as `unknown`: re-check it live, never from the cache. */
  readonly recheck?: boolean;
}

export interface FreshnessResult {
  citekey: string;
  /** DOI that was probed (normalized) or null when none was available. */
  doi: string | null;
  /** Zero or more advisory warnings. Empty array == no staleness signal. */
  warnings: FreshnessWarning[];
  /**
   * Probes that gave no answer: NOT run because the run is offline, e.g.
   * 'skipped (offline)' (RUN-03), or 'unavailable' when the live lookup failed
   * (`note` says why — the status is unknown, never "ok").
   */
  skipped?: Array<{ probe: FreshnessProbe; detail: string; note?: string }>;
  /** Probes that were SENT and answered clean — the only `ok` rows the table prints. */
  ok?: Array<{ probe: FreshnessProbe; detail: string }>;
  /** What the table says instead of a probe: no DOI, not in the bib, a retraction status no registrar holds. */
  info?: Array<{ probe: FreshnessProbe; status: string; detail: string }>;
  /** The live re-check of a status LIBRARY.json records as unknown (VRFY-15). */
  recheck?: { status: 'clear' | 'retracted' | 'unknown'; details: string | null };
}

function debug(msg: string): void {
  if (process.env['PENSMITH_DEBUG'] === '1') {
    process.stderr.write(`[freshness] ${msg}\n`);
  }
}

/** A table-safe one-line reason. */
function cell(s: string): string {
  return s.replace(/\|/g, '/').replace(/\s*\r?\n\s*/g, ' ').trim();
}

type Agency = { kind: 'agency'; agency: string } | { kind: 'none'; reason: string } | { kind: 'skipped'; detail: string } | { kind: 'unavailable'; note: string };

/**
 * Who registered `doi` (see the header): Crossref when Crossref has a record
 * of it (the answer Pass 1 fetched — cache or fixture), else doi.org's agency
 * of the prefix. Never throws.
 */
async function registrationAgencyOf(doi: string): Promise<Agency> {
  if (isDataCiteArxivDoi(doi)) return { kind: 'agency', agency: 'DataCite' };
  try {
    const r = await sources.crossref.lookupById(doi);
    if (r.kind === 'found') return { kind: 'agency', agency: 'Crossref' };
    if (r.kind === 'failed') return { kind: 'unavailable', note: `${cell(r.reason)} — re-run verify` };
    const ra = await registrationAgency(doi);
    if (ra.kind === 'agency') return ra;
    if (ra.kind === 'unknown-prefix') return { kind: 'none', reason: 'no registration agency holds its prefix — see its Pass-1 row' };
    return { kind: 'unavailable', note: `the registration agency of ${doi} is unknown: ${cell(ra.reason)} — re-run verify` };
  } catch (err) {
    if (isOfflineEgressError(err)) return { kind: 'skipped', detail: `skipped (${offlineLabel(err)})` };
    return { kind: 'unavailable', note: `${cell(errorFailureReason(err))} — re-run verify` };
  }
}

/**
 * Probe one cited key (see the header). Never throws on a network failure:
 * an unanswered probe is an `unavailable` or `skipped` row, never `ok`.
 */
export async function probeFreshness(source: FreshnessSource): Promise<FreshnessResult> {
  const { citekey } = source;
  const warnings: FreshnessWarning[] = [];
  const skipped: NonNullable<FreshnessResult['skipped']> = [];
  const ok: NonNullable<FreshnessResult['ok']> = [];
  const info: NonNullable<FreshnessResult['info']> = [];
  let recheck: FreshnessResult['recheck'];
  const done = (doi: string | null): FreshnessResult => ({
    citekey,
    doi,
    warnings,
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(ok.length > 0 ? { ok } : {}),
    ...(info.length > 0 ? { info } : {}),
    ...(recheck !== undefined ? { recheck } : {}),
  });

  if (!source.inBib) {
    info.push({ probe: 'CITATIONS.bib', status: 'missing', detail: 'not in CITATIONS.bib — see its Pass-1 row' });
    return done(null);
  }
  if (source.doi === null) {
    info.push(
      source.registrar !== null
        ? { probe: 'registrar', status: 'no DOI', detail: `no DOI — checked at ${source.registrar} by Pass 1` }
        : { probe: 'registrar', status: 'no DOI', detail: 'no DOI, arXiv id, PMID or ISBN — see its Pass-1 row' },
    );
    return done(null);
  }
  // SSRF mitigation: validate the DOI format before issuing ANY request.
  const normalized = normalizeDoi(source.doi);
  if (normalized === null) {
    debug(`citekey=${citekey} doi=${JSON.stringify(source.doi)} failed normalization — not probed`);
    info.push({ probe: 'DOI HEAD', status: 'not probed', detail: 'the DOI does not normalize — see its Pass-1 row' });
    return done(null);
  }

  // --- DOI HEAD probe ---
  const mode = networkMode();
  if (mode.sourcesOffline) {
    // RUN-03: offline never HEADs doi.org and never replays a canned answer.
    skipped.push({ probe: 'DOI HEAD', detail: `skipped (${mode.dryRun ? 'dry-run' : 'offline'})` });
  } else {
    try {
      const res = await httpFetch(`https://doi.org/${normalized}`, { method: 'HEAD', timeoutMs: 10_000, followRedirects: false });
      if (res.status >= 400) {
        warnings.push({ probe: 'DOI HEAD', status: 'WARN', detail: `DOI HEAD returned ${res.status} — source may be stale or moved` });
      } else {
        ok.push({ probe: 'DOI HEAD', detail: `doi.org resolves it (HTTP ${res.status})` });
      }
    } catch (err) {
      // No answer is never "ok" (carry-over 1): the row says why.
      const why = isHostUnavailableError(err) ? errorFailureReason(err) : `no answer: ${errorFailureReason(err)}`;
      skipped.push({ probe: 'DOI HEAD', detail: 'unavailable', note: `${cell(why)} — re-run verify` });
    }
  }

  // --- Retraction status ---
  if (isReservedDryRunId(normalized)) {
    info.push({ probe: 'retraction-watch', status: 'not probed', detail: 'a synthetic --dry-run source' });
    return done(normalized);
  }
  const agency = await registrationAgencyOf(normalized);
  if (agency.kind === 'skipped') {
    skipped.push({ probe: 'retraction-watch', detail: agency.detail });
    return done(normalized);
  }
  if (agency.kind === 'unavailable') {
    skipped.push({ probe: 'retraction-watch', detail: 'unavailable', note: agency.note });
    if (source.recheck === true) recheck = { status: 'unknown', details: null };
    return done(normalized);
  }
  if (agency.kind === 'none') {
    info.push({ probe: 'retraction-watch', status: 'unknown', detail: agency.reason });
    return done(normalized);
  }
  if (!/^crossref$/i.test(agency.agency)) {
    info.push({ probe: 'retraction-watch', status: 'unknown', detail: `retraction status unknown (no retraction data for ${agency.agency} DOIs)` });
    if (source.recheck === true) recheck = { status: 'unknown', details: null };
    return done(normalized);
  }
  try {
    const hit = await retractionWatchFetchById(normalized, source.recheck === true ? { refresh: true } : {});
    if (hit) {
      const why = hit.retraction_details ? ` (${hit.retraction_details})` : '';
      warnings.push({ probe: 'retraction-watch', status: 'WARN', detail: `cited work appears in Retraction Watch${why}` });
      if (source.recheck === true) recheck = { status: 'retracted', details: hit.retraction_details ?? null };
    } else {
      ok.push({ probe: 'retraction-watch', detail: source.recheck === true ? 'no retraction notice (re-checked: LIBRARY.json had it unknown)' : 'no retraction notice' });
      if (source.recheck === true) recheck = { status: 'clear', details: null };
    }
  } catch (err) {
    if (isOfflineEgressError(err)) {
      skipped.push({ probe: 'retraction-watch', detail: `skipped (${offlineLabel(err)})` });
    } else {
      // Never block on the advisory probe, but never hide a failed lookup
      // either: an unknown retraction status is an "unavailable" row (SRC-04).
      const why = isRetractionLookupError(err) ? err.message : `retraction status unknown: ${errorFailureReason(err)}`;
      skipped.push({ probe: 'retraction-watch', detail: 'unavailable', note: `${cell(why)} — re-run verify` });
    }
    if (source.recheck === true) recheck = { status: 'unknown', details: null };
  }
  return done(normalized);
}

/**
 * Probe many cited keys concurrently under a Semaphore(5) fan-out cap.
 * Results preserve input order. With `root`, the re-checks that decided a
 * status LIBRARY.json records as unknown are written through the library
 * writer (clear or retracted; an unknown stays unknown).
 */
export async function probeFreshnessAll(
  list: ReadonlyArray<FreshnessSource>,
  opts: { readonly root?: string } = {},
): Promise<FreshnessResult[]> {
  const sem = new Semaphore(5);
  const results = await Promise.all(list.map((s) => sem.withLock(() => probeFreshness(s))));
  if (opts.root !== undefined) {
    const decided: Record<string, { status: 'clear' | 'retracted'; details: string | null }> = {};
    for (const r of results) {
      if (r.recheck !== undefined && r.recheck.status !== 'unknown') decided[r.citekey] = { status: r.recheck.status, details: r.recheck.details };
    }
    if (Object.keys(decided).length > 0) {
      try {
        await recordRetractionStatuses(opts.root, decided);
      } catch (err) {
        debug(`could not record re-checked retraction statuses: ${String(err)}`);
      }
    }
  }
  return results;
}

const PROBE_ORDER: readonly FreshnessProbe[] = ['CITATIONS.bib', 'registrar', 'DOI HEAD', 'retraction-watch'];

/**
 * Render the `## Source Freshness (RSCH-10)` table for VERIFICATION.md.
 * Deterministic, no LLM. Every row says what was probed; `ok` only for a
 * probe that was sent and answered clean.
 */
export function renderFreshnessTable(results: ReadonlyArray<FreshnessResult>): string {
  const lines = [
    '## Source Freshness (RSCH-10)',
    '',
    '| Citekey | Probe | Status | Detail |',
    '|---------|-------|--------|--------|',
  ];
  if (results.length === 0) {
    lines.push('| _(none)_ | — | — | no citations to probe |');
    return lines.join('\n');
  }
  for (const r of results) {
    const rows: Array<{ probe: FreshnessProbe; text: string }> = [];
    for (const i of r.info ?? []) rows.push({ probe: i.probe, text: `| ${r.citekey} | ${i.probe} | ${i.status} | ${cell(i.detail)} |` });
    for (const o of r.ok ?? []) rows.push({ probe: o.probe, text: `| ${r.citekey} | ${o.probe} | ok | ${cell(o.detail)} |` });
    for (const w of r.warnings) rows.push({ probe: w.probe, text: `| ${r.citekey} | ${w.probe} | ${w.status} | ${cell(w.detail)} |` });
    for (const sk of r.skipped ?? []) {
      rows.push({ probe: sk.probe, text: `| ${r.citekey} | ${sk.probe} | ${sk.detail} | ${sk.note ?? 'not probed — re-run online'} |` });
    }
    rows.sort((a, b) => PROBE_ORDER.indexOf(a.probe) - PROBE_ORDER.indexOf(b.probe));
    for (const x of rows) lines.push(x.text);
  }
  return lines.join('\n');
}
