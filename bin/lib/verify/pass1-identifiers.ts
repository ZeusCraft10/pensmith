// bin/lib/verify/pass1-identifiers.ts — which registrar Pass 1 asks for a
// citation, from its identifiers alone (the ONE predicate shared by Pass 1 and
// the outline / planner source filter; review round 1 of the Phase 18/19 merge).
//
// PURE: no fs, no network. Pass 1 (verify/pass1.ts) re-fetches a cited source:
//   - a DataCite arXiv DOI (`10.48550/arXiv.<id>`) at arXiv, by that id;
//   - a reserved `10.0000/pensmith-dryrun.*` DOI from the synthetic provider,
//     under --dry-run only;
//   - any other DOI at Crossref — and when Crossref has no record of it, at
//     the agency doi.org names for its prefix (Phase 20, VRFY-11, D-20-10):
//     DataCite (Zenodo, figshare, Dryad, …) at DataCite's API, mEDRA / JaLC /
//     KISTI through doi.org content negotiation, and an agency that serves no
//     record (ISTIC, …) by the entry's arXiv id / PMID / ISBN at their own
//     registrars (else UNVERIFIABLE, never FABRICATED);
//   - an entry without a DOI by its arXiv id (arXiv), PMID (PubMed) and ISBN
//     (the books registries), in that order.
// An entry with none of these is checked only by a metadata search (VRFY-12),
// which may find no strict match: the outline and the planner are not offered
// it (NO_IDENTIFIER_REASON) — unless it is the user's own PDF with a recorded
// title and author (byoCheckable): Pass 1 then checks the entry against that
// record, OK-BYO (VRFY-14, review round 3). Nor a DOI research learned is registered with an
// agency that serves no readable record (ISTIC, CNKI, the EU Publications
// Office, …) when the entry has no other identifier (review round 2).
//
// source-context.ts verifierBlindSpot reads citationCheckRoute to decide which
// LIBRARY entries the outline and the planner may be offered (D-18-37): only
// the ones this route can check. When Pass 1 gains a registrar, THIS module is
// what widens, for both.

import { isDataCiteArxivDoi } from '../full-text.js';
import { normArxiv } from '../migrations/library/shape.js';
import { isReservedDryRunId } from '../doi.js';

/** The registrars Pass 1 asks for an entry without a (usable) DOI, in the order it asks them. */
export type NoDoiRegistrar = 'arxiv' | 'pubmed' | 'books';

/** One identifier Pass 1 can resolve without a DOI, with the registrar that answers for it. */
export interface DoilessIdentifier {
  readonly registrar: NoDoiRegistrar;
  /** The id as the registrar's lookup takes it (`1706.03762`, `31978945`, `isbn:9780226458083`). */
  readonly id: string;
  /** How a verdict names it (`arXiv:1706.03762`, `PMID 31978945`, `ISBN 9780226458083`). */
  readonly label: string;
}

/** The identifiers of one citation, however its caller stores them (a bib entry, a LIBRARY entry). */
export interface CitationIdentifiers {
  readonly doi?: string | null | undefined;
  /** The arXiv id (a bib `eprint` whose archivePrefix is arXiv or absent). */
  readonly arxiv?: string | null | undefined;
  readonly pmid?: string | null | undefined;
  readonly isbn?: string | null | undefined;
  /**
   * The agency that registered the DOI, when research learned it (a DOI of
   * another agency: LIBRARY.json records `no retraction data for <agency>
   * DOIs`, registrationAgencyOfRecord) — so a DOI Pass 1 can only report
   * UNVERIFIABLE is not offered (review round 2).
   */
  readonly registrationAgency?: string | null | undefined;
  /**
   * The entry is the user's own hash-recorded PDF (not attached at the user's
   * word alone) and LIBRARY.json records the title and an author or editor of
   * the work it was identified as: Pass 1 checks an entry with no identifier
   * against that record (OK-BYO, VRFY-14) — see byoCheckable.
   */
  readonly byoIdentity?: boolean | undefined;
}

/**
 * True when Pass 1 can check an entry against the user's own PDF (OK-BYO):
 * a bring-your-own record that is not `asserted`, with the ingested work's
 * title and an author or editor (review round 3 — the same preconditions as
 * pass1.ts byoIdentity).
 */
