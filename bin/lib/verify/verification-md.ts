// bin/lib/verify/verification-md.ts — a section's VERIFICATION.md: the one
// renderer and its parser (VRFY-24, D-20-20).
//
// Layout (in this order):
//   > OFFLINE MODE …                      (only offline / --dry-run, D-17-08)
//   # VERIFICATION (Section 2, background)
//   Status: verified | failed | unverifiable
//   Draft: sha256 <computeDraftHash of DRAFT.md + assigned_sources>
//   ## Summary                            (| Pass | Verdict | Count |, FIRST)
//   ## Pass-1 (citation integrity, deterministic — D-11 AND-gate)
//   ## Pass-3 (quote integrity, deterministic — levenshtein-substring)
//   ## Draft checks
//   ## Accepted quotes                    (only when a quote acceptance was honoured)
//   ## Source Freshness (RSCH-10)
//   ## Pass-2 …                           (advisory)
//   ## Pass-4 …                           (advisory)
//
// Row formats:
//   Pass 1  `- <key>: **VERDICT** — titleJW=…, authorJW=… — reason`
//           (a text finding's key slot is `L<line>`)
//   Pass 3  `- <key> [q<N>] ("<snippet>…"): **VERDICT** — lev=… — reason`
//           (an accepted UNVERIFIABLE-QUOTE ends `— accepted by you <ISO> (<via>)`)
//   Draft   `- draft: **VERDICT** — reason`
//
// The Summary lists every Pass-1, Pass-3 and draft label with a non-zero
// count, the Pass-2 verdict counts, the Pass-4 orphan total and the freshness
// WARN / not-probed counts (plus the retraction statuses no registrar holds
// data for). parseVerificationMd reads the file back and summaryMismatches
// proves the counts equal the rows (tests/verify-summary).
//
// A VERIFICATION.md is a REPORT: compile and done recompute the verdicts from
// the draft (verify/gate.ts, D-20-04) and read this file only for what can
// make them stricter (a failed or missing Status, a --dry-run marker).
//
// PURE: no I/O.

import { renderPass1VerdictRow, dryRunVerificationReason } from './verdict-rows.js';
import { DRAFT_VERDICTS, LEGACY_UNAVAILABLE_VERDICTS, PASS1_VERDICTS, PASS3_VERDICTS, UNATTRIBUTED_CITEKEY } from './verdicts.js';
import type { GateRow, AcceptedQuote } from './gate.js';
import type { FreshnessResult } from './freshness.js';

/** The section headings (exact prefixes — readers match on them). */
export const SUMMARY_HEADING = '## Summary';
export const PASS1_HEADING = '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)';
export const PASS3_HEADING = '## Pass-3 (quote integrity, deterministic — levenshtein-substring)';
export const DRAFT_CHECKS_HEADING = '## Draft checks';
export const ACCEPTED_QUOTES_HEADING = '## Accepted quotes';
export const SUMMARY_TABLE_HEADER = '| Pass | Verdict | Count |';

/** The note a draft that cites nothing (and has no assigned sources) carries. */
export const NO_CITATIONS_NOTE = 'Note: DRAFT.md cites no sources ([@citekey]) — Pass 1 and Pass 3 had nothing to check.';

/** The Summary's label for an UNVERIFIABLE-QUOTE row the user accepted. */
export const ACCEPTED_QUOTE_LABEL = 'UNVERIFIABLE-QUOTE (accepted)';

/** The key slot of a draft-check row. */
export const DRAFT_ROW_KEY = 'draft';

export type SummaryPass = 'Pass-1' | 'Pass-3' | 'Draft' | 'Pass-2' | 'Pass-4' | 'Freshness';

export interface SummaryRow {
  readonly pass: SummaryPass;
  readonly verdict: string;
  readonly count: number;
}

