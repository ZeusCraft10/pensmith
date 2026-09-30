// bin/lib/sources/retraction-cross-check.ts — D-15 surface-twice helper
// (SRC-04, D-19-11).
//
// The research orchestrator (bin/cli/research.ts) calls
// `crossCheckRetractions(candidates)` AFTER the adapter discovery pass and
// BEFORE LIBRARY.json is persisted. Every DOI-bearing candidate leaves it with a
// decided `retraction_status`:
//
//   retracted — a retraction / withdrawal / removal notice updates the DOI
//               (`retracted: true`, `retraction_details` = the notice);
//   clear     — a live answer listed no such notice, for a DOI Crossref
//               registered (Phase 20, D-20-13: the candidate came from
//               Crossref, or doi.org's agency lookup of its prefix says
//               Crossref — one lookup per prefix per run). Retraction data
//               (Crossref's `updated-by`, the Retraction Watch feed) exists
//               only for Crossref DOIs: Crossref's "no notice" says nothing
//               about a DataCite, mEDRA, JaLC … DOI;
//   unknown   — the lookup could not answer (a non-200, an error body, a rate
//               limit, an open breaker, a transport error, or — offline — no
//               recorded fixture), or the DOI is another agency's (`no
//               retraction data for <agency> DOIs`, recorded as the entry's
//               retraction_details so RESEARCH.md can say why). UNKNOWN is
//               never "clear": research reports `retraction status unknown for
//               N source(s)`, RESEARCH.md shows it, Pass 1 re-queries a
//               Crossref DOI at verify time (blocking), and the freshness pass
//               re-checks every unknown status on each verify and done.
//
// Nothing is swallowed: every failure becomes `unknown`, with its reason
// available through retractionCheckReason(candidate).
//
// Economy (the audit counted 115 lookups in one run): a candidate whose own
// registrar record already decided its status (Crossref's `updated-by`, an
// OpenAlex `is_retracted`) is not looked up again, and each DOI is looked up
// at most once — its answer applies to every candidate carrying that DOI. A
// retraction is sticky: when any record of a DOI says retracted, every
// candidate with that DOI is retracted (fail closed).
//
// Synthetic --dry-run sources (reserved identifiers, `synthetic: true`) are
// left as they are: no registrar knows them and they never leave a dry run.
//
// D-15 LOCKED: we MUST call fetchById only. retraction-watch's index module
// intentionally exposes no `search` export; eslint backstops the rule.

import { sources } from './index.js';
import { isOfflineEgressError, offlineLabel } from '../http.js';
import { normalizeDoi } from '../doi.js';
import { registrationAgency as doiRegistrationAgency, doiPrefix, type RegistrationAgency } from './doi-ra.js';
import { isDataCiteArxivDoi } from '../full-text.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

/**
 * Optional dependency injection seam — the production path uses the real
 * retraction-watch adapter; tests can inject a fake to avoid hitting the
 * network or relying on a specific cassette. Matches the signature of
 * `sources['retraction-watch'].fetchById`.
 */
export interface RetractionLookup {
  fetchById: (doi: string) => Promise<SourceCandidate | null>;
  /**
   * Which agency registered a DOI's prefix (doi.org, sources/doi-ra.ts) —
   * injectable like fetchById; the real lookup when absent.
   */
  registrationAgency?: (doi: string) => Promise<RegistrationAgency>;
}

/** Why a DOI another agency registered has no retraction status (D-20-13). */
export function noRetractionDataReason(agency: string): string {
  return `no retraction data for ${agency} DOIs`;
}

/**
 * True for a recorded `retraction_details` that says the DOI's agency
 * publishes no retraction data (noRetractionDataReason): the status stays
 * `unknown` for good, so nothing re-checks it (review round 2) — only a failed
 * lookup is worth asking again.
 */
export function isNoRetractionDataReason(details: string | null | undefined): boolean {
  return typeof details === 'string' && /^no retraction data for .+ DOIs$/.test(details.trim());
}

/** The registrar adapters whose own record says who registered its DOI. */
const AGENCY_OF_SOURCE: Readonly<Record<string, string>> = { crossref: 'Crossref', datacite: 'DataCite' };

const unknownReasons = new WeakMap<SourceCandidate, string>();

/** Why a candidate's retraction status is `unknown` after crossCheckRetractions (undefined otherwise). */
export function retractionCheckReason(candidate: SourceCandidate): string | undefined {
  return unknownReasons.get(candidate);
}

type Decided = { status: 'retracted'; details: string | undefined } | { status: 'clear' };

function setRetracted(c: SourceCandidate, details: string | undefined): void {
  c.retracted = true;
  c.retraction_status = 'retracted';
  if (details && !c.retraction_details) c.retraction_details = details;
  unknownReasons.delete(c);
}

