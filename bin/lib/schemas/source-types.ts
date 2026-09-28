// bin/lib/schemas/source-types.ts — the shared vocabularies of a source record
// (Phase 19 seam S-B; SRC-05, SRC-09, SRC-04, SRC-16).
//
// SEAM FILE (Phase 19 plan, S-B). Every Phase 19 stream applies it
// byte-identically from .planning/phases/19-sources/seams/; no stream edits it
// during Phase 19.
//
// Used by the SourceCandidate schema (adapter output), the LIBRARY.json v3
// entry schema (bin/lib/schemas/library.ts) and the library writer.

import { z } from 'zod';

/**
 * The kind of work a source is, in CSL-JSON type spelling (the BibTeX writer
 * maps each to an entry type: article-journal → @article, book → @book,
 * chapter → @incollection, paper-conference → @inproceedings, report →
 * @techreport, thesis → @phdthesis, preprint → @misc with eprint fields, …).
 * Adapters set it when the registrar says (Crossref `type`, OpenAlex `type`,
 * arXiv → preprint, Open Library → book); null when unknown.
 */
export const SOURCE_TYPES = [
  'article-journal',
  'paper-conference',
  'chapter',
  'book',
  'report',
  'thesis',
  'preprint',
  'dataset',
  'article-newspaper',
  'article-magazine',
  'webpage',
  'other',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const SourceTypeSchema = z.enum(SOURCE_TYPES);

/**
 * The evaluator tiers of PRD §7.2 (SRC-09). Derived deterministically from
 * metadata where possible (bin/lib/source-tier.ts), with the source-evaluator
 * model as the tie-breaker.
 */
export const SOURCE_TIERS = ['peer-reviewed', 'preprint', 'book', 'gov-report', 'other'] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];
export const SourceTierSchema = z.enum(SOURCE_TIERS);

/**
 * Retraction status of a work (SRC-04):
 *   unchecked     — no retraction lookup has run for it yet;
 *   clear         — a live lookup answered and listed no retraction notice;
 *   retracted     — a retraction / withdrawal / removal notice updates it;
 *   unknown       — the lookup failed (non-200, error body, rate limit,
 *                   transport error): the status is UNKNOWN, never "clear".
 */
export const RETRACTION_STATUSES = ['unchecked', 'clear', 'retracted', 'unknown'] as const;
export type RetractionStatus = (typeof RETRACTION_STATUSES)[number];
export const RetractionStatusSchema = z.enum(RETRACTION_STATUSES);

/**
 * A Zotero item's identity (SRC-16): the library it lives in (`users/<id>`,
 * `groups/<id>`, or `local` for the Zotero 7 local API) and its 8-character
 * item key. Lets the library writer merge a re-pulled identifier-less item
 * instead of duplicating it.
 */
export const ZoteroRefSchema = z
  .object({
    library: z.string().regex(/^(?:users\/\d+|groups\/\d+|local)$/),
    key: z.string().regex(/^[A-Z0-9]{8}$/),
  })
  .strict();
export type ZoteroRef = z.infer<typeof ZoteroRefSchema>;

/**
 * One open-access location of a work (Unpaywall `oa_locations[]`, SRC-03): a
 * landing page and/or a direct PDF link, its host type and version.
 */
export const OaLocationSchema = z
  .object({
    url: z.string().url().optional(),
    url_for_pdf: z.string().url().optional(),
    host_type: z.string().optional(),
    version: z.string().optional(),
    license: z.string().optional(),
  })
  .strict();
export type OaLocation = z.infer<typeof OaLocationSchema>;