export function byoCheckable(entry: {
  readonly byo?: { readonly asserted?: boolean | undefined } | null | undefined;
  readonly title?: string | null | undefined;
  readonly authors?: readonly string[] | null | undefined;
  readonly editors?: readonly string[] | null | undefined;
}): boolean {
  if (entry.byo === null || entry.byo === undefined || entry.byo.asserted === true) return false;
  if (typeof entry.title !== 'string' || entry.title.trim() === '') return false;
  return (entry.authors ?? []).length > 0 || (entry.editors ?? []).length > 0;
}

/**
 * The registration agencies whose DOI records Pass 1 reads: Crossref and
 * DataCite directly, mEDRA / JaLC / KISTI through doi.org content negotiation
 * (sources/doi-cn.ts CONTENT_NEGOTIATION_AGENCIES — tests/pass1-identifiers
 * keeps the two lists together). Lower case.
 */
export const READABLE_AGENCIES: ReadonlySet<string> = new Set(['crossref', 'datacite', 'medra', 'jalc', 'kisti']);

/** The agency a LIBRARY.json `retraction_details` names (`no retraction data for ISTIC DOIs` → `ISTIC`), or null. */
export function registrationAgencyOfRecord(retractionDetails: string | null | undefined): string | null {
  const m = typeof retractionDetails === 'string' ? /^no retraction data for (.+) DOIs$/.exec(retractionDetails.trim()) : null;
  return m?.[1]?.trim() || null;
}

function trimmed(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The identifiers Pass 1 resolves without a DOI, each with its registrar, in the order it asks them. */
export function doilessIdentifiers(ids: CitationIdentifiers): DoilessIdentifier[] {
  const out: DoilessIdentifier[] = [];
  const arxiv = trimmed(ids.arxiv);
  if (arxiv) out.push({ registrar: 'arxiv', id: arxiv, label: `arXiv:${arxiv}` });
  const pmid = trimmed(ids.pmid);
  if (pmid) out.push({ registrar: 'pubmed', id: pmid, label: `PMID ${pmid}` });
  const isbn = trimmed(ids.isbn);
  if (isbn) out.push({ registrar: 'books', id: `isbn:${isbn}`, label: `ISBN ${isbn}` });
  return out;
}

/** How Pass 1 checks a citation (see the header). */
export type CitationCheckRoute =
  | { readonly kind: 'arxiv-doi'; readonly arxiv: string }
  | { readonly kind: 'dry-run-doi' }
  | { readonly kind: 'crossref'; readonly fallback: readonly DoilessIdentifier[] }
  | { readonly kind: 'no-doi'; readonly ids: readonly DoilessIdentifier[] };

/** The route Pass 1 takes for a citation with these identifiers. */
export function citationCheckRoute(ids: CitationIdentifiers): CitationCheckRoute {
  const doi = trimmed(ids.doi);
  if (doi === '') return { kind: 'no-doi', ids: doilessIdentifiers(ids) };
  if (isDataCiteArxivDoi(doi)) {
    const arxiv = normArxiv(doi);
    if (arxiv !== null) return { kind: 'arxiv-doi', arxiv };
  }
  if (isReservedDryRunId(doi)) return { kind: 'dry-run-doi' };
  return { kind: 'crossref', fallback: doilessIdentifiers(ids) };
}

/** The reason an entry with no identifier Pass 1 can resolve is withheld. */
export const NO_IDENTIFIER_REASON = 'no DOI, arXiv id, PMID or ISBN';

/**
 * Why Pass 1 could never pass a citation of an entry with these identifiers,
 * from the identifiers alone — null when some registrar can check it. (A
 * reserved dry-run DOI is the caller's to judge: it is checkable only under
 * --dry-run.)
 */
export function uncheckableReason(ids: CitationIdentifiers): string | null {
  const route = citationCheckRoute(ids);
  switch (route.kind) {
    case 'arxiv-doi':
    case 'dry-run-doi':
      return null;
    case 'no-doi':
      // No identifier: the user's own PDF (OK-BYO) is what Pass 1 checks it against.
      return route.ids.length > 0 || ids.byoIdentity === true ? null : NO_IDENTIFIER_REASON;
    case 'crossref': {
      // Crossref, else the agency doi.org names (DataCite, content
      // negotiation, else the entry's other identifiers) — VRFY-11. An agency
      // known to serve no record the verifier can read, with no other
      // identifier to fall back on, can only ever be UNVERIFIABLE.
      const agency = trimmed(ids.registrationAgency);
      if (agency !== '' && !READABLE_AGENCIES.has(agency.toLowerCase()) && route.fallback.length === 0) {
        return `its DOI is registered with ${agency}, which serves no record the verifier can read (and it has no arXiv id, PMID or ISBN)`;
      }
      return null;
    }
  }
}
