// bin/lib/quote-acceptance.ts — per-quote acceptance of an uncheckable quote
// (VRFY-20, D-20-22, S-04, S-17).
//
// A quote whose source text could not be checked (Pass 3 UNVERIFIABLE-QUOTE:
// no open-access copy, paywalled, an image-only PDF, …) blocks compile and
// done until the user adds the source's PDF, paraphrases the quote, or accepts
// THAT quote. An acceptance lives in the section folder,
// `sections/<NN>[a]-<slug>/QUOTE-ACCEPTANCES.json` (schemas/quote-acceptances.ts),
// and is bound to the quote's text hash and the section's draft hash. This
// module is the one reader and writer of that file; verify is the one caller
// that writes it (`pensmith verify N --accept-quote <id>`, or the interactive
// `quote-accept` gate; the Tier-1 verify tool calls the same function after an
// AskUserQuestion confirmation, PLUG-10). The gate core (verify/gate.ts) is the
// one place an acceptance lifts a verdict — only a recomputed
// UNVERIFIABLE-QUOTE, only for the same citekey and quote, only while the
// section's draft hash still matches. A hand-written entry for a quote whose
// recomputed verdict is anything else lifts nothing.
//
// The path is derived from the section folder (the folder of the section's
// PLAN.md), so no paths.ts helper is needed.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { EXIT_USAGE, PensmithError } from './exit-codes.js';
import { ACCEPTABLE_QUOTE_VERDICT, PASSING_VERDICTS, QUOTE_ID_RE, UNATTRIBUTED_CITEKEY } from './verify/verdicts.js';
import {
  ACCEPTANCE_EXCERPT_MAX,
  QUOTE_ACCEPTANCES_FILE,
  QUOTE_ACCEPTANCES_SCHEMA_VERSION,
  QuoteAcceptancesSchema,
  type QuoteAcceptance,
} from './schemas/quote-acceptances.js';

export type { QuoteAcceptance } from './schemas/quote-acceptances.js';

/** `<section folder>/QUOTE-ACCEPTANCES.json`. */
export function quoteAcceptancesPath(sectionDir: string): string {
  return join(sectionDir, QUOTE_ACCEPTANCES_FILE);
}

/** The section folder of a section's PLAN.md path. */
export function sectionDirOfPlan(planPath: string): string {
  return dirname(planPath);
}

export interface LoadedQuoteAcceptances {
  readonly acceptances: QuoteAcceptance[];
  /** Why the file could not be used (it then lifts nothing), or null. */
  readonly problem: string | null;
}

/**
 * A section's acceptances. Never throws: an absent file is none; a file that
 * does not parse or does not match the schema is none plus its problem (an
 * unusable record can only lift nothing — fail closed).
 */
export function loadQuoteAcceptances(sectionDir: string): LoadedQuoteAcceptances {
  const file = quoteAcceptancesPath(sectionDir);
  if (!existsSync(file)) return { acceptances: [], problem: null };
  try {
    const parsed = QuoteAcceptancesSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { acceptances: [], problem: `${QUOTE_ACCEPTANCES_FILE} does not match its schema (${issue ? `${issue.path.join('.')}: ${issue.message}` : 'invalid'}) — it accepts nothing` };
    }
    return { acceptances: parsed.data.acceptances, problem: null };
  } catch (e) {
    return { acceptances: [], problem: `${QUOTE_ACCEPTANCES_FILE} is not readable JSON (${(e as Error).message.split('\n')[0] ?? ''}) — it accepts nothing` };
  }
}

/** A section's acceptances ([] when none or unusable). Never throws. */
export function readQuoteAcceptances(sectionDir: string): QuoteAcceptance[] {
  return loadQuoteAcceptances(sectionDir).acceptances;
}

/** One quote row the user may name with `--accept-quote <id>` (a gate-core Pass-3 row). */
export interface AcceptableQuoteRow {
  readonly id: string;
  readonly citekey: string;
  readonly quoteSha256: string;
  readonly verdict: string;
  /** The start of the quote (shown in the prompt and stored as the excerpt). */
  readonly snippet: string;
}

/** `--accept-quote` named a quote that cannot be accepted: EXIT_USAGE, nothing recorded. */
export class QuoteAcceptanceError extends PensmithError {
  constructor(message: string) {
    super(message, EXIT_USAGE);
    this.name = 'QuoteAcceptanceError';
  }
}

