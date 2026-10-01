// bin/cli/done.ts — `pensmith done` verb entrypoint (DONE-01 / DONE-03 / DONE-09;
// Phase 21 EXP-03, EXP-14..EXP-21).
//
// THIN ORCHESTRATOR — delegates to bin/lib/* (the export gate in done-gate.ts,
// the style in export-style.ts, plagiarism.ts, honesty.ts, humanizer.ts,
// verify/pass4.ts, exporter.ts). 'done' IS one of the locked UX-02 16 verbs
// (bin/lib/verbs.ts); `export`, `humanize`, `score` and `plagiarism` are
// ALIASES of its sub-steps (`done --only <step>`, rewritten before argv
// validation — EXP-21, D-21-23), never a 17th verb. The workflows/done.md body
// (Tier 1) delegates to this SAME bin/lib path.
//
// stdout-only through out() (no console.* — the MCP frame stays clean,
// PLUG-13); warnings go to stderr.
//
// The run (draft mode, 21-PLAN §3.2):
//   flags (`--format`, `--style` → resolveExportStyle, `--only`, the
//   `--no-verify --raw` rule; every violation EXIT_USAGE before anything runs)
//   → the blocking gate over DRAFT.md (VRFY-26/27; every --only runs it first)
//   → the non-TTY confirmation pre-check (an export run) → plagiarism (unless
//   skipped) → honesty before (unless skipped) → the humanizer (humanizer.ts;
//   a rejection is EXIT_BLOCKED, nothing exported, FINAL.md untouched; a
//   provider failure exports the compiled draft) → honesty after → whole-paper
//   Pass 4 (unless --no-verify) → the confirmation (UNSUPPORTED claims,
//   orphans, plagiarism hits, the contradictions COMPILE-REPORT flagged, the
//   accepted quotes) → exportDraft → last_verified and retraction statuses →
//   `.paper/VERIFICATION.md` → FINAL.md + DONE-RECORD.
//
// FINAL.md (EXP-15, D-21-19) is written ONCE per successful run, after the
// export and the paper-level VERIFICATION.md: the accepted humanized text,
// else the compiled draft. It is never replaced before that, so a refused,
// declined, failed or capped done leaves it byte-identical.
//
// DONE-09 export-confirmation gate is the SOLE escape valve reconciling the
// Core Value ("every citation supports its claim") with VRFY-07 (advisory Pass
// 2/4 never auto-block). The gate ALWAYS prompts (generic confirm even when
// clean — PRD §7.9), shows a per-issue summary when UNSUPPORTED / orphan /
// plagiarism / contradiction issues exist, and ONLY --yolo skips it.
//
// Exports go to the exporter's DISTINCT export dir (default `.paper/export/`) —
// done.ts MUST NOT pass `outputDir=paperDir(paperRoot)`, so the md export
// never overwrites the source DRAFT.md. The export is always named after the
// compiled draft (`export/DRAFT.<ext>`), whichever text it holds. Under
// --dry-run the export dir is `.paper-dry-run/export/` and the file is
// `DRAFT.dry-run.<ext>` (GRND-19); done prints that path and says it is a
// dry-run export.

import { defineCommand } from 'citty';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { runPass4, renderPass4Section, type Pass4Result } from '../lib/verify/pass4.js';
import { type Pass2Result } from '../lib/verify/pass2.js';
import { runPlagiarism, renderPlagiarismSection, locationLabel, plagiarismCoverageLine, type PlagiarismResult } from '../lib/plagiarism.js';
import {
  measureHonesty,
  renderHonestySection,
  honestyLine,
  honestyFramingNote,
  type HonestyOutcome,
  type HonestyNotApplicable,
} from '../lib/honesty.js';
import { exportDraft, exportedFormats, exportPathFor, type ExportFormat } from '../lib/exporter.js';
import { humanizerSkillSearchDescription, paperDir, projectRoot } from '../lib/paths.js';
import { resolveExportStyle, type ExportStyle } from '../lib/export-style.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { runGate, declineGate, canPrompt } from '../lib/gates.js';
import { EXIT_BLOCKED, EXIT_ERROR, EXIT_USAGE, PensmithError } from '../lib/exit-codes.js';
import { offlineMarkerLine, networkMode } from '../lib/http-mock.js';
import { sectionRegistryProblem } from '../lib/section-registry.js';
import { compileRecordProblems, fileSha256, readCompileInputs } from '../lib/compile-inputs.js';
import { assertCslStyleApproved } from '../lib/style-approvals.js';
import { assertDoneRecordWritable, clearExportRefusal, clearHumanizeRejection, editedFinalReason, EXPORT_REFUSED_FILE, finalMdState, FINAL_REJECTED_FILE, readDoneRecord, writeDoneRecord, writeExportRefusal, writeHumanizeRejection } from '../lib/done-record.js';
import { scanExportText, ZeroTraceError } from '../lib/export/zero-trace.js';
import { loadBibliography, type AcceptedQuote, type ByoQuote, type GateResult, type LoadedBibliography } from '../lib/verify/gate.js';
import { renderSummaryTable, summaryRows } from '../lib/verify/verification-md.js';
import { recordLastVerified, recordRetractionStatuses, LibraryNotFoundError } from '../lib/library.js';
import { out as writeOut } from '../lib/output-sink.js';
import { isOutlinePaper, runOutlineDone } from '../lib/outline-export.js';
import { readPaperConfigSync, tryReadPaperConfigSync } from '../lib/config.js';
import { readReportContradictions } from '../lib/compile-report.js';
import { acceptHumanized, humanizeDraft, loadHumanizerSkill } from '../lib/humanizer.js';
import { rejudgeRewrittenClaims } from '../lib/rewritten-claims.js';
import { modelStepSkipReason } from '../lib/rewrite-guard.js';
import { assertLlmConfigured, complete, isFatalLlmError, MissingApiKeyError, RuntimeConfigError } from '../lib/anthropic.js';
import {
  doneSections,
  runExportBlockingGate,
  recheckUnknownRetractions,
  recomputeExportGate,
  readUnsupportedClaims,
  unjudgedClaimSections,
  unjudgedLine,
  type DoneSection,
  type UnsupportedClaim,
  type UnjudgedSection,
} from '../lib/done-gate.js';

// ---------------------------------------------------------------------------
// DONE-09 gate-issue collection
// ---------------------------------------------------------------------------

