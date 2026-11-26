// bin/lib/verify/verdict-rows.ts — which verdicts block, and the verdict rows
// of VERIFICATION.md.
//
// PURE module: no I/O, no side effects. No node:fs, node:path, or network
// imports.
//
// compile and done gate on the verdicts recorded in VERIFICATION.json
// (verification-record.ts), never on these rows. The rows are how
// VERIFICATION.md shows the verdicts; revise reads them back to find the
// citation it repairs, so the renderers and the parser stay together and the
// round-trip test (tests/verdict-rows.test.ts) catches any drift.

/**
 * Verdicts that block compile and export. UNRESOLVED means the registry was
 * not consulted (offline): an unchecked citation never passes. RAW_CITATION is
 * a DOI, arXiv ID, PMID or author-year citation typed as text, and UNPARSEABLE
 * a bracketed citation with no key that parses: neither can be checked until
 * it is written as a `[@key]` citation. RETRACTED is a citation of a retracted
 * work, until the author acknowledges it with `pensmith ack`.
 *
 * Three verdicts do not block, and every verb that reads them warns:
 * UNATTRIBUTED (a long quotation with no citation, which may be the author's
 * own data or an epigraph, so the section is unverifiable),
 * RETRACTED_ACKNOWLEDGED and EXPRESSION_OF_CONCERN.
 */
const BLOCKING_VERDICTS = new Set([
  'FABRICATED', 'MIS-CITED', 'NOT_FOUND', 'RETRACTED', 'UNRESOLVED', 'RAW_CITATION', 'UNPARSEABLE',
]);

/** Non-blocking Pass-1 verdicts compile and done warn about, and what each means. */
const WARNING_VERDICTS: Readonly<Record<string, string>> = {
  RETRACTED_ACKNOWLEDGED: 'is a retracted work, cited with your acknowledgement',
  EXPRESSION_OF_CONCERN: 'is a work under an expression of concern',
};

/** Whether `verdict` blocks compile and export. */
export function isBlockingVerdict(verdict: string): boolean {
  return BLOCKING_VERDICTS.has(verdict);
}

/** Blocking verdicts on text that is not a `[@key]` citation, so the row's key is that text. */
export const TEXT_VERDICTS: ReadonlySet<string> = new Set(['RAW_CITATION', 'UNPARSEABLE']);

/**
 * The blocking verdicts `plan N --revise` repairs by swapping or removing the
 * citation (bin/lib/revise.ts). The router sends a section that failed on one
 * of these to revise, so both read this one set.
 */
export const REPAIRABLE_VERDICTS: ReadonlySet<string> = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND', 'RETRACTED']);

/** The key a Pass-3 row carries for a quotation that cites nothing. */
export const NO_CITATION_KEY = '(no citation)';

/**
 * `s` on one line. The parser reads one row per line, so a key copied from a
 * hard-wrapped draft (`Engel and\nFleming (2007)`) must not carry its line
 * break into the row, or the row stops parsing and nothing blocks.
 */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/**
 * Render a Pass-1 verdict row (writer side — verify.ts).
 *
 * Output format (byte-identical to verify.ts:155):
 *   - ${citekey}: **${verdict}** — titleJW=${titleJW.toFixed(2)}, authorJW=${authorJW.toFixed(2)} — ${reason}
 */
export function renderPass1VerdictRow(
  citekey: string,
  verdict: string,
  titleJW: number,
  authorJW: number,
  reason: string,
): string {
  return `- ${oneLine(citekey)}: **${verdict}** — titleJW=${titleJW.toFixed(2)}, authorJW=${authorJW.toFixed(2)} — ${oneLine(reason)}`;
}

/**
 * Render a Pass-3 verdict row (writer side — verify.ts).
 *
 * Output format (byte-identical to verify.ts:159):
 *   - ${citekey} ("${quoteSnippet}…"): **${verdict}** — lev=${levRatio.toFixed(3)} — ${reason}
 *
 * Note: the … character is U+2026 HORIZONTAL ELLIPSIS, matching verify.ts exactly.
 */
export function renderPass3VerdictRow(
  citekey: string,
  quoteSnippet: string,
  verdict: string,
  levRatio: number,
  reason: string,
): string {
  return `- ${oneLine(citekey)} ("${oneLine(quoteSnippet)}…"): **${verdict}** — lev=${levRatio.toFixed(3)} — ${oneLine(reason)}`;
}

/** One verdict row of a VERIFICATION.md body. */
export interface VerdictRow {
  /** The citekey, or for RAW_CITATION / UNPARSEABLE / UNATTRIBUTED the text it is about. */
  citekey: string;
  verdict: string;
  /** Everything after the bold verdict, without its leading dash. */
  detail: string;
  /** The detail without the scores before it (`titleJW=…, authorJW=… — `, `lev=… — `). */
  reason: string;
  blocking: boolean;
  /** For a Pass-3 row, the start of the quotation it is about, as the row shows it. */
  quote?: string;
}

