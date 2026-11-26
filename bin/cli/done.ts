// bin/cli/done.ts — `pensmith done` verb entrypoint (DONE-01 / DONE-03 / DONE-09).
//
// THIN ORCHESTRATOR — delegates to bin/lib/* (runPass4, runPlagiarism,
// scoreHonesty, exportDraft). 'done' IS one of the locked UX-02 16 verbs
// (bin/lib/verbs.ts) — this file promotes the Phase-2 dispatcher stub to a real
// loader (bin/pensmith.ts REAL_VERB_LOADERS). No 17th verb is added; the
// workflows/done.md body (Tier 1) delegates to this SAME bin/lib path.
//
// stdout-only (no console.*, so stdout carries only what the verb prints, as
// in compile.ts and the other verbs).
//
// DONE-09 export-confirmation gate is the SOLE escape valve reconciling the
// Core Value ("every citation supports its claim") with VRFY-07 (advisory Pass
// 2/4 never auto-block). Without the gate the Core Value would force compile/
// export to block automatically. The gate ALWAYS prompts (generic confirm even
// when clean — PRD §7.9), shows a per-issue summary when UNSUPPORTED / orphan /
// plagiarism issues exist, and ONLY --yolo skips it. The answer defaults to no.
// With no terminal to ask in, done exits 3 with the pending decision as JSON.
//
// Exports go to the exporter's DISTINCT export dir (default `.paper/export/`),
// never over the source DRAFT.md. The format defaults to docx when Pandoc is
// installed and to md otherwise; an explicit docx/pdf that cannot be made is
// refused. A failed export (ExportError) writes nothing and does not mark the
// paper done: a refusal exits 2, a crashed tool exits 1.

import { defineCommand } from 'citty';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPass4, renderPass4Section, type Pass4Result } from '../lib/verify/pass4.js';
import { runPass3 } from '../lib/verify/pass3.js';
import { readBibText } from '../lib/verify/pass1.js';
import { extractQuotes } from '../lib/quote-extractor.js';
import { type Pass2Result, type Pass2Verdict } from '../lib/verify/pass2.js';
import { runPlagiarism, renderPlagiarismSection, type PlagiarismResult } from '../lib/plagiarism.js';
import { scoreHonesty, renderHonestyReport, renderHonestySkipped } from '../lib/honesty.js';
import {
  EXPORT_FORMATS,
  exportDraft,
  ExportError,
  formatUnavailable,
  runHumanizer,
  type ExportFormat,
} from '../lib/exporter.js';
import { paperDir, sectionDirName } from '../lib/paths.js';
import { parseBibByCitekey } from '../lib/citations.js';
import { resolveCitationStyle } from '../lib/citation-style.js';
import { isPandocPresent } from '../lib/ecosystem-presence.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { confirmOrNo, type PromptQuestion } from '../lib/prompts.js';
import {
  citedKeys,
  findCitations,
  findRawCitations,
  findUnparseableCitations,
  type Citation,
} from '../lib/citation-grammar.js';
import { EXIT_ERROR, EXIT_NEEDS_ANSWER, EXIT_REFUSED } from '../lib/exit-codes.js';
import { readOutline } from '../lib/outline-read.js';
import { isPlaceholderText } from '../lib/placeholder.js';
import { recheckExportText, runExportBlockingGate } from '../lib/export-gate.js';
import { readVerificationRecord } from '../lib/verify/verification-record.js';

// ---------------------------------------------------------------------------
// DONE-09 gate-issue collection
// ---------------------------------------------------------------------------

export interface GateIssues {
  /** Pass-2 rows whose verdict is UNSUPPORTED. */
  unsupported: Pass2Result[];
  /** Pass-4 paragraphs carrying at least one HIGH-confidence orphan claim. */
  orphanClaims: Pass4Result[];
  /** The orphan claims in those paragraphs, added up. */
  orphanClaimCount: number;
  /** Plagiarism results that returned at least one match URL. */
  plagiarismHits: PlagiarismResult[];
  /** True iff ANY of the three buckets is non-empty. */
  hasIssues: boolean;
}

/**
 * Bucket the three advisory inputs into the DONE-09 gate issue set. Pure,
 * deterministic, never throws:
 *   - UNSUPPORTED  ← Pass2Result.verdict === 'UNSUPPORTED'
 *   - orphan       ← Pass4Result.orphanCount > 0
 *   - plagiarism   ← PlagiarismResult.matches.length > 0
 * hasIssues is the OR of the three buckets being non-empty.
 */
