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
// With no terminal to ask in, done keeps the audit (.paper/gates/export.json),
// exits 3 with the pending decision as JSON, and takes the answer back through
// `pensmith gate answer <ref> export|cancel`, which exports those same bytes.
//
// Exports go to the exporter's DISTINCT export dir (default `.paper/export/`),
// never over the source DRAFT.md. The format defaults to docx when Pandoc is
// installed and to md otherwise; an explicit docx/pdf that cannot be made is
// refused. A failed export (ExportError) writes nothing and does not mark the
// paper done: a refusal exits 2, a crashed tool exits 1.

import { defineCommand } from 'citty';
import { z } from 'zod';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runPass4, renderPass4Section, type Pass4Result } from '../lib/verify/pass4.js';
import { runPass3 } from '../lib/verify/pass3.js';
import { readBibText } from '../lib/verify/pass1.js';
import { extractQuotes } from '../lib/quote-extractor.js';
import { type Pass2Result, type Pass2Verdict } from '../lib/verify/pass2.js';
import { PLAGIARISM_SKIPS, runPlagiarism, renderPlagiarismSection, type PlagiarismResult } from '../lib/plagiarism.js';
import { decideGptzeroConsent, HONESTY_SKIPS, scoreHonesty, renderHonestyReport, renderHonestySkipped, type HonestySkip } from '../lib/honesty.js';
import {
  EXPORT_FORMATS,
  exportDraft,
  ExportError,
  formatUnavailable,
  runHumanizer,
  type ExportFormat,
} from '../lib/exporter.js';
import { paperDir, paperFinalFile, paperFinalStagedFile, sectionDirName } from '../lib/paths.js';
import { closeGate, gateStillApplies, openGate, readGate, stopForAnswer } from '../lib/gates.js';
import { parseBibByCitekey } from '../lib/citations.js';
import { resolveCitationStyle } from '../lib/citation-style.js';
import { isPandocPresent } from '../lib/ecosystem-presence.js';
import { atomicWriteFile, removePath } from '../lib/atomic-write.js';
import { canAskInTerminal, confirmOrNo, type PromptQuestion } from '../lib/prompts.js';
import {
  citedKeys,
  findCitations,
  findRawCitations,
  findUnparseableCitations,
  type Citation,
} from '../lib/citation-grammar.js';
import { EXIT_ERROR, EXIT_REFUSED } from '../lib/exit-codes.js';
import { readOutline } from '../lib/outline-read.js';
import { isPlaceholderText } from '../lib/placeholder.js';
import { recheckExportText, runExportBlockingGate } from '../lib/export-gate.js';
import { readVerificationRecord, sha256 } from '../lib/verify/verification-record.js';
import { writeExportRecord } from '../lib/export-record.js';

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
  /** Phrases the plagiarism check could not search: it is incomplete, not clean. */
  plagiarismUnchecked: number;
  /** True iff ANY of the buckets is non-empty or the plagiarism check is incomplete. */
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
  const plagiarismUnchecked = (input.plagiarismResults ?? []).filter((r) => r.skipped !== undefined).length;
  const hasIssues =
    unsupported.length > 0 || orphanClaims.length > 0 || plagiarismHits.length > 0 || plagiarismUnchecked > 0;
  return { unsupported, orphanClaims, orphanClaimCount, plagiarismHits, plagiarismUnchecked, hasIssues };
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
  if (issues.plagiarismUnchecked > 0) {
    process.stdout.write(
      `  - the plagiarism check is incomplete: ${issues.plagiarismUnchecked} phrase(s) could not be searched, so it does not show the paper is clean\n`,
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

/** Each quotation Pass 3 reads in `md`, with the work it is attributed to ('' for none). */
function quotationSpans(md: string, cites: readonly Citation[]): string[] {
  return extractQuotes(md, cites).map((q) => `${q.citekey}\u0000${q.text}`);
}

/** A quotation span (quotationSpans) as people read it. */
function describeQuotation(span: string): string {
  const [key, text] = span.split('\u0000') as [string, string];
  return key === '' ? `no citation "${text.slice(0, 40)}"` : `[@${key}] "${text.slice(0, 40)}"`;
}

/**
 * Re-verify the humanized FINAL.md immediately before export (GATE-04).
 *
 * (a) Citation diff: the keys FINAL.md cites, in any Pandoc form, MUST equal
 *     the keys draftMd cites, and FINAL.md must not add a citation typed as
 *     text or a broken one. Any add/drop/swap is a HARD block.
 * (b) Humanize runs on protected text: every citation must be written as
 *     DRAFT.md writes it (prefix and locator included), in the same order,
 *     and every quotation must be word for word in DRAFT.md and attributed to
 *     the same work. A citation or quotation the humanizer changed, separated
 *     from its citation, or swapped with another claim's is a HARD block,
 *     whether or not the source's text can be read: Pass 3 below can only
 *     check a quotation against a source it can read. The order check also
 *     refuses sentences the humanizer reordered (the safe direction). It
 *     cannot see a citation moved to the neighbouring sentence with the order
 *     kept: the protected-text humanizer must keep each citation in its
 *     sentence.
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

  // Step (b): the citations and quotations themselves, span for span.
  const draftRaw = draftCites.map((c) => c.raw);
  const finalRaw = finalCites.map((c) => c.raw);
  const rewritten = addedEntries(finalRaw, draftRaw);
  if (rewritten.length > 0) {
    return {
      passed: false,
      reason: `a citation in the humanized FINAL.md is not written as in .paper/DRAFT.md: ${rewritten.join(', ')} (DRAFT.md has ${addedEntries(draftRaw, finalRaw).join(', ') || 'no other'})`,
    };
  }
  // The same citations in another order: one claim now carries another's source.
  const moved = finalRaw.findIndex((raw, i) => raw !== draftRaw[i]);
  if (moved !== -1) {
    return {
      passed: false,
      reason: `the citations in the humanized FINAL.md are not in the order .paper/DRAFT.md has them (citation ${moved + 1} is ${finalRaw[moved]}, ` +
        `where DRAFT.md has ${draftRaw[moved]}), so a claim may now carry another claim's source`,
    };
  }
  const changedQuotes = addedEntries(quotationSpans(finalMd, finalCites), quotationSpans(draftMd, draftCites));
  if (changedQuotes.length > 0) {
    const unattributed = changedQuotes.some((q) => q.startsWith('\u0000')) ? ' (UNATTRIBUTED where it has no citation)' : '';
    return {
      passed: false,
      reason: `a quotation in the humanized FINAL.md is not word for word in .paper/DRAFT.md, attributed to the same work${unattributed}: ${changedQuotes.map(describeQuotation).join('; ')}`,
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

/** The one-line question the export confirmation asks. */
function pendingExportSummary(issues: GateIssues, format: string, source: string): string {
  const count = issues.unsupported.length + issues.orphanClaimCount + issues.plagiarismHits.length;
  const incomplete = issues.plagiarismUnchecked > 0
    ? ` The plagiarism check is incomplete (${issues.plagiarismUnchecked} phrase(s) not searched).`
    : '';
  return `Export ${source} as ${format}? ` +
    (count > 0 ? `${count} advisory issue(s) to review first.` : 'No advisory issues were found.') + incomplete;
}

const EXPORT_PENDING = 'export-confirmation';

/**
 * What the export decision shows: the advisory issues to review. Printed as
 * part of one JSON line when there is no terminal to ask in; nothing is
 * exported, and the user's answer comes back through
 * `pensmith gate answer <ref> export|cancel`.
 */
function exportShown(issues: GateIssues): Record<string, unknown> {
  return {
    needs_confirmation: true,
    issues: {
      unsupported: issues.unsupported.map((r) => r.citekey),
      orphan_claims: issues.orphanClaimCount,
      plagiarism_hits: issues.plagiarismHits.map((r) => r.phrase.replace(/\s+/g, ' ').slice(0, 80)),
      plagiarism_not_checked: issues.plagiarismUnchecked,
    },
  };
}

/** What done keeps with a pending export confirmation, so the answering run audits nothing again. */
const ExportAuditSchema = z.object({
  pass4Results: z.array(z.object({ orphanCount: z.number() }).passthrough()),
  plagiarismResults: z.array(z.object({
    phrase: z.string(),
    matches: z.array(z.string()),
    skipped: z.enum(PLAGIARISM_SKIPS).optional(),
  }).strict()),
  honestyReport: z.string(),
  /**
   * Why the audit has no GPTZero score, or null when it has one. An audit kept
   * by an earlier build has no such field: why it has no score is unknown.
   */
  honestySkip: z.enum(HONESTY_SKIPS).nullable().optional(),
  humanized: z.boolean(),
}).strict();

/** The audit as done builds it. The schema checks only each Pass 4 result's orphanCount and keeps the rest as it was. */
interface ExportAudit extends Omit<z.infer<typeof ExportAuditSchema>, 'pass4Results' | 'plagiarismResults'> {
  pass4Results: Pass4Result[];
  plagiarismResults: PlagiarismResult[];
}

/** Skip reasons `--score` overturns: the user had not consented, or had said no. */
const CONSENT_SKIPS: ReadonlySet<HonestySkip | null> = new Set<HonestySkip | null>(['no-consent', 'declined']);

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
    score: {
      type: 'boolean',
      description: 'Consent to sending the paper text to GPTZero for the AI-likelihood score (kept for this paper); --no-score skips the score.',
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

    // An export confirmation kept from an earlier run without a terminal: its
    // audit is reused (nothing is searched, scored or humanized again), and an
    // answer given through `pensmith gate answer` decides the export. One
    // kept for another draft, bibliography, format or humanized text is
    // dropped, and the audit runs again. --yolo needs no confirmation. So
    // does `--score` for an audit that had no score for want of consent: it
    // is the consent the kept audit asked for, so the audit runs again with it.
    const stagedPath = paperFinalStagedFile(paperRoot);
    const binding = { draft_sha256: sha256(draftBytes), bib_sha256: sha256(bibText), format, raw: String(args.raw === true) };
    const keptGate = readGate(paperRoot, 'export');
    let audit: ExportAudit | null = null;
    let answer: boolean | null = null;
    if (keptGate && args.yolo !== true) {
      const kept = ExportAuditSchema.safeParse(keptGate.payload);
      const staged = existsSync(stagedPath) ? sha256(readFileSync(stagedPath)) : null;
      if (!kept.success) {
        process.stderr.write('pensmith done: the export confirmation kept earlier cannot be read by this version of pensmith; the audit runs again.\n');
      } else if (gateStillApplies(keptGate, { ...binding, staged_sha256: staged })) {
        // With no reason kept, the audit may have had no score for want of consent.
        const skip = kept.data.honestySkip;
        if (args.score === true && !keptGate.answer && (skip === undefined || CONSENT_SKIPS.has(skip))) {
          process.stderr.write('pensmith done: --score gives the consent the kept audit had no score for; the audit runs again with it.\n');
        } else {
          audit = {
            ...kept.data,
            pass4Results: kept.data.pass4Results as unknown as Pass4Result[],
            plagiarismResults: kept.data.plagiarismResults as PlagiarismResult[],
          };
          if (keptGate.answer) answer = keptGate.answer.options[0] === 'export';
        }
      } else {
        process.stderr.write('pensmith done: the export confirmation kept earlier was for another draft, bibliography or format; the audit runs again.\n');
      }
    }
    const reused = audit !== null;
    if (keptGate && !reused) await closeGate(paperRoot, 'export');

    // The audit: the whole-paper Pass 4 (orphaned claims), the plagiarism
    // check, the honesty score before humanizing, the humanizer (staged;
    // skipped when none is wired), and the score after.
    if (audit === null) {
      const pass4Results = await runWholePaperPass4(paperRoot);
      const plagiarismResults = await runPlagiarism(draftMd);
      // GPTZero consent, decided once for this run (before and after humanize
      // alike): only with a key, and only with the user's consent, which
      // defaults to no and which --yolo never gives.
      const consent = await decideGptzeroConsent(paperRoot, {
        ...(typeof args.score === 'boolean' ? { score: args.score } : {}),
        terminal: canAskInTerminal(process.stderr),
      });
      // One disclosure per run: the consent question, or the first score, shows it.
      const scoring = { consentGranted: consent.consent, disclosed: consent.disclosed === true };
      const before = consent.consent ? await scoreHonesty(draftMd, undefined, scoring) : null;
      let humanizedPath: string | null = null;
      let after: Awaited<ReturnType<typeof scoreHonesty>> = null;
      if (args.raw !== true) {
        humanizedPath = await runHumanizer(draftMd, paperRoot);
        if (humanizedPath !== null && before !== null) {
          try {
            after = await scoreHonesty(readFileSync(humanizedPath, 'utf8'), undefined, scoring);
          } catch {
            after = null;
          }
        }
      }
      // Honesty report: guard the null score explicitly — the skip line names
      // why, never a made-up percent. The audit keeps the reason the report names.
      let honestySkip: HonestySkip | null = null;
      let honestyReport: string;
      if (before === null) {
        honestySkip = consent.skip ?? 'backend-error';
        honestyReport = renderHonestySkipped(honestySkip);
      } else {
        honestyReport = renderHonestyReport(before.aiProbability, after?.aiProbability ?? null, before.backend);
      }
      audit = { pass4Results, plagiarismResults, honestyReport, honestySkip, humanized: humanizedPath !== null };
    }
    const { pass4Results, plagiarismResults, honestyReport } = audit;
    const finalPath: string | null = audit.humanized ? stagedPath : null;

    // The humanized text is checked again before export, and a failure blocks
    // it, before the export confirmation. It is skipped only when no humanizer
    // ran. --yolo never skips it: integrity checks are unconditional, and
    // --yolo belongs only to the advisory confirmation below.
    // The humanized text waits under a staging name (runHumanizer); it becomes
    // FINAL.md only once the export succeeds, so a refusal here leaves no mark
    // that the paper was exported. A kept text is checked again too.
    let finalMd: string | null = null;
    let finalBytes: Buffer | null = null;
    if (finalPath !== null) {
      finalBytes = readFileSync(finalPath);
      finalMd = finalBytes.toString('utf8');
      const refuseHumanized = async <T>(result: T): Promise<T> => {
        await removePath(finalPath);
        await closeGate(paperRoot, 'export');
        return result;
      };
      if (isPlaceholderText(finalMd)) {
        process.stdout.write('pensmith done: BLOCKED — the humanized FINAL.md is placeholder text (PENSMITH_NO_LLM), not a paper.\n');
        process.exitCode = EXIT_REFUSED;
        return refuseHumanized({ ok: false, blocked: true });
      }
      const bibPath = join(paperDir(paperRoot), 'CITATIONS.bib');
      const gate4 = await reCheckFinalMd(finalMd, draftMd, bibPath);
      if (!gate4.passed) {
        process.stdout.write(
          `pensmith done: GATE-04 BLOCKED — FINAL.md failed re-verification: ${gate4.reason}\n`,
        );
        process.exitCode = EXIT_REFUSED;
        return refuseHumanized({ ok: false });
      }
      // FINAL.md is what is exported, so its citations are checked as well
      // (reCheckFinalMd has just run Pass 3 on it). It cites exactly the works
      // DRAFT.md cites, so its warnings are the ones already printed. The
      // sections are read again: one edited since the gate is checked as it is now.
      const finalCheck = await recheckExportText(paperRoot, finalMd, { pass3: false, label: '.paper/FINAL.md', bibText });
      if (finalCheck.blocked) {
        return refuseHumanized(refuseExport('export refused (a citation in the humanized FINAL.md does not pass when checked again)', finalCheck.reasons));
      }
    }

    // The export confirmation. Pass-2 UNSUPPORTED rows are read from the
    // section VERIFICATION.md files: that is what feeds the confirmation.
    const pass2Results = readSectionUnsupported(paperRoot);
    const cancel = async (): Promise<{ ok: false }> => {
      process.stdout.write('pensmith done: export cancelled by user.\n');
      process.exitCode = EXIT_REFUSED;
      if (finalPath !== null) await removePath(finalPath);
      await closeGate(paperRoot, 'export');
      return { ok: false };
    };

    if (answer === false) return cancel();
    if (answer === null && args.yolo !== true) {
      // With no terminal there is nobody to ask. Keep the audit for the
      // user's answer, report the pending decision and stop; never read stdin
      // for it and never treat silence as a yes.
      if (!canAskInTerminal(process.stderr)) {
        const issues = collectGateIssues({ pass2Results, pass4Results, plagiarismResults });
        const record = keptGate && reused
          ? keptGate
          : await openGate(paperRoot, {
            gate: 'export',
            args: { format, raw: args.raw === true },
            summary: pendingExportSummary(issues, format, finalPath !== null ? '.paper/FINAL.md' : '.paper/DRAFT.md'),
            options: ['export', 'cancel'],
            default: ['cancel'],
            // Bound to the staged bytes checked above, not to the file as it is
            // now: a text changed during the checks is audited again.
            binding: { ...binding, staged_sha256: finalBytes === null ? null : sha256(finalBytes) },
            payload: audit,
            shown: { pending: EXPORT_PENDING, extra: exportShown(issues) },
          });
        // The issues as they are now: a section's VERIFICATION.md can change while the audit is kept.
        stopForAnswer(
          'pensmith done: exporting needs your confirmation and there is no terminal to ask in. Nothing was exported; the audit is kept until you answer.',
          record,
          EXPORT_PENDING,
          exportShown(issues),
        );
        return { ok: false, pending: true, ref: record.ref };
      }
      const gateResult = await runDoneGate({
        pass2Results,
        pass4Results,
        plagiarismResults,
        yolo: false,
        approve: () => confirmOrNo(EXPORT_CONFIRM_QUESTION),
      });
      if (gateResult.exported !== true) return cancel();
    }
    await closeGate(paperRoot, 'export');

    // The export, into the exporter's own export folder.

    // The user's chosen citation style, else the discipline preset.
    const citation = resolveCitationStyle(paperRoot);
    if (citation.warning) process.stderr.write(`pensmith done: WARN — ${citation.warning}\n`);

    // The humanized text exports under FINAL's name, as it will be kept.
    const finalMdPath = paperFinalFile(paperRoot);
    const exported = finalMd ?? draftMd;
    let result: Awaited<ReturnType<typeof exportDraft>>;
    try {
      result = await exportDraft({
        inputPath: finalMd !== null ? finalMdPath : draftPath,
        markdown: exported,
        bibText,
        format,
        paperRoot,
        pandocPresent: pandoc,
        style: citation.style,
      });
    } catch (err) {
      if (!(err instanceof ExportError)) throw err;
      if (finalPath !== null) await removePath(finalPath);
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

    // The export happened: FINAL.md is the text it shipped (humanized, or the
    // compiled draft itself), and EXPORT.json binds it to the compiled draft
    // it was checked against. The router counts the paper done only while
    // both still match (a recompile moves FINAL.md aside).
    await atomicWriteFile(finalMdPath, exported);
    await writeExportRecord(paperRoot, {
      $schemaVersion: 1,
      exported_at: new Date().toISOString(),
      draft_sha256: binding.draft_sha256,
      final_sha256: sha256(Buffer.from(exported, 'utf8')),
      format,
      humanized: finalMd !== null,
    });
    if (finalPath !== null) await removePath(finalPath);

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
