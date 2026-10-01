// bin/lib/sources/registrar-confirm.ts — research confirms an aggregator's
// DOI record at the DOI's registrar before the library stores it (Phase 20,
// VRFY-13, D-20-11: research-to-verify self-consistency).
//
// Semantic Scholar and OpenAlex merge a work's versions into one record, and
// the record can pair the journal article's DOI with fields of another version
// — Semantic Scholar's "Lack of Sample Diversity in Research on Adolescent
// Depression and Social Media Use" carries the Clinical Psychological Science
// DOI (2023) with the PsyArXiv preprint's year (2021). Written to
// CITATIONS.bib as it is, Pass 1 compares that entry with Crossref's record of
// the DOI and rightly finds the year two apart: the tool would block its own
// source. So research asks the DOI's registrar — where Pass 1 asks it:
// Crossref, else the agency doi.org names (DataCite, or doi.org content
// negotiation for mEDRA / JaLC / KISTI; the caller's lookup routes it,
// source-input.ts registrarLookup) — for the DOI of each KEPT candidate an
// aggregator found, and when the registrar's record is the same work (title and
// first author, D-11 thresholds; the year is what may differ — or, when the
// aggregator lists the authors in another order, a strict title and its first
// author anywhere in the record's list; review round 3) its
// bibliographic fields — title, subtitle, authors, editors, year, venue,
// volume, issue, pages, publisher, type — replace the aggregator's. The
// candidate keeps its citekey, identifiers, abstract and provenance.
//
// PubMed is not a DOI's registrar either (review round 1 of the Phase 20 +
// 23a merge, found on the live chain): for a non-English article its title is
// the English translation in brackets, while Crossref holds the title the
// journal printed — PubMed's `[How much do medical students forget?]` is
// Crossref's `Mennyit felejtenek az orvostanhallgatók?`, and Pass 1 blocked
// the kept source as MIS-CITED on the title. A PubMed candidate with a DOI is
// confirmed too, and its record's original-language title
// (pubmedVernacularTitle) counts as its title for the same-work check. Since
// review round 2 a PMID identified like `add` is confirmed the same way
// (source-input.ts lookupIdentifier → pubmedConfirmed): `add PMID:…`, a URL
// that declares a PMID, and research's prune question.
//
// A registrar record that is definitively ANOTHER work (main-branch merge
// review, round 2, found on the live chain: OpenAlex paired the DataCite DOI
// 10.4230/lipics.itp.2023.19 — DataCite's "MizAR 60 for Mizar 50" — with
// "Exploiting Generative AI to Scale up Intelligent Tutoring Systems") is a
// guaranteed MIS-CITED at Pass 1: the candidate is named in `mismatched`
// with the registrar's title, and research drops it from the kept sources
// (research-orchestrator.ts confirmKept), so it never reaches LIBRARY.json,
// the outline or a plan.
//
// Best-effort otherwise: a DOI no registrar answers for, a failed lookup or
// an offline miss leaves the candidate as the aggregator gave it (verify
// still checks it). The same registrar request is the one Pass 1 makes for
// the DOI, so the answer is cached for verify. An arXiv DataCite DOI is never
// asked (Pass 1 checks it at arXiv). Nothing is asked under --dry-run (no
// registry entry).

import { isOfflineEgressError } from '../http.js';
import { isDataCiteArxivDoi } from '../full-text.js';
import { authorSimilarity, matchWork, STRICT_TITLE_JW } from '../verify/name-match.js';
import { AUTHOR_JW_THRESHOLD } from '../fuzzy.js';
import { pubmedVernacularTitle } from './pubmed.js';
import type { LookupResult } from './lookup.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

/** The sources that are not a DOI's registrar, whose DOI records research confirms at the registrar. */
export const AGGREGATOR_SOURCES: ReadonlySet<string> = new Set(['semanticscholar', 'openalex', 'pubmed']);

/** The three-way lookup of one DOI at its registrar (Crossref, else the agency doi.org names). */
export type RegistrarLookup = (doi: string) => Promise<LookupResult>;

/** A candidate whose DOI the registrar records as another work. */
export interface RegistrarMismatch {
  /** Its position in the input. */
  readonly index: number;
  readonly citekey: string;
  readonly doi: string;
  /** One line: `DOI X is "<registrar title>" at <registrar>, not "<aggregator title>"`. */
  readonly reason: string;
}

/** What confirmRegistrarRecords did, for the research log. */
export interface ConfirmOutcome {
  /** The candidates, in input order — a confirmed one replaced by a new object; a mismatched one as it was. */
  readonly candidates: SourceCandidate[];
  /** Citekeys whose fields now come from the registrar's record. */
  readonly confirmed: string[];
  /** Candidates whose DOI the registrar records as another work (Pass 1 would block them as MIS-CITED). */
  readonly mismatched: RegistrarMismatch[];
}