function setClear(c: SourceCandidate): void {
  c.retracted = false;
  c.retraction_status = 'clear';
  unknownReasons.delete(c);
}

function setUnknown(c: SourceCandidate, reason: string, recordReason = false): void {
  // `retracted` stays false only because nothing confirmed a retraction; the
  // status says the question is open.
  c.retraction_status = 'unknown';
  // A stable reason (another agency's DOI) is kept on the entry for RESEARCH.md.
  if (recordReason && !c.retraction_details) c.retraction_details = reason;
  unknownReasons.set(c, reason);
}

/**
 * What the candidates' own records already say about one DOI, or null. Only a
 * Crossref record's `clear` is a decision (its `updated-by` carries the
 * Retraction Watch notices, D-19-11); a retraction any record reports is.
 */
function decidedByRecords(group: readonly SourceCandidate[]): Decided | null {
  const retracted = group.find((c) => c.retracted === true || c.retraction_status === 'retracted');
  if (retracted) return { status: 'retracted', details: retracted.retraction_details };
  if (group.some((c) => c.source === 'crossref' && c.retraction_status === 'clear')) return { status: 'clear' };
  return null;
}

function lookupFailureReason(err: unknown): string {
  if (isOfflineEgressError(err)) {
    return offlineLabel(err) === 'dry-run'
      ? 'dry-run: no retraction lookup under --dry-run'
      : 'offline: no recorded fixture for the retraction lookup — re-run online';
  }
  const msg = err instanceof Error ? err.message : String(err);
  return (msg.split(/\r?\n/)[0] ?? '').slice(0, 240);
}

/**
 * Decide the retraction status of every DOI-bearing candidate (see the module
 * header). Mutates the candidates in place and returns the same array.
 *
 * D-15: never calls `.search()` — retraction-watch is fetchById-only.
 */
export async function crossCheckRetractions(
  candidates: SourceCandidate[],
  lookup: RetractionLookup = sources['retraction-watch'],
): Promise<SourceCandidate[]> {
  const agencyLookup = lookup.registrationAgency ?? doiRegistrationAgency;
  // D-20-13: one doi.org agency lookup per prefix per run.
  const agencies = new Map<string, Promise<{ agency: string } | { reason: string }>>();
  const agencyOf = (doi: string, group: readonly SourceCandidate[]): Promise<{ agency: string } | { reason: string }> => {
    for (const c of group) {
      const known = AGENCY_OF_SOURCE[c.source];
      if (known !== undefined) return Promise.resolve({ agency: known });
    }
    if (isDataCiteArxivDoi(doi)) return Promise.resolve({ agency: 'DataCite' });
    const prefix = doiPrefix(doi) ?? doi;
    let p = agencies.get(prefix);
    if (p === undefined) {
      p = (async () => {
        try {
          const ra = await agencyLookup(doi);
          if (ra.kind === 'agency') return { agency: ra.agency };
          if (ra.kind === 'unknown-prefix') return { reason: `no registration agency holds the DOI prefix ${prefix}` };
          return { reason: `doi.org could not say which agency registered ${prefix} (${ra.reason})` };
        } catch (err) {
          return { reason: lookupFailureReason(err).replace('the retraction lookup', `doi.org's agency lookup of ${prefix}`) };
        }
      })();
      agencies.set(prefix, p);
    }
    return p;
  };
  // Group by normalized DOI, first-seen order (one lookup per DOI).
  const groups = new Map<string, SourceCandidate[]>();
  for (const c of candidates) {
    if (!c.doi || c.synthetic === true) continue;
    const key = normalizeDoi(c.doi) ?? c.doi.trim().toLowerCase();
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }

  for (const group of groups.values()) {
    const known = decidedByRecords(group);
    if (known !== null) {
      for (const c of group) {
        if (known.status === 'retracted') setRetracted(c, known.details);
        else setClear(c);
      }
      continue;
    }
    const doi = group[0]!.doi!;
    // Retraction data exists for Crossref DOIs only (D-20-13): ask who registered it.
    const who = await agencyOf(doi, group);
    if ('reason' in who) {
      for (const c of group) setUnknown(c, who.reason);
      continue;
    }
    if (!/^crossref$/i.test(who.agency)) {
      for (const c of group) setUnknown(c, noRetractionDataReason(who.agency), true);
      continue;
    }
    try {
      const hit = await lookup.fetchById(doi);
      if (hit && hit.retracted === true) {
        for (const c of group) setRetracted(c, hit.retraction_details);
      } else {
        for (const c of group) setClear(c);
      }
    } catch (err) {
      const reason = lookupFailureReason(err);
      for (const c of group) setUnknown(c, reason);
    }
  }
  return candidates;
}
