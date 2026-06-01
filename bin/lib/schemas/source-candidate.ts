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
};

export const SourceCandidateSchema = z.discriminatedUnion('source', [
  z.object({ ...BaseFields, source: z.literal('crossref') }),
  z.object({ ...BaseFields, source: z.literal('openalex') }),
  z.object({ ...BaseFields, source: z.literal('arxiv') }),
  z.object({ ...BaseFields, source: z.literal('pubmed') }),
  z.object({ ...BaseFields, source: z.literal('semanticscholar') }),
  z.object({ ...BaseFields, source: z.literal('unpaywall') }),
  z.object({ ...BaseFields, source: z.literal('retraction-watch') }),
]);
export type SourceCandidate = z.infer<typeof SourceCandidateSchema>;
