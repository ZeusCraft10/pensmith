// bin/lib/schemas/source-candidate.ts — the shape every research adapter
// answers with (crossref, openalex, arxiv, pubmed, semanticscholar, unpaywall,
// zotero-mcp), so research, add and the library treat them alike.
//
//   - id: the registry's own identifier (DOI, arXiv ID, PMID, S2 paperId,
//     OpenAlex W-ID).
//   - authors: display strings, "Family, Given" (or a corporate name), built
//     from `names`. Citekeys and prompts read these.
//   - names: the same authors as CSL name objects, from the registry's own
//     fields where it has them (Crossref and Zotero family/given, PubMed's
//     "Family Initials"); OpenAlex, arXiv and Semantic Scholar give display
//     names only, which author-normalize.ts splits.
//   - doi / arxiv / pmid / pmcid / isbn: the identifiers Pass 1 can look a
//     work up by. A work with none of them cannot be verified.
//   - csl_type, container_title, volume, issue, page, publisher, url: the
//     bibliographic fields the library item keeps (CSL-JSON names them).
//   - also_known_as / merged_from: when research merged several records of
//     one work into this one, the identifiers the others had and where they
//     came from. They find the work again; only this record's own
//     identifiers are printed in the bibliography.
//   - retracted: set from the candidate's own record before it is stored
//     (bin/lib/sources/retraction-cross-check.ts).
//   - citekey: provisional; the library assigns the one that is kept
//     (bin/lib/library.ts), reusing the key of a work it already holds.
//   - raw: the adapter's native payload, never stored.

import { z } from 'zod';

/** A CSL-JSON name: a person (family and given names) or a corporate `literal`. */
export const CslNameSchema = z.object({
  family: z.string().min(1).optional(),
  given: z.string().min(1).optional(),
  suffix: z.string().min(1).optional(),
  'non-dropping-particle': z.string().min(1).optional(),
  'dropping-particle': z.string().min(1).optional(),
  literal: z.string().min(1).optional(),
});
export type CslName = z.infer<typeof CslNameSchema>;

const BaseFields = {
  id: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string()).min(1),
  names: z.array(CslNameSchema).optional(),
  arxiv: z.string().min(1).optional(),
  pmid: z.string().min(1).optional(),
  pmcid: z.string().min(1).optional(),
  isbn: z.string().min(1).optional(),
  csl_type: z.string().min(1).optional(),
  container_title: z.string().min(1).optional(),
  volume: z.string().min(1).optional(),
  issue: z.string().min(1).optional(),
  page: z.string().min(1).optional(),
  publisher: z.string().min(1).optional(),
  url: z.string().url().optional(),
  also_known_as: z.array(z.string().min(1)).optional(),
  merged_from: z.array(z.object({ source: z.string().min(1), id: z.string().min(1) })).optional(),
  year: z.number().int().min(1800).max(2100).optional(),
  doi: z.string().optional(),
  abstract: z.string().optional(),
  oa_pdf_url: z.string().url().optional(),
  retracted: z.boolean().default(false),
  retraction_details: z.string().optional(),
  last_verified: z.string().datetime(),
  citekey: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  raw: z.unknown(),
};

export const SourceCandidateSchema = z.discriminatedUnion('source', [
  z.object({ ...BaseFields, source: z.literal('crossref') }),
  z.object({ ...BaseFields, source: z.literal('openalex') }),
  z.object({ ...BaseFields, source: z.literal('arxiv') }),
  z.object({ ...BaseFields, source: z.literal('pubmed') }),
  z.object({ ...BaseFields, source: z.literal('semanticscholar') }),
  z.object({ ...BaseFields, source: z.literal('unpaywall') }),
  z.object({ ...BaseFields, source: z.literal('zotero-mcp') }),
]);
export type SourceCandidate = z.infer<typeof SourceCandidateSchema>;
