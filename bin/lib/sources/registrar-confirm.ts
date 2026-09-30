// bin/lib/sources/registrar-confirm.ts — research confirms an aggregator's
// DOI record at Crossref before the library stores it (Phase 20, VRFY-13,
// D-20-11: research-to-verify self-consistency).
//
// Semantic Scholar and OpenAlex merge a work's versions into one record, and
// the record can pair the journal article's DOI with fields of another version
// — Semantic Scholar's "Lack of Sample Diversity in Research on Adolescent
// Depression and Social Media Use" carries the Clinical Psychological Science
// DOI (2023) with the PsyArXiv preprint's year (2021). Written to
// CITATIONS.bib as it is, Pass 1 compares that entry with Crossref's record of
// the DOI and rightly finds the year two apart: the tool would block its own
// source. So research asks Crossref for the DOI of each KEPT candidate an
// aggregator found, and when Crossref's record is the same work (title and
// first author, D-11 thresholds; the year is what may differ — or, when the
// aggregator lists the authors in another order, a strict title and its first
// author anywhere in the record's list; review round 3) its
// bibliographic fields — title, subtitle, authors, editors, year, venue,
// volume, issue, pages, publisher, type — replace the aggregator's. The
// candidate keeps its citekey, identifiers, abstract and provenance.
//
// Best-effort and never fatal: a DOI Crossref does not know (a DataCite DOI),
// a failed lookup, an offline miss, or a record that is another work leaves
// the candidate as the aggregator gave it (verify still checks it). The same
// Crossref request is the one Pass 1 makes for the DOI, so the answer is
// cached for verify (7 days). An arXiv DataCite DOI is never asked (Pass 1
// checks it at arXiv). Nothing is asked under --dry-run (no registry entry).

import { isOfflineEgressError } from '../http.js';
import { isDataCiteArxivDoi } from '../full-text.js';
import { authorSimilarity, matchWork, STRICT_TITLE_JW } from '../verify/name-match.js';
import { AUTHOR_JW_THRESHOLD } from '../fuzzy.js';
import type { LookupResult } from './lookup.js';
import type { SourceCandidate } from '../schemas/source-candidate.js';

/** The aggregators whose DOI records research confirms at Crossref. */
export const AGGREGATOR_SOURCES: ReadonlySet<string> = new Set(['semanticscholar', 'openalex']);

/** Crossref's three-way lookup of one DOI (`sources.crossref.lookupById`). */
export type CrossrefLookup = (doi: string) => Promise<LookupResult>;

/** What confirmRegistrarRecords did, for the research log. */
export interface ConfirmOutcome {
  /** The candidates, in input order — a confirmed one replaced by a new object. */
  readonly candidates: SourceCandidate[];
  /** Citekeys whose fields now come from Crossref's record. */
  readonly confirmed: string[];
}

function needsConfirmation(c: SourceCandidate): boolean {
  return AGGREGATOR_SOURCES.has(c.source) && typeof c.doi === 'string' && c.doi.trim() !== '' && !isDataCiteArxivDoi(c.doi);
}

/** The aggregator candidate with Crossref's bibliographic fields (identifiers, abstract, citekey kept). */
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
 * Confirm each aggregator candidate's DOI record at Crossref (see the
 * header). Never throws for a lookup's outcome; the typed OfflineEgressError
 * is a miss like any other here (the candidate stays as it is).
 */
export async function confirmRegistrarRecords(candidates: readonly SourceCandidate[], lookup: CrossrefLookup): Promise<ConfirmOutcome> {
  const out: SourceCandidate[] = [];
  const confirmed: string[] = [];
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
  for (const c of candidates) {
    if (!needsConfirmation(c)) {
      out.push(c);
      continue;
    }
    const record = await recordOf(c.doi as string);
    if (record === null) {
      out.push(c);
      continue;
    }
    const m = matchWork(
      { title: c.title, authors: c.authors, ...(c.editors ? { editors: c.editors } : {}), year: null },
      { title: record.title, subtitle: record.subtitle, authors: record.authors, editors: record.editors, year: record.year ?? null },
    );
    if (!m.ok && !sameWorkReordered(c, record, m)) {
      out.push(c);
      continue;
    }
    out.push(withRecordFields(c, record));
    confirmed.push(c.citekey);
  }
  return { candidates: out, confirmed };
}
