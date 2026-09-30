// bin/lib/verify/verdicts.ts — the verifier's verdict vocabulary and the
// section-status rule (Phase 20 seam S-C; D-20-01, D-20-02, D-20-03).
//
// SEAM FILE (.planning/phases/20-verify/seams/20-seam-S-C.patch). Every Phase
// 20 stream applies the seam as its first commit and never edits this file;
// once Phase 20 is merged it is ordinary code.
//
// ONE vocabulary for every writer and reader of a verdict: verify writes rows
// with these labels, compile's and done's recomputation decides with these
// sets, the verdict-row parser (verdict-rows.ts) reads them, and the router
// words its attention from them. A label that is not listed as passing here
// never passes (fail closed).
//
// PURE: no I/O.

import { createHash } from 'node:crypto';

/**
 * Pass-1 row verdicts: one row per cited key, per bare identifier in the prose
 * (VRFY-10) and per citation-shaped text the verifier cannot check.
 *   OK                    the registrar's record matches the entry's title, first author and year
 *   OK-BYO                no registrar identifier (or its lookup failed) and the user's own PDF
 *                         still matches its recorded hashes (VRFY-14); the row names file and hash
 *   FABRICATED            the key is not in the bibliography, or every applicable registrar
 *                         definitively does not know the identifier
 *   MIS-CITED             the record exists but its title, first author or year does not match
 *   RETRACTED             the cited work is retracted (VRFY-15, S-02)
 *   UNASSIGNED            the key is not in the section's PLAN.md assigned_sources (VRFY-17)
 *   UNPARSEABLE           a citation-shaped token that does not parse (VRFY-09), or a cited key
 *                         whose bibliography entry does not parse (VRFY-16)
 *   UNSUPPORTED-FORM      an attribution the verifier cannot check against the bibliography:
 *                         author-date prose, footnotes, a reference list, raw TeX or HTML
 *                         citations (VRFY-10)
 *   UNRESOLVABLE          an entry with no identifier that no metadata search matches (VRFY-12)
 *   UNVERIFIABLE-NETWORK  no answer: an offline fixture miss, a transport error or timeout,
 *                         429 / 5xx after retries, an exhausted host or an open breaker —
 *                         retry online (VRFY-12, D-V1-03)
 *   UNVERIFIABLE          a definitive answer the verifier cannot compare (an agency with no
 *                         queryable record, an unusable record)
 */
export const PASS1_VERDICTS = [
  'OK',
  'OK-BYO',
  'FABRICATED',
  'MIS-CITED',
  'RETRACTED',
  'UNASSIGNED',
  'UNPARSEABLE',
  'UNSUPPORTED-FORM',
  'UNRESOLVABLE',
  'UNVERIFIABLE-NETWORK',
  'UNVERIFIABLE',
] as const;
export type Pass1RowVerdict = (typeof PASS1_VERDICTS)[number];

/**
 * Pass-3 row verdicts: one row per (direct quote, cited source).
 *   PASS                  the quote is in the source's text (after normalization)
 *   FUZZY                 the quote matches at or above QUOTE_LEV_THRESHOLD but not
 *                         verbatim — passes, and the row says so
 *   NOT_FOUND             the source's real text does not contain the quote
 *   UNVERIFIABLE-QUOTE    an answer that gives no text: no open-access copy, paywalled
 *                         (abstract only), no contact email for Unpaywall, a link that did not
 *                         serve a usable PDF, an image-only PDF. Blocks until the user supplies
 *                         the PDF, paraphrases, or accepts THIS quote (VRFY-20, S-04)
 *   UNVERIFIABLE-NETWORK  no answer (see Pass 1) — retry online; never acceptable
 *   UNATTRIBUTED          a direct quote with no citation it can be attributed to (VRFY-18)
 */
