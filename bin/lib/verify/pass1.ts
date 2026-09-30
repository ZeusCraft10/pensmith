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
//
// UNVERIFIABLE (D-17-07, RUN-03, RUN-04): when the Crossref re-fetch or the
// live Retraction Watch re-query is unavailable BECAUSE OF THE NETWORK MODE
// (a sources-offline fixture miss, or --dry-run), the verdict is UNVERIFIABLE
// with the reason "offline: no recorded fixture — re-run online" (or the
// dry-run equivalent). It is BLOCKING — compile and done refuse it with a
// "re-run online" message — and it is never OK, MIS-CITED or FABRICATED.
//
// A FAILED registrar lookup (D-19-05, SRC-05): when the Crossref re-fetch could
// not be answered — a 429 / 5xx after retries, an exhausted host, an open
// circuit breaker, a transport error, or a body that is not a Crossref answer —
// the adapter throws SourceLookupError and the verdict is UNVERIFIABLE with
// that reason (blocking, S-03). A failure never reads as "did not resolve"
// (FABRICATED): only Crossref's definitive 404 does.
//
// Retraction (SRC-04, D-19-11): the Crossref record carries its Retraction
// Watch notices (`updated-by`); a record that says retracted blocks (MIS-CITED,
// naming the notice) before the live re-query. A retraction recorded when the
// source entered the library (the bib's `note = {RETRACTED}`) blocks too, after
// the same re-fetch, so the row carries the real title / first-author scores
// and says where the flag came from (the library's notice, when `opts.root`
// names the paper). The label becomes RETRACTED in Phase 20 (VRFY-15).
//
// A Crossref 404 (review round 1 of the Phase 18/19 merge): Crossref's
// "not found" proves only that Crossref did not register the DOI. doi.org's
// agency lookup (sources/doi-ra.ts) decides: Crossref's own prefix, or a
// prefix no agency holds → FABRICATED; another agency (DataCite, ISTIC, JaLC,
// mEDRA, …) → the entry's arXiv id / PMID / ISBN at their own registrars,
// else UNVERIFIABLE naming the agency (crossrefNotFound). Which registrar Pass
// 1 asks is shared with the outline / planner source filter
// (pass1-identifiers.ts citationCheckRoute).
//
// DataCite arXiv DOIs (Phase 19 review round 2): Semantic Scholar and OpenAlex
// give an arXiv-only work the DOI `10.48550/arXiv.<id>`. It is not a Crossref
// DOI — Crossref's 404 for it says nothing about the work — so such an entry
// is re-fetched at the arXiv registrar by that id (the DOI-less path below),
// never read as "did not resolve" (FABRICATED).
//
// Titles are compared as plain text (markup.ts): a registrar that sends
// `<i>Drosophila melanogaster</i>` and one that sends the words match.
//
// Entries without a DOI (SRC-11, SRC-13, ROADMAP Phase 19 criterion 7): an
// arXiv-only preprint (`eprint` + `archivePrefix = {arXiv}`), a PubMed record
// with no DOI (`pmid`) or a book (`isbn`) is re-fetched at its OWN registrar —
// the arXiv API, PubMed E-utilities, the books adapter (Open Library / Google
// Books) — and runs the same title / first-author AND-gate. The three-way
// lookup decides: found → the AND-gate (a PubMed "Retracted Publication"
// blocks); failed / offline → UNVERIFIABLE (blocking); only a definitive
// not-found from EVERY identifier the entry carries is FABRICATED. An entry
// with no DOI, arXiv id, PMID or ISBN stays FABRICATED ("cannot verify
// upstream") — except the user's own PDF that no registrar identified (an
// unhydrated bring-your-own entry, read from LIBRARY.json when `opts.root` is
// given): it is UNVERIFIABLE (blocking), with the command that identifies it,
// because the user's real document is not an invented one (S-03; its OK-BYO
// verdict is Phase 20, VRFY-14). A DataCite (non-arXiv) record itself, the
// metadata search for identifier-less entries and the remaining registrars are
// Phase 20 (VRFY-11, VRFY-12).
//
// Reserved dry-run identifiers (RUN-27, D-17-11): under --dry-run a reserved
// `10.0000/pensmith-dryrun.*` DOI is re-fetched from the synthetic provider and
// runs the same title/author AND-gate; outside --dry-run it is FABRICATED
// ("reserved dry-run identifier") without any request.

