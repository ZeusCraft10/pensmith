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

import { defineCommand } from 'citty';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPass4, renderPass4Section, type Pass4Result } from '../lib/verify/pass4.js';
import { type Pass2Result, type Pass2Verdict } from '../lib/verify/pass2.js';
import { runPlagiarism, renderPlagiarismSection, type PlagiarismResult } from '../lib/plagiarism.js';
import { scoreHonesty, renderHonestyReport } from '../lib/honesty.js';
import { exportDraft, runHumanizer, type ExportFormat } from '../lib/exporter.js';
import { paperDir } from '../lib/paths.js';
import { parseIntakeMd } from '../lib/intake-parse.js';
import { resolveStyleName } from '../lib/citations.js';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { ask } from '../lib/prompts.js';

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
 * Scan each `.paper/sections/<dir>/VERIFICATION.md` for ## Pass-2 UNSUPPORTED
 * rows and return them as Pass2Result[]. Drives the DONE-09 gate's UNSUPPORTED bucket
 * (the load-bearing disk→gate feed, HIGH-3).
 *
 * Defensive on I/O ONLY: a missing sections dir or an unreadable file is SKIPPED
 * (contributes nothing for that section) and never throws. This is DISTINCT from
 * the fail-safe in parseSectionPass2: missing/absent = clean; present-but-
 * unparseable = a synthetic UNSUPPORTED issue.
 */
export function readSectionUnsupported(paperRoot: string): Pass2Result[] {
  const sectionsDir = join(paperDir(paperRoot), 'sections');
  let entries: string[];
  try {
    entries = readdirSync(sectionsDir);
  } catch {
    return []; // no sections dir → nothing to report
  }
  const out: Pass2Result[] = [];
  for (const entry of entries) {
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
// doneCommand — the thin orchestrator (DONE-01 + DONE-02 + DONE-03 + DONE-04/05
//               + DONE-06/07/08 + DONE-09)
// ---------------------------------------------------------------------------

const VALID_FORMATS: ReadonlySet<string> = new Set(['docx', 'pdf', 'latex', 'md']);

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
    const paperRoot = process.cwd();
    const draftPath = join(paperDir(paperRoot), 'DRAFT.md');

    let draftMd: string;
    try {
      draftMd = readFileSync(draftPath, 'utf8');
    } catch {
      process.stdout.write(
        `pensmith done: no compiled draft at ${draftPath} — run 'pensmith compile' first.\n`,
      );
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
        ? 'Pensmith honesty check: skipped (no GPTZero API key set or backend unavailable).'
        : renderHonestyReport(before.aiProbability, after?.aiProbability ?? null, before.backend);

    // 6. DONE-09 export-confirmation gate. Pass-2 UNSUPPORTED is read from the
    //    section VERIFICATION.md files (the load-bearing disk→gate feed, HIGH-3).
    const pass2Results = readSectionUnsupported(paperRoot);
    const gateResult = await runDoneGate({
      pass2Results,
      pass4Results,
      plagiarismResults,
      yolo: args.yolo === true,
      approve: async () => {
        const answer = await ask({
          id: 'export-confirm',
          kind: 'confirm',
          label: 'Export the paper?',
          default: true,
        });
        return answer.kind === 'confirm' ? answer.value : false;
      },
    });

    if (gateResult.exported === false && gateResult.gateSkipped !== true) {
      process.stdout.write('pensmith done: export cancelled by user.\n');
      return { ok: false };
    }

    // 7. DONE-06/07/08 exportDraft into the exporter's DISTINCT export dir. Leave
    //    outputDir UNSET so the md-fallback never overwrites the source DRAFT.md.
    const format: ExportFormat = VALID_FORMATS.has(String(args.format))
      ? (String(args.format) as ExportFormat)
      : 'docx';

    // Resolve discipline → CSL style from INTAKE.md (never-throw: missing or
    // unparseable INTAKE.md leaves style undefined; exportDraft defaults to APA).
    // Mirrors the draft-read never-throw at lines 388-399.
    const intakePath = join(paperDir(paperRoot), 'INTAKE.md');
    let style: string | undefined;
    try {
      const intakeText = readFileSync(intakePath, 'utf8');
      const { discipline } = parseIntakeMd(intakeText);
      style = resolveStyleName(discipline);
    } catch {
      // Missing or unparseable INTAKE.md → style undefined → exportDraft defaults to APA.
    }

    const result = await exportDraft({
      inputPath: finalPath ?? draftPath,
      format,
      paperRoot,
      ...(style !== undefined ? { style } : {}),
    });

    // Write the whole-paper VERIFICATION.md (a SOURCE artifact, not the export dir).
    const verificationPath = join(paperDir(paperRoot), 'VERIFICATION.md');
    await atomicWriteFile(
      verificationPath,
      buildVerificationReport(honestyReport, plagiarismResults, pass4Results),
    );

    process.stdout.write(`pensmith done: exported ${result.outputPath}\n`);
    return { ok: true, ...result };
  },
});

export default doneCommand;
