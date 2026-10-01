// bin/lib/verify/verdict-rows.ts — shared verdict-row render+parse pair (Phase 14, GATE-02).
//
// PURE module: no I/O, no side effects. Every function is referentially
// transparent (same input → same output). No node:fs, node:path, or
// network imports.
//
// Purpose: single source of truth for the writer (verify.ts Pass-1/Pass-3 rows)
// and the parser (compile.ts failing-citekey extraction). Keeping the render
// templates and the parse regex co-located in one module means any format
// change will break the round-trip test (tests/verdict-rows.test.ts) rather
// than silently nulling the blocking set.

import { BLOCKING_VERDICTS, RETRY_ONLINE_VERDICTS, ACCEPTABLE_QUOTE_VERDICT } from './verdicts.js';
import { DRAFT_ROW_KEY, DRAFT_VERDICTS, FAILING_VERDICTS, UNATTRIBUTED_CITEKEY, textRowLine } from './verdicts.js';

// ---------------------------------------------------------------------------
// What `plan N --revise` can repair (revise.ts), read from a VERIFICATION.md.
// Here, not in revise.ts, so the router's attention wording and the compile /
// done refusals (verification-md.ts) name `--revise` only when it can change
// something (main-branch merge review, round 1).
// ---------------------------------------------------------------------------

/**
 * The verifier verdicts that --revise repairs by swapping or removing the
 * flagged citation: every failing verdict whose row names a citekey (Phase 20:
 * RETRACTED, UNASSIGNED, UNPARSEABLE and UNRESOLVABLE join FABRICATED,
 * MIS-CITED and NOT_FOUND). The rows without a citekey (a citation form the
 * grammar cannot read, an unattributed quote, NO-CITATIONS) need an edit or a
 * re-draft — a re-plan is REV-03 (Phase 22).
 */
export const REVISABLE_VERDICTS = ['FABRICATED', 'MIS-CITED', 'RETRACTED', 'UNASSIGNED', 'UNPARSEABLE', 'UNRESOLVABLE', 'NOT_FOUND'] as const;

/**
 * One verdict row of VERIFICATION.md (D-20-20): a Pass-3 quote row
 * `- <key> [q<N>] ("<snippet>…"): **<VERDICT>** — rest` or a keyed row
 * `- <key>: **<VERDICT>** — rest` (any citekey the grammar accepts). Null for
 * any other line.
 */
function verdictRowOf(line: string): { citekey: string; verdict: string; rest: string } | null {
  const m =
    /^\s*-\s*(\S+?)(?:\s+\[q[1-9]\d*\])?\s+\(".*"\):\s*\*\*([A-Z_-]+)\*\*\s*(.*)$/u.exec(line) ??
    /^\s*-\s*(\S+):\s*\*\*([A-Z_-]+)\*\*\s*(.*)$/u.exec(line);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { citekey: m[1], verdict: m[2], rest: m[3] ?? '' };
}

/**
 * The key slot of a row that names no citation (review round 2): a text
 * finding (`(L<line>)` — an UNPARSEABLE or UNSUPPORTED-FORM text), an
 * identifier written in the prose (`doi:10.…`, `arXiv:…`, `PMID:…`), a draft
 * check (`draft`) or an unattributed quote. revise cannot swap one: the text
 * needs a hand edit or a re-draft.
 */
export function isTextRowKey(key: string): boolean {
  if (key === DRAFT_ROW_KEY || key === UNATTRIBUTED_CITEKEY) return true;
  if (/^(?:doi:10\.|arXiv:|PMID:\d)/.test(key)) return true;
  // A text finding's key slot `(L<line>)` — never a citekey (review round 3: a
  // citekey `L12` is a citation revise can repair).
  return textRowLine(key) !== null;
}

/** A failing row of VERIFICATION.md: its key and `<VERDICT>: <reason>`. */
export interface FailingRow {
  citekey: string;
  reason: string;
}

/**
 * The failing rows of VERIFICATION.md (each key once, in order): the citations
 * revise can repair (a citekey with a REVISABLE_VERDICTS verdict) and the text
 * rows it cannot (every row whose key names no citation and whose verdict
 * fails the section — an UNSUPPORTED-FORM or UNPARSEABLE text, an UNATTRIBUTED
 * quote, NO-CITATIONS, a bare identifier; main-branch merge review, round 1:
 * before, a verdict outside REVISABLE_VERDICTS was dropped, so revise
 * reported "nothing wrong" for a section failed by author-date prose).
 */