import { jaroWinkler, TITLE_JW_THRESHOLD, AUTHOR_JW_THRESHOLD } from '../fuzzy.js';
import { firstAuthorSurname } from '../author-normalize.js';
import { sources } from '../sources/index.js';
import { parseBibFileAt } from '../citations.js';
import { readFileSync } from 'node:fs';
import { probeFreshnessAll, type FreshnessResult } from './freshness.js';
import { fetchById as retractionWatchFetchById, isRetractionLookupError } from '../sources/retraction-watch.js';
import { fetchById as dryRunFetchById } from '../sources/dry-run.js';
import { extractCitedKeysForVerification } from '../citation-token.js';
import { isReservedDryRunId, normalizeDoi } from '../doi.js';
import { isOfflineEgressError, type OfflineEgressError } from '../http.js';
import { isSourceLookupError, type LookupResult } from '../sources/lookup.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { networkMode } from '../http-mock.js';
import { plainText } from '../markup.js';
import { normArxiv } from '../migrations/library/shape.js';
import { isDataCiteArxivDoi } from '../full-text.js';
import { tryLoadLibrary } from '../library.js';
import { registrationAgency, doiPrefix } from '../sources/doi-ra.js';
import { doilessIdentifiers as routeIdentifiers, type CitationIdentifiers, type NoDoiRegistrar } from './pass1-identifiers.js';
import type { LibraryEntry } from '../schemas/library.js';

export type { FreshnessResult } from './freshness.js';
export { renderFreshnessTable } from './freshness.js';

export type Pass1Verdict = 'OK' | 'MIS-CITED' | 'FABRICATED' | 'UNVERIFIABLE';

/** The fixed UNVERIFIABLE reasons (D-17-07). */
export const UNVERIFIABLE_OFFLINE_REASON = 'offline: no recorded fixture — re-run online';
export const UNVERIFIABLE_DRY_RUN_REASON = 'dry-run: no live re-fetch under --dry-run — re-run online';
export const RESERVED_DRY_RUN_REASON = 'reserved dry-run identifier (a synthetic --dry-run source is never a real citation)';

function unverifiable(ck: string, err: OfflineEgressError, what: string): Pass1Result {
  const reason = err.mode === 'dry-run' ? UNVERIFIABLE_DRY_RUN_REASON : UNVERIFIABLE_OFFLINE_REASON;
  return { citekey: ck, verdict: 'UNVERIFIABLE', titleJW: 0, authorJW: 0, reason: `${reason} (${what})` };
}

export interface Pass1Result {
  citekey: string;
  verdict: Pass1Verdict;
  /** Title similarity; NaN when there was no record to compare (rendered `n/a`). */
  titleJW: number;
  /** First-author similarity; NaN when there was no record to compare. */
  authorJW: number;
  reason: string;
  /** True when the MIS-CITED verdict is a retraction (VRFY-15 labels it RETRACTED). */
  retraction?: boolean;
}

interface BibAuthor {
  family?: string;
  given?: string;
  /** A corporate / literal name (citation-js spelling of a braced BibTeX name). */
  literal?: string;
  /** Surname particles citation-js splits off (`van der` of `van der Maaten, Ernst`). */
  'non-dropping-particle'?: string;
  'dropping-particle'?: string;
}