export function collectGateIssues(input: {
  pass2Results: Pass2Result[];
  pass4Results: Pass4Result[];
  plagiarismResults: PlagiarismResult[];
}): GateIssues {
  const unsupported = (input.pass2Results ?? []).filter((r) => r.verdict === 'UNSUPPORTED');
  const orphanClaims = (input.pass4Results ?? []).filter((r) => r.orphanCount > 0);
  const plagiarismHits = (input.plagiarismResults ?? []).filter(
    (r) => Array.isArray(r.matches) && r.matches.length > 0,
  );
  const orphanClaimCount = orphanClaims.reduce((sum, r) => sum + r.orphanCount, 0);
  const hasIssues =
    unsupported.length > 0 || orphanClaims.length > 0 || plagiarismHits.length > 0;
  return { unsupported, orphanClaims, orphanClaimCount, plagiarismHits, hasIssues };
}

// ---------------------------------------------------------------------------
// DONE-09 export-confirmation gate
// ---------------------------------------------------------------------------

export interface DoneGateResult {
  exported?: boolean;
  gateSkipped?: boolean;
}

/**
 * Render the per-issue summary to stdout (table-cell-safe — counts plus a few
 * example citekeys / phrases). Called BEFORE approve() when hasIssues is true.
 */
function writeGateSummary(issues: GateIssues): void {
  process.stdout.write('pensmith done: advisory issues found before export (DONE-09):\n');
  if (issues.unsupported.length > 0) {
    const sample = issues.unsupported
      .slice(0, 3)
      .map((r) => r.citekey)
      .join(', ');
    process.stdout.write(
      `  - ${issues.unsupported.length} UNSUPPORTED claim(s) (Pass 2): ${sample}\n`,
    );
  }
  if (issues.orphanClaims.length > 0) {
    process.stdout.write(
      `  - ${issues.orphanClaimCount} orphan claim(s) across ${issues.orphanClaims.length} paragraph(s) (Pass 4)\n`,
    );
  }
  if (issues.plagiarismHits.length > 0) {
    const sample = issues.plagiarismHits
      .slice(0, 3)
      .map((r) => r.phrase.replace(/[\r\n]+/g, ' ').slice(0, 60))
      .join(' | ');
    process.stdout.write(
      `  - ${issues.plagiarismHits.length} distinctive phrase(s) with web matches (plagiarism): ${sample}\n`,
    );
  }
  process.stdout.write('These are advisory only — review before confirming export.\n');
}

/**
 * The DONE-09 export-confirmation gate. Accepts the three advisory result sets
 * directly (the locked Wave-0 export-gate test shape), an injectable approver
 * (so tests pass a deterministic approve()), and the --yolo flag.
 *
 *   - yolo === true  → { gateSkipped: true }; approve() is NEVER called.
 *   - otherwise      → collectGateIssues; if hasIssues, print the per-issue
 *                      summary FIRST; then ALWAYS call approve() (generic
 *                      confirm even on a clean paper, PRD §7.9):
 *                        approve() === false → { exported: false }
 *                        approve() === true  → { exported: true }
 *
 * Never throws beyond the injected approver's own behavior (the --yolo path
 * never touches approve, so a throwing approver there is a test guard only).
 */
export async function runDoneGate(input: {
  pass2Results: Pass2Result[];
  pass4Results: Pass4Result[];
  plagiarismResults: PlagiarismResult[];
  yolo: boolean;
  approve: () => Promise<boolean>;
}): Promise<DoneGateResult> {
  if (input.yolo === true) {
    return { gateSkipped: true };
  }
  const issues = collectGateIssues({
    pass2Results: input.pass2Results,
    pass4Results: input.pass4Results,
    plagiarismResults: input.plagiarismResults,
  });
  if (issues.hasIssues) {
    writeGateSummary(issues);
  }
  // ALWAYS call approve() in the non-yolo path — generic confirm even when the
  // paper is clean (PRD §7.9). The approver is the SOLE export decision.
  const approved = await input.approve();
  return { exported: approved === true };
}

// ---------------------------------------------------------------------------
// DONE-01 whole-paper Pass 4 helper
// ---------------------------------------------------------------------------

/**
 * Run the whole-paper Pass 4 orphan audit on the compiled `.paper/DRAFT.md`
 * (DONE-01). Reads the draft via paperDir; a missing draft yields [] (the
 * caller surfaces the missing-draft error separately). runPass4 is deterministic
 * and offline under PENSMITH_NO_LLM=1 (CI path). Never throws.
 */
