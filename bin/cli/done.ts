// bin/cli/done.ts — `pensmith done` verb entrypoint (DONE-01 / DONE-03 / DONE-09).
//
// THIN ORCHESTRATOR — delegates to bin/lib/* (runPass4, runPlagiarism,
// scoreHonesty, exportDraft). 'done' IS one of the locked UX-02 16 verbs
// (bin/lib/verbs.ts) — this file promotes the Phase-2 dispatcher stub to a real
// loader (bin/pensmith.ts REAL_VERB_LOADERS). No 17th verb is added; the
// workflows/done.md body (Tier 1) delegates to this SAME bin/lib path.
//
// stdout-only (no console.* — keeps a future stdio/MCP frame clean, the same
// Pitfall-7 stance as compile.ts and the other verbs).
//
// DONE-09 export-confirmation gate is the SOLE escape valve reconciling the
// Core Value ("every citation supports its claim") with VRFY-07 (advisory Pass
// 2/4 never auto-block). Without the gate the Core Value would force compile/
// export to block automatically. The gate ALWAYS prompts (generic confirm even
// when clean — PRD §7.9), shows a per-issue summary when UNSUPPORTED / orphan /
// plagiarism issues exist, and ONLY --yolo skips it.
//
// Exports go to the exporter's DISTINCT export dir (default `.paper/export/`) —
// done.ts MUST NOT pass `outputDir=paperDir(paperRoot)`, so the md-fallback
// never overwrites the source DRAFT.md and the verb-level zero-trace scan
// targets a real distinct deliverable (cycle-2 MEDIUM). Under --dry-run the
// export dir is `.paper-dry-run/export/` and the file is `DRAFT.dry-run.<ext>`
// (GRND-19); done prints that path and says it is a dry-run export.