/** The registrar a record came from, as a person names it. */
function registrarName(source: string): string {
  return source === 'crossref' ? 'Crossref' : source === 'datacite' ? 'DataCite' : source === 'doi.org' ? 'its registration agency (doi.org)' : source;
}

/** A title for a one-line reason (quotes neutralised, shortened). */
function quoted(title: string): string {
  const t = title.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return `"${t.length > 120 ? `${t.slice(0, 117)}…` : t}"`;
}

function needsConfirmation(c: SourceCandidate): boolean {
  return AGGREGATOR_SOURCES.has(c.source) && typeof c.doi === 'string' && c.doi.trim() !== '' && !isDataCiteArxivDoi(c.doi);
}

/** The titles the candidate's own record gives the work: its title, then PubMed's original-language title of a translated one. */
function titlesOf(c: SourceCandidate): string[] {
  const vernacular = c.source === 'pubmed' ? pubmedVernacularTitle(c.raw) : null;
  return vernacular !== null && vernacular !== c.title ? [c.title, vernacular] : [c.title];
}

/** The aggregator candidate with the registrar's bibliographic fields (identifiers, abstract, citekey kept). */
function withRecordFields(c: SourceCandidate, r: SourceCandidate): SourceCandidate {
  const out: SourceCandidate = { ...c, title: r.title, authors: [...r.authors] };
  const copy = <K extends 'subtitle' | 'editors' | 'year' | 'venue' | 'volume' | 'issue' | 'pages' | 'publisher' | 'type'>(k: K): void => {
    if (r[k] !== undefined) out[k] = r[k];
  };
  copy('subtitle');
  copy('editors');
  copy('year');
  copy('venue');
  copy('volume');
  copy('issue');
  copy('pages');
  copy('publisher');
  copy('type');
  if (c.abstract === undefined && r.abstract !== undefined) out.abstract = r.abstract;
  return out;
}

/**
 * The same work with its authors in another order: the aggregator lists the
 * authors differently from the registrar (Semantic Scholar put Limon first
 * for a paper Crossref lists Khan, Begum, Rahman, Limon, …), so only the first
 * author failed — the title matches strictly (STRICT_TITLE_JW) and the
 * aggregator's first author is one of the record's authors. The record's
 * author order is then adopted (review round 3).
 */
function sameWorkReordered(c: SourceCandidate, record: SourceCandidate, m: ReturnType<typeof matchWork>): boolean {
  if (m.failing.length !== 1 || m.failing[0] !== 'first author' || m.titleJW < STRICT_TITLE_JW) return false;
  const first = c.authors[0];
  if (first === undefined) return false;
  return record.authors.some((a) => authorSimilarity(a, first) >= AUTHOR_JW_THRESHOLD);
}

/**
 * Confirm each aggregator candidate's DOI record at its registrar (see the
 * header). Never throws for a lookup's outcome; the typed OfflineEgressError
 * is a miss like any other here (the candidate stays as it is).
 */
export async function confirmRegistrarRecords(candidates: readonly SourceCandidate[], lookup: RegistrarLookup): Promise<ConfirmOutcome> {
  const out: SourceCandidate[] = [];
  const confirmed: string[] = [];
  const mismatched: RegistrarMismatch[] = [];
  const answers = new Map<string, Promise<SourceCandidate | null>>();
  const recordOf = (doi: string): Promise<SourceCandidate | null> => {
    const key = doi.trim().toLowerCase();
    let p = answers.get(key);
    if (p === undefined) {
      p = lookup(doi.trim()).then(
        (r) => (r.kind === 'found' ? r.candidate : null),
        // Offline with no recording: no confirmation (verify asks again).
        (err: unknown) => {
          if (isOfflineEgressError(err)) return null;
          throw err;
        },
      );
      answers.set(key, p);
    }
    return p;
  };
  for (const [index, c] of candidates.entries()) {
    if (!needsConfirmation(c)) {
      out.push(c);
      continue;
    }
    const record = await recordOf(c.doi as string);
    if (record === null) {
      out.push(c);
      continue;
    }
    const same = titlesOf(c).some((title) => {
      const m = matchWork(
        { title, authors: c.authors, ...(c.editors ? { editors: c.editors } : {}), year: null },
        { title: record.title, subtitle: record.subtitle, authors: record.authors, editors: record.editors, year: record.year ?? null },
      );
      return m.ok || sameWorkReordered(c, record, m);
    });
    if (!same) {
      out.push(c);
      const doi = (c.doi as string).trim();
      mismatched.push({ index, citekey: c.citekey, doi, reason: `DOI ${doi} is ${quoted(record.title)} at ${registrarName(record.source)}, not ${quoted(c.title)}` });
      continue;
    }
    out.push(withRecordFields(c, record));
    confirmed.push(c.citekey);
  }
  return { candidates: out, confirmed, mismatched };
}