export async function runWholePaperPass4(paperRoot: string): Promise<Pass4Result[]> {
  const draftPath = join(paperDir(paperRoot), 'DRAFT.md');
  let draftMd: string;
  try {
    draftMd = readFileSync(draftPath, 'utf8');
  } catch {
    return [];
  }
  try {
    return await runPass4(draftMd, { n: 0 });
  } catch {
    // Advisory — a Pass-4 failure must never crash the export.
    return [];
  }
}

// ---------------------------------------------------------------------------
// UNCONDITIONAL export blocking gate (bin/lib/export-gate.ts)
// ---------------------------------------------------------------------------

// The export is bound to the bytes the last gated compile wrote and to the
// sections' recorded verdicts (runExportBlockingGate), and the citations of
// the exact text being exported are checked again (recheckExportText).
// Neither --raw nor --yolo skips them: --yolo skips only the advisory export
// confirmation.
export { runExportBlockingGate, type ExportBlock } from '../lib/export-gate.js';

// ---------------------------------------------------------------------------
// readSectionUnsupported — the FAIL-SAFE section Pass-2 UNSUPPORTED reader (HIGH-3)
// ---------------------------------------------------------------------------

// PINNED Pass-2 table contract (HIGH-3). The SINGLE writer of this shape is
// bin/lib/verify/pass2.ts renderPass2Section — if that writer ever changes its
// table header or its bolded-verdict cell convention, the desync MUST be caught
// here (the parser fails safe rather than silently dropping UNSUPPORTED rows).
//   header:        | Citekey | Claim Sentence | Verdict | Rationale |
//   verdict cell:  **<VERDICT>**  (e.g. **UNSUPPORTED**)
//   empty section: _(no citations to judge)_
const PASS2_HEADING = '## Pass-2';
const PASS2_TABLE_HEADER = '| Citekey | Claim Sentence | Verdict | Rationale |';
const PASS2_EMPTY_MARKER = '_(no citations to judge)_';
const VALID_VERDICTS: ReadonlySet<string> = new Set([
  'SUPPORTED',
  'PARTIAL',
  'UNSUPPORTED',
  'UNCLEAR',
]);

/** Build the synthetic fail-safe sentinel row for an unparseable Pass-2 table. */
function unparseableSentinel(sectionName: string): Pass2Result {
  return {
    citekey: '<unparseable>',
    claimSentence: `Pass-2 table in ${sectionName}/VERIFICATION.md could not be parsed — failing safe`,
    verdict: 'UNSUPPORTED',
    rationale: 'parser/writer contract desync',
    evidence: '',
  };
}

/**
 * Parse the ## Pass-2 table out of ONE section VERIFICATION.md and return the
 * UNSUPPORTED rows it carries. FAIL-SAFE (HIGH-3):
 *   - NO `## Pass-2` heading at all → return [] (nothing to report — clean).
 *   - the `_(no citations to judge)_` empty marker → return [] (clean).
 *   - heading present + header matches the pinned contract + rows parse →
 *     return the **UNSUPPORTED** rows (filtering out SUPPORTED/PARTIAL/UNCLEAR).
 *   - heading present but the header does NOT match the pinned contract, OR a
 *     data row cannot be split into the expected 4 cells → return a synthetic
 *     `<unparseable>` UNSUPPORTED sentinel so hasIssues becomes true and the
 *     gate REQUIRES confirmation. NEVER a silent clean for a present-but-
 *     unparseable table.
 */
