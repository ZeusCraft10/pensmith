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

/** Verdicts that block compile (mirrors REFUSING_VERDICTS in compile.ts:62). */
const BLOCKING_VERDICTS = new Set(['FABRICATED', 'MIS-CITED', 'NOT_FOUND']);

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
 * NOT_FOUND). Safe to call on any string, including ''.
 */
export function parseVerdictRows(verificationMd: string): string[] {
  const out: string[] = [];
  for (const line of verificationMd.split(/\r?\n/)) {
    // `- <citekey>: **VERDICT**` OR `- <citekey> ("quote…"): **VERDICT**`
    //
    // LOWERCASE-CITEKEY CONSTRAINT: the citekey group `[a-z][a-z0-9_-]*` matches
    // only lowercase-first citekeys. This is a bijection WITHIN the lowercase-citekey
    // namespace — it is correct because pensmith's citekeys are generated lowercase
    // (see bin/lib/citekey.ts and CITATION_TOKEN_RE in citation-token.ts, which uses
    // the same `[a-z]` anchor). A mixed-case citekey like `Smith2020` would be silently
    // skipped by this parser (and by extractCitekeys in GATE-04). Do NOT widen the
    // charset unless the project's citekey generation is changed to allow uppercase;
    // doing so without auditing all extraction points would create a charset mismatch
    // between the writer and parser that breaks the round-trip guarantee.
    const m = /^\s*-\s*([a-z][a-z0-9_-]*)\s*[:(].*?\*\*([A-Z_-]+)\*\*/.exec(line);
    if (!m) continue;
    const citekey = m[1];
    const verdict = m[2];
    if (citekey === undefined || verdict === undefined) continue;
    if (BLOCKING_VERDICTS.has(verdict)) out.push(citekey);
  }
  return out;
}
