// bin/lib/schemas/library.ts — .paper/LIBRARY.json, the paper's canonical
// bibliographic store.
//
// Each entry is a CSL-JSON item: `id` is its citekey (assigned once, never
// given to another work), the bibliographic variables are CSL's own (`author`
// as name objects, `issued`, `container-title`, `DOI`, `ISBN`, `PMID`, ...),
// and `custom` holds what CSL has no variable for. CITATIONS.bib and
// CITATIONS.ris are views written from this file (bin/lib/library.ts).
//
// v1 held research candidates as the adapters returned them (display-string
// authors, no arXiv ID or PMID); bin/lib/migrations/library/v1_to_v2.ts
// converts it.

import { z } from 'zod';
import { CslNameSchema } from './source-candidate.js';

export const CURRENT_LIBRARY_VERSION = 2;

/** Where an item's metadata, or a record merged into it, came from. */
export const ProvenanceSchema = z.object({
  /** An adapter ('crossref', 'arxiv', ...), 'CITATIONS.bib', 'pdf' or 'bibtex'. */
  source: z.string().min(1),
  /** The registry's own identifier for the work. */
  id: z.string().min(1).optional(),
  /** A file the user added it from, as they named it. */
  file: z.string().min(1).optional(),
  /** The section a `revise --research` query was run for. */
  section: z.number().int().positive().optional(),
  at: z.string().datetime(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const LibraryCustomSchema = z.object({
  /** The arXiv ID without a version; CSL has no variable for it. */
  arxiv: z.string().min(1).optional(),
  /**
   * Every identifier the work is known by ("doi:10.x/y", "arxiv:1706.03762",
   * "pmid:9500320", "pmcid:PMC123", "isbn:9780262033848"): its own and those
   * of the records merged into it. research and add find a work by these, so
   * its citekey is reused.
   */
  identities: z.array(z.string().min(1)).default([]),
  retracted: z.boolean().default(false),
  retraction_details: z.string().optional(),
  oa_pdf_url: z.string().url().optional(),
  /** The text of a PDF the user added, as a path under .paper/. */
  local_text: z.string().min(1).optional(),
  /**
   * The entry as CITATIONS.bib held it when it was read in (written by hand,
   * imported, or by an older pensmith). It is written back exactly so, never
   * re-rendered: verify checked these bytes.
   */
  bibtex: z.string().min(1).optional(),
  provenance: z.array(ProvenanceSchema).default([]),
  added_at: z.string().datetime(),
});
export type LibraryCustom = z.infer<typeof LibraryCustomSchema>;

const optionalText = z.string().min(1).optional();

export const LibraryItemSchema = z
  .object({
    /** The citekey. */
    id: z.string().min(1),
    type: z.string().min(1),
    /** Empty only for an entry read in from a bibliography that has no title. */
    title: z.string(),
    author: z.array(CslNameSchema).optional(),
    editor: z.array(CslNameSchema).optional(),
    issued: z.object({}).passthrough().optional(),
    'container-title': optionalText,
    volume: optionalText,
    issue: optionalText,
    page: optionalText,
    publisher: optionalText,
    DOI: optionalText,
    ISBN: optionalText,
    PMID: optionalText,
    PMCID: optionalText,
    URL: optionalText,
    abstract: optionalText,
    custom: LibraryCustomSchema,
  })
  // An entry read in from a bibliography keeps every CSL variable it had.
  .passthrough();
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

export const Schema = z.object({
  $schemaVersion: z.literal(CURRENT_LIBRARY_VERSION),
  entries: z.array(LibraryItemSchema).default([]),
  /** The @string and @preamble blocks of a bibliography read in, written back first. */
  bibtex_preamble: z.array(z.string()).default([]),
  /**
   * When research last ran, a run that found nothing included. `pensmith add`
   * writes this file too, so the router reads research as done from this, not
   * from the file being there.
   */
  researched_at: z.string().optional(),
});

export type Library = z.infer<typeof Schema>;