function parseSectionPass2(md: string, sectionName: string): Pass2Result[] {
  // Locate the ## Pass-2 heading line. Absent → clean (nothing to report).
  const lines = md.split(/\r?\n/);
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? '').startsWith(PASS2_HEADING)) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return []; // absent Pass-2 section = clean

  // Slice the body of the Pass-2 section: from the heading to the next `## ` or EOF.
  const body: string[] = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if ((lines[i] ?? '').startsWith('## ')) break;
    body.push(lines[i] ?? '');
  }
  const bodyText = body.join('\n');

  // Explicit empty-section marker → clean.
  if (bodyText.includes(PASS2_EMPTY_MARKER)) return [];

  // The Pass-2 section is present but non-empty. Find the pinned header row.
  const headerLineIdx = body.findIndex((l) => l.trim() === PASS2_TABLE_HEADER);
  if (headerLineIdx === -1) {
    // Heading present but the pinned 4-column header is missing → fail safe.
    return [unparseableSentinel(sectionName)];
  }

  // Data rows start AFTER the header + the dashed separator line.
  const sepIdx = headerLineIdx + 1;
  const sep = (body[sepIdx] ?? '').trim();
  if (!/^\|[\s|:-]+\|$/.test(sep)) {
    // The separator is missing/malformed → fail safe (shape desync).
    return [unparseableSentinel(sectionName)];
  }

  const out: Pass2Result[] = [];
  for (let i = sepIdx + 1; i < body.length; i++) {
    const raw = (body[i] ?? '').trim();
    if (raw.length === 0) continue; // blank line ends the table body
    if (!raw.startsWith('|')) break; // non-table content ends the table
    // Split a GFM table row into its cells. A 4-column table yields 4 inner
    // cells once the leading/trailing empty splits are dropped.
    const cells = raw
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length !== 4) {
      // A row that does not parse into the expected 4 cells → fail safe.
      return [unparseableSentinel(sectionName)];
    }
    const [citekey, claimSentence, verdictCell, rationale] = cells as [
      string,
      string,
      string,
      string,
    ];
    // The verdict cell is bolded: **<VERDICT>**. Strip the ** markers.
    const verdict = verdictCell.replace(/\*\*/g, '').trim();
    if (!VALID_VERDICTS.has(verdict)) {
      // A verdict cell that is not one of the four enum values → fail safe.
      return [unparseableSentinel(sectionName)];
    }
    if (verdict === 'UNSUPPORTED') {
      out.push({
        citekey,
        claimSentence,
        verdict: 'UNSUPPORTED' as Pass2Verdict,
        rationale,
        evidence: '',
      });
    }
  }
  return out;
}

/**
 * The ## Pass-2 UNSUPPORTED rows of each section, as Pass2Result[], for the
 * export confirmation's UNSUPPORTED bucket. They are read from the advisory
 * part of the section's recorded verdicts (VERIFICATION.json), so deleting
 * rows from the rendered VERIFICATION.md hides nothing; a section with no
 * record is read from its VERIFICATION.md. A record that cannot be read gives
 * the fail-safe sentinel.
 *
 * Defensive on I/O ONLY: a missing sections dir or an unreadable report is
 * SKIPPED (contributes nothing for that section) and never throws. This is
 * DISTINCT from the fail-safe in parseSectionPass2: missing/absent = clean;
 * present-but-unparseable = a synthetic UNSUPPORTED issue.
 */
export function readSectionUnsupported(paperRoot: string): Pass2Result[] {
  const sectionsDir = join(paperDir(paperRoot), 'sections');
  // The outline's sections only: a folder the outline no longer names is not
  // part of the paper. Without an outline, every section folder is read.
  const outline = readOutline(paperRoot);
  let entries: string[];
  if (outline.ok) {
    entries = outline.outline.sections.map((s) => sectionDirName(s.n, s.slug));
  } else {
    try {
      entries = readdirSync(sectionsDir);
    } catch {
      return []; // no sections dir → nothing to report
    }
  }
  const out: Pass2Result[] = [];
  for (const entry of entries) {
    const record = readVerificationRecord(join(sectionsDir, entry, 'VERIFICATION.json'));
    if (record.ok) {
      out.push(...parseSectionPass2(record.record.advisory_markdown, entry));
      continue;
    }
    if (record.problem === 'unreadable') {
      out.push(unparseableSentinel(entry));
      continue;
    }
    const vPath = join(sectionsDir, entry, 'VERIFICATION.md');
    let md: string;
    try {
      if (!existsSync(vPath)) continue;
      md = readFileSync(vPath, 'utf8');
    } catch {
      continue; // unreadable file → skip (I/O defensive only)
    }
    out.push(...parseSectionPass2(md, entry));
  }
  return out;
}

// ---------------------------------------------------------------------------
// GATE-04 reCheckFinalMd — re-verify the humanized FINAL.md before export
// ---------------------------------------------------------------------------

/** The citations of `md` that are not Pandoc citations: raw identifiers and broken brackets. */
function nonPandocCitations(md: string, cites: readonly Citation[]): string[] {
  return [...findRawCitations(md, cites), ...findUnparseableCitations(md, cites)].map((c) => c.raw);
}