export interface GateIssues {
  /** Pass-2 rows whose verdict is UNSUPPORTED. */
  unsupported: Pass2Result[];
  /** Pass-4 paragraphs carrying at least one HIGH-confidence orphan claim. */
  orphanClaims: Pass4Result[];
  /** Plagiarism results that returned at least one match URL. */
  plagiarismHits: PlagiarismResult[];
  /** What the plagiarism check could not check (plagiarismCoverageLine), when a query got no answer. */
  plagiarismCoverage?: string;
  /** True iff ANY of the buckets is non-empty (an incomplete plagiarism check included). */
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
  const coverage = plagiarismCoverageLine(input.plagiarismResults ?? []);
  const hasIssues =
    unsupported.length > 0 || orphanClaims.length > 0 || plagiarismHits.length > 0 || coverage !== null;
  return { unsupported, orphanClaims, plagiarismHits, ...(coverage !== null ? { plagiarismCoverage: coverage } : {}), hasIssues };
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
  writeOut('pensmith done: advisory issues found before export (DONE-09):\n');
  if (issues.unsupported.length > 0) {
    const sample = issues.unsupported
      .slice(0, 3)
      .map((r) => r.citekey)
      .join(', ');
    writeOut(
      `  - ${issues.unsupported.length} UNSUPPORTED claim(s) (Pass 2): ${sample}\n`,
    );
  }
  if (issues.orphanClaims.length > 0) {
    const total = issues.orphanClaims.reduce((sum, r) => sum + r.orphanCount, 0);
    writeOut(
      `  - ${total} orphan claim(s) across ${issues.orphanClaims.length} paragraph(s) (Pass 4)\n`,
    );
    // VRFY-23: name the uncited claims themselves (the first few).
    const sentences = issues.orphanClaims.flatMap((r) => r.orphans ?? []);
    for (const o of sentences.slice(0, 5)) writeOut(`      uncited: "${cell(o, 160)}"\n`);
    if (sentences.length > 5) writeOut(`      … and ${sentences.length - 5} more (see .paper/VERIFICATION.md)\n`);
  }
  if (issues.plagiarismCoverage !== undefined) writeOut(`  - plagiarism check ${issues.plagiarismCoverage}\n`);
  if (issues.plagiarismHits.length > 0) {
    writeOut(
      `  - ${issues.plagiarismHits.length} distinctive phrase(s) found verbatim on the web (plagiarism):\n`,
    );
    for (const r of issues.plagiarismHits.slice(0, 5)) {
      writeOut(`      ${locationLabel(r.location)} "${cell(r.phrase, 80)}" — ${r.matches.slice(0, 2).join(', ')}\n`);
    }
    if (issues.plagiarismHits.length > 5) writeOut(`      … and ${issues.plagiarismHits.length - 5} more (see .paper/VERIFICATION.md)\n`);
  }
  writeOut('These are advisory only — review before confirming export.\n');
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
 * Run the whole-paper Pass 4 orphan audit (DONE-01, VRFY-23) over `text` — the
 * exact text done exports (the accepted humanized text, else the compiled
 * DRAFT.md) — or, without it, the compiled `.paper/DRAFT.md` (a missing draft
 * yields []; the caller surfaces the missing-draft error separately). runPass4
 * is deterministic and offline under PENSMITH_NO_LLM=1 (CI path). Never throws.
 */
export async function runWholePaperPass4(paperRoot: string, text?: string): Promise<Pass4Result[]> {
  let draftMd: string;
  if (text !== undefined) draftMd = text;
  else {
    try {
      draftMd = readFileSync(join(paperDir(paperRoot), 'DRAFT.md'), 'utf8');
    } catch {
      return [];
    }
  }
  try {
    return await runPass4(draftMd, { n: 0 });
  } catch {
    // Advisory — a Pass-4 failure must never crash the export.
    return [];
  }
}

// ---------------------------------------------------------------------------
// The export gate helpers (moved to bin/lib/done-gate.ts in Phase 21 so the
// Tier-1 tools and compile's report call the same code; re-exported here for
// every existing importer — 21-PLAN §3.3).
// ---------------------------------------------------------------------------

export {
  doneSections,
  runExportBlockingGate,
  exportAcceptanceSets,
  recomputeExportGate,
  sectionQuoteIndex,
  citedKeySetChange,
  readUnsupportedClaims,
  unjudgedClaimSections,
  readSectionAdvisory,
  unjudgedLine,
  recheckUnknownRetractions,
  type RetractionRecheck,
  type ExportBlock,
  type DoneSection,
  type UnsupportedClaim,
  type UnjudgedSection,
  type SectionAdvisory,
} from '../lib/done-gate.js';

// ---------------------------------------------------------------------------
// Flags (EXP-21, D-21-23)
// ---------------------------------------------------------------------------

/** A sub-step `--only` runs (and the alias that names it: `pensmith export` = `done --only export`). */
export type DoneStep = 'export' | 'humanize' | 'score' | 'plagiarism';

/** The steps `--only` accepts, in the order done runs them. */
export const DONE_ONLY_STEPS: readonly DoneStep[] = ['export', 'humanize', 'score', 'plagiarism'];

/** How `--format` errors name what it accepts. */
export const DONE_FORMAT_CHOICES = 'md, docx, pdf, latex (tex)';

/** PRD §7.9: `--no-verify` refuses to combine with `--raw` without `--yolo`. */
export const NO_VERIFY_RAW_REFUSAL =
  'pensmith done: --no-verify cannot be combined with --raw without --yolo (PRD §7.9): together they skip both the whole-paper ' +
  'verify pass and the humanizer — drop one of them, or pass --yolo to accept that (the blocking citation gate still runs)';

function usageError(message: string): PensmithError {
  return new PensmithError(message, EXIT_USAGE);
}

/** `--format`: md, docx, pdf, latex or tex (an alias of latex); anything else is EXIT_USAGE listing them. */
export function parseDoneFormat(raw: unknown): ExportFormat {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (v === 'md' || v === 'docx' || v === 'pdf' || v === 'latex') return v;
  if (v === 'tex') return 'latex';
  throw usageError(`pensmith done: unknown --format '${String(raw)}' — use one of ${DONE_FORMAT_CHOICES}`);
}

/** `--only`: one of DONE_ONLY_STEPS, or null when absent; anything else is EXIT_USAGE listing them. */
export function parseDoneOnly(raw: unknown): DoneStep | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if ((DONE_ONLY_STEPS as readonly string[]).includes(v)) return v as DoneStep;
  throw usageError(`pensmith done: unknown --only step '${String(raw)}' — use one of ${DONE_ONLY_STEPS.join(', ')}`);
}

/** done's validated flags. */
export interface DoneFlags {
  readonly format: ExportFormat;
  readonly only: DoneStep | null;
  readonly style: string | undefined;
  readonly yolo: boolean;
  readonly raw: boolean;
  /** `--no-verify`: skip the whole-paper Pass 4 (never the blocking gate). */
  readonly noVerify: boolean;
  /** `--no-score`. */
  readonly noScore: boolean;
  /** `--no-plagiarism-check`. */
  readonly noPlagiarismCheck: boolean;
}

/**
 * Validate done's flags (EXIT_USAGE before anything is read or sent): the
 * format, the step, `--no-verify --raw` without `--yolo` (PRD §7.9), and a
 * step that its own skip flag would cancel (`--only score --no-score`).
 */