export const PASS3_VERDICTS = ['PASS', 'FUZZY', 'NOT_FOUND', 'UNVERIFIABLE-QUOTE', 'UNVERIFIABLE-NETWORK', 'UNATTRIBUTED'] as const;
export type Pass3RowVerdict = (typeof PASS3_VERDICTS)[number];

/**
 * Whole-draft verdicts (VRFY-24):
 *   PLACEHOLDER    the draft is stub or placeholder text (a no-LLM / --dry-run stub
 *                  draft outside --dry-run): the section is `unverifiable`, never
 *                  verified, and compile and done refuse it (S-13: other sections go on)
 *   NO-CITATIONS   the draft cites nothing although the section has assigned sources:
 *                  the section fails
 */
export const DRAFT_VERDICTS = ['PLACEHOLDER', 'NO-CITATIONS'] as const;
export type DraftVerdict = (typeof DRAFT_VERDICTS)[number];

/** Verdicts that pass. `OK` is also the Pass-3 label written before Phase 20. */
export const PASSING_VERDICTS: ReadonlySet<string> = new Set(['OK', 'OK-BYO', 'PASS', 'FUZZY']);

/** Verdicts that fail a section: Status `failed`, and compile and done refuse. */
export const FAILING_VERDICTS: ReadonlySet<string> = new Set([
  'FABRICATED',
  'MIS-CITED',
  'RETRACTED',
  'UNASSIGNED',
  'UNPARSEABLE',
  'UNSUPPORTED-FORM',
  'UNRESOLVABLE',
  'NOT_FOUND',
  'UNATTRIBUTED',
  'NO-CITATIONS',
]);

/** Verdicts that leave a section `unverifiable` and block compile and done until resolved. */
export const UNVERIFIABLE_VERDICTS: ReadonlySet<string> = new Set(['UNVERIFIABLE-NETWORK', 'UNVERIFIABLE', 'UNVERIFIABLE-QUOTE', 'PLACEHOLDER']);

/** Every blocking verdict (failing or unverifiable). */
export const BLOCKING_VERDICTS: ReadonlySet<string> = new Set([...FAILING_VERDICTS, ...UNVERIFIABLE_VERDICTS]);

/** The only verdict a per-quote acceptance can cover (VRFY-20, S-04, S-17). */
export const ACCEPTABLE_QUOTE_VERDICT = 'UNVERIFIABLE-QUOTE';

/** Verdicts whose remedy is "retry when online" (the lookup was not answered). */
export const RETRY_ONLINE_VERDICTS: ReadonlySet<string> = new Set(['UNVERIFIABLE-NETWORK']);

/**
 * Pass-3 labels written before Phase 20 for a quote whose text was not
 * available: they left the section `unverifiable` without blocking it. Only
 * VERIFICATION.md files written by an older pensmith carry them; the Phase 20
 * Pass 3 writes UNVERIFIABLE-QUOTE / UNVERIFIABLE-NETWORK instead.
 */
export const LEGACY_UNAVAILABLE_VERDICTS: ReadonlySet<string> = new Set(['PDF_UNAVAILABLE', 'TEXT_UNAVAILABLE']);

/** The citekey slot of an UNATTRIBUTED Pass-3 row (a quote with no citation). */
export const UNATTRIBUTED_CITEKEY = '(unattributed)';

/** A verdict row as the status rule reads it. */
export interface VerdictRowLike {
  readonly verdict: string;
  /** An UNVERIFIABLE-QUOTE row the user accepted for this exact quote in this exact draft (VRFY-20). */
  readonly accepted?: boolean;
}

export type SectionStatus = 'verified' | 'failed' | 'unverifiable';

export interface SectionOutcome {
  readonly status: SectionStatus;
  /** True when compile and done must refuse this text (verify exits EXIT_BLOCKED). */
  readonly blocked: boolean;
}

/**
 * True when `verdict` stops compile and done: every label that is not passing,
 * not a legacy advisory label and not an accepted UNVERIFIABLE-QUOTE — an
 * unknown label included (fail closed).
 */