/** The entries of `after` left once each entry of `before` has matched one of them: what `after` adds. */
function addedEntries(after: readonly string[], before: readonly string[]): string[] {
  const left = [...before];
  return after.filter((x) => {
    const i = left.indexOf(x);
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
}

/** The text of every long quotation in `md` with no citation. */
function unattributedQuotes(md: string, cites: readonly Citation[]): string[] {
  return extractQuotes(md, cites).filter((q) => q.unattributed).map((q) => q.text);
}

/**
 * Re-verify the humanized FINAL.md immediately before export (GATE-04).
 *
 * (a) Citation diff: the keys FINAL.md cites, in any Pandoc form, MUST equal
 *     the keys draftMd cites, and FINAL.md must not add a citation typed as
 *     text or a broken one. Any add/drop/swap is a HARD block.
 * (b) A quotation with no citation does not block, but the humanizer must
 *     leave it as the draft had it: one it separated from its citation, or
 *     whose words it changed, is a HARD block.
 * (c) Pass-3 quote re-check on finalMd against the whole CITATIONS.bib, not
 *     only the works the draft cites, so a quote moved onto another work is
 *     still checked; an absent or empty bib is an empty library. Any
 *     NOT_FOUND quote is a HARD block. Each source is read again for this
 *     check, so FINAL.md is checked against the source as it is now.
 *
 * Never throws. Returns { passed: boolean; reason: string }.
 */
export async function reCheckFinalMd(
  finalMd: string,
  draftMd: string,
  bibPath: string,
): Promise<{ passed: boolean; reason: string }> {
  // Step (a): the citation diff runs first, so its reason is the one reported.
  const finalCites = findCitations(finalMd);
  const draftCites = findCitations(draftMd);
  const finalKeys = new Set(citedKeys(finalCites));
  const draftKeys = new Set(citedKeys(draftCites));

  const added = [...finalKeys].filter((k) => !draftKeys.has(k));
  const dropped = [...draftKeys].filter((k) => !finalKeys.has(k));
  const addedRaw = addedEntries(nonPandocCitations(finalMd, finalCites), nonPandocCitations(draftMd, draftCites));

  if (added.length > 0 || dropped.length > 0 || addedRaw.length > 0) {
    const parts: string[] = [];
    if (added.length > 0) parts.push(`added: [${added.join(', ')}]`);
    if (dropped.length > 0) parts.push(`dropped: [${dropped.join(', ')}]`);
    if (addedRaw.length > 0) parts.push(`added text that is not a [@key] citation: [${addedRaw.join(', ')}]`);
    return {
      passed: false,
      reason: `citekey-set mismatch after humanization — ${parts.join('; ')}`,
    };
  }

  // Step (b): quotations with no citation, which need no bibliography.
  const changedUnattributed = addedEntries(unattributedQuotes(finalMd, finalCites), unattributedQuotes(draftMd, draftCites));
  if (changedUnattributed.length > 0) {
    const detail = changedUnattributed.map((t) => `no citation "${t.slice(0, 40)}"`).join('; ');
    return {
      passed: false,
      reason: `Pass-3 quote UNATTRIBUTED in humanized FINAL.md and not word for word in DRAFT.md: ${detail}`,
    };
  }

  // Step (c): Pass-3 quote re-check only when the citations match.
  let bibText = '';
  try {
    if (existsSync(bibPath)) bibText = readFileSync(bibPath, 'utf8');
  } catch {
    // Unreadable: read as an empty library.
  }

  let bibByCitekey: Map<string, { DOI?: string }>;
  try {
    bibByCitekey = await parseBibByCitekey<{ DOI?: string }>(bibText);
  } catch {
    // Unparseable bib → skip-clean (no DOIs to check against).
    return { passed: true, reason: '' };
  }

  let pass3Results;
  try {
    pass3Results = await runPass3(finalMd, bibByCitekey);
  } catch (err) {
    // GATE-04 FAIL-CLOSED: an unexpected runPass3 error is NOT a clean pass.
    // We already have a valid bibByCitekey map here, so an exception is unexpected
    // (not a "nothing to do" case like the bib-parse catch above). Fail closed so
    // a humanizer-introduced NOT_FOUND quote that also triggers a runPass3 bug
    // cannot silently escape the gate. Log to stderr and block export.
    process.stderr.write(
      `pensmith done: GATE-04 Pass-3 re-check failed unexpectedly (${
        err instanceof Error ? err.message : String(err)
      }) — blocking export (fail-closed verifier gate).\n`,
    );
    return {
      passed: false,
      reason: `Pass-3 re-check threw unexpectedly: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const notFound = pass3Results.filter((r) => r.verdict === 'NOT_FOUND');
  if (notFound.length > 0) {
    const detail = notFound.map((r) => `[@${r.citekey}] "${r.quoteSnippet}"`).join('; ');
    return {
      passed: false,
      reason: `Pass-3 quote NOT_FOUND in humanized FINAL.md: ${detail}`,
    };
  }

  return { passed: true, reason: '' };
}

// ---------------------------------------------------------------------------
// doneCommand — the thin orchestrator (DONE-01 + DONE-02 + DONE-03 + DONE-04/05
//               + DONE-06/07/08 + DONE-09)
// ---------------------------------------------------------------------------

const VALID_FORMATS: ReadonlySet<string> = new Set(EXPORT_FORMATS);

/** The export confirmation. It defaults to no: exporting needs an explicit yes. */
export const EXPORT_CONFIRM_QUESTION = {
  id: 'export-confirm',
  kind: 'confirm',
  label: 'Export the paper?',
  default: false,
} as const satisfies PromptQuestion;

/**
 * True when a person at a terminal can see the question and type an answer.
 * Claude Code's Bash tool, CI and pipes have no terminal: reading stdin there
 * either crashes on a closed stream or takes whatever text was piped in.
 */
function canAskInTerminal(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY);
}

/**
 * The machine-readable description of a pending export decision, printed as
 * one JSON line when there is no terminal to ask in. Nothing is exported.
 */
export function pendingExportDecision(
  issues: GateIssues,
  format: string,
  source = '.paper/DRAFT.md',
): Record<string, unknown> {
  const count = issues.unsupported.length + issues.orphanClaimCount + issues.plagiarismHits.length;
  return {
    pending: 'export-confirmation',
    gate: 'export',
    needs_confirmation: true,
    summary:
      `Export ${source} as ${format}? ` +
      (issues.hasIssues ? `${count} advisory issue(s) to review first.` : 'No advisory issues were found.'),
    options: ['export', 'cancel'],
    default: 'cancel',
    issues: {
      unsupported: issues.unsupported.map((r) => r.citekey),
      orphan_claims: issues.orphanClaimCount,
      plagiarism_hits: issues.plagiarismHits.map((r) => r.phrase.replace(/\s+/g, ' ').slice(0, 80)),
    },
    how_to_answer: 'Run `pensmith done` in an interactive terminal and answer the prompt there.',
  };
}

/** Build the whole-paper `.paper/VERIFICATION.md` report body (a SOURCE
 *  artifact, NOT written into the distinct export dir). */
function buildVerificationReport(
  honestyReport: string,
  plagiarismResults: PlagiarismResult[],
  pass4Results: Pass4Result[],
): string {
  return [
    '# Paper Verification (done)',
    '',
    '## Honesty (DONE-04)',
    '',
    honestyReport,
    '',
    renderPlagiarismSection(plagiarismResults),
    '',
    renderPass4Section(pass4Results),
    '',
  ].join('\n');
}

export const doneCommand = defineCommand({
  meta: {
    name: 'done',
    description: 'Finalize the paper: audit + humanize + export (no metadata trace).',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip the export confirmation gate.',
      default: false,
    },
    format: {
      type: 'string',
      description: 'Export format: docx | pdf | latex | md (default: docx when Pandoc is installed, otherwise md).',
    },
    raw: {
      type: 'boolean',
      description: 'Skip the humanizer step.',
      default: false,
    },
  },
  async run({ args }) {
    const paperRoot = process.cwd();
    const draftPath = join(paperDir(paperRoot), 'DRAFT.md');

    let draftBytes: Buffer;
    try {
      draftBytes = readFileSync(draftPath);
    } catch {
      process.stdout.write(
        `pensmith done: no compiled draft at ${draftPath} — run 'pensmith compile' first.\n`,
      );
      process.exitCode = EXIT_REFUSED;
      return { ok: false };
    }
    // UNCONDITIONAL export blocking gate, BEFORE any advisory, humanizer or
    // export work, for EVERY done invocation (explicit, bare /pensmith, next),
    // and NOT skipped by --raw or --yolo: the compiled draft must be the one a
    // gated compile wrote, from sections, verdicts and bibliography entries
    // that have not changed since; then every citation and quotation in it is
    // checked again.
    const refuseExport = (heading: string, reasons: readonly string[]): { ok: false; blocked: true } => {
      process.stdout.write(`pensmith done: BLOCKED — ${heading}:\n`);
      for (const r of reasons) process.stdout.write(`  - ${r}\n`);
      process.stdout.write(
        "Fix the cited section(s) — re-run 'pensmith verify <N>' then 'pensmith compile' — and try again.\n",
      );
      process.exitCode = EXIT_REFUSED;
      return { ok: false, blocked: true };
    };

    // One read of the manuscript and of the bibliography: the gate, the
    // checks and the export all use these bytes.
    const draftMd = draftBytes.toString('utf8');
    let bibText: string;
    try {
      bibText = readBibText(paperRoot) ?? '';
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : String(err));
      return refuseExport('export refused (the bibliography cannot be checked)', [`.paper/CITATIONS.bib could not be read (${code})`]);
    }
    const blocking = await runExportBlockingGate(paperRoot, draftBytes, bibText);
    if (blocking.blocked) {
      return refuseExport('export refused (the compiled draft is not what a gated compile produced, a section is unverified, or text is placeholder)', blocking.reasons);
    }
    for (const w of blocking.warnings) process.stderr.write(`pensmith done: WARN — ${w}.\n`);
    const recheck = await recheckExportText(paperRoot, draftMd, { label: '.paper/DRAFT.md', bibText });
    if (recheck.blocked) {
      return refuseExport('export refused (a citation or quotation in the text being exported does not pass when checked again)', recheck.reasons);
    }
    for (const w of recheck.warnings) process.stderr.write(`pensmith done: WARN — ${w}.\n`);

    // The format, settled before any audit work: a format that cannot be made
    // here is refused now, not after the user has confirmed the export.
    const requested = typeof args.format === 'string' && args.format.length > 0 ? args.format : undefined;
    if (requested !== undefined && !VALID_FORMATS.has(requested)) {
      process.stdout.write(`pensmith done: unknown export format '${requested}' — use docx, pdf, latex or md.\n`);
      process.exitCode = EXIT_REFUSED;
      return { ok: false };
    }
    // A Markdown export never needs Pandoc, so it is not probed for.
    const pandoc = requested === 'md' ? false : isPandocPresent();
    const format: ExportFormat = (requested as ExportFormat | undefined) ?? (pandoc ? 'docx' : 'md');
    const unavailable = formatUnavailable(format, pandoc);
    if (unavailable) {
      process.stdout.write(
        `pensmith done: ${unavailable.reason} Nothing was exported.\n  ${unavailable.remedy}\n`,
      );
      process.exitCode = EXIT_REFUSED;
      return { ok: false };
    }

    // 1. DONE-01 whole-paper Pass 4 (orphan audit). 2. DONE-02 plagiarism.
    const pass4Results = await runWholePaperPass4(paperRoot);
    const plagiarismResults = await runPlagiarism(draftMd);

    // 3. DONE-04 honesty score (before humanize).
    const before = await scoreHonesty(draftMd);

    // 4. DONE-03 humanize (skip-clean if absent / no transport). 5. honesty after.
    let finalPath: string | null = null;
    let after: Awaited<ReturnType<typeof scoreHonesty>> = null;
    if (args.raw !== true) {
      finalPath = await runHumanizer(draftMd, paperRoot);
      if (finalPath !== null) {
        try {
          after = await scoreHonesty(readFileSync(finalPath, 'utf8'));
        } catch {
          after = null;
        }
      }
    }

    // Honesty report: guard the null score explicitly — a missing key emits the
    // skip banner, NEVER a fabricated percent (T-06-05-05).
    const honestyReport =
      before === null
        ? renderHonestySkipped()
        : renderHonestyReport(before.aiProbability, after?.aiProbability ?? null, before.backend);

    // GATE-04: re-verify humanized FINAL.md before export (HARD block, BEFORE runDoneGate).
    // Skip only when no humanizer ran (finalPath === null) — i.e. no humanized artifact exists.
    // --yolo NEVER bypasses this gate (per PRD §14 non-negotiable: verifier gates are unconditional).
    // --yolo belongs ONLY on the advisory runDoneGate (DONE-09) confirmation below.
    let finalMd: string | null = null;
    if (finalPath !== null) {
      finalMd = readFileSync(finalPath, 'utf8');
      if (isPlaceholderText(finalMd)) {
        process.stdout.write('pensmith done: BLOCKED — the humanized FINAL.md is placeholder text (PENSMITH_NO_LLM), not a paper.\n');
        process.exitCode = EXIT_REFUSED;
        return { ok: false, blocked: true };
      }
      const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
      const gate4 = await reCheckFinalMd(finalMd, draftMd, bibPath);
      if (!gate4.passed) {
        process.stdout.write(
          `pensmith done: GATE-04 BLOCKED — FINAL.md failed re-verification: ${gate4.reason}\n`,
        );
        process.exitCode = EXIT_REFUSED;
        return { ok: false };
      }
      // FINAL.md is what is exported, so its citations are checked as well
      // (reCheckFinalMd has just run Pass 3 on it). It cites exactly the works
      // DRAFT.md cites, so its warnings are the ones already printed. The
      // sections are read again: one edited since the gate is checked as it is now.
      const finalCheck = await recheckExportText(paperRoot, finalMd, { pass3: false, label: '.paper/FINAL.md', bibText });
      if (finalCheck.blocked) {
        return refuseExport('export refused (a citation in the humanized FINAL.md does not pass when checked again)', finalCheck.reasons);
      }
    }

    // 6. DONE-09 export-confirmation gate. Pass-2 UNSUPPORTED is read from the
    //    section VERIFICATION.md files (the load-bearing disk→gate feed, HIGH-3).
    const pass2Results = readSectionUnsupported(paperRoot);

    // With no terminal there is nobody to ask. Report the pending decision and
    // stop; never read stdin for it and never treat silence as a yes.
    if (args.yolo !== true && !canAskInTerminal()) {
      const issues = collectGateIssues({ pass2Results, pass4Results, plagiarismResults });
      process.stderr.write(
        'pensmith done: exporting needs your confirmation and there is no terminal to ask in. Nothing was exported.\n',
      );
      const source = finalPath !== null ? '.paper/FINAL.md' : '.paper/DRAFT.md';
      process.stdout.write(`${JSON.stringify(pendingExportDecision(issues, format, source))}\n`);
      process.exitCode = EXIT_NEEDS_ANSWER;
      return { ok: false, pending: true };
    }

    const gateResult = await runDoneGate({
      pass2Results,
      pass4Results,
      plagiarismResults,
      yolo: args.yolo === true,
      approve: () => confirmOrNo(EXPORT_CONFIRM_QUESTION),
    });

    if (gateResult.exported === false && gateResult.gateSkipped !== true) {
      process.stdout.write('pensmith done: export cancelled by user.\n');
      process.exitCode = EXIT_REFUSED;
      return { ok: false };
    }

    // 7. DONE-06/07/08 exportDraft into the exporter's DISTINCT export dir.

    // The user's chosen citation style, else the discipline preset.
    const citation = resolveCitationStyle(paperRoot);
    if (citation.warning) process.stderr.write(`pensmith done: WARN — ${citation.warning}\n`);

    let result: Awaited<ReturnType<typeof exportDraft>>;
    try {
      result = await exportDraft({
        inputPath: finalPath ?? draftPath,
        markdown: finalMd ?? draftMd,
        bibText,
        format,
        paperRoot,
        pandocPresent: pandoc,
        style: citation.style,
      });
    } catch (err) {
      if (!(err instanceof ExportError)) throw err;
      process.stdout.write(`pensmith done: export failed — ${err.message} Nothing was exported.\n`);
      for (const d of err.details) process.stdout.write(`  ${d.replace(/\n/g, '\n  ')}\n`);
      // A tool that crashed is an error; everything else is a refusal.
      process.exitCode = err.kind === 'tool-failed' ? EXIT_ERROR : EXIT_REFUSED;
      return { ok: false, exportFailed: err.kind };
    }

    // Write the whole-paper VERIFICATION.md (a SOURCE artifact, not the export dir).
    const verificationPath = join(paperDir(paperRoot), 'VERIFICATION.md');
    await atomicWriteFile(
      verificationPath,
      buildVerificationReport(honestyReport, plagiarismResults, pass4Results),
    );

    // Audit #15: the router's terminal sentinel is "DRAFT.md present AND FINAL.md
    // present" (router.ts:216-218). In Tier 2 there is no humanizer, so
    // runHumanizer returns null and FINAL.md is never written — bare `pensmith`/
    // next/resume then re-run the WHOLE export pipeline (and re-prompt the gate)
    // on every invocation, never reaching the {verb:'status',reason:'done'}
    // terminus. Mark completion by writing FINAL.md from the exported source when
    // it is absent: the humanized FINAL.md when a humanizer ran (already on disk),
    // otherwise the compiled draft (the manuscript is final, just not humanized).
    const finalMdPath = join(paperDir(paperRoot), 'FINAL.md');
    if (!existsSync(finalMdPath)) {
      await atomicWriteFile(finalMdPath, finalMd ?? draftMd);
    }

    process.stdout.write(`pensmith done: exported ${result.outputPath} (${citation.style} citations)\n`);
    if (requested === undefined && !pandoc) {
      process.stdout.write(
        'pensmith done: Pandoc is not installed, so the paper was exported as Markdown. Install Pandoc to get a .docx.\n',
      );
    }
    return { ok: true, ...result };
  },
});

export default doneCommand;