interface BibEntry {
  id?: string;
  title?: string | string[];
  author?: BibAuthor[];
  DOI?: string;
  /** The arXiv id of a preprint (parseBib keeps BibTeX `eprint` / `archivePrefix` verbatim). */
  eprint?: string;
  archivePrefix?: string;
  /** BibTeX `isbn` (citation-js CSL `ISBN`). */
  ISBN?: string;
  /** BibTeX `pmid` (parseBib's CSL `PMID`). */
  PMID?: string;
  retracted?: boolean;
  // D-15 retracted-flag persistence: writeBibtex serializes a retracted source
  // as BibTeX `note = {RETRACTED}` (bibtex-write.ts:93), and citation-js
  // preserves `note` verbatim across the round-trip — it does NOT repopulate the
  // synthetic `retracted` boolean. So a bib-sourced retracted entry arrives here
  // with `note: 'RETRACTED'` and `retracted: undefined`. compile.ts:482 already
  // reads `x.note === 'RETRACTED'`; the blocking gate must do the same or the
  // entire stored-retraction surface (D-15 "surface twice") is silently dead.
  note?: string;
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
      // The particles belong to the surname the AND-gate compares (SRC-12):
      // `van der Maaten, Ernst` is compared as "van der maaten", as the
      // registrar's record spells it.
      const particle = [a?.['dropping-particle'], a?.['non-dropping-particle']]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .join(' ');
      const bare = String(a?.family ?? '').trim();
      const family = bare && particle ? `${particle} ${bare}` : bare;
      const given = String(a?.given ?? '').trim();
      const literal = String(a?.literal ?? '').trim();
      if (!family) return literal ? `{${literal}}` : '';
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
}

/**
 * The first-author surname for the AND-gate. A corporate author is written
 * braced (`{The ENCODE Project Consortium}`, D-19-13); its braces are not part
 * of the name.
 */
function surnameOf(author: string | undefined): string {
  return firstAuthorSurname(String(author ?? '').replace(/[{}]/g, ''));
}

/** Title similarity on the plain text of both titles (markup.ts). */
function titleSimilarity(actual: string | null | undefined, claimed: string): number {
  return jaroWinkler(plainText(actual ?? ''), plainText(claimed));
}

/** A score that was not computed (no record to compare): rendered `n/a`. */
const NOT_COMPARED = Number.NaN;

/** The arXiv id a DataCite arXiv DOI stands for (`10.48550/arXiv.1706.03762` → `1706.03762`), else null. */
export function arxivIdOfDataCiteDoi(doi: string): string | null {
  return isDataCiteArxivDoi(doi) ? normArxiv(doi) : null;
}

/** What Pass 1 reads from the paper's LIBRARY.json (with `opts.root`). */
interface LibraryFacts {
  /** Recorded retraction notices, by citekey. */
  readonly retractionDetails: ReadonlyMap<string, string>;
  /** Bring-your-own entries no registrar identified: citekey → the stored PDF. */
  readonly unidentifiedByo: ReadonlyMap<string, string>;
}

const NO_LIBRARY_FACTS: LibraryFacts = { retractionDetails: new Map(), unidentifiedByo: new Map() };

