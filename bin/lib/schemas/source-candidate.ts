// bin/lib/schemas/source-candidate.ts — D-14 LOCKED unified source-candidate schema.
//
// Phase 3 wave 2 / Plan 03-03 Task 3.1.
//
// This schema is the contract for every adapter's response (crossref, openalex,
// arxiv, pubmed, semanticscholar, unpaywall, retraction-watch). The
// discriminated union on `source` lets the verifier and library writer dispatch
// to per-source logic without losing strong typing.
//
// D-14 LOCKED contract (CYCLE-3 reviews convergence — single canonical schema):
//   - id: REQUIRED. DOI / arXiv ID / PMID / S2 paperId / OpenAlex W-ID.
//   - title: REQUIRED.
//   - authors: REQUIRED string[] (surname normalization happens in
//              bin/lib/author-normalize.ts, Plan 01).
//   - year: optional int 1800..2100.
//   - doi: optional (normalized in bin/lib/doi.ts).
//   - abstract / oa_pdf_url / retraction_details: optional.
//   - retracted: boolean default false (wires D-15 surface-twice).
//   - last_verified: REQUIRED ISO datetime.
//   - citekey: REQUIRED, matches /^[a-z][a-z0-9_-]*$/ (deterministic gen in
//              bin/lib/citekey.ts, Plan 04).
//   - raw: unknown — per-adapter native payload, debug only; stripped by
//          bin/lib/bibtex-write.ts before persistence (BL-4 chokepoint).

import { z } from 'zod';
import {
  SourceTypeSchema,
  RetractionStatusSchema,
  ZoteroRefSchema,
  OaLocationSchema,
} from './source-types.js';

const BaseFields = {
  id: z.string().min(1),
  title: z.string().min(1),
  authors: z.array(z.string()).min(1),
  year: z.number().int().min(1800).max(2100).optional(),
  doi: z.string().optional(),
  abstract: z.string().optional(),
  oa_pdf_url: z.string().url().optional(),
  retracted: z.boolean().default(false),
  retraction_details: z.string().optional(),
  last_verified: z.string().datetime(),
  citekey: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  raw: z.unknown(),
  // RUN-27 (D-17-11): the synthetic dry-run provider flags every source it
  // mints (reserved-namespace ids) and may carry arXiv-style / ISBN-style ids.
  synthetic: z.boolean().optional(),
  arxiv: z.string().optional(),
  isbn: z.string().optional(),
  // Phase 19 seam S-B — the fields a full reference and the evaluator need
  // (SRC-02, SRC-03, SRC-04, SRC-05, SRC-11, SRC-16). All optional: an adapter
  // sets what its registrar returns. The library writer copies them into the
  // LIBRARY.json v3 entry (bin/lib/migrations/library/shape.ts).
  pmid: z.string().optional(),
  pmcid: z.string().optional(),
  venue: z.string().optional(),
  volume: z.string().optional(),
  issue: z.string().optional(),
  pages: z.string().optional(),
  publisher: z.string().optional(),
  type: SourceTypeSchema.optional(),
  /** Editors, for edited volumes / editor-only works (author strings, same forms). */
  editors: z.array(z.string()).optional(),
  /** Every open-access location Unpaywall lists (SRC-03); oa_pdf_url is the best PDF among them. */
  oa_locations: z.array(OaLocationSchema).optional(),
  /** Retraction lookup outcome when the adapter's own record carries it (Crossref updated-by, SRC-04). */
  retraction_status: RetractionStatusSchema.optional(),
  /** The Zotero item identity (SRC-16). */
  zotero: ZoteroRefSchema.optional(),
  // Phase 20 (VRFY-13, VRFY-14): what Pass 1 compares beyond the title and
  // authors. Neither is persisted (the library keeps the title as registered).
  /** The registrar's subtitle, when it keeps it apart from the title (Crossref `subtitle`, DataCite `Subtitle`). */
  subtitle: z.string().optional(),
  /**
   * The relations the registrar itself asserts between this work and another
   * DOI (Crossref `relation`, DataCite `relatedIdentifiers`): `type` in the
   * registrar's kebab-case spelling (`is-identical-to`, `has-preprint`, …),
   * `doi` normalized. Pass 1 accepts an answer under another DOI only on one
   * of these (VRFY-14, D-20-12).
   */
  relations: z.array(z.object({ type: z.string().min(1), doi: z.string().min(1) }).strict()).optional(),
};

export const SourceCandidateSchema = z.discriminatedUnion('source', [
  z.object({ ...BaseFields, source: z.literal('crossref') }),
  // Phase 20 (VRFY-11, D-20-10): a DataCite record (api.datacite.org), and a
  // record another agency served through doi.org content negotiation
  // (mEDRA, JaLC, KISTI — CSL JSON).
  z.object({ ...BaseFields, source: z.literal('datacite') }),
  z.object({ ...BaseFields, source: z.literal('doi.org') }),
  z.object({ ...BaseFields, source: z.literal('openalex') }),
  z.object({ ...BaseFields, source: z.literal('arxiv') }),
  z.object({ ...BaseFields, source: z.literal('pubmed') }),
  z.object({ ...BaseFields, source: z.literal('semanticscholar') }),
  z.object({ ...BaseFields, source: z.literal('unpaywall') }),
  z.object({ ...BaseFields, source: z.literal('retraction-watch') }),
  // RSCH-06: Zotero MCP is a normalizable source provider. Items pulled via the
  // injectable Zotero client (bin/lib/sources/zotero-mcp.ts) normalize to this
  // variant so they validate against the locked D-14 schema and flow through the
  // SAME scoring + RSCH-11 retraction cross-check as every other adapter.
  z.object({ ...BaseFields, source: z.literal('zotero-mcp') }),
  // RUN-27: the labelled synthetic dry-run provider (bin/lib/sources/dry-run.ts).
  // Only ever produced under --dry-run; outside it research filters reserved ids.
  z.object({ ...BaseFields, source: z.literal('dry-run') }),
  // Phase 19 seam S-B: the books adapter (Open Library / Google Books, SRC-11),
  // the Zotero Web / local API client (SRC-16) and bring-your-own PDFs entering
  // the research candidate pool (SRC-15).
  z.object({ ...BaseFields, source: z.literal('books') }),
  z.object({ ...BaseFields, source: z.literal('zotero') }),
  z.object({ ...BaseFields, source: z.literal('byo') }),
]);
export type SourceCandidate = z.infer<typeof SourceCandidateSchema>;
