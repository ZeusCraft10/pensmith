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
// targets a real distinct deliverable (cycle-2 MEDIUM).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runPass4, type Pass4Result } from '../lib/verify/pass4.js';
import { type Pass2Result } from '../lib/verify/pass2.js';
import { type PlagiarismResult } from '../lib/plagiarism.js';
import { paperDir } from '../lib/paths.js';

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
    const total = issues.orphanClaims.reduce((sum, r) => sum + r.orphanCount, 0);
    process.stdout.write(
      `  - ${total} orphan claim(s) across ${issues.orphanClaims.length} paragraph(s) (Pass 4)\n`,
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