async function libraryFacts(root: string | undefined): Promise<LibraryFacts> {
  if (root === undefined) return NO_LIBRARY_FACTS;
  let entries: readonly LibraryEntry[] = [];
  try {
    entries = (await tryLoadLibrary(root))?.entries ?? [];
  } catch {
    // An unreadable library only means no extra facts: the bib stays the basis.
    return NO_LIBRARY_FACTS;
  }
  return {
    retractionDetails: new Map(entries.filter((e) => e.retraction_details !== null).map((e) => [e.citekey, e.retraction_details as string])),
    unidentifiedByo: new Map(entries.filter((e) => e.byo !== null && !e.hydrated).map((e) => [e.citekey, (e.byo as { file: string }).file])),
  };
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
  facts: LibraryFacts = NO_LIBRARY_FACTS,
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
  const v = await registrarVerdict(ck, claimed, claimedTitle, claimedAuthorsD14, facts);
  // D-15 stored-retraction gate: honor BOTH the synthetic `retracted` boolean
  // (fixture / in-memory candidate path) AND the round-tripped BibTeX
  // `note = {RETRACTED}` (the on-disk .paper/CITATIONS.bib path). Without the
  // `note` check, every bib-sourced retracted work passes Pass-1 (the boolean is
  // undefined after the citation-js round-trip) and the stored-retraction block
  // is dead — leaving only the live Retraction Watch re-query, which is null
  // offline. Mirrors compile.ts:482. The re-fetch above still ran, so the row
  // carries the real scores (or n/a when there was no record to compare).
  if (claimed.retracted || claimed.note === 'RETRACTED') {
    if (v.verdict === 'MIS-CITED' && v.retraction === true) return v;
    const compared = v.verdict === 'OK' || (v.verdict === 'MIS-CITED' && Number.isFinite(v.titleJW) && v.titleJW > 0);
    const notice = facts.retractionDetails.get(ck);
    return {
      citekey: ck, verdict: 'MIS-CITED',
      titleJW: compared ? v.titleJW : NOT_COMPARED,
      authorJW: compared ? v.authorJW : NOT_COMPARED,
      retraction: true,
      reason:
        `cited work is retracted (recorded when the source entered the library${notice ? `: ${notice}` : ''})` +
        (v.verdict === 'OK'
          ? ' — the metadata matches the registrar record'
          : compared
            ? ` — also: ${v.reason}`
            : ` — the registrar re-fetch did not compare: ${v.reason}`),
    };
  }
  return v;
}

/**
 * The verdict from the entry's registrar (Crossref for a DOI, the entry's own
 * registrar otherwise), before the stored-retraction rule of verdictForCitekey.
 */
