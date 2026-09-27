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

/**
 * Verdicts that block compile and done. UNVERIFIABLE (D-17-07) is a Pass-1 row
 * recorded when the re-fetch was unavailable because of the network mode
 * (offline fixture miss or --dry-run); it blocks with a "re-run online" message.
 */
export const BLOCKING_VERDICTS: ReadonlySet<string> = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND', 'UNVERIFIABLE']);

/** One blocking verdict row parsed from a VERIFICATION.md body. */
export interface BlockingVerdictRow {
  citekey: string;
  verdict: string;
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
  return `- ${citekey}: **${verdict}** — titleJW=${titleJW.toFixed(2)}, authorJW=${authorJW.toFixed(2)} — ${reason}`;
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
  return `- ${citekey} ("${quoteSnippet}…"): **${verdict}** — lev=${levRatio.toFixed(3)} — ${reason}`;
}

/**
 * Parse all failing citekeys from a VERIFICATION.md body (parser side — compile.ts).
 *
 * Matches list-item verdict rows in two forms:
 *   Pass-1: - citekey: **VERDICT** — titleJW=…, authorJW=… — reason
 *   Pass-3: - citekey ("quote…"): **VERDICT** — lev=… — reason
 *
 * The `^\s*-\s*` anchor excludes pipe-delimited table rows (| citekey | ...) so
 * the Source Freshness table (RSCH-10) does NOT pollute the blocking set (Pitfall 2).
 *
 * Returns only citekeys whose verdict is in BLOCKING_VERDICTS (FABRICATED / MIS-CITED /
 * NOT_FOUND / UNVERIFIABLE). Safe to call on any string, including ''.
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
    // `- <citekey>: **VERDICT**` OR `- <citekey> ("quote…"): **VERDICT**`
    //
    // FAIL-CLOSED widening (audit #2/#20): the citekey group is `[A-Za-z0-9]...`
    // (was `[a-z]...`) so a verdict row produced for an UPPERCASE / mixed-case key
    // — which the broad verifier extractor (extractCitedKeysForVerification) now
    // emits — is matched and added to the blocking set. Previously such a row was
    // silently skipped, so a FABRICATED `[@Vaswani2017]` produced a verdict that
    // never blocked compile. `:`/`(` are deliberately EXCLUDED from the body so the
    // `[:(]` delimiter stays unambiguous; for an exotic key containing `:` the body
    // captures a prefix, which is harmless because compile.ts:272 refuses on ANY
    // matched blocking row (the exact key text is not used for the refuse decision).
    // The `^\s*-\s*` anchor still excludes pipe-delimited freshness-table rows.
    const m = /^\s*-\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*/.exec(line);
    if (!m) continue;
    const citekey = m[1];
    const verdict = m[2];
    if (citekey === undefined || verdict === undefined) continue;
    if (BLOCKING_VERDICTS.has(verdict)) out.push({ citekey, verdict });
  }
  return out;
}

/** The refusal wording for one blocking row (compile refuse-gate, done re-check). */
export function blockingRowReason(row: BlockingVerdictRow): string {
  return row.verdict === 'UNVERIFIABLE'
    ? `citation [@${row.citekey}] is UNVERIFIABLE (checked offline or under --dry-run) — re-run online`
    : `citation [@${row.citekey}] has a blocking verdict (FABRICATED/MIS-CITED/NOT_FOUND)`;
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