// `- <key>: **VERDICT** <detail>` (Pass 1) and `- <key> ("<quote>…"): **VERDICT**
// <detail>` (Pass 3). The key runs up to its delimiter, so every Pandoc key
// character (`.`, `/`, `:`, `+` ...) is kept. A row is read as Pass 3 when
// ` ("` comes before the first `: **`; a quote snippet may itself hold `: **`,
// so a Pass-3 row takes the bold verdict after the last `"): `. A Pass-1 key
// that holds ` ("` (text from the draft) does not fit the Pass-3 form, so it
// is read as Pass 1. The `^\s*-\s*` anchor leaves the pipe tables of the
// advisory sections alone.
const PASS3_ROW = /^\s*-\s*(?<key>.+?) \("(?<quote>.*)"\):\s*\*\*(?<verdict>[A-Z_-]+)\*\*\s*(?<detail>.*)$/;
const PASS1_ROW = /^\s*-\s*(?<key>.+?):\s*\*\*(?<verdict>[A-Z_-]+)\*\*\s*(?<detail>.*)$/;
// The `name=value` scores the renderers put before a row's reason, and the
// dash after them.
const ROW_SCORES = /^(?:\w+=[\d.]+(?:,\s*)?)+\s*—\s*/;

/** Every Pass-1 and Pass-3 verdict row in `verificationMd`, in order. Safe on any string. */
export function parseVerdictRowDetails(verificationMd: string): VerdictRow[] {
  const out: VerdictRow[] = [];
  for (const line of verificationMd.split(/\r?\n/)) {
    const quote = line.indexOf(' ("');
    const colon = line.indexOf(': **');
    const pass3 = quote !== -1 && (colon === -1 || quote < colon) ? PASS3_ROW.exec(line) : null;
    const g = (pass3 ?? PASS1_ROW.exec(line))?.groups;
    if (!g) continue;
    const verdict = g['verdict']!;
    const detail = g['detail']!.replace(/^—\s*/, '').trim();
    const row: VerdictRow = {
      citekey: g['key']!.trim(),
      verdict,
      detail,
      reason: detail.replace(ROW_SCORES, ''),
      blocking: BLOCKING_VERDICTS.has(verdict),
    };
    // The renderer ends the snippet with an ellipsis (U+2026).
    if (g['quote'] !== undefined) row.quote = g['quote'].replace(/…$/, '');
    out.push(row);
  }
  return out;
}

/**
 * Parse the failing citekeys from a VERIFICATION.md body (compile and done).
 * Returns the key of every row whose verdict blocks, in order.
 */
export function parseVerdictRows(verificationMd: string): string[] {
  return parseVerdictRowDetails(verificationMd).filter((r) => r.blocking).map((r) => r.citekey);
}

/** `count` quotations, in words. */
const quotations = (count: number): string => (count === 1 ? '1 quotation' : `${count} quotations`);

/**
 * The warning for `count` quotations with no citation in `where`, shared by
 * verify, compile and done so each says the same thing.
 */
export function unattributedWarning(where: string, count: number): string {
  return `${where} has ${quotations(count)} with no citation, which nothing checked — ` +
    'cite a quoted source as [@key, p. N]; check your own data or an epigraph yourself';
}

/** The warning for `count` quotations in `where` whose source text could not be read, shared by compile and done. */
export function uncheckedQuoteWarning(where: string, count: number): string {
  return `${where} has ${quotations(count)} that could not be checked against the source text`;
}

/**
 * The warning for `count` citations in `where` whose retraction status was read
 * from their registry record alone, since OpenAlex could not be asked.
 */
export function recordOnlyRetractionWarning(where: string, count: number): string {
  const [what, them] = count === 1
    ? ['1 citation was read from its registry record', 'it']
    : [`${count} citations was read from their registry records`, 'them'];
  return `${where}: the retraction status of ${what} alone, since OpenAlex could not be asked; ` +
    `re-run verify later to check ${them} against OpenAlex too`;
}

/** How a refusal names what a verdict is about: `[@key]`, or the quoted text. */
function describeVerdictRow(row: Pick<VerdictRow, 'citekey' | 'verdict'>): string {
  return TEXT_VERDICTS.has(row.verdict) ? `text "${row.citekey}"` : `citation [@${row.citekey}]`;
}

/**
 * The refusal for each blocking verdict in `rows`, worded the same by compile
 * and done. `where` names the section or the text.
 */
export function blockingReasons(
  rows: ReadonlyArray<Pick<VerdictRow, 'citekey' | 'verdict' | 'reason'>>,
  where: string,
): string[] {
  return rows
    .filter((r) => isBlockingVerdict(r.verdict))
    .map((r) => `${where}: ${describeVerdictRow(r)} is ${r.verdict} — ${r.reason}`);
}

/**
 * A warning for each citation that passes but must not look clean: a
 * retracted work cited with the author's acknowledgement, or a work under an
 * expression of concern. `where` names the section.
 */
export function citationWarnings(
  rows: ReadonlyArray<Pick<VerdictRow, 'citekey' | 'verdict' | 'reason'>>,
  where: string,
): string[] {
  return rows
    .filter((r) => Object.hasOwn(WARNING_VERDICTS, r.verdict))
    .map((r) => `${where}: ${describeVerdictRow(r)} ${WARNING_VERDICTS[r.verdict]} — ${r.reason}`);
}
