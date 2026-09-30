// bin/lib/schemas/quote-acceptances.ts — a section's QUOTE-ACCEPTANCES.json v1
// (VRFY-20, D-20-22, S-04, S-17).
//
// `sections/<NN>[a]-<slug>/QUOTE-ACCEPTANCES.json` records the quotes the user
// accepted although no source text could be checked against them
// (UNVERIFIABLE-QUOTE). Each acceptance is bound to the quote (the sha256 of
// its text, verdicts.ts quoteTextSha256) and to the section's draft
// (computeDraftHash of DRAFT.md and its assigned_sources): the gate core
// honours it only when its own recomputation finds UNVERIFIABLE-QUOTE for that
// citekey and quote in a draft whose hash still matches. Read and written only
// by bin/lib/quote-acceptance.ts; written only by verify.
//
// A new persisted file: `$schemaVersion` 1, strict. Adding a field is a
// migration plus a version bump (S-20).

import { z } from 'zod';

export const QUOTE_ACCEPTANCES_SCHEMA_VERSION = 1;

/** The file name in the section folder. */
export const QUOTE_ACCEPTANCES_FILE = 'QUOTE-ACCEPTANCES.json';

/** An excerpt is at most this many characters (a reminder of the quote, never the binding). */
export const ACCEPTANCE_EXCERPT_MAX = 80;

const SHA256 = /^[0-9a-f]{64}$/;

export const QuoteAcceptanceSchema = z
  .object({
    /** The quote's id in the draft it was accepted in (`q1`, …) — informational; the binding is the hashes. */
    quote_id: z.string().regex(/^q[1-9]\d*$/),
    /** The source the quote is attributed to. */
    citekey: z.string().min(1).max(512),
    /** quoteTextSha256 of the whole quote. */
    quote_sha256: z.string().regex(SHA256),
    /** The start of the quote, for the reader of the record and the reports. */
    excerpt: z.string().max(ACCEPTANCE_EXCERPT_MAX),
    /** computeDraftHash of the section's DRAFT.md and assigned_sources when the quote was accepted. */
    draft_sha256: z.string().regex(SHA256),
    /** When the user accepted it (ISO-8601). */
    accepted_at: z.string().datetime(),
    /** `verify N --accept-quote <id>` (flag) or the interactive `quote-accept` gate (prompt). */
    via: z.enum(['flag', 'prompt']),
  })
  .strict();

export const QuoteAcceptancesSchema = z
  .object({
    $schemaVersion: z.literal(QUOTE_ACCEPTANCES_SCHEMA_VERSION),
    acceptances: z.array(QuoteAcceptanceSchema),
  })
  .strict();

export type QuoteAcceptance = z.infer<typeof QuoteAcceptanceSchema>;
export type QuoteAcceptances = z.infer<typeof QuoteAcceptancesSchema>;