export function blocksCompile(verdict: string, accepted = false): boolean {
  if (PASSING_VERDICTS.has(verdict) || LEGACY_UNAVAILABLE_VERDICTS.has(verdict)) return false;
  return !(accepted && verdict === ACCEPTABLE_QUOTE_VERDICT);
}

/**
 * The section status from every row of its verification (Pass 1, Pass 3 and
 * the draft checks): `failed` when any row fails (an unknown label counts as
 * failing), else `unverifiable` when any row is unverifiable (a legacy
 * advisory row does not block), else `verified`. An accepted
 * UNVERIFIABLE-QUOTE row counts as passing.
 */
export function sectionOutcome(rows: Iterable<VerdictRowLike>): SectionOutcome {
  let failed = false;
  let unverifiable = false;
  let blocked = false;
  for (const r of rows) {
    if (PASSING_VERDICTS.has(r.verdict)) continue;
    if (r.accepted === true && r.verdict === ACCEPTABLE_QUOTE_VERDICT) continue;
    if (LEGACY_UNAVAILABLE_VERDICTS.has(r.verdict)) {
      unverifiable = true;
      continue;
    }
    if (UNVERIFIABLE_VERDICTS.has(r.verdict)) {
      unverifiable = true;
      blocked = true;
      continue;
    }
    failed = true;
    blocked = true;
  }
  return { status: failed ? 'failed' : unverifiable ? 'unverifiable' : 'verified', blocked };
}

/**
 * The hash that binds a quote acceptance to a quote (VRFY-20): sha256 of the
 * quote's text, NFKC-normalized with whitespace collapsed, so the same quote
 * re-extracted from the same draft always hashes the same.
 */
export function quoteTextSha256(text: string): string {
  return createHash('sha256').update(text.normalize('NFKC').replace(/\s+/gu, ' ').trim(), 'utf8').digest('hex');
}

/**
 * The key slot of a text finding's row (an UNPARSEABLE or UNSUPPORTED-FORM
 * text on line `line`): `(L<line>)`. No citekey can hold a parenthesis, so a
 * row of a real citekey `L12` is never read as a text row (review round 3).
 */
export function textRowKey(line: number): string {
  return `(L${line})`;
}

/** The line a text row's key names (`(L12)` → 12), or null for any other key. */
export function textRowLine(key: string): number | null {
  const m = /^\(L([1-9]\d*)\)$/.exec(key);
  return m === null ? null : Number(m[1]);
}

/** The id of the `index`-th quote (0-based) of a draft, in document order: `q1`, `q2`, … */
export function quoteId(index: number): string {
  return `q${index + 1}`;
}

/** A quote id as `verify N --accept-quote <id>` takes it. */
export const QUOTE_ID_RE = /^q[1-9]\d*$/;

/** What a text scan found that the verifier cannot check (VRFY-09, VRFY-10). */
export interface TextFinding {
  readonly verdict: 'UNPARSEABLE' | 'UNSUPPORTED-FORM';
  /**
   * The form found: `empty-key`, `unbalanced-bracket`, `unterminated-braced-key`,
   * `nested-bracket` (UNPARSEABLE); `author-date`, `footnote`, `inline-note`,
   * `reference-list`, `tex-cite`, `html-cite` (UNSUPPORTED-FORM).
   */
  readonly form: string;
  /** The text as written (the renderer clamps it). */
  readonly text: string;
  /** 1-based line of the scanned text. */
  readonly line: number;
  /** One line: why it blocks and what to write instead. */
  readonly reason: string;
}

/** The Pass-2 table header verify writes from Phase 20 on (VRFY-22: the Evidence column). */
export const PASS2_TABLE_HEADER = '| Citekey | Claim Sentence | Verdict | Rationale | Evidence |';

/** The Pass-2 table header written before Phase 20 (no Evidence column); readers accept both. */
export const PASS2_TABLE_HEADER_V1 = '| Citekey | Claim Sentence | Verdict | Rationale |';
