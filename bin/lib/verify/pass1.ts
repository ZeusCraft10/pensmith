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
import { probeFreshness, type FreshnessResult } from './freshness.js';

export type Pass1Verdict = 'OK' | 'MIS-CITED' | 'FABRICATED';

export interface Pass1Result {
  citekey: string;
  verdict: Pass1Verdict;
  titleJW: number;
  authorJW: number;
  reason: string;
}

/**
 * Aggregate return type for runPass1 (Phase 4 extension — RSCH-10).
 * The `results` array is the canonical blocking-verdict list (unchanged from
 * Phase 3). The `freshness` array carries WARN-only advisory data for
 * VERIFICATION.md and the COMPILE-REPORT aggregation (Plan 05).
 */
export interface Pass1RunResult {
  results: Pass1Result[];
  freshness: FreshnessResult[];
}

export type { FreshnessResult };

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
 *   4. (Phase 4 RSCH-10 extension) Probe freshness for each citekey that
 *      resolved a DOI. Freshness results are WARN-only — they do NOT change
 *      any blocking verdict (D-10 / PRD §14).
 *
 * 100% deterministic — no LLM, no narration, no side effects beyond the
 * Crossref HTTP read (cassette-served in offline test mode).
 */
export async function runPass1(
  draftMd: string,
  citationsBibPath: string,
): Promise<Pass1RunResult> {
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

  // RSCH-10 freshness probe — WARN-only, never changes blocking verdicts.
  // Probe each citekey's DOI; transport errors are silent.
  const freshness: FreshnessResult[] = [];
  for (const ck of unique) {
    const entry = bibByCitekey.get(ck);
    const doi = entry?.DOI ?? null;
    const freshnessResult = await probeFreshness(ck, doi ?? null);
    freshness.push(freshnessResult);
  }

  return { results, freshness };
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
