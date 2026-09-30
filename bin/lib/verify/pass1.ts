// bin/lib/verify/pass1.ts — Pass-1 citation-integrity verifier (D-11, VRFY-02,
// D-13; Phase 20 VRFY-10..15, VRFY-28, D-20-10..15).
//
// Deterministic — NO LLM (D-13 LOCKED INVARIANT). One row per cited key and
// per bare identifier in the prose, each a function of the bibliography entry,
// the paper's LIBRARY.json (with `opts.root`) and what the registrars answer.
// The verdict vocabulary is verify/verdicts.ts (Phase 20 seam S-C):
//
//   OK                    the registrar's record matches the entry's title, first
//                         author and year (verify/name-match.ts) — or, for an entry
//                         with no identifier, a strict metadata-search match (the row
//                         names the matched identifier)
//   OK-BYO                the entry has no registrar identifier, or its lookup got no
//                         answer, the user's own PDF still re-hashes to its
//                         recorded sha256 (byo-text.ts; the row names the file and
//                         hash; never an `asserted` PDF), AND the entry's title,
//                         first author and year match the work LIBRARY.json records
//                         that PDF was identified as at ingest (a mismatch is
//                         MIS-CITED naming the field) — VRFY-14
//   FABRICATED            the key is not in the bibliography; or the DOI's registrar
//                         definitively does not know it (Crossref's 404 for a Crossref
//                         prefix or a prefix no agency holds, DataCite's or doi.org's
//                         404); or every registrar of a DOI-less entry said
//                         not-found; or a reserved --dry-run id outside --dry-run
//   MIS-CITED             the record exists but its title, first author or year does
//                         not match (the reason names the field), or it answers under
//                         another DOI with no relation the registrar asserts
//   RETRACTED             the cited work is retracted (Crossref's `updated-by`, the
//                         Retraction Watch re-query, PubMed's "Retracted Publication",
//                         or the notice recorded in the library) — VRFY-15; echoed on
//                         stderr as `pensmith verify: RETRACTED — <key>: <notice>`
//   UNRESOLVABLE          no identifier, and the metadata search definitively matched
//                         nothing (add the work's identifier, or its PDF) — VRFY-12
//   UNVERIFIABLE-NETWORK  NO ANSWER (D-20-03): an offline fixture miss, --dry-run, a
//                         transport error or timeout, 429 / 5xx after retries, an
//                         exhausted host, an open breaker, a failed retraction lookup.
//                         Blocking; retry online; never FABRICATED
//   UNVERIFIABLE          a definitive answer that cannot be compared: an agency that
//                         serves no record (ISTIC, CNKI, …) with no arXiv id / PMID /
//                         ISBN to fall back on, an incomplete registrar record, the
//                         user's own PDF that no longer matches its recorded hash
//
// Where Pass 1 asks (D-20-10; pass1-identifiers.ts citationCheckRoute is the
// same route for the outline / planner source filter):
//   - a DOI: Crossref (DOIs compare case-insensitively after doi.ts
//     normalization). On Crossref's definitive 404, doi.org names the prefix's
//     agency (sources/doi-ra.ts, only the prefix leaves the machine): Crossref
//     or no agency → FABRICATED; DataCite → api.datacite.org
//     (sources/datacite.ts); mEDRA, JaLC, KISTI → doi.org content negotiation
//     (sources/doi-cn.ts, CSL JSON); any other agency → the entry's arXiv id /
//     PMID / ISBN, else UNVERIFIABLE naming the agency. A DataCite arXiv DOI
//     (10.48550/arXiv.<id>) is re-fetched at arXiv by its id. A reserved
//     `10.0000/pensmith-dryrun.*` DOI is answered by the synthetic provider
//     under --dry-run only (RUN-27), FABRICATED otherwise.
//   - no DOI: the arXiv id (arXiv), PMID (PubMed), ISBN (the books
//     registries), in that order; FABRICATED only when every one said
//     not-found.
//   - no identifier: the user's own PDF (OK-BYO, when the entry describes the
//     work that PDF was ingested as), else the metadata search
//     (verify/metadata-search.ts: the books registries' title search for a
//     book, Crossref `query.bibliographic`, arXiv, PubMed, DataCite and
//     OpenAlex, strict matches only).
//
// Aliases (VRFY-14, D-20-12): a Crossref answer under a DOI other than the one
// claimed passes only when the registrar asserts the relation at verification
// time — the record's `relation` names the claimed DOI as is-identical-to /
// is-version-of / has-version / is-preprint-of / has-preprint, or doi.org's
// handle of the claimed DOI redirects (HEAD, not followed) to the returned
// DOI — and the title / author / year match still holds. LIBRARY.json's
// alternate_dois are never read.
//
// Retraction data (VRFY-15, D-20-13) exists for Crossref-registered DOIs (the
// record's `updated-by` and the Retraction Watch re-query of the claimed and
// the returned DOI) and PubMed. For a DOI another agency registered, and for
// an arXiv or books record, the OK row says `retraction status unknown (…)` —
// reported, never shown as clean, not blocking. A retraction re-query that got
// no answer is UNVERIFIABLE-NETWORK (blocking).
//
// Bare identifiers (VRFY-10, D-20-14): doi.ts findBareIdentifiers finds
// `doi:10.…`, doi.org links, bare DOIs, `arXiv:…`, arxiv.org links, `PMID:`
// and PubMed links outside provable code and outside Pandoc citations; each
// gets one row keyed `doi:<doi>` / `arXiv:<id>` / `PMID:<id>`: found → OK
// naming the record's title; definitive not-found → FABRICATED; no answer →
// UNVERIFIABLE-NETWORK.
//
// Freshness data (VRFY-28, D-20-15): `opts.refresh` names the citekeys whose
// lookups skip the HTTP-cache read (their last_verified is older than
// `[verification] recheck_after_days`); every row resting on a registrar's
// record carries `checkedAt` — when that answer was obtained (a cached
// answer's savedAt, else now).
//
// CYCLE-2 H-2 D-14 author shape lock: citation-js's `{family, given}` BibTeX
// names are normalized ONCE at the boundary (normalizeBibAuthors) into the
// D-14 "Family, Given" strings every comparison reads.

import { sources } from '../sources/index.js';
import { parseBibFileAt, bibEntryRawFields } from '../citations.js';
import { readFileSync } from 'node:fs';
import { probeFreshnessAll, type FreshnessResult, type FreshnessSource } from './freshness.js';
import { fetchById as retractionWatchFetchById, isRetractionLookupError } from '../sources/retraction-watch.js';
import { fetchById as dryRunFetchById } from '../sources/dry-run.js';
import * as doiContent from '../sources/doi-cn.js';
import { extractCitedKeysForVerification, findCitations } from '../citation-token.js';
import { bareIdentifierKey, findBareIdentifiers, isReservedDryRunId, normalizeDoi, type BareIdentifier } from '../doi.js';
import { fetch as httpFetch, isOfflineEgressError, type OfflineEgressError } from '../http.js';
import { type LookupResult } from '../sources/lookup.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';
import { networkMode } from '../http-mock.js';
import { normArxiv } from '../migrations/library/shape.js';
import { isDataCiteArxivDoi } from '../full-text.js';
import { byoText } from '../byo-text.js';
import { matchWork, type ClaimedWork, type MatchResult } from './name-match.js';
import { metadataSearch } from './metadata-search.js';
import { DATACITE_RETRACTION_UNKNOWN } from '../sources/datacite.js';
import { tryLoadLibrary } from '../library.js';
import { registrationAgency, doiPrefix } from '../sources/doi-ra.js';
import { isNoRetractionDataReason } from '../sources/retraction-cross-check.js';
import { doilessIdentifiers as routeIdentifiers, type CitationIdentifiers, type NoDoiRegistrar } from './pass1-identifiers.js';
import type { LibraryEntry } from '../schemas/library.js';
import type { Pass1RowVerdict } from './verdicts.js';