export interface VerificationDoc {
  /** The section as the user types it (`2`, `1a`). */
  readonly sectionId: string;
  readonly slug: string;
  /** The offline / --dry-run marker line, or null. */
  readonly offlineMarker: string | null;
  readonly status: string;
  /** computeDraftHash of the judged draft; null when there is no draft. */
  readonly draftHash: string | null;
  /** Gate-core rows (verify/gate.ts). */
  readonly rows: readonly GateRow[];
  /** One-line notes printed under `## Draft checks` (e.g. why nothing was checked). */
  readonly notes?: readonly string[];
  /** Acceptances the gate honoured (listed under `## Accepted quotes`). */
  readonly accepted?: readonly AcceptedQuote[];
  /** The freshness probe (null: not run — its table is omitted). */
  readonly freshness?: readonly FreshnessResult[] | null;
  /** The rendered freshness table (renderFreshnessTable), when `freshness` ran. */
  readonly freshnessSection?: string | null;
  /** Pass-2 verdicts for the summary (null: not run). */
  readonly pass2Verdicts?: readonly string[] | null;
  /** The rendered `## Pass-2` section (renderPass2Section, or a "not run" section). */
  readonly pass2Section?: string | null;
  /** The Pass-4 orphan total for the summary (null: not run). */
  readonly pass4Orphans?: number | null;
  /** The rendered `## Pass-4` section. */
  readonly pass4Section?: string | null;
}

/** A snippet safe inside a row: no line breaks, no `**` a reader could take for a verdict. */
function safeSnippet(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/\*/g, '\\*');
}

/**
 * A reason safe inside a row: one line, and no `**` a reader could take for a
 * verdict (a registrar title or a failure message with asterisks is escaped).
 */
function oneLine(s: string): string {
  return s.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\*/g, '\\*').trim();
}

/** Render a Pass-3 row in the Phase 20 format (with its quote id). */
export function renderQuoteRow(row: {
  key: string;
  id: string;
  snippet: string;
  verdict: string;
  levRatio: number;
  reason: string;
  accepted?: { at: string; via: string } | undefined;
}): string {
  const lev = Number.isFinite(row.levRatio) ? row.levRatio.toFixed(3) : 'n/a';
  const accepted = row.accepted ? ` — accepted by you ${row.accepted.at} (${row.accepted.via === 'flag' ? '--accept-quote' : 'at the prompt'})` : '';
  return `- ${row.key} [${row.id}] ("${safeSnippet(row.snippet)}…"): **${row.verdict}** — lev=${lev} — ${oneLine(row.reason)}${accepted}`;
}

/** Render one gate row in its section's format. */
export function renderGateRow(row: GateRow): string {
  switch (row.kind) {
    case 'pass1':
      return renderPass1VerdictRow(row.key, row.verdict, row.titleJW, row.authorJW, oneLine(row.reason));
    case 'text':
      return renderPass1VerdictRow(row.key, row.verdict, Number.NaN, Number.NaN, oneLine(`\`${row.text.replace(/`/g, "'").slice(0, 80)}\`: ${row.reason}`));
    case 'pass3':
      return renderQuoteRow(row);
    case 'draft':
      return `- ${DRAFT_ROW_KEY}: **${row.verdict}** — ${oneLine(row.reason)}`;
  }
}

function orderedLabels(present: readonly string[], vocabulary: readonly string[]): string[] {
  const known = vocabulary.filter((v) => present.includes(v));
  const extra = [...new Set(present.filter((v) => !vocabulary.includes(v)))].sort();
  return [...known, ...extra];
}

function countBy(labels: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of labels) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

/** The label a row is counted under in the Summary. */
export function summaryLabel(row: GateRow): string {
  return row.kind === 'pass3' && row.accepted ? ACCEPTED_QUOTE_LABEL : row.verdict;
}

