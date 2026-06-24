// bin/lib/verify/pass1.ts — Pass-1 citation-integrity verifier (D-11, VRFY-02, D-13).
//
// Deterministic — NO LLM (D-13 LOCKED INVARIANT). Every verdict is a function
// of:
//   - whether the citekey appears in .paper/CITATIONS.bib
//   - whether the entry has a DOI / authors / title (field-presence sub-gate)
//   - whether the entry is flagged retracted (Retraction Watch cross-check)
//   - Crossref DOI resolution
//   - Jaro-Winkler comparison of (claimed title, actual title) >= TITLE_JW_THRESHOLD
//     AND (claimed first-author surname, actual first-author surname) >= AUTHOR_JW_THRESHOLD
//     (D-11 AND-gate — BOTH must hold)
//
// CYCLE-2 H-2 D-14 author shape lock:
//   The internal canonical author type is D-14 `string[]` ("Family, Given").
//   When reading citation-js parsed BibTeX entries (which use { family, given }
//   objects), we normalize ONCE at the boundary into the D-14 string[] form.
//   We NEVER `claimed.author[0].family` downstream — the BibTeX shape is
//   scoped to the normalize step only.
//
// CYCLE-2 H-4 signature lock:
//   `runPass1(draftMd: string, citationsBibPath: string)` is the canonical
//   draft-+-bib entrypoint. `runPass1Unit(input)` is the fixture-shape
//   helper used by tests/known-bad-citations.test.ts in Plan 03-09.

import { jaroWinkler, TITLE_JW_THRESHOLD, AUTHOR_JW_THRESHOLD } from '../fuzzy.js';
import { firstAuthorSurname } from '../author-normalize.js';
import { sources } from '../sources/index.js';
import { parseBibtex } from '../citations.js';
import { readFileSync } from 'node:fs';
import { probeFreshnessAll, type FreshnessResult } from './freshness.js';
import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js';

export type { FreshnessResult } from './freshness.js';
export { renderFreshnessTable } from './freshness.js';

export type Pass1Verdict = 'OK' | 'MIS-CITED' | 'FABRICATED';

export interface Pass1Result {
  citekey: string;
  verdict: Pass1Verdict;
  titleJW: number;
  authorJW: number;
  reason: string;
}

interface BibAuthor {
  family?: string;
  given?: string;
}

interface BibEntry {
  id?: string;
  title?: string | string[];
  author?: BibAuthor[];
  DOI?: string;
  retracted?: boolean;
}

/**
 * Normalize a citation-js BibTeX author array into the D-14 `string[]` shape.
 *
 * Output strings are "Family, Given" or "Family" when given-name is missing,
 * matching SourceCandidate.authors (Plan 03-04 adapters). This is the ONLY
 * point in pass1.ts that reads the BibTeX-native `{family, given}` shape;
 * every downstream comparison operates on D-14 string[].
 */
