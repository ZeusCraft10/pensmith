// bin/lib/verify/pass1-identifiers.ts — which registrar Pass 1 asks for a
// citation, from its identifiers alone (the ONE predicate shared by Pass 1 and
// the outline / planner source filter; review round 1 of the Phase 18/19 merge).
//
// PURE: no fs, no network. Pass 1 (verify/pass1.ts) re-fetches a cited source:
//   - a DataCite arXiv DOI (`10.48550/arXiv.<id>`) at arXiv, by that id;
//   - a reserved `10.0000/pensmith-dryrun.*` DOI from the synthetic provider,
//     under --dry-run only;
//   - any other DOI at Crossref — and when Crossref has no record of it and
//     doi.org says another agency (DataCite, ISTIC, JaLC, mEDRA, …) registered
//     it, by the entry's arXiv id / PMID / ISBN at their own registrars
//     (else UNVERIFIABLE, never FABRICATED);
//   - an entry without a DOI by its arXiv id (arXiv), PMID (PubMed) and ISBN
//     (the books registries), in that order.
// An entry with none of these cannot be checked upstream.
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
}

/**
 * DOI prefixes registered with DataCite that are not arXiv's: Zenodo,
 * figshare, Dryad. Crossref has no record of them, and Pass 1 cannot query
 * DataCite yet (VRFY-11), so such an entry is checkable only through its
 * arXiv id / PMID / ISBN. (arXiv's own DataCite prefix, 10.48550, is resolved
 * at arXiv.)
 */
export const DATACITE_DOI_PREFIXES: readonly string[] = Object.freeze(['10.5281', '10.6084', '10.5061']);

function trimmed(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** The DOI's lower-cased prefix (`10.5281`), or '' when there is none. */
export function doiPrefixOf(doi: string | null | undefined): string {
  const d = trimmed(doi).toLowerCase();
  const slash = d.indexOf('/');
  return slash > 0 ? d.slice(0, slash) : '';
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
      return route.ids.length > 0 ? null : NO_IDENTIFIER_REASON;
    case 'crossref': {
      const prefix = doiPrefixOf(ids.doi);
      if (DATACITE_DOI_PREFIXES.includes(prefix) && route.fallback.length === 0) {
        return `a DataCite DOI (${prefix}) the verifier cannot check yet, and no arXiv id, PMID or ISBN`;
      }
      return null;
    }
  }
}