/** The Summary rows of a document (every non-zero label; Pass-2 / Pass-4 / freshness when they ran). */
export function summaryRows(doc: Pick<VerificationDoc, 'rows' | 'freshness' | 'pass2Verdicts' | 'pass4Orphans'>): SummaryRow[] {
  const out: SummaryRow[] = [];
  const pass1 = doc.rows.filter((r) => r.kind === 'pass1' || r.kind === 'text').map(summaryLabel);
  const pass3 = doc.rows.filter((r) => r.kind === 'pass3').map(summaryLabel);
  const draft = doc.rows.filter((r) => r.kind === 'draft').map(summaryLabel);
  const add = (pass: SummaryPass, labels: readonly string[], vocabulary: readonly string[]): void => {
    const counts = countBy(labels);
    for (const label of orderedLabels([...counts.keys()], vocabulary)) out.push({ pass, verdict: label, count: counts.get(label) ?? 0 });
  };
  add('Pass-1', pass1, PASS1_VERDICTS);
  add('Pass-3', pass3, [...PASS3_VERDICTS, ACCEPTED_QUOTE_LABEL, ...LEGACY_UNAVAILABLE_VERDICTS, 'OK']);
  add('Draft', draft, DRAFT_VERDICTS);
  if (doc.pass2Verdicts) add('Pass-2', doc.pass2Verdicts, ['SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'UNCLEAR']);
  if (doc.pass4Orphans !== null && doc.pass4Orphans !== undefined) out.push({ pass: 'Pass-4', verdict: 'orphans', count: doc.pass4Orphans });
  if (doc.freshness) {
    out.push({ pass: 'Freshness', verdict: 'WARN', count: doc.freshness.reduce((n, r) => n + r.warnings.length, 0) });
    // A probe that got no answer (offline, a failed lookup): its status is not known — never "ok".
    out.push({ pass: 'Freshness', verdict: 'not probed', count: doc.freshness.reduce((n, r) => n + (r.skipped?.length ?? 0), 0) });
    // D-20-13: a DOI no registrar holds retraction data for — reported, never shown as clean.
    const unknownRetraction = doc.freshness.reduce((n, r) => n + (r.info ?? []).filter((i) => i.probe === 'retraction-watch' && i.status === 'unknown').length, 0);
    if (unknownRetraction > 0) out.push({ pass: 'Freshness', verdict: 'retraction status unknown', count: unknownRetraction });
  }
  return out;
}

/** The summary table alone (`| Pass | Verdict | Count |`). */
export function renderSummaryTable(rows: readonly SummaryRow[]): string {
  const lines = [SUMMARY_TABLE_HEADER, '|------|---------|-------|'];
  for (const r of rows) lines.push(`| ${r.pass} | ${r.verdict} | ${r.count} |`);
  if (rows.length === 0) lines.push('| — | nothing to check | 0 |');
  return lines.join('\n');
}

/** Render the `## Summary` section. */
export function renderSummary(rows: readonly SummaryRow[]): string {
  return [SUMMARY_HEADING, '', renderSummaryTable(rows)].join('\n');
}

/** Render the `## Accepted quotes` table (empty string when none). */
export function renderAcceptedQuotes(accepted: readonly AcceptedQuote[]): string {
  if (accepted.length === 0) return '';
  const lines = [ACCEPTED_QUOTES_HEADING, '', '| Quote | Citekey | Accepted | Via |', '|-------|---------|----------|-----|'];
  for (const a of accepted) {
    const excerpt = a.excerpt.replace(/\|/g, '/').replace(/[\r\n]+/g, ' ');
    lines.push(`| ${a.id} "${excerpt}" | ${a.citekey} | ${a.acceptedAt} | ${a.via === 'flag' ? '--accept-quote' : 'prompt'} |`);
  }
  return lines.join('\n');
}

/** Render a whole section VERIFICATION.md. */
export function renderVerificationMd(doc: VerificationDoc): string {
  const pass1 = doc.rows.filter((r) => r.kind === 'pass1' || r.kind === 'text');
  const pass3 = doc.rows.filter((r) => r.kind === 'pass3');
  const draft = doc.rows.filter((r) => r.kind === 'draft');
  const accepted = renderAcceptedQuotes(doc.accepted ?? []);
  const lines = [
    ...(doc.offlineMarker !== null ? [doc.offlineMarker, ''] : []),
    `# VERIFICATION (Section ${doc.sectionId}, ${doc.slug})`,
    '',
    `Status: ${doc.status}`,
    `Draft: ${doc.draftHash !== null ? `sha256 ${doc.draftHash}` : 'none'}`,
    '',
    renderSummary(summaryRows(doc)),
    '',
    PASS1_HEADING,
    '',
    ...(pass1.length > 0 ? pass1.map(renderGateRow) : ['_(no citations to check)_']),
    '',
    PASS3_HEADING,
    '',
    ...(pass3.length > 0 ? pass3.map(renderGateRow) : ['_(no direct quotes)_']),
    '',
    DRAFT_CHECKS_HEADING,
    '',
    ...draft.map(renderGateRow),
    ...(doc.notes ?? []).map(oneLine),
    ...(draft.length === 0 && (doc.notes ?? []).length === 0 ? ['_(no draft findings)_'] : []),
    '',
    ...(accepted.length > 0 ? [accepted, ''] : []),
    ...(doc.freshnessSection ? [doc.freshnessSection, ''] : []),
    ...(doc.pass2Section ? [doc.pass2Section, ''] : []),
    ...(doc.pass4Section ? [doc.pass4Section, ''] : []),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/** One verdict row as read back from a VERIFICATION.md. */
export interface ParsedVerdictRow {
  readonly key: string;
  readonly verdict: string;
  /** The quote id of a Pass-3 row (`q1`), or null. */
  readonly quoteId: string | null;
  /** An UNVERIFIABLE-QUOTE row the file says was accepted. */
  readonly accepted: boolean;
}

export interface ParsedVerificationMd {
  readonly status: string | null;
  readonly draftHash: string | null;
  readonly summary: SummaryRow[];
  readonly pass1: ParsedVerdictRow[];
  readonly pass3: ParsedVerdictRow[];
  readonly draft: ParsedVerdictRow[];
  /** Pass-2 verdict cells (bolded) in the Pass-2 table. */
  readonly pass2Verdicts: string[];
}

const QUOTE_ROW_RE = /^\s*-\s*(\S+?)(?:\s+\[(q[1-9]\d*)\])?\s+\("(.*)"\):\s*\*\*([A-Z_-]+)\*\*/u;
const KEY_ROW_RE = /^\s*-\s*(\S+):\s*\*\*([A-Z_-]+)\*\*/u;
const ACCEPTED_RE = / — accepted by you \S+ \((?:--accept-quote|at the prompt)\)\s*$/;

/** The lines of each `## ` section, keyed by its heading line. */
function sections(md: string): Array<{ heading: string; lines: string[] }> {
  const out: Array<{ heading: string; lines: string[] }> = [];
  let cur: { heading: string; lines: string[] } | null = null;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      cur = { heading: line.trim(), lines: [] };
      out.push(cur);
      continue;
    }
    cur?.lines.push(line);
  }
  return out;
}

function parseRows(lines: readonly string[]): ParsedVerdictRow[] {
  const out: ParsedVerdictRow[] = [];
  for (const line of lines) {
    const q = QUOTE_ROW_RE.exec(line);
    if (q) {
      out.push({ key: q[1] ?? '', verdict: q[4] ?? '', quoteId: q[2] ?? null, accepted: ACCEPTED_RE.test(line) });
      continue;
    }
    const k = KEY_ROW_RE.exec(line);
    if (k) out.push({ key: k[1] ?? '', verdict: k[2] ?? '', quoteId: null, accepted: false });
  }
  return out;
}

/** Read a section VERIFICATION.md back (never throws; absent parts are empty). */
export function parseVerificationMd(md: string): ParsedVerificationMd {
  const status = /^Status:\s*(\S+)/m.exec(md)?.[1] ?? null;
  const draftHash = /^Draft:\s*sha256\s+([0-9a-f]{64})\s*$/m.exec(md)?.[1] ?? null;
  const secs = sections(md);
  const find = (prefix: string): string[] => secs.find((s) => s.heading.startsWith(prefix))?.lines ?? [];
  const summary: SummaryRow[] = [];
  for (const line of find(SUMMARY_HEADING)) {
    const m = /^\|\s*(Pass-1|Pass-3|Draft|Pass-2|Pass-4|Freshness)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*$/.exec(line);
    if (m) summary.push({ pass: m[1] as SummaryPass, verdict: m[2] ?? '', count: Number(m[3]) });
  }
  const pass2Verdicts: string[] = [];
  for (const line of find('## Pass-2')) {
    if (!line.trim().startsWith('|')) continue;
    const m = /\|\s*\*\*([A-Z]+)\*\*\s*\|/.exec(line);
    if (m) pass2Verdicts.push(m[1] ?? '');
  }
  return {
    status,
    draftHash,
    summary,
    pass1: parseRows(find('## Pass-1')),
    pass3: parseRows(find('## Pass-3')),
    draft: parseRows(find(DRAFT_CHECKS_HEADING)),
    pass2Verdicts,
  };
}

/**
 * Where the Summary and the rows disagree (empty when every Pass-1, Pass-3,
 * draft and Pass-2 count equals the number of rows with that label, and no
 * row's label is missing from the Summary).
 */
export function summaryMismatches(md: string): string[] {
  const doc = parseVerificationMd(md);
  const out: string[] = [];
  const check = (pass: SummaryPass, labels: readonly string[]): void => {
    const counts = countBy(labels);
    const listed = doc.summary.filter((s) => s.pass === pass);
    for (const s of listed) {
      const n = counts.get(s.verdict) ?? 0;
      if (n !== s.count) out.push(`${pass} ${s.verdict}: the Summary says ${s.count}, the rows hold ${n}`);
    }
    for (const [label, n] of counts) {
      if (!listed.some((s) => s.verdict === label)) out.push(`${pass} ${label}: ${n} row(s) missing from the Summary`);
    }
  };
  const label = (r: ParsedVerdictRow): string => (r.accepted && r.verdict === 'UNVERIFIABLE-QUOTE' ? ACCEPTED_QUOTE_LABEL : r.verdict);
  check('Pass-1', doc.pass1.map(label));
  check('Pass-3', doc.pass3.map(label));
  check('Draft', doc.draft.map(label));
  if (doc.summary.some((s) => s.pass === 'Pass-2') || doc.pass2Verdicts.length > 0) check('Pass-2', doc.pass2Verdicts);
  return out;
}

/**
 * What a section's VERIFICATION.md adds to compile's and done's refusals
 * (D-20-04 — a local record can only make the gate stricter): missing, no
 * Status line, `Status: failed`, a --dry-run verification outside --dry-run
 * (RUN-27), or a `Draft:` hash of another draft than `draftHash` (null skips
 * that comparison — compile's staleness re-verify rewrites the record). Its
 * verdict rows are never trusted either way: the gate core recomputes them.
 */
export function verificationRecordReasons(md: string | null, id: string, draftHash: string | null, dryRun: boolean): string[] {
  if (md === null) return [`no verifiable VERIFICATION.md (missing VERIFICATION.md: the section was never verified) — run \`pensmith verify ${id}\``];
  const doc = parseVerificationMd(md);
  if (doc.status === null) {
    return [`no verifiable VERIFICATION.md (no Status line: the section was never verified, or the verifier output is unreadable) — run \`pensmith verify ${id}\``];
  }
  const dry = dryRunVerificationReason(md, dryRun);
  if (dry !== null) return [dry];
  const out: string[] = [];
  if (doc.status.toLowerCase() === 'failed') {
    out.push(
      `VERIFICATION.md Status is 'failed' — repair the flagged citations (\`pensmith plan ${id} --revise\`) or re-draft (\`pensmith write ${id}\`), then \`pensmith verify ${id}\``,
    );
  }
  if (draftHash !== null && doc.draftHash !== null && doc.draftHash !== draftHash) {
    out.push(`VERIFICATION.md judged another draft than DRAFT.md holds — run \`pensmith verify ${id}\``);
  }
  return out;
}

/** The key slot of an UNATTRIBUTED quote row (re-exported for renderers). */
export { UNATTRIBUTED_CITEKEY };