export function checkDoneFlags(args: Record<string, unknown>): DoneFlags {
  const flags: DoneFlags = {
    format: parseDoneFormat(args['format'] ?? 'docx'),
    only: parseDoneOnly(args['only']),
    style: typeof args['style'] === 'string' && args['style'].trim().length > 0 ? args['style'] : undefined,
    yolo: args['yolo'] === true,
    raw: args['raw'] === true,
    noVerify: args['verify'] === false,
    noScore: args['score'] === false,
    noPlagiarismCheck: args['plagiarism-check'] === false || args['plagiarismCheck'] === false,
  };
  if (flags.noVerify && flags.raw && !flags.yolo) throw usageError(NO_VERIFY_RAW_REFUSAL);
  const cancelled =
    flags.only === 'score' && flags.noScore ? '--no-score'
      : flags.only === 'plagiarism' && flags.noPlagiarismCheck ? '--no-plagiarism-check'
        : flags.only === 'humanize' && flags.raw ? '--raw'
          : null;
  if (cancelled !== null) {
    throw usageError(`pensmith done: --only ${flags.only ?? ''} cannot be combined with ${cancelled}, which skips that step`);
  }
  return flags;
}

// ---------------------------------------------------------------------------
// The paper-level record (`.paper/VERIFICATION.md`)
// ---------------------------------------------------------------------------

/** One recorded decision on an UNSUPPORTED claim (VRFY-22). */
export interface ClaimDecision {
  readonly claim: UnsupportedClaim;
  /** `Confirmed by user <ISO>` or `Auto-accepted under --yolo <ISO>`. */
  readonly decision: string;
}