export function revisableRows(verificationMd: string): { citations: FailingRow[]; textRows: FailingRow[] } {
  const citations: FailingRow[] = [];
  const textRows: FailingRow[] = [];
  const seen = new Set<string>();
  for (const line of verificationMd.split(/\r?\n/)) {
    const row = verdictRowOf(line);
    if (row === null || seen.has(row.citekey)) continue;
    const text = isTextRowKey(row.citekey);
    if (text ? !FAILING_VERDICTS.has(row.verdict) : !(REVISABLE_VERDICTS as readonly string[]).includes(row.verdict)) continue;
    seen.add(row.citekey);
    const f = { citekey: row.citekey, reason: `${row.verdict}: ${row.rest.replace(/^—\s*/, '').trim()}` };
    (text ? textRows : citations).push(f);
  }
  return { citations, textRows };
}

/** True when VERIFICATION.md flags a citation `plan N --revise` can swap or remove. */
export function reviseCanRepair(verificationMd: string): boolean {
  return revisableRows(verificationMd).citations.length > 0;
}

/**
 * Verdicts that block compile and done: the ONE vocabulary of verdicts.ts
 * (Phase 20 seam S-C). UNVERIFIABLE / UNVERIFIABLE-NETWORK (D-17-07, VRFY-12)
 * rows block with a "re-run online" message.
 */
export { BLOCKING_VERDICTS };

/** One blocking verdict row parsed from a VERIFICATION.md body. */
export interface BlockingVerdictRow {
  citekey: string;
  verdict: string;
  /** The row says the cited work is retracted (a MIS-CITED retraction verdict; RETRACTED from VRFY-15). */
  retraction?: boolean;
  /** A Pass-3 row's quote id (`q1`), when the row carries one (Phase 20 format). */
  quoteId?: string;
  /**
   * The row's reason (the text after its score), when it has one — what an
   * UNVERIFIABLE row's refusal names (the agency that cannot be asked and the
   * remedy) and a RETRACTED row's notice.
   */
  reason?: string;
}

/** The reason of a verdict row: what follows `**VERDICT**` and its `titleJW=…, authorJW=…` / `lev=…` score. */
function rowReason(afterVerdict: string): string | undefined {
  const m = /^\s*—\s*(?:titleJW=\S+,\s*authorJW=\S+\s*—\s*|lev=\S+\s*—\s*)?(.*)$/u.exec(afterVerdict);
  const reason = m?.[1]?.replace(/ — accepted by you \S+ \((?:--accept-quote|at the prompt)\)\s*$/, '').trim();
  return reason !== undefined && reason.length > 0 ? reason : undefined;
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
  // A score that was not computed (no record to compare, NaN) reads `n/a`, never a false 0.00.
  const score = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : 'n/a');
  return `- ${citekey}: **${verdict}** — titleJW=${score(titleJW)}, authorJW=${score(authorJW)} — ${reason}`;
}

/**
 * Parse all failing citekeys from a VERIFICATION.md body — the parse side of
 * the round trip renderPass1VerdictRow writes (VRFY-09's property test:
 * every key the extractor accepts survives it). compile and done do not gate
 * on these rows (they recompute the gate, D-20-04): the router words a
 * section's attention from parseBlockingVerdictRows, and done words the
 * refusal of a paper with no compiled draft from them.
 *
 * Matches list-item verdict rows in two forms:
 *   Pass-1: - citekey: **VERDICT** — titleJW=…, authorJW=… — reason
 *   Pass-3: - citekey ("quote…"): **VERDICT** — lev=… — reason
 * The citekey is any non-space run (every CITEKEY_GRAMMAR key: dotted, colon,
 * Unicode); a blocking row whose key cannot be read is still returned (as
 * UNREADABLE_CITEKEY) — fail closed, never "absent".
 *
 * The `^\s*-\s*` anchor excludes pipe-delimited table rows (| citekey | ...) so
 * the Source Freshness table (RSCH-10) does NOT pollute the blocking set (Pitfall 2).
 *
 * Returns only citekeys whose verdict is in BLOCKING_VERDICTS (verdicts.ts:
 * FABRICATED, MIS-CITED, NOT_FOUND, UNVERIFIABLE, …). A label it does not know
 * is skipped here — a report reader; the record's `Status:` line still blocks
 * (sectionVerificationReasons), and compile and done recompute every row.
 * Safe to call on any string, including ''.
 */
export function parseVerdictRows(verificationMd: string): string[] {
  return parseBlockingVerdictRows(verificationMd).map((r) => r.citekey);
}