function normalizeBibAuthors(rawAuthors: BibAuthor[] | undefined): string[] {
  return (rawAuthors ?? [])
    .map((a) => {
      const family = String(a?.family ?? '').trim();
      const given = String(a?.given ?? '').trim();
      if (!family) return '';
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
}

function bibTitle(claimed: BibEntry): string {
  if (Array.isArray(claimed.title)) {
    return claimed.title[0] ?? '';
  }
  return claimed.title ?? '';
}

/**
 * Pass-1 deterministic verdict for a single citekey.
 *
 * Pure per-key logic — used by both `runPass1` (which iterates citekeys
 * pulled from a DRAFT.md) and `runPass1Unit` (which iterates fixture
 * entries without a DRAFT.md). Centralizes the field-presence sub-gate
 * and the D-11 AND-gate so the two callers never drift.
 */
async function verdictForCitekey(
  ck: string,
  claimed: BibEntry | undefined,
): Promise<Pass1Result> {
  if (!claimed) {
    return {
      citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0,
      reason: 'citekey not in .paper/CITATIONS.bib (drafter invented)',
    };
  }
  // CYCLE-2 H-2 D-14 author shape lock — normalize ONCE at the boundary.
  const claimedAuthorsD14 = normalizeBibAuthors(claimed.author);
  const claimedTitle = bibTitle(claimed);

  // Field-presence sub-gate (REVIEWS amendment OpenCode MEDIUM #5).
  if (!claimedTitle || claimedAuthorsD14.length === 0) {
    return {
      citekey: ck, verdict: 'MIS-CITED', titleJW: 0, authorJW: 0,
      reason: 'claimed citation metadata incomplete (empty title or no authors)',
    };
  }
  if (claimed.retracted) {
    return {
      citekey: ck, verdict: 'MIS-CITED', titleJW: 0, authorJW: 0,
      reason: 'cited a retracted work (per Retraction Watch cross-check at research time)',
    };
  }
  if (!claimed.DOI) {
    return {
      citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0,
      reason: 'no DOI in citation entry (cannot verify upstream)',
    };
  }

  const actual = await sources.crossref.fetchById(claimed.DOI);
  if (!actual) {
    return {
      citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0,
      reason: `DOI ${claimed.DOI} did not resolve via Crossref`,
    };
  }

  // GATE-03: live retraction re-query at verify time (Phase 14, Plan 03).
  // Re-query Retraction Watch on the Crossref-confirmed DOI. A confirmed hit
  // (non-null) escalates to MIS-CITED (blocking). A transport error or no-hit
  // (fetchById returns null — never throws) is a silent skip; the verdict falls
  // through to the normal JW path. No try/catch needed: the adapter already
  // catches all transport errors and returns null (retraction-watch.ts:122-126).
  // Placed AFTER the Crossref null-guard so FABRICATED citations (unresolved DOI)
  // never reach this check (Pitfall 1 — avoids cassette-fallback false positives).
  const liveRetraction = await retractionWatchFetchById(claimed.DOI);
  if (liveRetraction !== null) {
    const why = liveRetraction.retraction_details
      ? `: ${liveRetraction.retraction_details}`
      : '';
    return {
      citekey: ck, verdict: 'MIS-CITED', titleJW: 0, authorJW: 0,
      reason: `cited work appears in Retraction Watch (live re-query at verify time)${why}`,
    };
  }

  const titleJW = jaroWinkler(actual.title, claimedTitle);
  const authorJW = jaroWinkler(
    firstAuthorSurname(actual.authors?.[0] ?? ''),
    firstAuthorSurname(claimedAuthorsD14[0] ?? ''),
  );

  // Multi-DOI redirect handling — the claimed DOI may have redirected to a
  // different canonical DOI; strict-match (≥0.98 title / ≥0.95 author) lets
  // it pass with a diagnostic, otherwise MIS-CITED.
  const actualDoi: string = actual.doi ?? claimed.DOI;
  if (actualDoi !== claimed.DOI) {
    if (titleJW >= 0.98 && authorJW >= 0.95) {
      return {
        citekey: ck, verdict: 'OK', titleJW, authorJW,
        reason: `multi-DOI redirect: ${claimed.DOI} → ${actualDoi}, strict-match OK`,
      };
    }
    return {
      citekey: ck, verdict: 'MIS-CITED', titleJW, authorJW,
      reason: `claimed DOI ${claimed.DOI} resolves to different work (canonical: ${actualDoi})`,
    };
  }

  if (titleJW >= TITLE_JW_THRESHOLD && authorJW >= AUTHOR_JW_THRESHOLD) {
    return {
      citekey: ck, verdict: 'OK', titleJW, authorJW,
      reason: 'D-11 AND-gate passed',
    };
  }
  return {
    citekey: ck, verdict: 'MIS-CITED', titleJW, authorJW,
    reason: `JW below threshold (title=${titleJW.toFixed(2)}/${TITLE_JW_THRESHOLD}, author=${authorJW.toFixed(2)}/${AUTHOR_JW_THRESHOLD})`,
  };
}

/**
 * CYCLE-2 H-4 canonical Pass-1 signature: read draft + bib, return per-citekey
 * verdicts.
 *
 * Workflow:
 *   1. Parse the BibTeX file into a citekey→entry map.
 *   2. Pull every `[@citekey]` token out of the draft (deduplicated).
 *   3. For each, call verdictForCitekey and collect the result.
 *
 * 100% deterministic — no LLM, no narration, no side effects beyond the
 * Crossref HTTP read (cassette-served in offline test mode).
 */
export async function runPass1(
  draftMd: string,
  citationsBibPath: string,
): Promise<Pass1Result[]> {
  const bibText = readFileSync(citationsBibPath, 'utf8');
  const entries = await parseBibtex(bibText);
  const bibByCitekey = new Map<string, BibEntry>(
    entries.map((e) => [String(e['id'] ?? ''), e as BibEntry]),
  );

  const citekeys = [...draftMd.matchAll(/\[@([a-z][a-z0-9_-]*)\]/g)]
    .map((m) => m[1])
    .filter((s): s is string => Boolean(s));
  const unique = [...new Set(citekeys)];

  const results: Pass1Result[] = [];
  for (const ck of unique) {
    results.push(await verdictForCitekey(ck, bibByCitekey.get(ck)));
  }
  return results;
}

/**
 * RSCH-10 source-freshness probe for a draft (D-10, WARN-only).
 *
 * SEPARATE from `runPass1` by design: this never feeds the blocking verdict
 * path. It pulls the same `[@citekey]` tokens out of the draft, resolves each
 * to its DOI in the bib, and probes freshness (DOI HEAD + retraction-watch)
 * advisory-only. A stale DOI or a retraction hit produces a WARN row; it can
 * NEVER produce a FABRICATED / MIS-CITED verdict (PRD §14 / D-10).
 *
 * Returns one FreshnessResult per unique citekey, in draft-appearance order.
 */
export async function runFreshnessForDraft(
  draftMd: string,
  citationsBibPath: string,
): Promise<FreshnessResult[]> {
  const bibText = readFileSync(citationsBibPath, 'utf8');
  const entries = await parseBibtex(bibText);
  const doiByCitekey = new Map<string, string | null>(
    entries.map((e) => [
      String((e as BibEntry).id ?? ''),
      (e as BibEntry).DOI ?? null,
    ]),
  );

  const citekeys = [...draftMd.matchAll(/\[@([a-z][a-z0-9_-]*)\]/g)]
    .map((m) => m[1])
    .filter((s): s is string => Boolean(s));
  const unique = [...new Set(citekeys)];

  return probeFreshnessAll(
    unique.map((ck) => ({ citekey: ck, doi: doiByCitekey.get(ck) ?? null })),
  );
}

/**
 * CYCLE-2 H-4 — fixture-shape helper for tests/known-bad-citations.test.ts.
 *
 * Takes a synthetic `{ claimed, actual }` shape directly so unit fixtures
 * can be tested in isolation — no HTTP, no BibTeX parse, no DRAFT.md.
 * Plan 03-09 tests/known-bad-citations.test.ts MUST import this helper,
 * NOT `runPass1`.
 */
export function runPass1Unit(input: {
  claimed: { title: string; authors: string[]; doi: string | null; retracted?: boolean };
  actual: { title: string; authors: string[]; doi: string | null } | null;
}): { verdict: Pass1Verdict; titleJW: number; authorJW: number; reason: string } {
  if (!input.claimed.doi) {
    return { verdict: 'FABRICATED', titleJW: 0, authorJW: 0, reason: 'no DOI in claimed citation' };
  }
  if (input.claimed.retracted) {
    return { verdict: 'MIS-CITED', titleJW: 0, authorJW: 0, reason: 'cited a retracted work' };
  }
  if (!input.actual) {
    return { verdict: 'FABRICATED', titleJW: 0, authorJW: 0, reason: `DOI ${input.claimed.doi} did not resolve` };
  }
  const titleJW = jaroWinkler(input.actual.title ?? '', input.claimed.title ?? '');
  // CYCLE-3 MEDIUM REVIEWS CONVERGENCE — defense-in-depth null-safety.
  // Optional chaining on both `actual?` and `authors?.[0]` prevents the
  // whole pass from throwing on a single malformed fixture row.
  const authorJW = jaroWinkler(
    firstAuthorSurname(input.actual?.authors?.[0] ?? ''),
    firstAuthorSurname(input.claimed?.authors?.[0] ?? ''),
  );
  if (titleJW >= TITLE_JW_THRESHOLD && authorJW >= AUTHOR_JW_THRESHOLD) {
    return { verdict: 'OK', titleJW, authorJW, reason: 'D-11 AND-gate passed' };
  }
  return {
    verdict: 'MIS-CITED', titleJW, authorJW,
    reason: `JW below threshold (title=${titleJW.toFixed(2)}/${TITLE_JW_THRESHOLD}, author=${authorJW.toFixed(2)}/${AUTHOR_JW_THRESHOLD})`,
  };
}