async function registrarVerdict(
  ck: string,
  claimed: BibEntry,
  claimedTitle: string,
  claimedAuthorsD14: string[],
  facts: LibraryFacts,
): Promise<Pass1Result> {
  if (!claimed.DOI) return verdictWithoutDoi(ck, claimed, claimedTitle, claimedAuthorsD14, facts);

  // A DataCite arXiv DOI is re-fetched at arXiv by its id (see the header).
  const dataCiteArxiv = arxivIdOfDataCiteDoi(claimed.DOI);
  if (dataCiteArxiv !== null) {
    const eprint = typeof claimed.eprint === 'string' && claimed.eprint.trim() ? claimed.eprint : dataCiteArxiv;
    if (normArxiv(eprint) !== dataCiteArxiv) {
      return {
        citekey: ck, verdict: 'MIS-CITED', titleJW: NOT_COMPARED, authorJW: NOT_COMPARED,
        reason: `the DOI ${claimed.DOI} names arXiv:${dataCiteArxiv}, but the entry's eprint is ${eprint}`,
      };
    }
    return verdictWithoutDoi(ck, { ...claimed, eprint: dataCiteArxiv, archivePrefix: 'arXiv' }, claimedTitle, claimedAuthorsD14, facts);
  }

  // RUN-27: a reserved dry-run DOI is accepted ONLY under --dry-run, where the
  // synthetic provider stands in for the registrar (zero sockets).
  if (isReservedDryRunId(claimed.DOI)) {
    if (!networkMode().dryRun) {
      return { citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0, reason: RESERVED_DRY_RUN_REASON };
    }
    const synthetic = await dryRunFetchById(claimed.DOI);
    if (!synthetic) {
      return {
        citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0,
        reason: `dry-run: reserved DOI ${claimed.DOI} is not a source the synthetic provider minted`,
      };
    }
    return andGate(ck, synthetic, claimedTitle, claimedAuthorsD14, 'dry-run synthetic source; ');
  }

  let actual: Awaited<ReturnType<typeof sources.crossref.fetchById>>;
  try {
    actual = await sources.crossref.fetchById(claimed.DOI);
  } catch (err) {
    if (isOfflineEgressError(err)) return unverifiable(ck, err, `Crossref re-fetch of ${claimed.DOI}`);
    // D-19-05: a lookup that could not be answered is never "did not resolve".
    if (isSourceLookupError(err)) {
      // A definitive but unusable record (e.g. no author or editor to compare)
      // is still blocking, but re-running cannot change it: say so.
      return {
        citekey: ck, verdict: 'UNVERIFIABLE', titleJW: 0, authorJW: 0,
        reason: err.permanent
          ? `Crossref re-fetch of ${claimed.DOI}: ${err.reason}`
          : `Crossref re-fetch of ${claimed.DOI} failed: ${err.reason} — re-run verify once the lookup answers`,
      };
    }
    throw err;
  }
  if (!actual) return crossrefNotFound(ck, claimed, claimedTitle, claimedAuthorsD14, facts);

  const titleJW = titleSimilarity(actual.title, claimedTitle);
  const authorJW = jaroWinkler(surnameOf(actual.authors?.[0]), surnameOf(claimedAuthorsD14[0]));

  // SRC-04 (D-19-11): the Crossref record's own Retraction Watch notice blocks.
  if (actual.retracted === true || actual.retraction_status === 'retracted') {
    const why = actual.retraction_details ? `: ${actual.retraction_details}` : '';
    return {
      citekey: ck, verdict: 'MIS-CITED', titleJW, authorJW, retraction: true,
      reason: `cited work is retracted (Crossref's record of ${claimed.DOI} at verify time${why})`,
    };
  }

  // GATE-03: live retraction re-query at verify time (Phase 14, Plan 03).
  // Re-query Retraction Watch on the Crossref-confirmed DOI. A confirmed hit
  // (non-null) escalates to MIS-CITED (blocking); a live "no retraction" (null)
  // falls through to the normal JW path. A status that cannot be determined —
  // offline with no fixture, or a live lookup failure (RetractionLookupError:
  // a non-200, an error body, a transport failure) — is never "not retracted":
  // it is UNVERIFIABLE (blocking) unless the other DOI confirms a retraction.
  // Placed AFTER the Crossref null-guard so FABRICATED citations (unresolved DOI)
  // never reach this check (Pitfall 1 — avoids cassette-fallback false positives).
  // Audit #16: a work can be listed in Retraction Watch under EITHER the claimed
  // DOI or the canonical DOI Crossref redirected it to. Querying only the claimed
  // DOI misses a retraction recorded against the canonical record (the original
  // bug); querying only the canonical DOI would miss one recorded against the
  // claimed/alias DOI. Check BOTH (deduped) and block on the first hit.
  // Deduped by the normalized DOI (DOIs are case-insensitive): one lookup per work.
  const retractionDois = [...new Map(
    [claimed.DOI, actual.doi]
      .filter((d): d is string => typeof d === 'string' && d.length > 0)
      .map((d) => [normalizeDoi(d) ?? d.toLowerCase(), d] as const),
  ).values()];
  let liveRetraction: Awaited<ReturnType<typeof retractionWatchFetchById>> = null;
  let retractionUnavailable: { err: OfflineEgressError; doi: string } | null = null;
  let retractionUnknown: string | null = null;
  for (const d of retractionDois) {
    let hit: Awaited<ReturnType<typeof retractionWatchFetchById>>;
    try {
      hit = await retractionWatchFetchById(d);
    } catch (err) {
      // An unavailable re-query is never "not retracted" (RUN-03, SRC-04):
      // remember it, keep checking the other DOI (a confirmed hit there still
      // blocks), and report UNVERIFIABLE below if nothing confirmed a retraction.
      if (isOfflineEgressError(err)) {
        retractionUnavailable ??= { err, doi: d };
        continue;
      }
      if (isRetractionLookupError(err)) {
        retractionUnknown ??= err.message;
        continue;
      }
      throw err;
    }
    if (hit !== null) {
      liveRetraction = hit;
      break;
    }
  }
  if (liveRetraction !== null) {
    const why = liveRetraction.retraction_details
      ? `: ${liveRetraction.retraction_details}`
      : '';
    return {
      citekey: ck, verdict: 'MIS-CITED', titleJW, authorJW, retraction: true,
      reason: `cited work is retracted (Retraction Watch, re-queried at verify time${why})`,
    };
  }
  if (retractionUnavailable !== null) {
    return unverifiable(ck, retractionUnavailable.err, `Retraction Watch re-query of ${retractionUnavailable.doi}`);
  }
  if (retractionUnknown !== null) {
    return {
      citekey: ck, verdict: 'UNVERIFIABLE', titleJW: 0, authorJW: 0,
      reason: `${retractionUnknown} (Retraction Watch re-query) — re-run verify once the lookup answers`,
    };
  }

  // Multi-DOI redirect handling — the claimed DOI may have redirected to a
  // different canonical DOI; strict-match (≥0.98 title / ≥0.95 author) lets
  // it pass with a diagnostic, otherwise MIS-CITED.
  // DOIs are case-insensitive: only a different DOI is a redirect.
  const actualDoi: string = actual.doi ?? claimed.DOI;
  if ((normalizeDoi(actualDoi) ?? actualDoi.toLowerCase()) !== (normalizeDoi(claimed.DOI) ?? claimed.DOI.toLowerCase())) {
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
 * Crossref has no record of the DOI (its definitive 404). That proves nothing
 * about a DOI another agency registered, so doi.org is asked which agency
 * holds the prefix (sources/doi-ra.ts — only the prefix leaves the machine):
 *   - Crossref's own prefix, or a prefix no agency holds → FABRICATED;
 *   - another agency (DataCite, ISTIC, JaLC, mEDRA, …) → the entry's arXiv id,
 *     PMID and ISBN at their own registrars (the DOI-less path); with none, or
 *     when none of them has the work, UNVERIFIABLE naming the agency
 *     (blocking — a real work registered elsewhere is never called invented);
 *   - an agency lookup that could not be answered → UNVERIFIABLE.
 */
async function crossrefNotFound(
  ck: string,
  claimed: BibEntry,
  claimedTitle: string,
  claimedAuthorsD14: string[],
  facts: LibraryFacts,
): Promise<Pass1Result> {
  const doi = claimed.DOI as string;
  const notResolved = `DOI ${doi} did not resolve via Crossref`;
  let ra: Awaited<ReturnType<typeof registrationAgency>>;
  try {
    ra = await registrationAgency(doi);
  } catch (err) {
    if (isOfflineEgressError(err)) return unverifiable(ck, err, `${notResolved}; doi.org agency lookup of ${doiPrefix(doi) ?? doi}`);
    throw err;
  }
  if (ra.kind === 'failed') {
    return {
      citekey: ck, verdict: 'UNVERIFIABLE', titleJW: 0, authorJW: 0,
      reason: `${notResolved}, and doi.org could not say which agency registered it (${ra.reason}) — re-run verify once the lookup answers`,
    };
  }
  if (ra.kind === 'unknown-prefix') {
    return {
      citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0,
      reason: `${notResolved} (no registration agency holds its prefix${doiPrefix(doi) !== null ? ` ${doiPrefix(doi)}` : ''})`,
    };
  }
  if (/^crossref$/i.test(ra.agency)) {
    return { citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0, reason: notResolved };
  }
  const elsewhere = `DOI ${doi} is registered with ${ra.agency}, not Crossref`;
  if (doilessIdentifiers(claimed).length === 0) {
    return {
      citekey: ck, verdict: 'UNVERIFIABLE', titleJW: NOT_COMPARED, authorJW: NOT_COMPARED,
      reason: `${elsewhere}, which the verifier cannot query yet — give the work's arXiv id, PMID or ISBN (pensmith add), or cite its Crossref-registered version`,
    };
  }
  const v = await verdictWithoutDoi(ck, claimed, claimedTitle, claimedAuthorsD14, facts);
  if (v.verdict === 'FABRICATED') {
    return {
      ...v, verdict: 'UNVERIFIABLE', titleJW: NOT_COMPARED, authorJW: NOT_COMPARED,
      reason: `${elsewhere}, which the verifier cannot query yet, and ${v.reason}`,
    };
  }
  return { ...v, reason: `${elsewhere}; ${v.reason}` };
}

const REGISTRAR_LABEL: Record<NoDoiRegistrar, string> = { arxiv: 'arXiv', pubmed: 'PubMed', books: 'the books registries' };

/** A bib entry's identifiers, as the shared route (pass1-identifiers.ts) reads them. */
function bibIdentifiers(claimed: BibEntry): CitationIdentifiers {
  const eprint = typeof claimed.eprint === 'string' ? claimed.eprint.trim() : '';
  const prefix = typeof claimed.archivePrefix === 'string' ? claimed.archivePrefix.trim() : '';
  return {
    doi: claimed.DOI ?? null,
    arxiv: eprint && (prefix === '' || /^arxiv$/i.test(prefix)) ? eprint : null,
    pmid: typeof claimed.PMID === 'string' ? claimed.PMID : null,
    isbn: typeof claimed.ISBN === 'string' ? claimed.ISBN : null,
  };
}

/** The identifiers a DOI-less entry carries, each with the registrar that answers for it. */
function doilessIdentifiers(claimed: BibEntry): Array<{ registrar: NoDoiRegistrar; id: string; label: string }> {
  return routeIdentifiers(bibIdentifiers(claimed));
}

async function lookupAt(registrar: NoDoiRegistrar, id: string): Promise<LookupResult> {
  switch (registrar) {
    case 'arxiv':
      return sources.arxiv.lookupById(id);
    case 'pubmed':
      return sources.pubmed.lookupById(id);
    case 'books':
      return sources.books.lookupById(id);
  }
}

/**
 * Pass 1 for an entry with no DOI (see the header): each identifier at its own
 * registrar; the first record found runs the AND-gate; a failed or offline
 * lookup is UNVERIFIABLE; FABRICATED only when every registrar said not-found.
 */
async function verdictWithoutDoi(
  ck: string,
  claimed: BibEntry,
  claimedTitle: string,
  claimedAuthorsD14: string[],
  facts: LibraryFacts = NO_LIBRARY_FACTS,
): Promise<Pass1Result> {
  const ids = doilessIdentifiers(claimed);
  if (ids.length === 0) {
    const byoFile = facts.unidentifiedByo.get(ck);
    if (byoFile !== undefined) {
      return {
        citekey: ck, verdict: 'UNVERIFIABLE', titleJW: NOT_COMPARED, authorJW: NOT_COMPARED,
        reason:
          `your own PDF ${byoFile} was not identified by any registrar, so this citation cannot be checked upstream — ` +
          `give its identifier: pensmith add <DOI or arXiv id> --pdf .paper/${byoFile}`,
      };
    }
    return {
      citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0,
      reason: 'no DOI, arXiv id, PMID or ISBN in citation entry (cannot verify upstream)',
    };
  }
  let undecided: Pass1Result | null = null;
  const notFound: string[] = [];
  for (const { registrar, id, label } of ids) {
    const who = REGISTRAR_LABEL[registrar];
    let res: LookupResult;
    try {
      res = await lookupAt(registrar, id);
    } catch (err) {
      if (isOfflineEgressError(err)) {
        undecided ??= unverifiable(ck, err, `${who} lookup of ${label}`);
        continue;
      }
      throw err;
    }
    if (res.kind === 'failed') {
      undecided ??= {
        citekey: ck, verdict: 'UNVERIFIABLE', titleJW: 0, authorJW: 0,
        reason: res.permanent
          ? `${who} lookup of ${label}: ${res.reason}`
          : `${who} lookup of ${label} failed: ${res.reason} — re-run verify once the lookup answers`,
      };
      continue;
    }
    if (res.kind === 'not-found') {
      notFound.push(`${label}: ${res.reason}`);
      continue;
    }
    const actual: SourceCandidate = res.candidate;
    if (actual.retracted === true || actual.retraction_status === 'retracted') {
      const why = actual.retraction_details ? `: ${actual.retraction_details}` : '';
      return {
        citekey: ck, verdict: 'MIS-CITED',
        titleJW: titleSimilarity(actual.title, claimedTitle),
        authorJW: jaroWinkler(surnameOf(actual.authors?.[0]), surnameOf(claimedAuthorsD14[0])),
        retraction: true,
        reason: `cited work is retracted (${who}'s record of ${label} at verify time${why})`,
      };
    }
    return andGate(ck, actual, claimedTitle, claimedAuthorsD14, `${label} re-fetched from ${who}; `);
  }
  if (undecided !== null) return undecided;
  return {
    citekey: ck, verdict: 'FABRICATED', titleJW: 0, authorJW: 0,
    reason: `no registrar has this work (${notFound.join('; ')})`,
  };
}

/**
 * The D-11 AND-gate against a re-fetched record with the same claimed DOI
 * (the dry-run synthetic path), or against the record a DOI-less entry's own
 * registrar returned (the Crossref path inlines the same thresholds).
 */
function andGate(
  ck: string,
  actual: { title: string; authors?: string[] },
  claimedTitle: string,
  claimedAuthorsD14: string[],
  prefix: string,
): Pass1Result {
  const titleJW = titleSimilarity(actual.title, claimedTitle);
  const authorJW = jaroWinkler(surnameOf(actual.authors?.[0]), surnameOf(claimedAuthorsD14[0]));
  if (titleJW >= TITLE_JW_THRESHOLD && authorJW >= AUTHOR_JW_THRESHOLD) {
    return { citekey: ck, verdict: 'OK', titleJW, authorJW, reason: `${prefix}D-11 AND-gate passed` };
  }
  return {
    citekey: ck, verdict: 'MIS-CITED', titleJW, authorJW,
    reason: `${prefix}JW below threshold (title=${titleJW.toFixed(2)}/${TITLE_JW_THRESHOLD}, author=${authorJW.toFixed(2)}/${AUTHOR_JW_THRESHOLD})`,
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
export interface Pass1Options {
  /**
   * The project root: LIBRARY.json then adds what the bib cannot carry — a
   * recorded retraction notice, and which identifier-less entries are the
   * user's own unidentified PDFs (UNVERIFIABLE, not FABRICATED). verify and
   * compile pass it.
   */
  readonly root?: string;
}

export async function runPass1(
  draftMd: string,
  citationsBibPath: string,
  opts: Pass1Options = {},
): Promise<Pass1Result[]> {
  const bibText = readFileSync(citationsBibPath, 'utf8');
  const entries = await parseBibFileAt(bibText, citationsBibPath);
  const bibByCitekey = new Map<string, BibEntry>(
    entries.map((e) => [String(e['id'] ?? ''), e as BibEntry]),
  );

  // FAIL-CLOSED extraction (audit #2/#20): use the BROAD verifier-side detector,
  // not the narrow lowercase-bare `[@key]` regex. Uppercase, locator ([@k, p. 5]),
  // and multi-cite ([@a; @b]) citations must each produce a verdict — an
  // unparseable/out-of-namespace citation is "unverifiable", never "absent". A
  // key not present in the (lowercase-keyed) bib falls through to FABRICATED.
  const unique = extractCitedKeysForVerification(draftMd);

  const facts = unique.length > 0 ? await libraryFacts(opts.root) : NO_LIBRARY_FACTS;
  const results: Pass1Result[] = [];
  for (const ck of unique) {
    results.push(await verdictForCitekey(ck, bibByCitekey.get(ck), facts));
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
  const entries = await parseBibFileAt(bibText, citationsBibPath);
  const doiByCitekey = new Map<string, string | null>(
    entries.map((e) => [
      String((e as BibEntry).id ?? ''),
      (e as BibEntry).DOI ?? null,
    ]),
  );

  // Same broad extraction as runPass1 so the advisory freshness probe covers the
  // identical citation set the blocking gate sees (no divergence).
  const unique = extractCitedKeysForVerification(draftMd);

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
  if (isReservedDryRunId(input.claimed.doi) && !networkMode().dryRun) {
    return { verdict: 'FABRICATED', titleJW: 0, authorJW: 0, reason: RESERVED_DRY_RUN_REASON };
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