/**
 * Check the ids `verify N --accept-quote <id>` names against the section's
 * recomputed quote rows: every id must be a quote whose open rows — those not
 * already passing (PASS / FUZZY) — are UNVERIFIABLE-QUOTE. A quote cited to
 * several sources whose text one source holds (PASS) and another does not
 * show (UNVERIFIABLE-QUOTE) is accepted for the open source only (review
 * round 2). Throws QuoteAcceptanceError (EXIT_USAGE) naming the first id that
 * cannot be accepted — a NOT_FOUND, UNVERIFIABLE-NETWORK or UNATTRIBUTED row,
 * a quote that already passes for every source, or no such quote. Returns the
 * rows to accept (the UNVERIFIABLE-QUOTE rows of each id).
 */
export function acceptableRows(rows: readonly AcceptableQuoteRow[], ids: readonly string[], section: string): AcceptableQuoteRow[] {
  const out: AcceptableQuoteRow[] = [];
  for (const id of ids) {
    if (!QUOTE_ID_RE.test(id)) {
      throw new QuoteAcceptanceError(`--accept-quote ${id}: a quote id is q1, q2, … as VERIFICATION.md lists them — nothing was recorded`);
    }
    const matching = rows.filter((r) => r.id === id);
    if (matching.length === 0) {
      throw new QuoteAcceptanceError(`--accept-quote ${id}: section ${section}'s draft has no quote ${id} — nothing was recorded`);
    }
    // A source that already holds the quote needs no acceptance.
    const open = matching.filter((r) => !PASSING_VERDICTS.has(r.verdict));
    const other = open.find((r) => r.verdict !== ACCEPTABLE_QUOTE_VERDICT);
    if (other !== undefined) {
      throw new QuoteAcceptanceError(
        `--accept-quote ${id}: its verdict is ${other.verdict} (${other.citekey === UNATTRIBUTED_CITEKEY ? 'no citation' : `[@${other.citekey}]`}) — ` +
          `only an ${ACCEPTABLE_QUOTE_VERDICT} quote (no source text to check it against) can be accepted; nothing was recorded`,
      );
    }
    if (open.length === 0) {
      throw new QuoteAcceptanceError(
        `--accept-quote ${id}: it already passes for every source it cites (${matching.map((r) => `[@${r.citekey}] ${r.verdict}`).join(', ')}) — nothing to accept; nothing was recorded`,
      );
    }
    out.push(...open);
  }
  return out;
}

/**
 * Record acceptances for `rows` (UNVERIFIABLE-QUOTE rows of the section's
 * draft whose hash is `draftSha256`) in the section's QUOTE-ACCEPTANCES.json,
 * under the file's lock. An acceptance for the same citekey and quote is
 * replaced; acceptances bound to another draft hash — void since the draft
 * changed — are dropped. Returns what was recorded. Only verify calls it.
 */
export async function recordQuoteAcceptances(
  sectionDir: string,
  rows: readonly AcceptableQuoteRow[],
  draftSha256: string,
  via: QuoteAcceptance['via'],
  at: Date = new Date(),
): Promise<QuoteAcceptance[]> {
  const file = quoteAcceptancesPath(sectionDir);
  const accepted_at = at.toISOString();
  const fresh: QuoteAcceptance[] = rows
    .filter((r) => r.verdict === ACCEPTABLE_QUOTE_VERDICT)
    .map((r) => ({
      quote_id: r.id,
      citekey: r.citekey,
      quote_sha256: r.quoteSha256,
      excerpt: excerptOf(r.snippet),
      draft_sha256: draftSha256,
      accepted_at,
      via,
    }));
  if (fresh.length === 0) return [];
  return withLock(file, async () => {
    const current = loadQuoteAcceptances(sectionDir).acceptances.filter((a) => a.draft_sha256 === draftSha256);
    const same = (a: QuoteAcceptance, b: QuoteAcceptance): boolean => a.citekey === b.citekey && a.quote_sha256 === b.quote_sha256;
    const kept = current.filter((a) => !fresh.some((f) => same(a, f)));
    const record = QuoteAcceptancesSchema.parse({ $schemaVersion: QUOTE_ACCEPTANCES_SCHEMA_VERSION, acceptances: [...kept, ...fresh] });
    await atomicWriteFile(file, JSON.stringify(record, null, 2) + '\n');
    return fresh;
  });
}

/** The excerpt stored for a quote: its start, whitespace collapsed, at most ACCEPTANCE_EXCERPT_MAX characters. */
export function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= ACCEPTANCE_EXCERPT_MAX ? flat : `${flat.slice(0, ACCEPTANCE_EXCERPT_MAX - 1)}…`;
}
