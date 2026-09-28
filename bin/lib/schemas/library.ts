// bin/lib/schemas/library.ts — the per-paper source library, `.paper/LIBRARY.json`
// (LIB-01, D-59; v2 by BRDTH-01 / D-17-43; v3 by Phase 19 seam S-B).
//
// LIBRARY.json is the paper's source of truth for sources. It has ONE writer,
// bin/lib/library.ts (upsertSources — research, add, plan --research, and later
// BYO / Zotero ingest), which also renders .paper/CITATIONS.bib and
// .paper/CITATIONS.ris from it (chokepoint row `library-writer`).
//
// v1 (foundation slice) was `{id, doi?, arxiv?, pmid?, pmcid?, title?, addedAt}`,
// but research wrote raw SourceCandidate[] entries without `addedAt`, so every
// real library failed validation (T1-9). v2 is the real shape; the v1→v2
// migration (bin/lib/migrations/library/v1_to_v2.ts) accepts BOTH v1 shapes.
//
// Field notes:
//   - citekey: the stable primary key shared with CITATIONS.bib, the section
//     PLAN.md assigned_sources[] and the drafts' [@citekey] tokens. Unique.
//   - doi: doi.ts-normalized (lowercase). alternate_dois: other DOIs of the same
//     work (preprint ↔ version of record). They are CANDIDATES only — Pass 1
//     accepts one only when the registrar itself asserts the relation at
//     verification time (VRFY-14); storing one here is never evidence.
//   - arxiv: bare id without version (`1706.03762`, `cs.CL/0301012`). pmid:
//     digits. pmcid: `PMC<digits>`. isbn: ISBN-13 digits.
//   - authors: display strings, "Family, Given" where known.
//   - provenance: every ingest path that produced or confirmed the entry
//     (`research:openalex`, `add:crossref`, `plan-research:§2`, `bib-import`, …).
//   - last_verified: ISO time the metadata was last fetched from / checked
//     against its registrar (VRFY-28 re-check scheduling reads it).
//   - byo: the bring-your-own PDF record (SRC-15 fills it; hashes, not text).
//
// v3 (Phase 19 seam S-B, migration bin/lib/migrations/library/v2_to_v3.ts):
//   - type / publisher / volume / issue / pages / editors: the bibliographic
//     fields a formatted reference needs (SRC-05, SRC-11, SRC-12). `type` is a
//     CSL type (bin/lib/schemas/source-types.ts).
//   - tier / relevance / why_relevant: the source evaluator's judgement
//     (SRC-09): tier ∈ peer-reviewed | preprint | book | gov-report | other,
//     relevance 0–1, why_relevant = the evaluator's reason, shown in RESEARCH.md.
//   - hydrated: false for a bring-your-own PDF kept with its local metadata
//     because no registrar record matched it confidently (SRC-15).
//   - retraction_status: unchecked | clear | retracted | unknown (SRC-04). An
//     unanswerable lookup is `unknown`, never `clear`; `retracted` mirrors it.
//   - zotero: the Zotero item identity, when the entry came from Zotero (SRC-16).
//
// Author strings: "Family, Given" where the family is known, "Given Family"
// as a registrar displays it, or "{Corporate Name}" (braced) for a corporate
// or consortium author (the BibTeX writer emits it as one literal name).
//
// Any new field needs a v(N)→v(N+1) migration and a CURRENT_LIBRARY_VERSION
// bump in the same change (S-20).

import { z } from 'zod';
import {
  SourceTypeSchema,
  SourceTierSchema,
  RetractionStatusSchema,
  ZoteroRefSchema,
} from './source-types.js';

export const CURRENT_LIBRARY_VERSION = 3;

/** The Pandoc citation-key grammar (a superset of the D-14 generated form). */
export const CITEKEY_GRAMMAR = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_:.#$%&+?<>~/-]*[\p{L}\p{N}_])?$/u;

const IsoDateTime = z.string().datetime();

export const ByoRecordSchema = z
  .object({
    file: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    text_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  })
  .strict();

export const LibraryEntrySchema = z
  .object({
    // Generated keys follow D-14 (`^[a-z][a-z0-9_-]*$`); a key imported from a
    // user's CITATIONS.bib keeps its spelling, so the schema accepts the Pandoc
    // citation-key grammar (letter/digit/_ first; alphanumerics, _ and internal
    // :.#$%&-+?<>~/ after) — a draft citing it must keep resolving.
    citekey: z.string().regex(CITEKEY_GRAMMAR),
    doi: z.string().min(1).nullable().default(null),
    arxiv: z.string().min(1).nullable().default(null),
    pmid: z.string().regex(/^\d{1,9}$/).nullable().default(null),
    pmcid: z.string().regex(/^PMC\d+$/).nullable().default(null),
    isbn: z.string().regex(/^\d{13}$/).nullable().default(null),
    title: z.string().min(1).nullable().default(null),
    authors: z.array(z.string().min(1)).default([]),
    year: z.number().int().min(1000).max(2200).nullable().default(null),
    venue: z.string().min(1).nullable().default(null),
    abstract: z.string().min(1).nullable().default(null),
    oa_url: z.string().url().nullable().default(null),
    alternate_dois: z.array(z.string().min(1)).default([]),
    provenance: z.array(z.string().min(1)).default([]),
    retracted: z.boolean().default(false),
    retraction_details: z.string().min(1).nullable().default(null),
    synthetic: z.boolean().default(false),
    last_verified: IsoDateTime.nullable().default(null),
    byo: ByoRecordSchema.nullable().default(null),
    // v3 (Phase 19 seam S-B).
    type: SourceTypeSchema.nullable().default(null),
    publisher: z.string().min(1).nullable().default(null),
    volume: z.string().min(1).nullable().default(null),
    issue: z.string().min(1).nullable().default(null),
    pages: z.string().min(1).nullable().default(null),
    editors: z.array(z.string().min(1)).default([]),
    tier: SourceTierSchema.nullable().default(null),
    relevance: z.number().min(0).max(1).nullable().default(null),
    why_relevant: z.string().min(1).nullable().default(null),
    hydrated: z.boolean().default(true),
    retraction_status: RetractionStatusSchema.default('unchecked'),
    zotero: ZoteroRefSchema.nullable().default(null),
    addedAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .strict()
  .superRefine((e, ctx) => {
    // `retracted` and `retraction_status` never disagree (SRC-04).
    if (e.retracted !== (e.retraction_status === 'retracted')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['retraction_status'],
        message: `retraction_status "${e.retraction_status}" disagrees with retracted: ${String(e.retracted)}`,
      });
    }
  });

export const Schema = z
  .object({
    $schemaVersion: z.literal(CURRENT_LIBRARY_VERSION),
    entries: z.array(LibraryEntrySchema).default([]),
  })
  .strict()
  .superRefine((lib, ctx) => {
    const seen = new Set<string>();
    lib.entries.forEach((e, i) => {
      if (seen.has(e.citekey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', i, 'citekey'],
          message: `duplicate citekey "${e.citekey}" (citekeys are the library's primary key)`,
        });
      }
      seen.add(e.citekey);
    });
  });

export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;
export type LibraryEntryInput = z.input<typeof LibraryEntrySchema>;
export type Library = z.infer<typeof Schema>;
export type ByoRecord = z.infer<typeof ByoRecordSchema>;