import { defineCommand } from 'citty';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { runPass4, renderPass4Section, type Pass4Result } from '../lib/verify/pass4.js';
import { runFreshnessForDraft } from '../lib/verify/pass1.js';
import { decidedRetractions, type DecidedRetraction } from '../lib/verify/freshness.js';
import { type Pass2Result } from '../lib/verify/pass2.js';
import { runPlagiarism, renderPlagiarismSection, type PlagiarismResult } from '../lib/plagiarism.js';
import { scoreHonesty, renderHonestyReport } from '../lib/honesty.js';
import { exportDraft, runHumanizer, type ExportFormat } from '../lib/exporter.js';
import { paperDir, projectRoot } from '../lib/paths.js';
import { parseIntakeMd } from '../lib/intake-parse.js';
import { resolveStyleName } from '../lib/citations.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { runGate, declineGate, canPrompt } from '../lib/gates.js';
import { EXIT_BLOCKED, EXIT_ERROR } from '../lib/exit-codes.js';
import { offlineMarkerLine, networkMode } from '../lib/http-mock.js';
import { sectionRegistryProblem } from '../lib/section-registry.js';
import { compileRecordProblems, fileSha256 } from '../lib/compile-inputs.js';
import { editedFinalReason, finalMdState, writeDoneRecord } from '../lib/done-record.js';
import { loadBibliography, type AcceptedQuote, type ByoQuote, type GateResult } from '../lib/verify/gate.js';
import { renderSummaryTable, summaryRows } from '../lib/verify/verification-md.js';
import { recordLastVerified, recordRetractionStatuses, LibraryNotFoundError } from '../lib/library.js';
import { out as writeOut } from '../lib/output-sink.js';
import {
  doneSections,
  runExportBlockingGate,
  recomputeExportGate,
  citedKeySetChange,
  readUnsupportedClaims,
  unjudgedClaimSections,
  unjudgedLine,
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
  const hasIssues =
    unsupported.length > 0 || orphanClaims.length > 0 || plagiarismHits.length > 0;
  return { unsupported, orphanClaims, plagiarismHits, hasIssues };
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
  if (issues.plagiarismHits.length > 0) {
    const sample = issues.plagiarismHits
      .slice(0, 3)
      .map((r) => r.phrase.replace(/[\r\n]+/g, ' ').slice(0, 60))
      .join(' | ');
    writeOut(
      `  - ${issues.plagiarismHits.length} distinctive phrase(s) with web matches (plagiarism): ${sample}\n`,
    );
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
 * exact text done exports (FINAL.md after the humanizer, else the compiled
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
  type ExportBlock,
  type DoneSection,
  type UnsupportedClaim,
  type UnjudgedSection,
  type SectionAdvisory,
} from '../lib/done-gate.js';

// ---------------------------------------------------------------------------
// doneCommand — the thin orchestrator (DONE-01 + DONE-02 + DONE-03 + DONE-04/05
//               + DONE-06/07/08 + DONE-09)
// ---------------------------------------------------------------------------

const VALID_FORMATS: ReadonlySet<string> = new Set(['docx', 'pdf', 'latex', 'md']);

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
  readonly honestyReport: string;
  readonly plagiarismResults: readonly PlagiarismResult[];
  readonly pass4Results: readonly Pass4Result[];
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
  // export never does — exporters read DRAFT.md / FINAL.md, not this file).
  const offlineMarker = offlineMarkerLine();
  const decisions = r.decisions.length
    ? [
        '| Section | Row | Claim | Decision |',
        '|---------|-----|-------|----------|',
        ...r.decisions.map(
          (d) =>
            `| §${d.claim.section} (${d.claim.slug}) | ${d.claim.row > 0 ? `Pass-2 row ${d.claim.row}` : 'Pass-2 table'} [@${cell(d.claim.result.citekey, 60)}] | ${cell(d.claim.result.claimSentence, 160)} | ${d.decision} |`,
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
    renderPlagiarismSection([...r.plagiarismResults]),
    '',
    renderPass4Section(r.pass4Results),
    '',
  ].join('\n');
}

/** Print the UNSUPPORTED claims with their evidence, the sections Pass 2 did not judge, the accepted quotes and the local-file quotes (the confirmation's list). */
function writeExportFindings(
  claims: readonly UnsupportedClaim[],
  accepted: readonly AcceptedQuote[],
  byoQuotes: readonly ByoQuote[],
  unjudged: readonly UnjudgedSection[] = [],
): void {
  for (const u of unjudged) writeOut(`pensmith done: ${unjudgedLine(u)}\n`);
  if (claims.length > 0) {
    writeOut(`pensmith done: ${claims.length} claim(s) Pass 2 judged UNSUPPORTED by the cited source (VRFY-22):\n`);
    for (const c of claims) {
      writeOut(`  - §${c.section} [@${c.result.citekey}] "${cell(c.result.claimSentence, 160)}" — ${cell(c.result.rationale, 200)}\n`);
      writeOut(`      evidence: ${c.result.evidence.trim().length > 0 ? `"${cell(c.result.evidence, 200)}"` : '(none quoted)'}\n`);
    }
  }
  for (const a of accepted) {
    writeOut(`  - accepted without a source check: ${a.section !== undefined ? `§${a.section} ` : ''}${a.id} [@${a.citekey}] "${cell(a.excerpt, 80)}" (${a.acceptedAt})\n`);
  }
  for (const q of byoQuotes) {
    writeOut(`  - ${q.id} [@${q.citekey}] "${cell(q.snippet, 60)}…" verified against your local file ${q.localFile}\n`);
  }
}

/** What done's re-check of `unknown` retraction statuses found (VRFY-15, D-20-13). */
export interface RetractionRecheck {
  /** One refusal line per cited source found retracted now. */
  readonly retracted: string[];
  /** The decided statuses (and an `unknown` that stays so for good, with its reason), recorded once done exports. */
  readonly decided: Record<string, DecidedRetraction>;
}

/**
 * Re-check, live, the retraction status of every source `text` cites whose
 * LIBRARY.json status is `unknown` because a lookup failed (research or an
 * earlier verify could not decide it) — never one whose agency publishes no
 * retraction data (recorded; it stays unknown for good). The re-check sends no
 * DOI HEAD, and a status it decides (or records for good) is never asked
 * again, so a second done on an unchanged paper asks nothing (VRFY-26). Nothing is written
 * here. Skipped under --dry-run and for a bibliography that does not parse;
 * never throws (a failed re-check leaves the status unknown, as verify does —
 * the gate core's Pass 1 still decides).
 */
export async function recheckUnknownRetractions(paperRoot: string, text: string): Promise<RetractionRecheck> {
  const none: RetractionRecheck = { retracted: [], decided: {} };
  if (networkMode().dryRun) return none;
  const bib = loadBibliography(paperRoot);
  if (!bib.exists || bib.problems.length > 0) return none;
  let results;
  try {
    results = await runFreshnessForDraft(text, bib.path, { bibEntries: bib.entries, root: paperRoot, onlyRecheck: true, record: false });
  } catch {
    return none;
  }
  const out: RetractionRecheck = { retracted: [], decided: decidedRetractions(results) };
  for (const r of results) {
    if (r.recheck?.status === 'retracted') {
      out.retracted.push(
        `citation [@${r.citekey}] is RETRACTED — ${r.recheck.details ?? 'it appears in Retraction Watch'} (re-checked now: LIBRARY.json had its retraction status unknown) — replace the source`,
      );
    }
  }
  return out;
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
      description: 'Export format: docx | pdf | latex | md.',
      default: 'docx',
    },
    raw: {
      type: 'boolean',
      description: 'Skip the humanizer step.',
      default: false,
    },
  },
  async run({ args }) {
    const paperRoot = projectRoot();
    const draftPath = join(paperDir(paperRoot), 'DRAFT.md');

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
    // (explicit, bare /pensmith, next), whatever --raw or --yolo: the sections
    // STATE.json and OUTLINE.md register (never a directory listing), each
    // verified for the draft it holds now; the compiled DRAFT.md exactly as
    // compile wrote it from those sections; and the ONE gate core recomputed
    // over the DRAFT.md bytes about to be exported. Every reason is collected
    // (staleness and recomputed verdicts together) and listed.
    const sections = doneSections(paperRoot);
    const blocking = runExportBlockingGate(paperRoot);
    const reasons = [...blocking.reasons];
    // FINAL.md is the file pensmith calls the finished paper. One done did not
    // leave — edited or written by hand — is never exported and never
    // replaced (the humanizer would overwrite it too): refused, naming the
    // remedy (done-record.ts; main-branch merge review, round 1).
    if (finalMdState(paperRoot) === 'edited') reasons.push(editedFinalReason(paperRoot));
    if (sectionRegistryProblem(paperRoot) === null && sections.length > 0) {
      const current = new Map(sections.map((s) => [s.id, s.verifiedHash]));
      reasons.push(...compileRecordProblems(paperRoot, sections.map((s) => s.identity), current));
    }
    // VRFY-15 (D-20-13): every cited source whose LIBRARY.json retraction
    // status is `unknown` is re-checked live, never from the cache: a
    // retraction found now blocks the export; the decided answers are recorded
    // (through the library writer) only once done exports — a refused done
    // writes nothing.
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

    // The UNSUPPORTED claims of the registered sections (VRFY-22): with any,
    // the confirmation is the `unsupported-claims` gate, else `export-confirm`.
    const claims = readUnsupportedClaims(paperRoot, sections);
    const unjudged = unjudgedClaimSections(paperRoot, sections);
    const confirmGate = claims.length > 0 ? 'unsupported-claims' : 'export-confirm';

    // RUN-09 / RUN-28: the export confirmation needs an answer. Without a
    // terminal (and without --yolo) refuse NOW — EXIT_APPROVAL, before the
    // plagiarism / detector / humanizer work — instead of after it, listing
    // what the answer is about (the UNSUPPORTED claims with their evidence and
    // the quotes the gate took on the user's word) first.
    if (args.yolo !== true && !canPrompt()) {
      writeExportFindings(claims, draftGate.gate.accepted, draftGate.gate.byoQuotes, unjudged);
      await runGate(confirmGate, { yolo: false, detail: 'nothing was exported' });
    }

    // (2) DONE-02 plagiarism, DONE-04 honesty score (before humanize).
    const plagiarismResults = await runPlagiarism(draftMd);
    const before = await scoreHonesty(draftMd);

    // (3) DONE-03 humanize (skip-clean if absent / no transport), honesty after.
    // The humanizer writes FINAL.md before GATE-04 judges it and before the
    // export: the FINAL.md it replaces (done's own, or none — step (1)
    // refused any other) is put back on EVERY way out short of the export
    // record — a GATE-04 refusal, a declined confirmation, the cost cap, a
    // failed export or write (main-branch merge review, round 2) — so a
    // humanized text no export recorded never stays behind as a FINAL.md
    // done-record.ts would read as a hand edit.
    const finalMdPath = join(paperDir(paperRoot), 'FINAL.md');
    const finalBefore = existsSync(finalMdPath) ? readFileSync(finalMdPath) : null;
    let finalPath: string | null = null;
    let after: Awaited<ReturnType<typeof scoreHonesty>> = null;
    // Set once the paper-level VERIFICATION.md names the exported text: from
    // then on FINAL.md is done's own (done-record.ts) and stays.
    let exported = false;
    let restored = false;
    const restoreFinal = async (): Promise<void> => {
      if (finalPath === null || restored) return;
      restored = true;
      if (finalBefore === null) rmSync(finalMdPath, { force: true });
      else await atomicWriteFile(finalMdPath, finalBefore);
    };
    const restoredWhat = (): string => (finalBefore === null ? 'was removed' : 'is back as it was');
    try {
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
          ? 'Pensmith honesty check: skipped (no GPTZero API key set or backend unavailable).'
          : renderHonestyReport(before.aiProbability, after?.aiProbability ?? null, before.backend);

      // GATE-04 (VRFY-26): the humanized FINAL.md is gated on its OWN exact bytes
      // — the humanizer never adds, drops or swaps a citation, and the gate core
      // recomputes every row over FINAL.md (a form or key the humanizer
      // introduced is refused). HARD block, before the confirmation; --yolo never
      // bypasses it (PRD §14).
      let exportedText = draftMd;
      let exportGate = draftGate.gate;
      if (finalPath !== null) {
        const finalMd = readFileSync(finalPath, 'utf8');
        const finalReasons: string[] = [];
        const change = citedKeySetChange(finalMd, draftMd);
        if (change !== null) finalReasons.push(change);
        const finalGate = await recomputeExportGate(paperRoot, finalMd, { sections, bib });
        finalReasons.push(...finalGate.refusals);
        if (finalReasons.length > 0) {
          await restoreFinal();
          writeOut('pensmith done: GATE-04 BLOCKED — FINAL.md failed re-verification:\n');
          for (const r of finalReasons) writeOut(`  - ${r}\n`);
          writeOut(
            `pensmith done: the humanized text was not kept (FINAL.md ${restoredWhat()}); ` +
              '`pensmith done --raw` exports the compiled draft without the humanizer.\n',
          );
          return { ok: false, blocked: true, exitCode: EXIT_BLOCKED };
        }
        exportedText = finalMd;
        exportGate = finalGate.gate;
      }

      // Whole-paper Pass 4 (DONE-01, VRFY-23) over the exact text to be exported.
      const pass4Results = await runWholePaperPass4(paperRoot, exportedText);

      // (4) The confirmation: every UNSUPPORTED claim with its evidence, the
      // orphans, the plagiarism hits, the accepted quotes and the quotes verified
      // against the user's own files; then `unsupported-claims` (VRFY-22) or the
      // generic `export-confirm` (DONE-09). --yolo answers either.
      writeExportFindings(claims, exportGate.accepted, exportGate.byoQuotes, unjudged);
      if (args.yolo === true) {
        const issues = collectGateIssues({ pass2Results: claims.map((c) => c.result), pass4Results, plagiarismResults });
        if (issues.orphanClaims.length > 0 || issues.plagiarismHits.length > 0) writeGateSummary(issues);
      }
      const gateResult = await runDoneGate({
        pass2Results: claims.map((c) => c.result),
        pass4Results,
        plagiarismResults,
        yolo: args.yolo === true,
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

      // (5) DONE-06/07/08 exportDraft into the exporter's DISTINCT export dir. Leave
      //    outputDir UNSET so the md-fallback never overwrites the source DRAFT.md.
      const format: ExportFormat = VALID_FORMATS.has(String(args.format))
        ? (String(args.format) as ExportFormat)
        : 'docx';

      // Resolve discipline → CSL style from INTAKE.md (never-throw: missing or
      // unparseable INTAKE.md leaves style undefined; citation rendering is skipped).
      const intakePath = join(paperDir(paperRoot), 'INTAKE.md');
      let style: string | undefined;
      try {
        const intakeText = readFileSync(intakePath, 'utf8');
        const { discipline } = parseIntakeMd(intakeText);
        style = resolveStyleName(discipline);
      } catch {
        // Missing or unparseable INTAKE.md → style undefined → citation rendering is skipped.
      }

      // VRFY-26: the export is EXACTLY the text the gate judged, and the
      // bibliography the gate read — never the files read again after the
      // plagiarism queries, the humanizer, the detector or the confirmation (a
      // sync client, an editor or the user may have changed them meanwhile).
      const exportedFrom = finalPath ?? draftPath;
      const result = await exportDraft({
        inputPath: exportedFrom,
        text: exportedText,
        ...(bib.text !== undefined ? { bibText: bib.text } : {}),
        format,
        paperRoot,
        ...(style !== undefined ? { style } : {}),
      });
      const sha = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');
      let onDisk: string | null = null;
      try {
        onDisk = readFileSync(exportedFrom, 'utf8');
      } catch {
        onDisk = null;
      }
      const changed = [
        ...(onDisk !== exportedText ? [finalPath !== null ? '.paper/FINAL.md' : '.paper/DRAFT.md'] : []),
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

      // The whole-paper VERIFICATION.md (a SOURCE artifact, not the export dir;
      // never a file under sections/).
      const verificationPath = join(paperDir(paperRoot), 'VERIFICATION.md');
      await atomicWriteFile(
        verificationPath,
        buildVerificationReport({
          checkedFile: finalPath !== null ? '.paper/FINAL.md' : '.paper/DRAFT.md',
          checkedSha256: createHash('sha256').update(exportedText, 'utf8').digest('hex'),
          gate: exportGate,
          decisions,
          unjudged,
          accepted: exportGate.accepted,
          byoQuotes: exportGate.byoQuotes,
          honestyReport,
          plagiarismResults,
          pass4Results,
        }),
      );
      // The export is made and the paper-level record names its text: FINAL.md
      // (the humanized text) is done's own from here on (done-record.ts).
      exported = true;

      // Audit #15, VRFY-26 (main-branch merge review, round 1): FINAL.md
      // holds exactly the text this done judged and exported — the humanized
      // manuscript when a humanizer ran (already on disk), otherwise the
      // compiled draft (final, just not humanized), written on every done whose
      // FINAL.md differs from it (step (1) refused one done did not write). The
      // record of both hashes is the router's terminus (done-record.ts): the
      // paper is complete only while DRAFT.md and FINAL.md hold these bytes, so
      // a recompile sends it back to done and a hand edit to attention — never
      // an mtime comparison, and never "complete" for a FINAL.md no gate judged.
      if (finalPath === null && fileSha256(finalMdPath) !== sha(exportedText)) {
        await atomicWriteFile(finalMdPath, exportedText);
      }
      await writeDoneRecord(paperRoot, {
        doneAt: new Date().toISOString(),
        compiledDraftSha256: sha(draftMd),
        finalSha256: sha(exportedText),
        humanized: finalPath !== null,
      });

      writeOut(`pensmith done: exported ${result.outputPath}\n`);
      if (networkMode().dryRun) {
        // GRND-19 (D-18-29): say plainly that this is the dry run's trial export.
        writeOut(
          `pensmith done: this is a dry-run export (synthetic sources, stub text) in ${join(paperDir(paperRoot), 'export')}; ` +
            'the real paper was not touched\n',
        );
      }
      return { ok: true, ...result };
    } finally {
      if (!exported && finalPath !== null && !restored) {
        try {
          await restoreFinal();
          writeOut(`pensmith done: the humanized text was not kept (FINAL.md ${restoredWhat()}).\n`);
        } catch (e) {
          process.stderr.write(
            `pensmith done: WARN — the humanized text no export recorded is still in .paper/FINAL.md (putting the previous one back failed: ${(e as Error).message}); ` +
              'move it out of the paper folder before `pensmith done`\n',
          );
        }
      }
    }
  },
});

export default doneCommand;