/** A table cell: one line, no pipes, at most `max` characters. */
function cell(s: string, max: number): string {
  const flat = s.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export interface PaperVerificationReport {
  /** The file whose bytes the gate judged (`.paper/FINAL.md` or `.paper/DRAFT.md`) and their sha256. */
  readonly checkedFile: string;
  readonly checkedSha256: string;
  readonly gate: GateResult;
  readonly decisions: readonly ClaimDecision[];
  /** Sections whose current draft Pass 2 did not judge (named, never decided). */
  readonly unjudged?: readonly UnjudgedSection[];
  readonly accepted: readonly AcceptedQuote[];
  readonly byoQuotes: readonly ByoQuote[];
  /** The `## Honesty` body (honesty.ts renderHonestySection). */
  readonly honestyReport: string;
  readonly plagiarismResults: readonly PlagiarismResult[];
  /** Why the plagiarism check did not run (`--no-plagiarism-check`, `config`, `offline`, `dry-run`, `--only export`). */
  readonly plagiarismSkipped?: string;
  readonly pass4Results: readonly Pass4Result[];
  /** Why the whole-paper Pass 4 did not run (`--no-verify`). */
  readonly pass4Skipped?: string;
}

/**
 * Build the whole-paper `.paper/VERIFICATION.md` (a SOURCE artifact, NOT
 * written into the distinct export dir; D-20-24): the recomputed gate's
 * summary over the exported text, the decisions on UNSUPPORTED claims
 * (VRFY-22), the accepted quotes and the quotes verified against the user's
 * own files, the honesty and plagiarism checks, and the per-paragraph Pass-4
 * audit of the exported text (VRFY-23). done never writes under sections/.
 */
export function buildVerificationReport(r: PaperVerificationReport): string {
  // D-17-08: an offline run's report carries the marker as its first line (the
  // export never does — exporters read the gated text, not this file).
  const offlineMarker = offlineMarkerLine();
  const decisions = r.decisions.length
    ? [
        '| Section | Row | Claim | Decision |',
        '|---------|-----|-------|----------|',
        ...r.decisions.map(
          (d) =>
            `| §${d.claim.section} (${d.claim.slug}) | ${d.claim.rewritten === true ? 'humanized text' : d.claim.row > 0 ? `Pass-2 row ${d.claim.row}` : 'Pass-2 table'} [@${cell(d.claim.result.citekey, 60)}] | ${cell(d.claim.result.claimSentence, 160)} | ${d.decision} |`,
        ),
      ]
    : ['_(no UNSUPPORTED claims to decide)_'];
  const unjudged = (r.unjudged ?? []).map((u) => `- ${unjudgedLine(u)}`);
  const accepted = r.accepted.length
    ? [
        '| Quote | Citekey | Section | Accepted | Via |',
        '|-------|---------|---------|----------|-----|',
        ...r.accepted.map((a) => `| ${a.id} "${cell(a.excerpt, 80)}" | ${a.citekey} | ${a.section !== undefined ? `§${a.section}` : '—'} | ${a.acceptedAt} | ${a.via === 'flag' ? '--accept-quote' : 'prompt'} |`),
      ]
    : ['_(no quotes accepted without a source check)_'];
  const local = r.byoQuotes.length
    ? r.byoQuotes.map((q) => `- ${q.id} [@${q.citekey}] "${cell(q.snippet, 60)}…" — verified against your local file ${q.localFile}`)
    : ['_(no quotes verified against your own files)_'];
  const pass4 =
    r.pass4Skipped !== undefined
      ? `## Pass-4 (orphan claims, advisory)\n\nwhole-paper Pass 4 skipped (${r.pass4Skipped}) — the blocking re-verification above still ran\n`
      : renderPass4Section(r.pass4Results);
  return [
    ...(offlineMarker !== null ? [offlineMarker, ''] : []),
    '# Paper Verification (done)',
    '',
    '## Gate',
    '',
    `Text checked: ${r.checkedFile} (sha256 ${r.checkedSha256})`,
    '',
    renderSummaryTable(summaryRows({ rows: r.gate.rows })),
    '',
    '## Decisions',
    '',
    ...decisions,
    '',
    ...(unjudged.length > 0 ? [...unjudged, ''] : []),
    '## Accepted quotes',
    '',
    ...accepted,
    '',
    '## Quotes verified against your files',
    '',
    ...local,
    '',
    '## Honesty (DONE-04)',
    '',
    r.honestyReport,
    '',
    renderPlagiarismSection([...r.plagiarismResults], r.plagiarismSkipped !== undefined ? { skipped: r.plagiarismSkipped } : {}),
    '',
    pass4,
    '',
  ].join('\n');
}

/** The contradictions compile flagged (COMPILE-REPORT.md `## Contradictions`, EXP-11). Never throws. */
function compiledContradictions(paperRoot: string): { count: number; lines: string[] } {
  try {
    return readReportContradictions(readFileSync(join(paperDir(paperRoot), 'COMPILE-REPORT.md'), 'utf8'));
  } catch {
    return { count: 0, lines: [] };
  }
}

/** Print the UNSUPPORTED claims with their evidence, the sections Pass 2 did not judge, the contradictions, the accepted quotes and the local-file quotes (the confirmation's list). */
function writeExportFindings(
  claims: readonly UnsupportedClaim[],
  accepted: readonly AcceptedQuote[],
  byoQuotes: readonly ByoQuote[],
  unjudged: readonly UnjudgedSection[] = [],
  contradictions: { count: number; lines: readonly string[] } = { count: 0, lines: [] },
): void {
  for (const u of unjudged) writeOut(`pensmith done: ${unjudgedLine(u)}\n`);
  if (claims.length > 0) {
    writeOut(`pensmith done: ${claims.length} claim(s) Pass 2 judged UNSUPPORTED by the cited source (VRFY-22):\n`);
    for (const c of claims) {
      writeOut(`  - §${c.section}${c.rewritten === true ? ' (humanized)' : ''} [@${c.result.citekey}] "${cell(c.result.claimSentence, 160)}" — ${cell(c.result.rationale, 200)}\n`);
      writeOut(`      evidence: ${c.result.evidence.trim().length > 0 ? `"${cell(c.result.evidence, 200)}"` : '(none quoted)'}\n`);
    }
  }
  if (contradictions.count > 0) {
    writeOut(`pensmith done: Contradictions flagged at compile: ${contradictions.count} (target 0) — see .paper/COMPILE-REPORT.md (EXP-11):\n`);
    for (const l of contradictions.lines.slice(0, 10)) writeOut(`  - ${cell(l, 400)}\n`);
  }
  for (const a of accepted) {
    writeOut(`  - accepted without a source check: ${a.section !== undefined ? `§${a.section} ` : ''}${a.id} [@${a.citekey}] "${cell(a.excerpt, 80)}" (${a.acceptedAt})\n`);
  }
  for (const q of byoQuotes) {
    writeOut(`  - ${q.id} [@${q.citekey}] "${cell(q.snippet, 60)}…" verified against your local file ${q.localFile}\n`);
  }
}

// ---------------------------------------------------------------------------
// The humanizer step (EXP-14, D-21-18)
// ---------------------------------------------------------------------------

/** What the humanizer step did. */
export type HumanizeStep =
  /** The accepted humanized text and the gate core's result over its bytes. */
  | { readonly kind: 'humanized'; readonly text: string; readonly gate: GateResult }
  /** Not run: the line done printed and the after-score's `N/A (…)` reason. */
  | { readonly kind: 'skipped'; readonly line: string; readonly after: string }
  /** The model call failed (not the cost cap): done exports the compiled draft. */
  | { readonly kind: 'failed'; readonly reason: string }
  /** The rewrite guard, the cited-key diff or the gate core refused the text: EXIT_BLOCKED. */
  | { readonly kind: 'rejected'; readonly reasons: readonly string[] };

/** Why the humanizer's model call cannot run now (the invocation's mode, or no usable model), or null. */
async function humanizerModelSkip(paperRoot: string): Promise<string | null> {
  const mode = await modelStepSkipReason(paperRoot);
  if (mode !== null) return mode;
  try {
    await assertLlmConfigured('done');
    return null;
  } catch (e) {
    if (e instanceof MissingApiKeyError || e instanceof RuntimeConfigError) return 'no model configured';
    throw e;
  }
}

/**
 * Run the humanizer over the gated compiled draft (see the header): skipped
 * with its reason, failed (a provider error — the cost cap and the other fatal
 * errors propagate, exit 5), rejected with every reason, or the accepted text.
 * Writes nothing.
 */
export async function runHumanizeStep(input: {
  readonly paperRoot: string;
  readonly draft: string;
  readonly raw: boolean;
  readonly sections: readonly DoneSection[];
  readonly bib: LoadedBibliography;
  /** The section ids in the draft's `##` order (the COSTS/SESSION records). */
  readonly sectionIds?: readonly string[];
}): Promise<HumanizeStep> {
  if (input.raw) return { kind: 'skipped', line: 'humanizer skipped (--raw)', after: 'humanize skipped with --raw' };
  const config = tryReadPaperConfigSync(input.paperRoot);
  if (config?.humanizer?.enabled === false) {
    return { kind: 'skipped', line: 'humanizer skipped ([humanizer] enabled = false)', after: 'humanizer disabled' };
  }
  // A dry run sends nothing, whatever is installed: it says so first (done.md;
  // review round 2 — a missing skill used to be reported instead).
  if (networkMode().dryRun) return { kind: 'skipped', line: 'humanizer skipped (dry-run)', after: 'humanize skipped (dry-run)' };
  const skill = loadHumanizerSkill();
  if (skill === null) {
    return { kind: 'skipped', line: `humanizer skill not found (looked for ${humanizerSkillSearchDescription()}) — skipping`, after: 'humanizer not installed' };
  }
  const mode = await humanizerModelSkip(input.paperRoot);
  if (mode !== null) return { kind: 'skipped', line: `humanizer skipped (${mode})`, after: `humanize skipped (${mode})` };
  writeOut(`pensmith done: humanizer skill: ${skill.path}\n`);
  const quoteMinWords = config?.verification?.quote_min_words;
  const ids = input.sectionIds ?? [];
  let result;
  try {
    result = await humanizeDraft({
      draft: input.draft,
      skill,
      preserveVoice: config?.humanizer?.preserve_voice ?? 'academic',
      ...(quoteMinWords !== undefined ? { quoteMinWords } : {}),
      call: async (req, i) => {
        const res = await complete({ slug: req.slug, system: req.system, messages: req.messages, section: ids[i] ?? i + 1 });
        return res.text;
      },
    });
  } catch (e) {
    if (isFatalLlmError(e)) throw e;
    return { kind: 'failed', reason: ((e as Error).message ?? String(e)).split('\n')[0] ?? 'the model call failed' };
  }
  if (result.rejected.length > 0) return { kind: 'rejected', reasons: result.rejected };
  const accepted = await acceptHumanized({
    paperRoot: input.paperRoot,
    draft: input.draft,
    humanized: result.text,
    sections: input.sections,
    bib: input.bib,
    ...(quoteMinWords !== undefined ? { quoteMinWords } : {}),
  });
  if (!accepted.ok) return { kind: 'rejected', reasons: accepted.reasons };
  return { kind: 'humanized', text: result.text, gate: accepted.gate };
}

// ---------------------------------------------------------------------------
// The plagiarism step (EXP-19, EXP-20, D-21-22)
// ---------------------------------------------------------------------------

/** Why the plagiarism check sends nothing this run, or null when it runs. */
export function plagiarismSkipReason(paperRoot: string, noPlagiarismCheck: boolean): string | null {
  if (noPlagiarismCheck) return '--no-plagiarism-check';
  // Strict: a config.toml this build cannot read sends nothing (its
  // plagiarism_check = false may be the value it holds; done refuses the file first).
  let check: boolean | undefined;
  try {
    check = readPaperConfigSync(paperRoot).config.verification?.plagiarism_check;
  } catch {
    return 'config.toml cannot be read';
  }
  if (check === false) return 'config';
  const mode = networkMode();
  if (mode.dryRun) return 'dry-run';
  if (mode.sourcesOffline) return 'offline';
  return null;
}

/** The section ids in the order compile wrote their `##` headings (COMPILE-INPUTS.json), else the registered order. */
function compiledSectionIds(paperRoot: string, sections: readonly DoneSection[]): string[] {
  const recorded = readCompileInputs(paperRoot)?.sections.map((s) => s.id);
  return recorded !== undefined && recorded.length > 0 ? recorded : sections.map((s) => s.id);
}

/** Print the check's outcome: the phrases searched, and each verbatim match with its location. */
function writePlagiarismSummary(results: readonly PlagiarismResult[]): void {
  const hits = results.filter((r) => r.matches.length > 0);
  const failed = results.filter((r) => r.error !== undefined);
  writeOut(
    `pensmith done: plagiarism check: ${results.length} distinctive phrase(s) searched as exact quotes; ${hits.length} found verbatim on the web` +
      `${failed.length > 0 ? `; ${failed.length} query(ies) got no answer (${failed[0]?.error ?? ''})` : ''}\n`,
  );
  const coverage = plagiarismCoverageLine(results);
  if (coverage !== null) writeOut(`pensmith done: plagiarism check ${coverage}\n`);
  for (const r of hits) {
    writeOut(`  - ${locationLabel(r.location)} "${cell(r.phrase, 120)}"\n`);
    for (const u of r.matches) writeOut(`      ${u}\n`);
  }
}

// ---------------------------------------------------------------------------
// doneCommand — the thin orchestrator
// ---------------------------------------------------------------------------

const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

export const doneCommand = defineCommand({
  meta: {
    name: 'done',
    description:
      'Finalize the paper: re-verify, plagiarism check, honesty score, humanize, export (no metadata trace). ' +
      'Aliases: export, humanize, score, plagiarism (= done --only <step>).',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip the export confirmation gate (never the blocking citation gate, the cost cap or detector consent).',
      default: false,
    },
    format: {
      type: 'string',
      description: `Export format: ${DONE_FORMAT_CHOICES}.`,
      default: 'docx',
    },
    style: {
      type: 'string',
      description: 'Citation style: APA, MLA, Chicago (Notes-Bibliography), Chicago (Author-Date), IEEE, AMA, Vancouver, Harvard, or a path to a .csl file.',
    },
    raw: {
      type: 'boolean',
      description: 'Skip the humanizer step.',
      default: false,
    },
    verify: {
      type: 'boolean',
      description: 'Run the whole-paper Pass 4 audit.',
      negativeDescription: 'Skip the whole-paper Pass 4 audit (the blocking re-verification always runs).',
      default: true,
    },
    score: {
      type: 'boolean',
      description: 'Score the paper with the configured AI detector (consent asked once).',
      negativeDescription: 'Skip the AI-detector score.',
      default: true,
    },
    'plagiarism-check': {
      type: 'boolean',
      description: 'Search distinctive phrases as exact quotes (DuckDuckGo).',
      negativeDescription: 'Skip the plagiarism check (nothing is sent).',
      default: true,
    },
    only: {
      type: 'string',
      description: `Run one step after the blocking gate: ${DONE_ONLY_STEPS.join(' | ')}.`,
    },
  },
  async run({ args }) {
    // (0) Flags — EXIT_USAGE before anything is read, written or sent.
    const flags = checkDoneFlags(args as Record<string, unknown>);
    const paperRoot = projectRoot();
    const only = flags.only;
    // The paper's config.toml, read STRICTLY before any step (review round 1):
    // one bad value must never discard the whole file silently — the
    // plagiarism opt-out, the phrase cap and the detector backend live in it —
    // so a file this build cannot read is the one-line ConfigError (EXIT_ERROR)
    // for every done, `--only score` and `--only plagiarism` included.
    readPaperConfigSync(paperRoot);
    // GRND-11 (D-21-25): an outline-only paper ends in its outline export, after
    // the flag checks and in the resolved style: the Markdown pair always and
    // the --format pair (default docx) — a routed done and an explicit one
    // export the same (review round 2). There is no prose to humanize, score
    // or search, so those steps are named as skipped and write nothing.
    if (isOutlinePaper(paperRoot)) {
      if (only !== null && only !== 'export') {
        writeOut(`pensmith done: ${only} skipped (outline only — there is no prose; done exports the outline and the annotated bibliography)\n`);
        return { ok: true, outlineOnly: true };
      }
      const outlineStyle = await assertCslStyleApproved(paperRoot, resolveExportStyle(paperRoot, flags.style), warnLine);
      writeOut(`pensmith done: style: ${outlineStyle.name} (from ${outlineStyle.from})\n`);
      return runOutlineDone({ paperRoot, format: flags.format, style: outlineStyle.style, yolo: flags.yolo });
    }
    const exporting = only === null || only === 'export';
    const draftPath = join(paperDir(paperRoot), 'DRAFT.md');
    const finalMdPath = join(paperDir(paperRoot), 'FINAL.md');

    // EXP-03 (D-21-24): the style, resolved once with where it came from — an
    // unknown name or a bad .csl file is EXIT_USAGE here, before the gate.
    let style: ExportStyle | null = null;
    if (exporting) {
      // A .csl file config.toml names prints its own text in every citation
      // and reference: used only once this user approved it for this paper
      // (style-approvals.ts; review round 2) — before any step, and read only
      // after that approval (review round 3).
      style = await assertCslStyleApproved(paperRoot, resolveExportStyle(paperRoot, flags.style), warnLine);
      writeOut(`pensmith done: style: ${style.name} (from ${style.from})\n`);
    }
    if (flags.noVerify && exporting) {
      process.stderr.write(
        'pensmith done: WARN — --no-verify skips only the whole-paper Pass 4 audit; the blocking re-verification of every citation always runs\n',
      );
    }

    let draftMd: string;
    try {
      draftMd = readFileSync(draftPath, 'utf8');
    } catch {
      // RUN-09: no compiled draft because compile REFUSED (a section the
      // verifier blocked) is a refusal — EXIT_BLOCKED with the blocking
      // reasons, the same gate compile ran — not "run compile first", which
      // would only refuse again. A paper that genuinely has not reached compile
      // yet stays EXIT_ERROR.
      const gate = runExportBlockingGate(paperRoot);
      const refused = [...(gate.verdictReasons ?? []), ...(gate.recordedBlocks ?? [])];
      if (refused.length > 0) {
        writeOut(
          'pensmith done: BLOCKED — there is no compiled draft because compile refuses these sections:\n',
        );
        for (const r of refused) writeOut(`  - ${r}\n`);
        writeOut(
          "Fix the cited section(s) — re-run 'pensmith verify <N>' then 'pensmith compile' — and try again.\n",
        );
        return { ok: false, blocked: true, exitCode: EXIT_BLOCKED };
      }
      writeOut(
        `pensmith done: no compiled draft at ${draftPath} — run 'pensmith compile' first.\n`,
      );
      return { ok: false, exitCode: EXIT_ERROR };
    }

    // (1) UNCONDITIONAL export blocking gate (audit #3/#14, VRFY-26, VRFY-27,
    // D-20-24) — BEFORE any paid or third-party step, for EVERY done invocation
    // (explicit, an alias, bare /pensmith, next), whatever --raw, --yolo,
    // --no-verify or --only: the sections STATE.json and OUTLINE.md register
    // (never a directory listing), each verified for the draft it holds now;
    // the compiled DRAFT.md exactly as compile wrote it from those sections;
    // and the ONE gate core recomputed over the DRAFT.md bytes about to be
    // exported. Every reason is collected and listed.
    // A DONE-RECORD.json a newer pensmith wrote is never overwritten: a run
    // that would write the record (an export or --only humanize) refuses
    // before any paid or third-party step, not after its export.
    if (only === null || only === 'export' || only === 'humanize') assertDoneRecordWritable(paperRoot);
    const sections = doneSections(paperRoot);
    const blocking = runExportBlockingGate(paperRoot);
    const reasons = [...blocking.reasons];
    // FINAL.md is the file pensmith calls the finished paper. One done did not
    // leave — edited or written by hand — is never exported and never
    // replaced: refused, naming the remedy (done-record.ts).
    if (finalMdState(paperRoot) === 'edited') reasons.push(editedFinalReason(paperRoot));
    if (sectionRegistryProblem(paperRoot) === null && sections.length > 0) {
      const current = new Map(sections.map((s) => [s.id, s.verifiedHash]));
      reasons.push(...compileRecordProblems(paperRoot, sections.map((s) => s.identity), current));
    }
    // VRFY-15 (D-20-13): every cited source whose LIBRARY.json retraction
    // status is `unknown` is re-checked live, never from the cache: a
    // retraction found now blocks; the decided answers are recorded (through
    // the library writer) only once done exports — a refused done writes nothing.
    const rechecked = await recheckUnknownRetractions(paperRoot, draftMd);
    for (const r of rechecked.retracted) reasons.push(`.paper/DRAFT.md: ${r}`);
    const bib = loadBibliography(paperRoot);
    const draftGate = await recomputeExportGate(paperRoot, draftMd, { sections, bib, recheck: true });
    for (const r of draftGate.refusals) reasons.push(`.paper/DRAFT.md: ${r}`);
    if (reasons.length > 0) {
      writeOut(
        'pensmith done: BLOCKED — export refused (unresolved blocking citations, unverified or stale sections, a stale compiled draft, or a FINAL.md done did not write):\n',
      );
      for (const r of reasons) writeOut(`  - ${r}\n`);
      writeOut(
        "Fix the cited section(s) — re-run 'pensmith verify <N>' then 'pensmith compile' — and try again.\n",
      );
      return { ok: false, blocked: true, exitCode: EXIT_BLOCKED };
    }

    // Review round 3: the zero-trace author-content rule (a folder or home
    // path, a `.paper` path, a pensmith marker) is deterministic, so it runs
    // on the gated text NOW — before the plagiarism queries, the detector and
    // the paid humanizer — for every format (the exporter scans every written
    // file again). A refusal is kept for the router (EXPORT.refused.md): a
    // bare `pensmith` reports attention instead of repeating those steps.
    if (only === null || only === 'export' || only === 'humanize') {
      const trace = scanExportText(`${basename(paperDir(paperRoot))}/DRAFT.md`, draftMd, { paperRoot });
      if (trace.length > 0) {
        await writeExportRefusal(paperRoot, { compiledDraftSha256: sha(draftMd), reasons: trace.map((f) => `${f.file} ${f.finding}`), at: new Date().toISOString() });
        writeOut(
          `pensmith done: the compiled draft holds text no export may carry — nothing was sent or exported; the reasons are kept in ${basename(paperDir(paperRoot))}/${EXPORT_REFUSED_FILE} ` +
            '(remove it from the section draft, then `pensmith verify N` and `pensmith compile`)\n',
        );
        throw new ZeroTraceError(trace, []);
      }
      await clearExportRefusal(paperRoot);
    }

    const sectionIds = compiledSectionIds(paperRoot, sections);
    const honestyOpts = { paperRoot, yolo: flags.yolo, noScore: flags.noScore };

    // --only plagiarism (D-21-23): the gate, the check, the matches printed; nothing written.
    if (only === 'plagiarism') {
      const skip = plagiarismSkipReason(paperRoot, false);
      if (skip !== null) {
        writeOut(`pensmith done: plagiarism check skipped (${skip})\n`);
        return { ok: true, plagiarism: [] };
      }
      const results = await runPlagiarism(draftMd, { ...maxPhrasesOpt(paperRoot), sectionIds });
      writePlagiarismSummary(results);
      return { ok: true, plagiarism: results };
    }

    // --only score: the gate, the before score (the consent rules apply) printed; nothing written.
    if (only === 'score') {
      const score = await measureHonesty(draftMd, honestyOpts);
      writeOut(`Pensmith honesty check: ${honestyLine(score)}\n\n${honestyFramingNote()}\n`);
      return { ok: true, honesty: score };
    }

    // The UNSUPPORTED claims of the registered sections (VRFY-22): with any,
    // the confirmation is the `unsupported-claims` gate, else `export-confirm`.
    let claims = readUnsupportedClaims(paperRoot, sections);
    const unjudged = unjudgedClaimSections(paperRoot, sections);
    const contradictions = compiledContradictions(paperRoot);
    let confirmGate: 'unsupported-claims' | 'export-confirm' = claims.length > 0 ? 'unsupported-claims' : 'export-confirm';

    // RUN-09 / RUN-28: the export confirmation needs an answer. Without a
    // terminal (and without --yolo) refuse NOW — EXIT_APPROVAL, before the
    // plagiarism / detector / humanizer work — instead of after it, listing
    // what the answer is about first.
    if (exporting && !flags.yolo && !canPrompt()) {
      writeExportFindings(claims, draftGate.gate.accepted, draftGate.gate.byoQuotes, unjudged, contradictions);
      await runGate(confirmGate, { yolo: false, detail: 'nothing was exported' });
    }

    // (2) DONE-02 plagiarism (EXP-19), DONE-04 honesty before the humanizer (EXP-16).
    let plagiarismResults: PlagiarismResult[] = [];
    let plagiarismSkipped: string | undefined;
    let before: HonestyOutcome | null = null;
    if (only === null) {
      const skip = plagiarismSkipReason(paperRoot, flags.noPlagiarismCheck);
      if (skip !== null) {
        plagiarismSkipped = skip;
        writeOut(`pensmith done: plagiarism check skipped (${skip})\n`);
      } else {
        plagiarismResults = await runPlagiarism(draftMd, { ...maxPhrasesOpt(paperRoot), sectionIds });
        writePlagiarismSummary(plagiarismResults);
      }
      before = await measureHonesty(draftMd, honestyOpts);
    } else {
      plagiarismSkipped = `--only ${only}`;
    }

    // (3) DONE-03 / EXP-14: the humanizer (a full run and --only humanize).
    // `--only export` exports FINAL.md when it is done's own and current —
    // re-gated through the same acceptance function — else the compiled draft.
    let exportedText = draftMd;
    let exportGate = draftGate.gate;
    let humanized = false;
    let after: HonestyOutcome | HonestyNotApplicable = { kind: 'na', reason: 'humanize skipped' };
    if (only === null || only === 'humanize') {
      const step = await runHumanizeStep({ paperRoot, draft: draftMd, raw: flags.raw, sections, bib, sectionIds });
      if (step.kind === 'rejected') {
        writeOut('pensmith done: GATE-04 BLOCKED — the humanized text failed re-verification; nothing was exported and FINAL.md was not changed:\n');
        for (const r of step.reasons) writeOut(`  - ${r}\n`);
        // Kept for the router (review round 2): a bare `pensmith` reports
        // attention instead of billing the humanizer again for the same draft.
        await writeHumanizeRejection(paperRoot, { compiledDraftSha256: sha(draftMd), reasons: step.reasons, at: new Date().toISOString() });
        writeOut(
          `pensmith done: the reasons are kept in ${basename(paperDir(paperRoot))}/${FINAL_REJECTED_FILE}; \`pensmith done --raw\` exports the compiled draft without the humanizer, ` +
            '`pensmith done` asks the humanizer again.\n',
        );
        return { ok: false, blocked: true, exitCode: EXIT_BLOCKED };
      }
      if (step.kind === 'skipped') {
        writeOut(`pensmith done: ${step.line}\n`);
        after = { kind: 'na', reason: step.after };
      } else if (step.kind === 'failed') {
        writeOut(`pensmith done: humanizer failed: ${step.reason}${only === null ? ' — exporting the compiled draft' : ''}\n`);
        after = { kind: 'na', reason: `humanizer failed: ${step.reason}` };
        if (only === 'humanize') return { ok: false, exitCode: EXIT_ERROR };
      } else {
        exportedText = step.text;
        exportGate = step.gate;
        humanized = true;
        writeOut('pensmith done: humanizer: the improved text kept every heading, citation and quote and passed re-verification\n');
        if (before !== null) {
          after = before.kind === 'score' ? await measureHonesty(exportedText, { ...honestyOpts, consentGranted: true }) : before;
        }
      }
      if (only === 'humanize') {
        if (!humanized) return { ok: true, humanized: false };
        // D-21-19: FINAL.md is the finished paper; an export is a rendering of it.
        // Not exported yet (DONE-RECORD `exported: false`): the router names
        // `pensmith export` until an export renders this FINAL.md. The record
        // is written FIRST and names the FINAL.md it replaces (v4, review
        // round 2): a stop before FINAL.md is written leaves done's own
        // earlier text (`stale`), never one the router calls edited by hand.
        const previous = finalMdState(paperRoot) === 'absent' ? '' : fileSha256(finalMdPath);
        await writeDoneRecord(paperRoot, {
          doneAt: new Date().toISOString(),
          compiledDraftSha256: sha(draftMd),
          finalSha256: sha(exportedText),
          humanized: true,
          exported: false,
          ...(previous !== '' ? { previousFinalSha256: previous } : {}),
        });
        await atomicWriteFile(finalMdPath, exportedText);
        await clearHumanizeRejection(paperRoot);
        writeOut('pensmith done: wrote .paper/FINAL.md (humanized; `pensmith export` renders it)\n');
        return { ok: true, humanized: true };
      }
    } else if (finalMdState(paperRoot) === 'current' || finalMdState(paperRoot) === 'unexported') {
      // --only export of done's own, current FINAL.md (D-21-23) — the humanized
      // text `pensmith humanize` wrote included.
      let finalMd: string | null = null;
      try {
        finalMd = readFileSync(finalMdPath, 'utf8');
      } catch {
        finalMd = null;
      }
      if (finalMd !== null && finalMd !== draftMd) {
        const regate = await acceptHumanized({ paperRoot, draft: draftMd, humanized: finalMd, sections, bib, ...quoteFloor(paperRoot) });
        if (!regate.ok) {
          writeOut('pensmith done: GATE-04 BLOCKED — .paper/FINAL.md failed re-verification; nothing was exported:\n');
          for (const r of regate.reasons) writeOut(`  - ${r}\n`);
          writeOut('pensmith done: `pensmith done` re-humanizes the compiled draft; `pensmith done --raw` exports it without the humanizer.\n');
          return { ok: false, blocked: true, exitCode: EXIT_BLOCKED };
        }
        exportedText = finalMd;
        exportGate = regate.gate;
        humanized = readDoneRecord(paperRoot)?.humanized ?? true;
      }
    }
    // Review round 3: a humanized text's changed cited sentences are judged
    // again (Pass 2, advisory) — the confirmation lists what the export says,
    // never only the section records' verdicts on the sentences it replaced.
    if (exportedText !== draftMd) {
      const rejudged = await rejudgeRewrittenClaims({ paperRoot, compiled: draftMd, text: exportedText, claims, bib, sections, sectionIds });
      if (rejudged.changedPairs > 0) {
        writeOut(
          `pensmith done: claim support (Pass 2, advisory) re-judged ${rejudged.changedPairs} citing sentence(s) the humanizer changed — ` +
            `${rejudged.claims.filter((c) => c.rewritten === true).length} UNSUPPORTED\n`,
        );
      }
      claims = rejudged.claims;
      confirmGate = claims.length > 0 ? 'unsupported-claims' : 'export-confirm';
    }
    const honestyReport =
      before !== null ? renderHonestySection(before, after) : `Pensmith honesty check: skipped (--only ${only ?? 'export'})\n\n${honestyFramingNote()}`;
    if (before !== null) writeOut(`${renderHonestySection(before, after)}\n`);

    // Whole-paper Pass 4 (DONE-01, VRFY-23) over the exact text to be exported, unless --no-verify.
    const pass4Results = flags.noVerify ? [] : await runWholePaperPass4(paperRoot, exportedText);

    // (4) The confirmation: every UNSUPPORTED claim with its evidence, the
    // orphans, the plagiarism hits, the contradictions, the accepted quotes and
    // the quotes verified against the user's own files; then
    // `unsupported-claims` (VRFY-22) or `export-confirm` (DONE-09). --yolo answers either.
    writeExportFindings(claims, exportGate.accepted, exportGate.byoQuotes, unjudged, contradictions);
    if (flags.yolo) {
      const issues = collectGateIssues({ pass2Results: claims.map((c) => c.result), pass4Results, plagiarismResults });
      if (issues.orphanClaims.length > 0 || issues.plagiarismHits.length > 0 || issues.plagiarismCoverage !== undefined) writeGateSummary(issues);
    }
    const gateResult = await runDoneGate({
      pass2Results: claims.map((c) => c.result),
      pass4Results,
      plagiarismResults,
      yolo: flags.yolo,
      // The registry gate (RUN-28). --yolo is handled by runDoneGate; a run that
      // cannot prompt refuses (EXIT_APPROVAL).
      approve: async () => {
        const outcome = await runGate(confirmGate, {
          yolo: false,
          question: {
            id: confirmGate,
            kind: 'confirm',
            label: confirmGate === 'unsupported-claims' ? 'Export the paper with these UNSUPPORTED claims?' : 'Export the paper?',
            default: confirmGate !== 'unsupported-claims',
          },
        });
        return outcome.kind === 'answered' && outcome.answer.kind === 'confirm' && outcome.answer.value === true;
      },
    });
    if (gateResult.exported === false && gateResult.gateSkipped !== true) {
      // An explicit "no" is the gate's decline: EXIT_APPROVAL, nothing exported.
      declineGate(confirmGate, claims.length > 0 ? 'export cancelled — the UNSUPPORTED claims were not accepted' : 'export cancelled by user');
    }
    const decidedAt = new Date().toISOString();
    const decisions: ClaimDecision[] = claims.map((claim) => ({
      claim,
      decision: gateResult.gateSkipped === true ? `Auto-accepted under --yolo ${decidedAt}` : `Confirmed by user ${decidedAt}`,
    }));

    // (5) DONE-06/07/08 exportDraft into the exporter's DISTINCT export dir
    // (outputDir UNSET). VRFY-26: the export is EXACTLY the text the gate
    // judged and the bibliography the gate read — never the files read again
    // after the plagiarism queries, the humanizer, the detector or the
    // confirmation. It is named after the compiled draft (`DRAFT.<ext>`).
    const result = await exportDraft({
      inputPath: draftPath,
      text: exportedText,
      ...(bib.text !== undefined ? { bibText: bib.text } : {}),
      format: flags.format,
      paperRoot,
      ...(style !== null ? { style: style.style } : {}),
    });
    // EXP-15 (review round 2): an export done made earlier in another format
    // is rebuilt from this text too — never left beside the new one holding
    // an older text. One that cannot be rebuilt now (pandoc gone, a zero-trace
    // finding) is removed and named.
    const exportDir = join(paperDir(paperRoot), 'export');
    for (const other of exportedFormats(exportDir, draftPath).filter((f) => f !== flags.format)) {
      try {
        await exportDraft({
          inputPath: draftPath,
          text: exportedText,
          ...(bib.text !== undefined ? { bibText: bib.text } : {}),
          format: other,
          paperRoot,
          ...(style !== null ? { style: style.style } : {}),
        });
      } catch (e) {
        if (!(e instanceof PensmithError)) throw e;
        const stale = exportPathFor(exportDir, draftPath, other);
        await rm(stale, { force: true });
        writeOut(
          `pensmith done: note — export/${basename(stale)} held an older text and could not be rebuilt (${(e.message.split('\n')[0] ?? '').replace(/^pensmith:\s*/, '')}); ` +
            `it was removed — \`pensmith done --format ${other}\` writes it again\n`,
        );
      }
    }
    let onDisk: string | null = null;
    try {
      onDisk = readFileSync(draftPath, 'utf8');
    } catch {
      onDisk = null;
    }
    const changed = [
      ...(onDisk !== draftMd ? ['.paper/DRAFT.md'] : []),
      ...(bib.text !== undefined && loadBibliography(paperRoot).text !== bib.text ? ['.paper/CITATIONS.bib'] : []),
    ];
    if (changed.length > 0) {
      process.stderr.write(
        `pensmith done: WARN — ${changed.join(' and ')} changed while done ran; the export holds the text done checked (sha256 ${sha(exportedText).slice(0, 12)}), ` +
          'not the edit — `pensmith done` checks the edited text before it exports it\n',
      );
    }

    // (6) VRFY-28: the registrar answers that confirmed the exported citations
    // become their LIBRARY.json last_verified (the one writer, under its lock);
    // VRFY-15: the retraction statuses re-checked above are recorded.
    const stamps = { ...draftGate.gate.checkedAt, ...exportGate.checkedAt };
    if (Object.keys(stamps).length > 0) {
      try {
        await recordLastVerified(paperRoot, stamps);
      } catch (e) {
        if (!(e instanceof LibraryNotFoundError)) throw e;
      }
    }
    if (Object.keys(rechecked.decided).length > 0) {
      try {
        await recordRetractionStatuses(paperRoot, rechecked.decided);
      } catch (e) {
        if (!(e instanceof LibraryNotFoundError)) throw e;
      }
    }

    // (7) The whole-paper VERIFICATION.md (a SOURCE artifact, not the export
    // dir; never a file under sections/).
    await atomicWriteFile(
      join(paperDir(paperRoot), 'VERIFICATION.md'),
      buildVerificationReport({
        checkedFile: humanized ? '.paper/FINAL.md' : '.paper/DRAFT.md',
        checkedSha256: sha(exportedText),
        gate: exportGate,
        decisions,
        unjudged,
        accepted: exportGate.accepted,
        byoQuotes: exportGate.byoQuotes,
        honestyReport,
        plagiarismResults,
        ...(plagiarismSkipped !== undefined ? { plagiarismSkipped } : {}),
        pass4Results,
        ...(flags.noVerify ? { pass4Skipped: '--no-verify' } : {}),
      }),
    );

    // (8) EXP-15 (D-21-19): FINAL.md holds exactly the text this done judged
    // and exported — the accepted humanized text, else the compiled draft —
    // written once, now, after the export and the paper-level record. The
    // record of both hashes is the router's terminus (done-record.ts): the
    // paper is complete only while DRAFT.md and FINAL.md hold these bytes.
    if (fileSha256(finalMdPath) !== sha(exportedText)) {
      await atomicWriteFile(finalMdPath, exportedText);
    }
    await writeDoneRecord(paperRoot, {
      doneAt: new Date().toISOString(),
      compiledDraftSha256: sha(draftMd),
      finalSha256: sha(exportedText),
      humanized,
      exported: true,
    });
    await clearHumanizeRejection(paperRoot);
    await clearExportRefusal(paperRoot);

    writeOut(`pensmith done: exported ${result.outputPath}\n`);
    if (networkMode().dryRun) {
      // GRND-19 (D-18-29): say plainly that this is the dry run's trial export.
      writeOut(
        `pensmith done: this is a dry-run export (synthetic sources, stub text) in ${join(paperDir(paperRoot), 'export')}; ` +
          'the real paper was not touched\n',
      );
    }
    return { ok: true, ...result };
  },
});

/** One warning line on stderr. */
function warnLine(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** `{ maxPhrases }` from `[verification] plagiarism_max_phrases`, when set (the default is plagiarism.ts's). */
function maxPhrasesOpt(paperRoot: string): { maxPhrases?: number } {
  const n = tryReadPaperConfigSync(paperRoot)?.verification?.plagiarism_max_phrases;
  return n !== undefined ? { maxPhrases: n } : {};
}

/** `{ quoteMinWords }` from `[verification] quote_min_words`, when set. */
function quoteFloor(paperRoot: string): { quoteMinWords?: number } {
  const q = tryReadPaperConfigSync(paperRoot)?.verification?.quote_min_words;
  return q !== undefined ? { quoteMinWords: q } : {};
}

export default doneCommand;
