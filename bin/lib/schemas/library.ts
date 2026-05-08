// bin/lib/schemas/library.ts — foundation-slice library skeleton (LIB-01, D-59).
//
// Phase 1 scope: empty entries[] skeleton. Real library entries land in Phase 3
// (research wave). The schema is here in foundation so W10's library.ts loader
// has something to validate against (proves the loader chokepoint contract).
//
// LibraryEntry minimal field set (foundation-slice):
//   - id (stable identifier — used as primary key in W10 lookups)
//   - doi/arxiv/pmid/pmcid (optional; one of these is the canonical id)
//   - title (optional in foundation slice; required by Phase 3 research-wave migration)
//   - addedAt (ISO timestamp)
//
// Future migrations (Phase 3) extend the entry to include authors, year,
// abstract, sources[], cite-key, etc. Those land in `migrations/library/v1_to_v2.ts`.

import { z } from 'zod';

export const CURRENT_LIBRARY_VERSION = 1;

export const LibraryEntrySchema = z.object({
  id: z.string().min(1),
  doi: z.string().nullable().optional(),
  arxiv: z.string().nullable().optional(),
  pmid: z.string().nullable().optional(),
  pmcid: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
  addedAt: z.string().datetime(),
});

export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_LIBRARY_VERSION),
  entries: z.array(LibraryEntrySchema).default([]),
});

export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;
export type Library = z.infer<typeof Schema>;