/**
 * Like parseVerdictRows, but keeps each row's verdict so a caller can word the
 * refusal: UNVERIFIABLE rows say "re-run online" (D-17-07), the others name the
 * failing verdict. Same parser, same blocking set — never a second grammar.
 */
export function parseBlockingVerdictRows(verificationMd: string): BlockingVerdictRow[] {
  const out: BlockingVerdictRow[] = [];
  for (const line of verificationMd.split(/\r?\n/)) {
    // Every `- … **VERDICT**` list item is a verdict row; the `^\s*-\s*` anchor
    // keeps the pipe-delimited freshness / Pass-2 tables out (Pitfall 2).
    // The citekey is ANY non-space run before the row's delimiter, so every key
    // the library accepts (the Pandoc CITEKEY_GRAMMAR: `.:#$%&+?<>~/` and
    // Unicode letters — `ghost.2099`, `müller2020`, `doe:2020`) is named:
    //   Pass-3: `- <key> [q<N>] ("quote…"): **VERDICT**` (the id since Phase 20)
    //   Pass-1: `- <key>: **VERDICT**`
    // The verdict is read right after the row's delimiter, so a `**…**` inside
    // a quoted snippet is never taken for it.
    const pass3 = /^\s*-\s*(\S+?)(?:\s+\[(q[1-9]\d*)\])?\s+\(".*"\):\s*\*\*([A-Z_-]+)\*\*/u.exec(line);
    const pass1 = pass3 ? null : /^\s*-\s*(\S+):\s*\*\*([A-Z_-]+)\*\*/u.exec(line);
    const any = pass3 || pass1 ? null : /^\s*-.*?\*\*([A-Z_-]+)\*\*/.exec(line);
    const verdict = pass3?.[3] ?? pass1?.[2] ?? any?.[1];
    const matched = pass3 ?? pass1 ?? any;
    if (verdict === undefined || !BLOCKING_VERDICTS.has(verdict)) continue;
    // An UNVERIFIABLE-QUOTE row the section's verification says the user
    // accepted (verification-md.ts) passes like its section status did. This is
    // a REPORT reader (the router's wording): compile and done recompute the
    // row and honour only a QUOTE-ACCEPTANCES.json record (D-20-04).
    if (verdict === ACCEPTABLE_QUOTE_VERDICT && / — accepted by you \S+ \((?:--accept-quote|at the prompt)\)\s*$/.test(line)) continue;
    const citekey = pass3?.[1] ?? pass1?.[1];
    // FAIL CLOSED (audit #2/#20, VRFY-09): a blocking verdict on a row whose key
    // cannot be read still blocks — it is never treated as absent.
    const retraction = /\bcited work is retracted\b/.test(line);
    const quoteId = pass3?.[2];
    const reason = matched !== null ? rowReason(line.slice(matched.index + matched[0].length)) : undefined;
    out.push({
      citekey: citekey ?? UNREADABLE_CITEKEY,
      verdict,
      ...(retraction ? { retraction: true } : {}),
      ...(quoteId !== undefined ? { quoteId } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
  }
  return out;
}

/** The citekey reported for a blocking verdict row whose key could not be read (it still blocks). */
export const UNREADABLE_CITEKEY = '(unreadable verdict row)';

/**
 * The reasons a section's recorded VERIFICATION.md shows it may not compile —
 * the router's wording of a section's attention (router.ts
 * verificationBlockers). compile and done do NOT use it: they recompute the
 * gate from the draft (verify/gate.ts) and read the record only for what can
 * make them stricter (verification-md.ts verificationRecordReasons, which
 * also compares the record's draft hash). Given a section's VERIFICATION.md
 * text, the reasons (empty = none):
 *   - no `Status:` line — never verified, or the verifier output is unreadable;
 *   - a --dry-run verification outside --dry-run (RUN-27, synthetic sources);
 *   - `Status: failed` — blocks even when no verdict row parses (fail closed);
 *   - every blocking verdict row (FABRICATED / MIS-CITED / NOT_FOUND /
 *     UNVERIFIABLE), any citekey shape.
 * `Status: unverifiable` with no blocking row passes (Pitfall 3).
 */
export function sectionVerificationReasons(verificationMd: string, dryRunNow: boolean): string[] {
  const status = /^Status:\s*(\S+)/m.exec(verificationMd)?.[1];
  if (status === undefined) {
    return ['no verifiable VERIFICATION.md (no Status line: the section was never verified, or the verifier output is unreadable)'];
  }
  const dryRun = dryRunVerificationReason(verificationMd, dryRunNow);
  if (dryRun !== null) return [dryRun];
  const reasons: string[] = [];
  if (status.toLowerCase() === 'failed') reasons.push("VERIFICATION.md Status is 'failed'");
  for (const row of parseBlockingVerdictRows(verificationMd)) reasons.push(verdictRowReason(row));
  return reasons;
}

/**
 * The refusal wording for any blocking row a VERIFICATION.md lists: a draft
 * check (`- draft: **PLACEHOLDER**`, `**NO-CITATIONS**`) and a text finding
 * (key slot `(L<line>)`) are worded as what they are; every citation row goes
 * through blockingRowReason.
 */
export function verdictRowReason(row: BlockingVerdictRow): string {
  if (row.citekey === 'draft' && DRAFT_VERDICTS.includes(row.verdict as (typeof DRAFT_VERDICTS)[number])) {
    return row.verdict === 'PLACEHOLDER'
      ? 'the draft is stub text written with no model configured (PLACEHOLDER) — re-draft it with a model configured (`pensmith write <N>`)'
      : 'the draft cites none of its assigned sources (NO-CITATIONS) — re-draft it (`pensmith write <N>`)';
  }
  const line = textRowLine(row.citekey);
  if (line !== null && (row.verdict === 'UNPARSEABLE' || row.verdict === 'UNSUPPORTED-FORM')) {
    return `line ${line} of the draft holds a citation the verifier cannot check (${row.verdict})`;
  }
  if (row.quoteId !== undefined && row.verdict === ACCEPTABLE_QUOTE_VERDICT) {
    return blockingRowReason(row).replace('--accept-quote <id>', `--accept-quote ${row.quoteId}`);
  }
  return blockingRowReason(row);
}

/** The refusal wording for one blocking row (compile refuse-gate, done re-check). */
export function blockingRowReason(row: BlockingVerdictRow): string {
  const cite = row.citekey === UNREADABLE_CITEKEY ? `a citation in ${UNREADABLE_CITEKEY}` : `citation [@${row.citekey}]`;
  if (RETRY_ONLINE_VERDICTS.has(row.verdict)) {
    return `${cite} is ${row.verdict} (its source could not be checked: offline, --dry-run or a failed lookup) — re-run online`;
  }
  // D-20-03 / D-20-10: UNVERIFIABLE is an ANSWER that cannot be compared (an
  // agency with no record of the DOI, a record with no title) — its reason names
  // the agency and the remedy; re-running online would change nothing.
  if (row.verdict === 'UNVERIFIABLE') {
    return `${cite} is UNVERIFIABLE — ${row.reason ?? "its registrar's answer cannot be compared with the entry"}`;
  }
  // VRFY-15: the retraction notice.
  if (row.verdict === 'RETRACTED') {
    return `${cite} is RETRACTED — ${row.reason ?? 'the cited work is retracted'}`;
  }
  if (row.verdict === ACCEPTABLE_QUOTE_VERDICT) {
    return (
      `${cite} has a quote no source text could be checked against (${row.verdict}) — add the source's PDF (pensmith add <pdf>), ` +
      "paraphrase the quote (re-draft with pensmith write <N>, or edit the section's DRAFT.md and run pensmith verify <N>), " +
      'or accept that one quote (pensmith verify <N> --accept-quote <id>)'
    );
  }
  return `${cite} has a blocking verdict (${row.verdict}${row.retraction === true ? ': the cited work is retracted' : ''})`;
}

/**
 * The first line of every VERIFICATION.md written under --dry-run (http-mock.ts
 * offlineMarkerLine; tests/empty-bib.test.ts pins that the two agree).
 */
export const DRY_RUN_VERIFICATION_MARKER = '> OFFLINE MODE (--dry-run)';

/**
 * RUN-27 / D-17-11: a VERIFICATION.md written under --dry-run verified the
 * labelled SYNTHETIC sources (reserved `10.0000/pensmith-dryrun.*` ids pass
 * Pass 1 only under --dry-run). Outside --dry-run it proves nothing about the
 * paper, so compile and done refuse it until the section is re-verified for
 * real. Under --dry-run (a preview) it is accepted. Null when not refused.
 */
export function dryRunVerificationReason(verificationMd: string, dryRunNow: boolean): string | null {
  if (dryRunNow) return null;
  const first = verificationMd.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return first.startsWith(DRY_RUN_VERIFICATION_MARKER)
    ? 'verified under --dry-run against synthetic sources — re-run `pensmith verify` without --dry-run'
    : null;
}