export type { FreshnessResult } from './freshness.js';
export { renderFreshnessTable } from './freshness.js';

/** The Pass-1 verdict vocabulary (verify/verdicts.ts, Phase 20 seam S-C). */
export type Pass1Verdict = Pass1RowVerdict;

/** The fixed UNVERIFIABLE reasons (D-17-07). */
export const UNVERIFIABLE_OFFLINE_REASON = 'offline: no recorded fixture — re-run online';
export const UNVERIFIABLE_DRY_RUN_REASON = 'dry-run: no live re-fetch under --dry-run — re-run online';
export const RESERVED_DRY_RUN_REASON = 'reserved dry-run identifier (a synthetic --dry-run source is never a real citation)';

/** The remedy every UNVERIFIABLE-NETWORK row ends with (VRFY-12). */
export const RETRY_ONLINE = 're-run verify once the lookup answers';

/** An offline / --dry-run fixture miss: no answer (D-20-03). */
function offlineRow(ck: string, err: OfflineEgressError, what: string): Pass1Result {
  const reason = err.mode === 'dry-run' ? UNVERIFIABLE_DRY_RUN_REASON : UNVERIFIABLE_OFFLINE_REASON;
  return { citekey: ck, verdict: 'UNVERIFIABLE-NETWORK', titleJW: NOT_COMPARED, authorJW: NOT_COMPARED, reason: `${reason} (${what})` };
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
  /**
   * When the registrar answer this verdict rests on was obtained (ISO-8601):
   * the live fetch time, or the HTTP-cache entry's savedAt (Phase 20 seam S-C;
   * VRFY-28 records it as the entry's last_verified). Absent when no registrar
   * answered.
   */
  checkedAt?: string;
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

export interface BibEntry {
  id?: string;
  title?: string | string[];
  author?: BibAuthor[];
  /** Editors (an edited volume cited by its editors, D-20-10). */
  editor?: BibAuthor[];
  DOI?: string;
  /** The arXiv id of a preprint (parseBib keeps BibTeX `eprint` / `archivePrefix` verbatim). */
  eprint?: string;
  archivePrefix?: string;
  /** BibTeX `isbn` (citation-js CSL `ISBN`). */
  ISBN?: string;
  /** BibTeX `pmid` (parseBib's CSL `PMID`). */
  PMID?: string;
  /** The CSL date (`year` → `issued['date-parts'][0][0]`). */
  issued?: { 'date-parts'?: Array<Array<number | string>> };
  /** The CSL type (`@book` → `book`): a book's metadata search adds the books registries. */
  type?: string;
  retracted?: boolean;
  // D-15 retracted-flag persistence: the library writer serializes a retracted
  // source as BibTeX `note = {RETRACTED}`, and citation-js keeps `note`
  // verbatim (not the synthetic `retracted` boolean).
  note?: string;
}

/** A score that was not computed (no record to compare): rendered `n/a`. */
const NOT_COMPARED = Number.NaN;

/**
 * Normalize a citation-js BibTeX name list into the D-14 `string[]` shape:
 * "Family, Given" or "Family"; a braced corporate name (citation-js reads
 * `{The ENCODE Project Consortium}` as a family with no given name, or a
 * `literal`) is kept braced so it is compared whole. Particles belong to the
 * family (`van der Maaten, Ernst`).
 */
function normalizeBibAuthors(rawAuthors: BibAuthor[] | undefined): string[] {
  return (rawAuthors ?? [])
    .map((a) => {
      const particle = [a?.['dropping-particle'], a?.['non-dropping-particle']]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .join(' ');
      const bare = String(a?.family ?? '').trim();
      const family = bare && particle ? `${particle} ${bare}` : bare;
      const given = String(a?.given ?? '').trim();
      const literal = String(a?.literal ?? '').trim();
      if (!family) return literal ? `{${literal}}` : '';
      if (!given && !particle && /\s/.test(family)) return `{${family}}`;
      return given ? `${family}, ${given}` : family;
    })
    .filter(Boolean);
}

function bibTitle(claimed: BibEntry): string {
  if (Array.isArray(claimed.title)) return claimed.title[0] ?? '';
  return claimed.title ?? '';
}

function bibYear(claimed: BibEntry): number | null {
  const y = Number(claimed.issued?.['date-parts']?.[0]?.[0]);
  return Number.isInteger(y) && y > 0 ? y : null;
}

/**
 * biblatex fields Pandoc's biblatex reader prints as (part of) the work's
 * title or date, and that no registrar record can confirm: an entry setting
 * one is refused rather than exported unchecked (pensmith never writes them).
 */
const UNCHECKED_RENDERED_FIELDS = ['maintitle', 'mainsubtitle', 'maintitleaddon', 'shorttitle', 'origtitle', 'origdate', 'origyear', 'pubstate'] as const;

/** A raw biblatex value as plain text (braces and the common escapes removed). */
function rawText(v: string | undefined): string {
  return (v ?? '').replace(/\\([&%$#_])/g, '$1').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * What the export prints for the entry's title and year, read the way
 * Pandoc's biblatex reader reads CITATIONS.bib (VRFY-13): the title with its
 * `subtitle` (`Title: Subtitle`) and `titleaddon` (`… . Addon`), and the year
 * of `date`, which wins over `year`. citation-js drops those fields, so Pass
 * 1 would otherwise compare a title and year the export never shows. A
 * reason string when the entry sets a field Pass 1 cannot compare.
 */
export function renderedClaim(claimed: BibEntry, title = bibTitle(claimed)): { title: string; wholeTitle: boolean; year: number | null } | { refused: string } {
  const raw = bibEntryRawFields(claimed as unknown as Record<string, unknown>);
  const unchecked = UNCHECKED_RENDERED_FIELDS.filter((f) => raw[f] !== undefined && raw[f] !== '');
  if (unchecked.length > 0) {
    return {
      refused:
        `the entry sets ${unchecked.map((f) => `\`${f}\``).join(', ')}, which the export prints as the work's title or date and no registrar record confirms — ` +
        'remove it from CITATIONS.bib (pensmith writes the bibliography from LIBRARY.json)',
    };
  }
  const subtitle = rawText(raw['subtitle']);
  const addon = rawText(raw['titleaddon']);
  const rendered = [subtitle !== '' ? `${title.replace(/[\s.:]+$/u, '')}: ${subtitle}` : title, addon].filter((x) => x !== '').join('. ');
  let year = bibYear(claimed);
  const date = rawText(raw['date']);
  if (date !== '') {
    const y = /^(\d{4})(?![\d])/.exec(date);
    if (y === null) return { refused: `the entry's \`date = {${date}}\` is not a date Pass 1 can read (the export prints it as the work's date) — write the year as \`date = {YYYY}\` or \`year = {YYYY}\`` };
    year = Number(y[1]);
  }
  return { title: rendered, wholeTitle: subtitle !== '' || addon !== '', year };
}

/** The arXiv id a DataCite arXiv DOI stands for (`10.48550/arXiv.1706.03762` → `1706.03762`), else null. */
export function arxivIdOfDataCiteDoi(doi: string): string | null {
  return isDataCiteArxivDoi(doi) ? normArxiv(doi) : null;
}

/** What Pass 1 reads from the paper's LIBRARY.json (with `opts.root`), and the answers it asked for up front. */
interface LibraryFacts {
  readonly root: string | undefined;
  /** Recorded retraction notices, by citekey. */
  readonly retractionDetails: ReadonlyMap<string, string>;
  /** The user's own PDFs (bring-your-own records), by citekey. */
  readonly byo: ReadonlyMap<string, LibraryEntry>;
  /** arXiv's answers for the draft's arXiv-routed citations, asked in one batched request. */
  readonly arxivAnswers?: ReadonlyMap<string, LookupResult>;
  /** Citekeys whose lookups skip the HTTP-cache read (VRFY-28). */
  readonly refresh: ReadonlySet<string>;
}

const NO_LIBRARY_FACTS: LibraryFacts = { root: undefined, retractionDetails: new Map(), byo: new Map(), refresh: new Set() };

async function libraryFacts(root: string | undefined, refresh: ReadonlySet<string>): Promise<LibraryFacts> {
  if (root === undefined) return { ...NO_LIBRARY_FACTS, refresh };
  let entries: readonly LibraryEntry[] = [];
  try {
    entries = (await tryLoadLibrary(root))?.entries ?? [];
  } catch {
    // An unreadable library only means no extra facts: the bib stays the basis.
    return { ...NO_LIBRARY_FACTS, root, refresh };
  }
  return {
    root,
    refresh,
    retractionDetails: new Map(entries.filter((e) => e.retraction_details !== null && e.retracted).map((e) => [e.citekey, e.retraction_details as string])),
    byo: new Map(entries.filter((e) => e.byo !== null).map((e) => [e.citekey, e])),
  };
}

/** The lookup options of one citekey. */
function refreshOf(ck: string, facts: LibraryFacts): { refresh?: boolean } {
  return facts.refresh.has(ck) ? { refresh: true } : {};
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function row(ck: string, verdict: Pass1Verdict, reason: string, scores?: { titleJW: number; authorJW: number }, checkedAt?: string): Pass1Result {
  return {
    citekey: ck,
    verdict,
    titleJW: scores?.titleJW ?? NOT_COMPARED,
    authorJW: scores?.authorJW ?? NOT_COMPARED,
    reason,
    ...(verdict === 'RETRACTED' ? { retraction: true } : {}),
    ...(checkedAt !== undefined ? { checkedAt } : {}),
  };
}

/** A lookup that got no answer (D-20-03): UNVERIFIABLE-NETWORK with the reason and the remedy. */
function noAnswerRow(ck: string, what: string, why: string): Pass1Result {
  return row(ck, 'UNVERIFIABLE-NETWORK', `${what} failed: ${why} — ${RETRY_ONLINE}`);
}

// ---------------------------------------------------------------------------
// Resolving a DOI at its registrar (D-20-10)
// ---------------------------------------------------------------------------

/** The registrar's answer for a DOI. */
type DoiResolution =
  | {
      readonly kind: 'record';
      readonly candidate: SourceCandidate;
      /** The registration agency whose record this is (`Crossref`, `DataCite`, `mEDRA`, …). */
      readonly agency: string;
      /** Whose record it is, for a RETRACTED reason (`Crossref's record of 10.…`). */
      readonly label: string;
      /** What an OK / MIS-CITED reason starts with ('' for Crossref: its record is the default). */
      readonly prefix: string;
    }
  | { readonly kind: 'not-found'; readonly reason: string }
  | { readonly kind: 'no-answer'; readonly reason: string; readonly offline?: OfflineEgressError }
  | { readonly kind: 'uncomparable'; readonly reason: string; readonly agency: string | null };

function fromLookup(
  res: LookupResult,
  record: { agency: string; label: string; prefix: string },
  what: string,
  notFound: (why: string) => string,
): DoiResolution {
  if (res.kind === 'found') return { kind: 'record', candidate: res.candidate, ...record };
  if (res.kind === 'not-found') return { kind: 'not-found', reason: notFound(res.reason) };
  return res.permanent
    ? { kind: 'uncomparable', reason: `${what}: ${res.reason}`, agency: record.agency }
    : { kind: 'no-answer', reason: `${what} failed: ${res.reason}` };
}

async function guarded(run: () => Promise<DoiResolution>, what: string): Promise<DoiResolution> {
  try {
    return await run();
  } catch (err) {
    if (isOfflineEgressError(err)) return { kind: 'no-answer', reason: what, offline: err };
    throw err;
  }
}

/**
 * Ask the registrar of `doi` for its record (see the header): Crossref, and on
 * Crossref's 404 the agency doi.org names for the prefix.
 */
async function resolveDoi(doi: string, opts: { refresh?: boolean }): Promise<DoiResolution> {
  const crossref = await guarded(
    async () =>
      fromLookup(
        await sources.crossref.lookupById(doi, opts),
        { agency: 'Crossref', label: `Crossref's record of ${doi}`, prefix: '' },
        `Crossref re-fetch of ${doi}`,
        () => '',
      ),
    `Crossref re-fetch of ${doi}`,
  );
  if (crossref.kind !== 'not-found') return crossref;
  const notResolved = `DOI ${doi} did not resolve via Crossref`;
  let ra: Awaited<ReturnType<typeof registrationAgency>>;
  try {
    ra = await registrationAgency(doi);
  } catch (err) {
    if (isOfflineEgressError(err)) return { kind: 'no-answer', reason: `${notResolved}; doi.org agency lookup of ${doiPrefix(doi) ?? doi}`, offline: err };
    throw err;
  }
  if (ra.kind === 'failed') {
    return { kind: 'no-answer', reason: `${notResolved}, and doi.org could not say which agency registered it (${ra.reason})` };
  }
  if (ra.kind === 'unknown-prefix') {
    return { kind: 'not-found', reason: `${notResolved} (no registration agency holds its prefix${doiPrefix(doi) !== null ? ` ${doiPrefix(doi)}` : ''})` };
  }
  if (/^crossref$/i.test(ra.agency)) return { kind: 'not-found', reason: notResolved };
  const agency = ra.agency;
  const elsewhere = `DOI ${doi} is registered with ${agency}, not Crossref`;
  if (/^datacite$/i.test(agency)) {
    return guarded(
      async () =>
        fromLookup(
          await sources.datacite.lookupById(doi, opts),
          { agency: 'DataCite', label: `DataCite's record of ${doi}`, prefix: `${elsewhere}; re-fetched from DataCite` },
          `${elsewhere}; DataCite lookup`,
          (why) => `${elsewhere}, and DataCite has no record of it (${why})`,
        ),
      `${elsewhere}; DataCite lookup of ${doi}`,
    );
  }
  if (doiContent.servesContentNegotiation(agency)) {
    return guarded(
      async () =>
        fromLookup(
          await doiContent.lookupById(doi, opts),
          { agency, label: `${agency}'s record of ${doi}`, prefix: `${elsewhere}; re-fetched through doi.org content negotiation` },
          `${elsewhere}; doi.org content negotiation`,
          (why) => `${elsewhere}, and doi.org does not know it (${why})`,
        ),
      `${elsewhere}; doi.org content negotiation of ${doi}`,
    );
  }
  return { kind: 'uncomparable', reason: `${elsewhere}, which serves no record the verifier can read`, agency };
}

/** Crossref and DataCite relation types that make two DOIs the same work (VRFY-14, D-20-12). */
const ALIAS_RELATIONS: ReadonlySet<string> = new Set(['is-identical-to', 'is-version-of', 'has-version', 'is-preprint-of', 'has-preprint']);

/**
 * Whether the registrar asserts, now, that `claimed` and the returned record's
 * DOI are the same work: the record's relation, else doi.org's handle of the
 * claimed DOI redirecting (HEAD, not followed) to the returned DOI. `null`
 * when the handle question got no answer.
 */
async function aliasAsserted(claimed: string, record: SourceCandidate): Promise<{ asserted: boolean; how: string } | null> {
  const returned = normalizeDoi(record.doi ?? '') ?? '';
  for (const r of record.relations ?? []) {
    if (ALIAS_RELATIONS.has(r.type) && r.doi === claimed) return { asserted: true, how: `the record asserts ${r.type} ${claimed}` };
  }
  let res: Awaited<ReturnType<typeof httpFetch>>;
  try {
    // The handle only: its redirect IS the answer (never followed, never cached).
    res = await httpFetch(`https://doi.org/${claimed}`, { method: 'HEAD', followRedirects: false, timeoutMs: 10_000 });
  } catch {
    // Offline with no recorded fixture, a transport error, a 5xx after retries: no answer.
    return null;
  }
  const target = normalizeDoi(res.headers['location'] ?? '');
  if (res.status >= 300 && res.status < 400 && target !== null && target === returned) {
    return { asserted: true, how: `doi.org redirects ${claimed} to ${returned}` };
  }
  return { asserted: false, how: `neither the record's relations nor doi.org's handle of ${claimed} name ${returned}` };
}

// ---------------------------------------------------------------------------
// Comparing a record, and its retraction status
// ---------------------------------------------------------------------------

interface Claimed {
  readonly ck: string;
  readonly work: ClaimedWork;
  readonly doi: string | null;
}

function retractedNotice(c: SourceCandidate): string | null {
  if (c.retracted === true || c.retraction_status === 'retracted') return c.retraction_details ?? 'the record is marked retracted';
  return null;
}

/**
 * Retraction Watch re-queried at verify time on the claimed and the returned
 * DOI (audit #16: a notice may be recorded against either), deduplicated by
 * the normalized DOI. A hit is a RETRACTED row; a query with no answer is
 * UNVERIFIABLE-NETWORK (never "not retracted"); null when both answered clean.
 */
async function retractionRequery(
  c: Claimed,
  dois: readonly string[],
  scores: { titleJW: number; authorJW: number },
  checkedAt: string,
  facts: LibraryFacts,
): Promise<Pass1Result | null> {
  const unique = [...new Map(dois.filter((d) => d.length > 0).map((d) => [normalizeDoi(d) ?? d.toLowerCase(), d] as const)).values()];
  let noAnswer: Pass1Result | null = null;
  for (const d of unique) {
    try {
      const hit = await retractionWatchFetchById(d, refreshOf(c.ck, facts));
      if (hit !== null) {
        return row(c.ck, 'RETRACTED', `cited work is retracted (Retraction Watch, re-queried at verify time${hit.retraction_details ? `: ${hit.retraction_details}` : ''})`, scores, checkedAt);
      }
    } catch (err) {
      if (isOfflineEgressError(err)) {
        noAnswer ??= offlineRow(c.ck, err, `Retraction Watch re-query of ${d}`);
        continue;
      }
      if (isRetractionLookupError(err)) {
        noAnswer ??= row(c.ck, 'UNVERIFIABLE-NETWORK', `${err.message} (Retraction Watch re-query) — ${RETRY_ONLINE}`);
        continue;
      }
      throw err;
    }
  }
  return noAnswer;
}

/** The note an OK row carries when no registrar holds retraction data for the record (D-20-13). */
function retractionUnknownNote(agency: string): string {
  if (/^datacite$/i.test(agency)) return `retraction status unknown (${DATACITE_RETRACTION_UNKNOWN})`;
  if (agency === 'arXiv') return 'retraction status unknown (no retraction data for arXiv preprints)';
  if (agency === 'the books registries' || agency === 'Open Library') return 'retraction status unknown (no retraction data for books)';
  return `retraction status unknown (no retraction data for ${agency} DOIs)`;
}

/**
 * The verdict against a record: RETRACTED when the record says so; MIS-CITED
 * naming the fields that do not match; and — a Crossref record that matches —
 * the Retraction Watch re-query (a hit is RETRACTED, no answer is
 * UNVERIFIABLE-NETWORK). An OK row for a registrar with no retraction data
 * says the status is unknown (D-20-13).
 */
async function compareRecord(
  c: Claimed,
  record: SourceCandidate,
  opts: {
    /** Whose record it is, for a RETRACTED reason (`Crossref's record of 10.…`). */
    label: string;
    /** What an OK / MIS-CITED reason starts with ('' for none). */
    prefix: string;
    agency: string;
    /** The DOIs to re-query at Retraction Watch (a Crossref-registered record only). */
    retractionDois?: readonly string[];
  },
  facts: LibraryFacts,
): Promise<Pass1Result> {
  const match: MatchResult = matchWork(c.work, record);
  const scores = { titleJW: match.titleJW, authorJW: match.authorJW };
  const checkedAt = record.last_verified;
  const notice = retractedNotice(record);
  if (notice !== null) return row(c.ck, 'RETRACTED', `cited work is retracted (${opts.label} at verify time: ${notice})`, scores, checkedAt);
  if (!match.ok) return row(c.ck, 'MIS-CITED', `${opts.prefix ? `${opts.prefix}: ` : ''}${match.detail}`, scores, checkedAt);
  if (opts.retractionDois !== undefined) {
    const rw = await retractionRequery(c, opts.retractionDois, scores, checkedAt, facts);
    if (rw !== null) return rw;
  }
  const unknown = opts.retractionDois === undefined && opts.agency !== 'PubMed' ? `; ${retractionUnknownNote(opts.agency)}` : '';
  return row(c.ck, 'OK', `${opts.prefix ? `${opts.prefix}; ` : ''}${match.detail}${unknown}`, scores, checkedAt);
}

// ---------------------------------------------------------------------------
// Per-entry verdicts
// ---------------------------------------------------------------------------

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

/**
 * The arXiv ids Pass 1 will ask arXiv for (a DOI-less entry's arXiv id, a
 * DataCite arXiv DOI's id), so runPass1 asks for them in one request rather
 * than one per citation (arXiv's floor is one request per 3 s).
 */
function arxivIdsToAsk(keys: readonly string[], bibByCitekey: ReadonlyMap<string, BibEntry>): Array<{ ck: string; id: string }> {
  const out: Array<{ ck: string; id: string }> = [];
  for (const ck of keys) {
    const claimed = bibByCitekey.get(ck);
    if (!claimed) continue;
    if (!claimed.DOI) {
      for (const { registrar, id } of doilessIdentifiers(claimed)) if (registrar === 'arxiv') out.push({ ck, id });
      continue;
    }
    const dataCiteArxiv = arxivIdOfDataCiteDoi(claimed.DOI);
    if (dataCiteArxiv !== null) out.push({ ck, id: dataCiteArxiv });
  }
  return out;
}

async function lookupAt(registrar: NoDoiRegistrar, id: string, ck: string, facts: LibraryFacts): Promise<LookupResult> {
  switch (registrar) {
    case 'arxiv':
      return facts.arxivAnswers?.get(id) ?? sources.arxiv.lookupById(id, refreshOf(ck, facts));
    case 'pubmed':
      return sources.pubmed.lookupById(id, { ...refreshOf(ck, facts), abstract: false });
    case 'books':
      return sources.books.lookupById(id, refreshOf(ck, facts));
  }
}

/**
 * Pass 1 by an entry's arXiv id, PMID and ISBN (a DOI-less entry, or the
 * fallback for a DOI no readable registrar holds): the first record found is
 * compared; a lookup with no answer is UNVERIFIABLE-NETWORK; FABRICATED only
 * when every registrar said not-found.
 */
async function verdictByIdentifiers(c: Claimed, claimed: BibEntry, facts: LibraryFacts): Promise<Pass1Result> {
  const ids = doilessIdentifiers(claimed);
  let undecided: Pass1Result | null = null;
  const notFound: string[] = [];
  for (const { registrar, id, label } of ids) {
    const who = REGISTRAR_LABEL[registrar];
    let res: LookupResult;
    try {
      res = await lookupAt(registrar, id, c.ck, facts);
    } catch (err) {
      if (isOfflineEgressError(err)) {
        undecided ??= offlineRow(c.ck, err, `${who} lookup of ${label}`);
        continue;
      }
      throw err;
    }
    if (res.kind === 'failed') {
      undecided ??= res.permanent
        ? row(c.ck, 'UNVERIFIABLE', `${who} lookup of ${label}: ${res.reason}`)
        : noAnswerRow(c.ck, `${who} lookup of ${label}`, res.reason);
      continue;
    }
    if (res.kind === 'not-found') {
      notFound.push(`${label}: ${res.reason}`);
      continue;
    }
    return compareRecord(
      c,
      res.candidate,
      { label: `${who}'s record of ${label}`, prefix: `${label} re-fetched from ${who}`, agency: registrar === 'pubmed' ? 'PubMed' : who },
      facts,
    );
  }
  if (undecided !== null) return undecided;
  return row(c.ck, 'FABRICATED', `no registrar has this work (${notFound.join('; ')})`, { titleJW: 0, authorJW: 0 });
}

/**
 * The user's own PDF of an entry (VRFY-14, D-20-12): `ok` when it still
 * re-hashes to its recorded sha256 (text problems after a matching hash —
 * image-only, unreadable — still identify the user's file); `altered` when the
 * recorded copy is missing, changed or outside `.paper/sources/`; null when
 * the entry has no bring-your-own PDF, or one attached only at the user's word
 * (`asserted`: never evidence).
 */
async function byoEvidence(
  c: Claimed,
  facts: LibraryFacts,
): Promise<{ kind: 'ok'; file: string; sha256: string; entry: LibraryEntry } | { kind: 'altered'; reason: string } | null> {
  const entry = facts.byo.get(c.ck);
  if (entry === undefined || entry.byo === null || facts.root === undefined) return null;
  const res = await byoText(facts.root, entry);
  if (res.available || res.code === 'no-text' || res.code === 'unreadable' || res.code === 'text-mismatch') {
    return { kind: 'ok', file: entry.byo.file, sha256: entry.byo.sha256, entry };
  }
  if (res.code === 'asserted' || res.code === 'none') return null;
  return { kind: 'altered', reason: res.reason };
}

/**
 * Whether the entry the bibliography claims is the work the user's own PDF was
 * identified as when it was ingested (VRFY-14): the PDF's hash vouches for the
 * FILE, and LIBRARY.json's record of it (the registrar record `add` / `new
 * --pdfs` / the Zotero ingest matched it to, or the PDF's own title and
 * authors) says which WORK the file is. The claimed title, first author and
 * year — what the export prints — are compared with that record exactly as
 * with a registrar's (name-match.ts), so a bibliography edited after ingest,
 * or a mistyped own-source entry, is never passed on the file's hash alone.
 * `uncomparable` when the record holds no title or no author / editor.
 */
function byoIdentity(c: Claimed, entry: LibraryEntry): { kind: 'match' } | { kind: 'mismatch'; match: MatchResult } | { kind: 'uncomparable' } {
  const title = (entry.title ?? '').trim();
  if (title === '' || (entry.authors.length === 0 && entry.editors.length === 0)) return { kind: 'uncomparable' };
  const match = matchWork(c.work, { title, authors: entry.authors, editors: entry.editors, year: entry.year, type: entry.type });
  return match.ok ? { kind: 'match' } : { kind: 'mismatch', match };
}

/** How the ingested identity of a PDF reads in a row: `"Title" (First Author, 2015)`. */
function byoIdentityLabel(entry: LibraryEntry): string {
  const first = entry.authors[0] ?? entry.editors[0] ?? '';
  const who = first.replace(/[{}]/g, '');
  return `"${entry.title ?? ''}" (${[who, entry.year !== null ? String(entry.year) : ''].filter((x) => x !== '').join(', ')})`;
}

/** The OK-BYO row: the file and the first 12 hex digits of its hash, and why no registrar decided. */
function okByoRow(c: Claimed, ev: { file: string; sha256: string }, because: string): Pass1Result {
  return row(c.ck, 'OK-BYO', `your own PDF ${ev.file} (sha256 ${ev.sha256.slice(0, 12)}) still matches what you ingested; ${because}`);
}

/** The MIS-CITED row of an entry that does not describe the work its own PDF was ingested as. */
function byoMisCitedRow(c: Claimed, ev: { file: string; sha256: string; entry: LibraryEntry }, m: MatchResult, because: string): Pass1Result {
  return row(
    c.ck,
    'MIS-CITED',
    `the entry does not describe the work your own PDF ${ev.file} (sha256 ${ev.sha256.slice(0, 12)}) was identified as when you added it, ` +
      `${byoIdentityLabel(ev.entry)} — ${m.detail}; ${because} — cite the work as the PDF shows it, or re-add the right PDF (pensmith add <pdf>)`,
    { titleJW: m.titleJW, authorJW: m.authorJW },
  );
}

/**
 * A lookup that got no answer: OK-BYO when the user's own PDF still matches
 * (VRFY-14) AND the entry describes the work that PDF was ingested as
 * (byoIdentity; a mismatch is MIS-CITED naming the field), else the row as it
 * is — a PDF whose ingested identity cannot be compared stands in for nothing.
 */
async function orByo(c: Claimed, failed: Pass1Result, facts: LibraryFacts): Promise<Pass1Result> {
  const ev = await byoEvidence(c, facts);
  if (ev?.kind !== 'ok') return failed;
  const because = `the registrar lookup got no answer (${failed.reason})`;
  const id = byoIdentity(c, ev.entry);
  if (id.kind === 'mismatch') return byoMisCitedRow(c, ev, id.match, because);
  if (id.kind === 'uncomparable') return failed;
  return okByoRow(c, ev, because);
}

/**
 * Pass 1 for an entry with no DOI, arXiv id, PMID or ISBN: the user's own PDF
 * (OK-BYO), else the metadata search (VRFY-12): a strict match is compared
 * like any record; nothing matching is UNRESOLVABLE; no answer is
 * UNVERIFIABLE-NETWORK. A bring-your-own entry whose PDF changed since ingest
 * is searched for too, and stays UNVERIFIABLE (never invented) when nothing
 * matches.
 */
async function verdictWithoutIdentifier(c: Claimed, claimed: BibEntry, facts: LibraryFacts): Promise<Pass1Result> {
  const ev = await byoEvidence(c, facts);
  const noId = 'the entry has no DOI, arXiv id, PMID or ISBN';
  let uncomparableByo = false;
  if (ev?.kind === 'ok') {
    const id = byoIdentity(c, ev.entry);
    if (id.kind === 'match') return okByoRow(c, ev, noId);
    if (id.kind === 'mismatch') return byoMisCitedRow(c, ev, id.match, noId);
    uncomparableByo = true;
  }
  const found = await metadataSearch(c.work, { isBook: claimed.type === 'book', ...refreshOf(c.ck, facts) });
  if (found.kind === 'match') {
    const crossrefRecord = found.candidate.source === 'crossref' && typeof found.candidate.doi === 'string';
    return compareRecord(
      c,
      found.candidate,
      {
        label: `${found.registrar}'s record of ${found.identifier}`,
        prefix: `no identifier in the entry; the metadata search matched ${found.identifier} (${found.registrar})`,
        agency: crossrefRecord ? 'Crossref' : found.registrar,
        ...(crossrefRecord ? { retractionDois: [found.candidate.doi as string] } : {}),
      },
      facts,
    );
  }
  if (ev?.kind === 'altered') {
    return row(c.ck, 'UNVERIFIABLE', `your own PDF can no longer stand in for this entry (${ev.reason}), and ${found.reason} — re-add the PDF (pensmith add <pdf>) or give the work's identifier`);
  }
  if (found.kind === 'no-answer') return row(c.ck, 'UNVERIFIABLE-NETWORK', `no DOI, arXiv id, PMID or ISBN, and ${found.reason} — ${RETRY_ONLINE}`);
  if (uncomparableByo) {
    return row(
      c.ck,
      'UNVERIFIABLE',
      `LIBRARY.json records no title or author for the work your own PDF was identified as, so the PDF cannot stand in for this entry, and ${found.reason} — re-add the PDF (pensmith add <pdf>) or give the work's identifier`,
    );
  }
  return row(
    c.ck,
    'UNRESOLVABLE',
    `no DOI, arXiv id, PMID or ISBN, and ${found.reason} — add the work's identifier (pensmith add <DOI, arXiv id, PMID or ISBN>), ` +
      `or its PDF (pensmith add <folder holding the PDF>: a PDF no registrar knows is kept as your own copy, OK-BYO), and cite the key it is added under`,
    { titleJW: 0, authorJW: 0 },
  );
}

/** Pass 1 for a DOI entry (see the header). */
async function verdictForDoi(c: Claimed, claimed: BibEntry, doi: string, facts: LibraryFacts): Promise<Pass1Result> {
  const norm = normalizeDoi(doi);
  if (norm === null) return row(c.ck, 'FABRICATED', `the entry's DOI ${JSON.stringify(doi)} is not a DOI`, { titleJW: 0, authorJW: 0 });

  // A DataCite arXiv DOI is re-fetched at arXiv by its id (see the header).
  const dataCiteArxiv = arxivIdOfDataCiteDoi(norm);
  if (dataCiteArxiv !== null) {
    const eprint = typeof claimed.eprint === 'string' && claimed.eprint.trim() ? claimed.eprint : dataCiteArxiv;
    if (normArxiv(eprint) !== dataCiteArxiv) {
      return row(c.ck, 'MIS-CITED', `the DOI ${doi} names arXiv:${dataCiteArxiv}, but the entry's eprint is ${eprint}`);
    }
    const { DOI: _doi, ...rest } = claimed;
    void _doi;
    const v = await verdictByIdentifiers(c, { ...rest, eprint: dataCiteArxiv, archivePrefix: 'arXiv' }, facts);
    return v.verdict === 'UNVERIFIABLE-NETWORK' ? orByo(c, v, facts) : v;
  }

  // RUN-27: a reserved dry-run DOI is accepted ONLY under --dry-run, where the
  // synthetic provider stands in for the registrar (zero sockets).
  if (isReservedDryRunId(norm)) {
    if (!networkMode().dryRun) return row(c.ck, 'FABRICATED', RESERVED_DRY_RUN_REASON, { titleJW: 0, authorJW: 0 });
    const synthetic = await dryRunFetchById(doi);
    if (!synthetic) return row(c.ck, 'FABRICATED', `dry-run: reserved DOI ${doi} is not a source the synthetic provider minted`, { titleJW: 0, authorJW: 0 });
    const match = matchWork(c.work, synthetic);
    const scores = { titleJW: match.titleJW, authorJW: match.authorJW };
    return row(c.ck, match.ok ? 'OK' : 'MIS-CITED', `dry-run synthetic source; ${match.detail}`, scores, synthetic.last_verified);
  }

  const res = await resolveDoi(doi.trim(), refreshOf(c.ck, facts));
  switch (res.kind) {
    case 'record': {
      const returned = normalizeDoi(res.candidate.doi ?? '') ?? norm;
      const retractionDois = res.agency === 'Crossref' ? { retractionDois: [doi, res.candidate.doi ?? returned] } : {};
      if (returned === norm) return compareRecord(c, res.candidate, { label: res.label, prefix: res.prefix, agency: res.agency, ...retractionDois }, facts);
      // VRFY-14: an answer under another DOI passes only when the registrar asserts the relation.
      const alias = await aliasAsserted(norm, res.candidate);
      if (alias === null) {
        return noAnswerRow(c.ck, `${res.agency} answered ${doi} with the record of ${returned}; doi.org's handle check of ${doi}`, 'no answer');
      }
      if (!alias.asserted) {
        const m = matchWork(c.work, res.candidate);
        return row(
          c.ck,
          'MIS-CITED',
          `claimed DOI ${doi} answers with another work's record (${returned}): ${alias.how} — an alias passes only when the registrar asserts it`,
          { titleJW: m.titleJW, authorJW: m.authorJW },
          res.candidate.last_verified,
        );
      }
      return compareRecord(
        c,
        res.candidate,
        { label: res.label, prefix: `${res.prefix ? `${res.prefix}; ` : ''}${doi} → ${returned} (${alias.how})`, agency: res.agency, ...retractionDois },
        facts,
      );
    }
    case 'not-found':
      return row(c.ck, 'FABRICATED', res.reason, { titleJW: 0, authorJW: 0 });
    case 'no-answer':
      return orByo(c, res.offline !== undefined ? offlineRow(c.ck, res.offline, res.reason) : row(c.ck, 'UNVERIFIABLE-NETWORK', `${res.reason} — ${RETRY_ONLINE}`), facts);
    case 'uncomparable': {
      if (doilessIdentifiers(claimed).length === 0) {
        return row(
          c.ck,
          'UNVERIFIABLE',
          `${res.reason} — give the work's arXiv id, PMID or ISBN (pensmith add), or cite its Crossref- or DataCite-registered version`,
        );
      }
      const v = await verdictByIdentifiers(c, claimed, facts);
      if (v.verdict === 'FABRICATED') {
        return { ...v, verdict: 'UNVERIFIABLE', titleJW: NOT_COMPARED, authorJW: NOT_COMPARED, reason: `${res.reason}, and ${v.reason}` };
      }
      if (v.verdict === 'UNVERIFIABLE-NETWORK') return orByo(c, { ...v, reason: `${res.reason}; ${v.reason}` }, facts);
      return { ...v, reason: `${res.reason}; ${v.reason}` };
    }
  }
}

/** The verdict from the entry's registrar, before the stored-retraction rule. */
async function registrarVerdict(c: Claimed, claimed: BibEntry, facts: LibraryFacts): Promise<Pass1Result> {
  if (claimed.DOI) return verdictForDoi(c, claimed, claimed.DOI, facts);
  if (doilessIdentifiers(claimed).length > 0) {
    const v = await verdictByIdentifiers(c, claimed, facts);
    return v.verdict === 'UNVERIFIABLE-NETWORK' ? orByo(c, v, facts) : v;
  }
  return verdictWithoutIdentifier(c, claimed, facts);
}
/** Pass-1 verdict for one cited key (see the header). */
async function verdictForCitekey(ck: string, claimed: BibEntry | undefined, facts: LibraryFacts): Promise<Pass1Result> {
  if (!claimed) return row(ck, 'FABRICATED', 'citekey not in .paper/CITATIONS.bib (drafter invented)', { titleJW: 0, authorJW: 0 });
  // CYCLE-2 H-2 D-14 author shape lock — normalize ONCE at the boundary.
  const authors = normalizeBibAuthors(claimed.author);
  const editors = normalizeBibAuthors(claimed.editor);
  const title = bibTitle(claimed);
  // Field-presence sub-gate (REVIEWS amendment OpenCode MEDIUM #5): an editor-only work counts its editors.
  if (!title || (authors.length === 0 && editors.length === 0)) {
    return row(ck, 'MIS-CITED', 'claimed citation metadata incomplete (empty title, or no author or editor)', { titleJW: 0, authorJW: 0 });
  }
  // VRFY-13: compare what the export prints (biblatex `date`, `subtitle`, `titleaddon` as Pandoc reads them).
  const shown = renderedClaim(claimed, title);
  if ('refused' in shown) return row(ck, 'MIS-CITED', shown.refused, { titleJW: 0, authorJW: 0 });
  const c: Claimed = {
    ck,
    work: { title: shown.title, ...(shown.wholeTitle ? { wholeTitle: true } : {}), authors, editors, year: shown.year },
    doi: claimed.DOI ?? null,
  };
  const v = await registrarVerdict(c, claimed, facts);
  // D-15 stored-retraction gate: the bib's `note = {RETRACTED}` (the on-disk
  // path) or the in-memory `retracted` flag. The re-fetch above still ran, so
  // the row carries the real scores (or n/a when nothing was compared).
  if (claimed.retracted === true || (typeof claimed.note === 'string' && claimed.note.trim().toUpperCase() === 'RETRACTED')) {
    if (v.verdict === 'RETRACTED') return v;
    const compared = v.verdict === 'OK' || v.verdict === 'MIS-CITED';
    const notice = facts.retractionDetails.get(ck);
    return {
      ...row(
        ck,
        'RETRACTED',
        `cited work is retracted (recorded when the source entered the library${notice ? `: ${notice}` : ''})` +
          (v.verdict === 'OK' ? ' — the metadata matches the registrar record' : compared ? ` — also: ${v.reason}` : ` — the registrar re-fetch did not compare: ${v.reason}`),
        compared ? { titleJW: v.titleJW, authorJW: v.authorJW } : undefined,
      ),
      ...(v.checkedAt !== undefined ? { checkedAt: v.checkedAt } : {}),
    };
  }
  return v;
}

// ---------------------------------------------------------------------------
// Bare identifiers (VRFY-10, D-20-14)
// ---------------------------------------------------------------------------

async function bareRow(b: BareIdentifier, facts: LibraryFacts): Promise<Pass1Result> {
  const key = bareIdentifierKey(b);
  const found = (c: SourceCandidate, where: string): Pass1Result => {
    const notice = retractedNotice(c);
    if (notice !== null) return row(key, 'RETRACTED', `cited work is retracted (bare identifier in the text, ${where}: ${notice})`, undefined, c.last_verified);
    return row(key, 'OK', `bare identifier in the text (line ${b.line}): ${where} has "${c.title}"`, undefined, c.last_verified);
  };
  const fromLookup = async (who: string, run: () => Promise<LookupResult>): Promise<Pass1Result> => {
    let res: LookupResult;
    try {
      res = await run();
    } catch (err) {
      if (isOfflineEgressError(err)) return offlineRow(key, err, `${who} lookup of the bare identifier on line ${b.line}`);
      throw err;
    }
    if (res.kind === 'found') return found(res.candidate, who);
    if (res.kind === 'not-found') return row(key, 'FABRICATED', `bare identifier in the text (line ${b.line}): ${who} has no such record (${res.reason})`, { titleJW: 0, authorJW: 0 });
    return res.permanent
      ? row(key, 'UNVERIFIABLE', `bare identifier in the text (line ${b.line}): ${who}: ${res.reason}`)
      : noAnswerRow(key, `${who} lookup of the bare identifier on line ${b.line}`, res.reason);
  };
  if (b.kind === 'arxiv') return fromLookup('arXiv', () => sources.arxiv.lookupById(b.id));
  if (b.kind === 'pmid') return fromLookup('PubMed', () => sources.pubmed.lookupById(b.id, { abstract: false }));
  const arxiv = arxivIdOfDataCiteDoi(b.id);
  if (arxiv !== null) return fromLookup('arXiv', () => sources.arxiv.lookupById(arxiv));
  if (isReservedDryRunId(b.id) && !networkMode().dryRun) return row(key, 'FABRICATED', `bare identifier in the text (line ${b.line}): ${RESERVED_DRY_RUN_REASON}`, { titleJW: 0, authorJW: 0 });
  const res = await resolveDoi(b.id, {});
  switch (res.kind) {
    case 'record': {
      const notice = retractedNotice(res.candidate);
      if (notice === null && res.agency === 'Crossref') {
        const c: Claimed = { ck: key, work: { title: res.candidate.title, authors: res.candidate.authors, year: res.candidate.year ?? null }, doi: b.id };
        const rw = await retractionRequery(c, [b.id, res.candidate.doi ?? b.id], { titleJW: NOT_COMPARED, authorJW: NOT_COMPARED }, res.candidate.last_verified, facts);
        if (rw !== null) return rw;
      }
      const v = found(res.candidate, res.agency);
      return res.agency === 'Crossref' || v.verdict !== 'OK' ? v : { ...v, reason: `${v.reason}; ${retractionUnknownNote(res.agency)}` };
    }
    case 'not-found':
      return row(key, 'FABRICATED', `bare identifier in the text (line ${b.line}): ${res.reason}`, { titleJW: 0, authorJW: 0 });
    case 'no-answer':
      return res.offline !== undefined ? offlineRow(key, res.offline, res.reason) : row(key, 'UNVERIFIABLE-NETWORK', `${res.reason} — ${RETRY_ONLINE}`);
    case 'uncomparable':
      return row(key, 'UNVERIFIABLE', `bare identifier in the text (line ${b.line}): ${res.reason}`);
  }
}

/** The bare identifiers of `draftMd` outside its Pandoc citations (a citation key is checked as a key). */
function bareIdentifiersOf(draftMd: string): BareIdentifier[] {
  const all = findBareIdentifiers(draftMd);
  if (all.length === 0) return all;
  const cites = findCitations(draftMd);
  return all.filter((b) => !cites.some((c) => b.start < c.end && c.start < b.end));
}

/** The stderr hard warning for a RETRACTED row (VRFY-15, D-20-13). */
export function retractionWarningLine(r: Pick<Pass1Result, 'citekey' | 'reason'>): string {
  const notice = /^cited work is retracted \((.*)\)(?: — .*)?$/su.exec(r.reason)?.[1] ?? r.reason;
  return `pensmith verify: RETRACTED — ${r.citekey}: ${notice}`;
}

/**
 * CYCLE-2 H-4 canonical Pass-1 signature: read draft + bib, return one row per
 * cited key (draft order) and one per bare identifier (draft order).
 *
 * 100% deterministic — no LLM, no narration; its only side effects are the
 * registrar reads (cassette-served in offline test mode) and the stderr hard
 * warning for each RETRACTED row.
 */
export interface Pass1Options {
  /**
   * The project root: LIBRARY.json then adds what the bib cannot carry — a
   * recorded retraction notice, and the user's own PDFs (OK-BYO when the PDF
   * still re-hashes to its recorded sha256, VRFY-14). verify and
   * compile pass it.
   */
  readonly root?: string;
  /**
   * The bibliography's entries, already parsed (Phase 20 seam S-C): verify
   * parses CITATIONS.bib entry by entry (VRFY-16) and passes the entries that
   * parsed; `citationsBibPath` is then only named in messages. Absent: the file
   * at `citationsBibPath` is read and parsed.
   */
  readonly bibEntries?: ReadonlyArray<Record<string, unknown>>;
  /**
   * Citekeys whose registrar lookups bypass the HTTP cache (the answer is
   * fetched live and written back): the citations whose last_verified is older
   * than `[verification] recheck_after_days` (VRFY-28; Phase 20 seam S-C).
   */
  readonly refresh?: ReadonlySet<string>;
}

export async function runPass1(
  draftMd: string,
  citationsBibPath: string,
  opts: Pass1Options = {},
): Promise<Pass1Result[]> {
  const entries = opts.bibEntries !== undefined
    ? [...opts.bibEntries]
    : await parseBibFileAt(readFileSync(citationsBibPath, 'utf8'), citationsBibPath);
  const bibByCitekey = new Map<string, BibEntry>(
    entries.map((e) => [String(e['id'] ?? ''), e as BibEntry]),
  );

  // FAIL-CLOSED extraction (audit #2/#20): the BROAD verifier-side detector
  // (citation-token.ts) — uppercase, locators, clusters, narrative keys. A key
  // not in the bib is FABRICATED.
  const unique = extractCitedKeysForVerification(draftMd);
  const bare = bareIdentifiersOf(draftMd);
  const refresh = opts.refresh ?? new Set<string>();

  let facts = unique.length > 0 || bare.length > 0 ? await libraryFacts(opts.root, refresh) : { ...NO_LIBRARY_FACTS, refresh };
  const arxivAsk = arxivIdsToAsk(unique, bibByCitekey);
  if (arxivAsk.length > 1) {
    // One batched request per freshness class (VRFY-28: a refreshed id skips the cache read).
    const answers = new Map<string, LookupResult>();
    const fresh = [...new Set(arxivAsk.filter((a) => refresh.has(a.ck)).map((a) => a.id))];
    const cached = [...new Set(arxivAsk.filter((a) => !refresh.has(a.ck)).map((a) => a.id))].filter((id) => !fresh.includes(id));
    if (fresh.length > 1) for (const [k, v] of await sources.arxiv.lookupByIds(fresh, { refresh: true })) answers.set(k, v);
    if (cached.length > 1) for (const [k, v] of await sources.arxiv.lookupByIds(cached)) answers.set(k, v);
    facts = { ...facts, arxivAnswers: answers };
  }
  const results: Pass1Result[] = [];
  for (const ck of unique) results.push(await verdictForCitekey(ck, bibByCitekey.get(ck), facts));
  for (const b of bare) results.push(await bareRow(b, facts));
  // VRFY-15: a retraction is a hard warning in the terminal as well as a blocking row.
  for (const r of results) if (r.verdict === 'RETRACTED') process.stderr.write(`${retractionWarningLine(r)}\n`);
  return results;
}

// ---------------------------------------------------------------------------
// Freshness (RSCH-10, advisory; VRFY-28 carry-over 1)
// ---------------------------------------------------------------------------

/**
 * RSCH-10 source-freshness probe for a draft (D-10, WARN-only), for the same
 * cited keys Pass 1 sees. SEPARATE from `runPass1` by design: it never feeds a
 * blocking verdict. Each key gets rows that say what was actually probed
 * (freshness.ts): a DOI's HEAD at doi.org and its retraction status; a key
 * with no DOI says where Pass 1 checked it; a key missing from the bib says
 * so. `bibEntries` replaces reading the file (as for runPass1); `root` adds
 * the library's retraction statuses — every `unknown` one is re-checked live
 * (never from the HTTP cache) and a decided answer is recorded through the
 * library writer (VRFY-15).
 */
export async function runFreshnessForDraft(
  draftMd: string,
  citationsBibPath: string,
  opts: {
    readonly bibEntries?: ReadonlyArray<Record<string, unknown>>;
    readonly root?: string;
    /** Probe only the keys whose LIBRARY.json retraction status is `unknown` (done's re-check, D-20-13). */
    readonly onlyRecheck?: boolean;
    /** Record the decided statuses through the library writer (default true; done records them only once it exports). */
    readonly record?: boolean;
  } = {},
): Promise<FreshnessResult[]> {
  const cited = extractCitedKeysForVerification(draftMd);
  if (cited.length === 0) return []; // nothing to probe: the library is not even read
  const entries = opts.bibEntries !== undefined ? [...opts.bibEntries] : await parseBibFileAt(readFileSync(citationsBibPath, 'utf8'), citationsBibPath);
  const bibByCitekey = new Map<string, BibEntry>(entries.map((e) => [String(e['id'] ?? ''), e as BibEntry]));
  let library: readonly LibraryEntry[] = [];
  if (opts.root !== undefined) {
    try {
      library = (await tryLoadLibrary(opts.root))?.entries ?? [];
    } catch {
      library = [];
    }
  }
  // A status is re-checked only when a lookup failed: an agency that publishes
  // no retraction data (the recorded reason) leaves it unknown for good.
  const recheckable = new Set(library.filter((e) => e.retraction_status === 'unknown' && !isNoRetractionDataReason(e.retraction_details)).map((e) => e.citekey));
  const recheckOnly = opts.onlyRecheck === true;
  const probes: FreshnessSource[] = cited.map((ck) => {
    const e = bibByCitekey.get(ck);
    if (!e) return { citekey: ck, inBib: false, doi: null, registrar: null };
    const ids = doilessIdentifiers(e);
    return {
      citekey: ck,
      inBib: true,
      doi: typeof e.DOI === 'string' && e.DOI.trim() ? e.DOI : null,
      registrar: ids.length > 0 ? REGISTRAR_LABEL[ids[0]!.registrar] : null,
      recheck: recheckable.has(ck),
      ...(recheckOnly ? { recheckOnly: true } : {}),
    };
  });
  const list = recheckOnly ? probes.filter((p) => p.recheck === true && p.doi !== null) : probes;
  return probeFreshnessAll(list, opts.root !== undefined && opts.record !== false ? { root: opts.root } : {});
}
