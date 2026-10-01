// bin/lib/done-gate.ts — the export gate done runs, in bin/lib (Phase 21, D-21-18,
// 21-PLAN §3.3).
//
// Moved out of bin/cli/done.ts (which re-exports every symbol) so the Tier-1
// done and humanize tools (PLUG-07, PLUG-10) and compile's report call the
// same functions done does:
//   - doneSections / runExportBlockingGate: the registered sections and what
//     their own records say (VRFY-26, VRFY-27; local records only ADD
//     refusals, D-20-04);
//   - recomputeExportGate: the ONE gate core (verify/gate.ts recomputeGate)
//     over the exact text done exports;
//   - citedKeySetChange: the cited-key diff a rewrite (the humanizer) must not
//     change (GATE-04);
//   - readUnsupportedClaims / unjudgedClaimSections / readAdvisoryPass2Rows:
//     the FAIL-SAFE reader of a section VERIFICATION.md's Pass-2 table
//     (HIGH-3) — done's UNSUPPORTED-claims gate (VRFY-22) and compile's
//     Advisory Findings (EXP-13) read it;
//   - sectionQuoteIndex: the section-local ids of the paper's quotes.
// Pure reads: nothing here writes a file.

import { readFileSync, existsSync } from 'node:fs';
import { sectionDraft, sectionPlan, sectionVerification } from './paths.js';
import { loadFrontmatterDocSync } from './frontmatter.js';
import { sectionWriteBlockReason } from './plan-status.js';
import { formatSectionId, sectionIdOf } from './section-id.js';
import { PASS2_TABLE_HEADER, PASS2_TABLE_HEADER_V1, quoteTextSha256 } from './verify/verdicts.js';
import { computeDraftHash } from './draft-hash.js';
import { outlineIdentitiesSync, registeredSectionsSync, sectionRegistryProblem, type SectionIdentity } from './section-registry.js';
import { verificationRecordReasons } from './verify/verification-md.js';
import { dryRunVerificationReason, parseBlockingVerdictRows, verdictRowReason } from './verify/verdict-rows.js';
import { recomputeGate, gateRefusals, loadBibliography, recheckKeys, type AcceptanceSet, type GateResult, type LoadedBibliography, type SectionQuoteRef } from './verify/gate.js';
import { extractQuotes } from './quote-extractor.js';
import { tryReadPaperConfigSync } from './config.js';
import { readQuoteAcceptances, sectionDirOfPlan } from './quote-acceptance.js';
import { extractCitedKeysForVerification } from './citation-token.js';
import { networkMode } from './http-mock.js';
import type { Pass2Result, Pass2Verdict } from './verify/pass2.js';

// ---------------------------------------------------------------------------
// UNCONDITIONAL export blocking gate (audit #3/#14; Phase 20 VRFY-26, VRFY-27)
// ---------------------------------------------------------------------------

export interface ExportBlock {
  blocked: boolean;
  reasons: string[];
  /**
   * The subset of `reasons` that are verifier refusals of a section that WAS
   * verified (a Status: failed, a --dry-run verification, a failed PLAN.md
   * status) — as opposed to a section never verified, a stale one or no
   * sections.
   */
  verdictReasons?: string[];
  /**
   * The blocking rows the sections' own VERIFICATION.md files list (a REPORT:
   * the export path recomputes them over the exact text instead). Read only
   * to word why there is no compiled draft — compile refused these sections
   * (RUN-09) — never to pass anything (D-20-04).
   */
  recordedBlocks?: string[];
}

/** One registered section as done reads it (VRFY-26: STATE.json + OUTLINE.md, never a directory listing). */
export interface DoneSection {
  readonly identity: SectionIdentity;
  /** `1`, `1a`. */
  readonly id: string;
  readonly planPath: string;
  readonly assignedSources: string[];
  /** PLAN.md verified_against_draft_hash, or null. */
  readonly verifiedHash: string | null;
  /** computeDraftHash of the section's DRAFT.md now, or null when it has none. */
  readonly currentDraftHash: string | null;
}

/** The PLAN.md frontmatter of a section, or null (absent or unreadable). Never throws. */
function planFrontmatter(planPath: string): Record<string, unknown> | null {
  if (!existsSync(planPath)) return null;
  try {
    return loadFrontmatterDocSync('plan', planPath).frontmatter;
  } catch {
    return null;
  }
}

/**
 * The sections compile compiles, with what done checks of each: the ones
 * STATE.json registers (OUTLINE.md must list the same — sectionRegistryProblem),
 * or OUTLINE.md's rows for a paper whose STATE.json registers none (compile
 * compiles those too). Never a directory listing. Never throws.
 */
export function doneSections(paperRoot: string): DoneSection[] {
  const out: DoneSection[] = [];
  const registered = registeredSectionsSync(paperRoot);
  const identities = registered !== null && registered.length > 0 ? registered : (outlineIdentitiesSync(paperRoot) ?? []);
  for (const identity of identities) {
    const id = formatSectionId(sectionIdOf(identity.n, identity.suffix));
    const planPath = sectionPlan(identity.n, identity.slug, paperRoot);
    const fm = planFrontmatter(planPath);
    const assignedSources = Array.isArray(fm?.['assigned_sources']) ? (fm['assigned_sources'] as unknown[]).map(String) : [];
    const rawHash = fm?.['verified_against_draft_hash'];
    let currentDraftHash: string | null = null;
    try {
      currentDraftHash = computeDraftHash(readFileSync(sectionDraft(identity.n, identity.slug, paperRoot)), assignedSources);
    } catch {
      currentDraftHash = null;
    }
    out.push({ identity, id, planPath, assignedSources, verifiedHash: typeof rawHash === 'string' ? rawHash : null, currentDraftHash });
  }
  return out;
}

/**
 * Re-assert the Core Value at EXPORT time from what the section records say
 * (audit #3/#14, VRFY-26, VRFY-27). done is independently reachable (explicit
 * `done`, bare `/pensmith`, `next`), so it never trusts that compile gated.
 * The sections come from STATE.json and OUTLINE.md (section-registry.ts,
 * doneSections) — never from a directory listing — and done refuses when:
 *   - OUTLINE.md and STATE.json disagree, or the paper has no section;
 *   - a section has no PLAN.md, no DRAFT.md or no VERIFICATION.md;
 *   - a section's last write failed or is unfinished (FEED-04);
 *   - its VERIFICATION.md has no Status line, says `failed`, or was written
 *     under --dry-run (outside --dry-run, RUN-27); its PLAN.md says `failed`;
 *   - it is stale: its verified_against_draft_hash is not the hash of its
 *     DRAFT.md now ("stale: §1 changed since verification — re-verify and
 *     recompile").
 * These local records can only ADD refusals (D-20-04): the verdicts
 * themselves are recomputed by the gate core over the exact text done
 * exports (recomputeExportGate). UNCONDITIONAL: neither `--raw` nor `--yolo`
 * bypasses it. Deterministic, offline, never throws.
 */
export function runExportBlockingGate(paperRoot: string): ExportBlock {
  const registry = sectionRegistryProblem(paperRoot);
  if (registry !== null) return { blocked: true, reasons: [registry], verdictReasons: [] };
  const sections = doneSections(paperRoot);
  if (sections.length === 0) {
    return {
      blocked: true,
      reasons: ["no sections are registered for this paper — this DRAFT.md was not produced by a gated compile; run 'pensmith outline' and 'pensmith compile' first"],
      verdictReasons: [],
    };
  }
  const reasons: string[] = [];
  const verdictReasons: string[] = [];
  const recordedBlocks: string[] = [];
  const dryRun = networkMode().dryRun;
  for (const s of sections) {
    const label = `section ${s.id} (${s.identity.slug})`;
    const fm = planFrontmatter(s.planPath);
    if (fm === null) {
      reasons.push(`${label}: missing or unreadable PLAN.md — run \`pensmith plan ${s.id}\``);
      continue;
    }
    // FEED-04: a failed or unfinished write left an OLDER draft in place; the
    // compiled DRAFT.md holds that older draft, so it must not be exported.
    const writeBlock = sectionWriteBlockReason(fm, s.id);
    if (writeBlock !== null) reasons.push(`${label}: ${writeBlock}`);
    if (s.currentDraftHash === null) {
      reasons.push(`${label}: missing DRAFT.md — run \`pensmith write ${s.id}\``);
      continue;
    }
    const vpath = sectionVerification(s.identity.n, s.identity.slug, paperRoot);
    let md: string | null = null;
    try {
      md = existsSync(vpath) ? readFileSync(vpath, 'utf8') : null;
    } catch {
      md = '';
    }
    // A section with NO VERIFICATION.md was never verified. It must BLOCK,
    // never be invisible (CodeRabbit #14).
    const record = verificationRecordReasons(md, s.id, s.currentDraftHash, dryRun);
    if (fm['status'] === 'failed') record.push(`PLAN.md status is 'failed' — repair the section, then \`pensmith verify ${s.id}\``);
    for (const r of record) {
      reasons.push(`${label}: ${r}`);
      if (md !== null && md !== '') verdictReasons.push(`${label}: ${r}`);
    }
    if (md !== null && md !== '' && dryRunVerificationReason(md, dryRun) === null) {
      for (const row of parseBlockingVerdictRows(md)) recordedBlocks.push(`${label}: ${verdictRowReason(row).replace(/<N>/g, s.id)}`);
    }
    // VRFY-27: the section's draft must be the one its verification judged.
    if (md !== null && s.verifiedHash !== s.currentDraftHash) {
      reasons.push(`${label}: stale: §${s.id} changed since verification — re-verify and recompile (\`pensmith verify ${s.id}\`, then \`pensmith compile\`)`);
    }
  }
  return { blocked: reasons.length > 0, reasons, verdictReasons, recordedBlocks };
}

/** Every compiled section's quote acceptances, bound to its draft hash NOW (D-20-22). */
export function exportAcceptanceSets(sections: readonly DoneSection[]): AcceptanceSet[] {
  return sections
    .filter((s) => s.currentDraftHash !== null)
    .map((s) => ({ currentDraftHash: s.currentDraftHash as string, acceptances: readQuoteAcceptances(sectionDirOfPlan(s.planPath)), section: s.id }));
}

/**
 * VRFY-26 (D-20-24): the ONE gate core over the exact text done exports (the
 * compiled DRAFT.md, or FINAL.md after the humanizer), with the union of the
 * sections' assigned_sources as the allowed keys and every section's quote
 * acceptances still bound to its current draft. Returns the gate result and
 * its refusal lines (empty when nothing blocks). Never writes a file.
 */
export async function recomputeExportGate(
  paperRoot: string,
  text: string,
  opts: { sections?: readonly DoneSection[]; bib?: LoadedBibliography; recheck?: boolean } = {},
): Promise<{ gate: GateResult; refusals: string[] }> {
  const sections = opts.sections ?? doneSections(paperRoot);
  const allowed = new Set(sections.flatMap((s) => s.assignedSources));
  const refresh = opts.recheck === true ? await recheckKeys(paperRoot, extractCitedKeysForVerification(text)) : undefined;
  const gate = await recomputeGate({
    root: paperRoot,
    text,
    allowedKeys: allowed,
    scope: { kind: 'paper' },
    dryRun: networkMode().dryRun,
    ...(refresh !== undefined ? { refresh } : {}),
    acceptanceSets: exportAcceptanceSets(sections),
    bib: opts.bib ?? loadBibliography(paperRoot),
  });
  return { gate, refusals: gateRefusals(gate, { kind: 'paper', quoteSections: sectionQuoteIndex(paperRoot, sections) }) };
}

/**
 * Every quote of the registered sections' drafts, by text hash → its section
 * and its id in that section (what `pensmith verify <section> --accept-quote`
 * takes): the paper-wide gate numbers quotes across the whole text, so its
 * refusals name the section's own id. Never throws.
 */
export function sectionQuoteIndex(paperRoot: string, sections: readonly DoneSection[]): Map<string, SectionQuoteRef> {
  const out = new Map<string, SectionQuoteRef>();
  let minWords: number | undefined;
  try {
    minWords = tryReadPaperConfigSync(paperRoot)?.verification?.quote_min_words;
  } catch {
    minWords = undefined;
  }
  for (const s of sections) {
    let draft: string;
    try {
      draft = readFileSync(sectionDraft(s.identity.n, s.identity.slug, paperRoot), 'utf8');
    } catch {
      continue;
    }
    for (const q of extractQuotes(draft, minWords !== undefined ? { minWords } : {})) {
      const hash = quoteTextSha256(q.text);
      if (!out.has(hash)) out.set(hash, { section: s.id, id: q.id });
    }
  }
  return out;
}

/**
 * The cited keys a humanized FINAL.md added or dropped against the compiled
 * draft (the broad Pandoc grammar), as one refusal line — or null when the
 * sets match. The humanizer only improves prose: it never adds, drops or
 * swaps a citation (GATE-04). The gate core then recomputes FINAL.md itself.
 */
export function citedKeySetChange(finalMd: string, draftMd: string): string | null {
  const finalKeys = new Set(extractCitedKeysForVerification(finalMd));
  const draftKeys = new Set(extractCitedKeysForVerification(draftMd));
  const added = [...finalKeys].filter((k) => !draftKeys.has(k));
  const dropped = [...draftKeys].filter((k) => !finalKeys.has(k));
  if (added.length === 0 && dropped.length === 0) return null;
  const parts: string[] = [];
  if (added.length > 0) parts.push(`added: [${added.join(', ')}]`);
  if (dropped.length > 0) parts.push(`dropped: [${dropped.join(', ')}]`);
  return `citekey-set mismatch after humanization — ${parts.join('; ')}`;
}

// ---------------------------------------------------------------------------
// readSectionUnsupported — the FAIL-SAFE section Pass-2 UNSUPPORTED reader (HIGH-3)
// ---------------------------------------------------------------------------

// PINNED Pass-2 table contract (HIGH-3). The SINGLE writer of this shape is
// bin/lib/verify/pass2.ts renderPass2Section — if that writer ever changes its
// table header or its bolded-verdict cell convention, the desync MUST be caught
// here (the parser fails safe rather than silently dropping UNSUPPORTED rows).
//   header:        verify/verdicts.ts PASS2_TABLE_HEADER (with the VRFY-22
//                  Evidence column) or PASS2_TABLE_HEADER_V1 (without it)
//   verdict cell:  **<VERDICT>**  (e.g. **UNSUPPORTED**)
//   empty section: _(no citations to judge)_
//   not judged:    _(not run — compile staleness re-verify; run `pensmith verify N`)_
//                  (bin/cli/verify.ts COMPILE_REVERIFY_NOT_RUN: compile re-verified a
//                  stale section with the advisory passes off, so its current
//                  draft has no claim-support judgment — not a desynced table)
const PASS2_HEADING = '## Pass-2';
const PASS2_EMPTY_MARKER = '_(no citations to judge)_';
/** The one-line body verify writes when Pass 2 did not judge the section's current draft. */
const PASS2_NOT_RUN_RE = /^[ \t]*_\(not run(?: —|:)[^\n]*\)_[ \t]*$/m;
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
 * True when the section's `## Pass-2` body is verify's one-line "not run"
 * marker (compile's staleness re-verify runs Pass 1 + Pass 3 only): the
 * current draft has no claim-support judgment, which done names instead of
 * inventing a claim (VRFY-22).
 */
function pass2NotRunOnDraft(md: string): boolean {
  const body = pass2Body(md);
  return body !== null && !body.some((l) => l.trim() === PASS2_TABLE_HEADER || l.trim() === PASS2_TABLE_HEADER_V1) && PASS2_NOT_RUN_RE.test(body.join('\n'));
}

/** The lines of the `## Pass-2` section (heading excluded), or null when there is none. */
function pass2Body(md: string): string[] | null {
  const lines = md.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => l.startsWith(PASS2_HEADING));
  if (headingIdx === -1) return null;
  const body: string[] = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if ((lines[i] ?? '').startsWith('## ')) break;
    body.push(lines[i] ?? '');
  }
  return body;
}

/**
 * Parse the ## Pass-2 table out of ONE section VERIFICATION.md: its
 * UNSUPPORTED rows. FAIL-SAFE (HIGH-3):
 *   - NO `## Pass-2` heading at all → return [] (nothing to report — clean).
 *   - the `_(no citations to judge)_` empty marker → return [] (clean).
 *   - the `_(not run — …)_` marker (no judgment of the current draft) → [];
 *     done names the section (unjudgedClaimSections), it invents no claim.
 *   - heading present + header matches the pinned contract + rows parse →
 *     return the **UNSUPPORTED** rows (filtering out SUPPORTED/PARTIAL/UNCLEAR).
 *   - heading present but the header does NOT match the pinned contract, OR a
 *     data row cannot be split into the expected 4 cells → return a synthetic
 *     `<unparseable>` UNSUPPORTED sentinel so hasIssues becomes true and the
 *     gate REQUIRES confirmation. NEVER a silent clean for a present-but-
 *     unparseable table.
 * Each row carries its 1-based position in the table (0 for the sentinel).
 */
function parseSectionPass2Rows(
  md: string,
  sectionName: string,
  keep: (verdict: Pass2Verdict) => boolean = (v) => v === 'UNSUPPORTED',
): Array<{ row: number; result: Pass2Result }> {
  const sentinel = (): Array<{ row: number; result: Pass2Result }> => [{ row: 0, result: unparseableSentinel(sectionName) }];
  // The body of the Pass-2 section (heading to the next `## ` or EOF). Absent → clean.
  const body = pass2Body(md);
  if (body === null) return [];
  const bodyText = body.join('\n');

  // Explicit empty-section marker → clean.
  if (bodyText.includes(PASS2_EMPTY_MARKER)) return [];
  // Not run on this draft (compile's staleness re-verify) → no judgment, no
  // claim: done names the section instead (unjudgedSections).
  if (pass2NotRunOnDraft(md)) return [];

  // The Pass-2 section is present but non-empty. Find the pinned header row
  // (5 columns with Evidence, or the 4-column layout written before Phase 20).
  const headerLineIdx = body.findIndex((l) => l.trim() === PASS2_TABLE_HEADER || l.trim() === PASS2_TABLE_HEADER_V1);
  if (headerLineIdx === -1) {
    // Heading present but the pinned 4-column header is missing → fail safe.
    return sentinel();
  }

  // Data rows start AFTER the header + the dashed separator line.
  const sepIdx = headerLineIdx + 1;
  const sep = (body[sepIdx] ?? '').trim();
  if (!/^\|[\s|:-]+\|$/.test(sep)) {
    // The separator is missing/malformed → fail safe (shape desync).
    return sentinel();
  }

  const columns = (body[headerLineIdx] ?? '').trim() === PASS2_TABLE_HEADER ? 5 : 4;
  const out: Array<{ row: number; result: Pass2Result }> = [];
  let row = 0;
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
    row += 1;
    if (cells.length !== columns) {
      // A row that does not parse into the header's cells → fail safe.
      return sentinel();
    }
    const [citekey, claimSentence, verdictCell, rationale, evidence = ''] = cells as [
      string,
      string,
      string,
      string,
      string | undefined,
    ];
    // The verdict cell is bolded: **<VERDICT>**. Strip the ** markers.
    const verdict = verdictCell.replace(/\*\*/g, '').trim();
    if (!VALID_VERDICTS.has(verdict)) {
      // A verdict cell that is not one of the four enum values → fail safe.
      return sentinel();
    }
    if (keep(verdict as Pass2Verdict)) {
      out.push({
        row,
        result: {
          citekey,
          claimSentence,
          verdict: verdict as Pass2Verdict,
          rationale,
          evidence,
        },
      });
    }
  }
  return out;
}

/** An UNSUPPORTED claim of one registered section, with where it is (VRFY-22). */
export interface UnsupportedClaim {
  /** `1`, `1a`. */
  readonly section: string;
  readonly slug: string;
  /** Its 1-based row in the section's Pass-2 table (0: the table could not be read). */
  readonly row: number;
  readonly result: Pass2Result;
}

/**
 * The UNSUPPORTED claims of the paper's REGISTERED sections (STATE.json +
 * OUTLINE.md; VRFY-26), with each claim's section and Pass-2 row — what the
 * `unsupported-claims` gate lists and `.paper/VERIFICATION.md` records a
 * decision for (VRFY-22). Defensive on I/O only (a missing or unreadable
 * VERIFICATION.md contributes nothing); fail safe on content (HIGH-3): a
 * present but unreadable table is one `<unparseable>` claim, never a silent
 * clean. A section whose current draft Pass 2 did not judge (compile's
 * staleness re-verify) has no claim here — unjudgedClaimSections names it.
 * Never throws.
 */
export function readUnsupportedClaims(paperRoot: string, sections: readonly DoneSection[] = doneSections(paperRoot)): UnsupportedClaim[] {
  const out: UnsupportedClaim[] = [];
  for (const s of sections) {
    const vPath = sectionVerification(s.identity.n, s.identity.slug, paperRoot);
    let md: string;
    try {
      if (!existsSync(vPath)) continue;
      md = readFileSync(vPath, 'utf8');
    } catch {
      continue;
    }
    const name = `${String(s.identity.n).padStart(2, '0')}${s.identity.suffix ?? ''}-${s.identity.slug}`;
    for (const r of parseSectionPass2Rows(md, name)) out.push({ section: s.id, slug: s.identity.slug, row: r.row, result: r.result });
  }
  return out;
}

/** A registered section whose current draft the advisory claim-support check (Pass 2) did not judge. */
export interface UnjudgedSection {
  /** `1`, `1a`. */
  readonly section: string;
  readonly slug: string;
}

/**
 * The registered sections whose VERIFICATION.md says Pass 2 was not run on the
 * draft it holds — compile re-verified them after their draft was edited, with
 * the advisory passes off (D-08; an unverifiable section whose draft did not
 * change keeps its judgments). done names them with the remedy (`pensmith verify N`)
 * instead of treating the marker as a claim (VRFY-22); Pass 2 is advisory, so
 * they never block. Never throws.
 */
export function unjudgedClaimSections(paperRoot: string, sections: readonly DoneSection[] = doneSections(paperRoot)): UnjudgedSection[] {
  const out: UnjudgedSection[] = [];
  for (const s of sections) {
    const vPath = sectionVerification(s.identity.n, s.identity.slug, paperRoot);
    try {
      if (existsSync(vPath) && pass2NotRunOnDraft(readFileSync(vPath, 'utf8'))) out.push({ section: s.id, slug: s.identity.slug });
    } catch {
      // unreadable: runExportBlockingGate reports it
    }
  }
  return out;
}

/** One line naming a section whose current draft has no claim-support judgment. */
export function unjudgedLine(u: UnjudgedSection): string {
  return `§${u.section} (${u.slug}): claim support (Pass 2, advisory) was not run on the current draft — compile re-verified it after the draft was edited; run \`pensmith verify ${u.section}\` to judge it`;
}


/** What a section's own VERIFICATION.md says about its advisory passes (COMPILE-REPORT Advisory Findings, EXP-13). */
export interface SectionAdvisory {
  /** `1`, `1a`. */
  readonly section: string;
  readonly slug: string;
  /**
   * `judged`: Pass 2 judged the current draft (its non-SUPPORTED rows follow);
   * `not-run`: the record says Pass 2 was not run on this draft (compile's
   * staleness re-verify, or an advisory stop); `absent`: no VERIFICATION.md or
   * no Pass-2 section.
   */
  readonly pass2: 'judged' | 'not-run' | 'absent';
  /** The Pass-2 rows that are not SUPPORTED (PARTIAL, UNSUPPORTED, UNCLEAR) with their 1-based table row; a table that cannot be read is one `<unparseable>` row (fail safe, HIGH-3). */
  readonly pass2Rows: ReadonlyArray<{ readonly row: number; readonly result: Pass2Result }>;
  /** `judged` / `not-run` / `absent`, as for Pass 2. */
  readonly pass4: 'judged' | 'not-run' | 'absent';
  /** The orphan sentences (a claim that carries no citation) Pass 4 listed, with their paragraph. */
  readonly orphans: ReadonlyArray<{ readonly paragraph: number; readonly sentence: string }>;
}

const PASS4_HEADING = '## Pass-4';

/** The lines of the `## Pass-4` section (heading excluded), or null when there is none. */
function pass4Body(md: string): string[] | null {
  const lines = md.split(/\r?\n/);
  const headingIdx = lines.findIndex((l) => l.startsWith(PASS4_HEADING));
  if (headingIdx === -1) return null;
  const body: string[] = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if ((lines[i] ?? '').startsWith('## ')) break;
    body.push(lines[i] ?? '');
  }
  return body;
}

/** The quoted sentences of a Pass-4 "Orphan sentences" cell (`"…" · "…" (audit)`). */
function orphanSentences(cell: string): string[] {
  const out: string[] = [];
  for (const part of cell.split(' · ')) {
    const m = /^"(.*)"(?: \(audit\))?$/.exec(part.trim());
    if (m) out.push(m[1] ?? '');
  }
  return out;
}

/**
 * The orphan sentences of a section record's Pass-4 table (verify/pass4.ts
 * renderPass4Section: `| Paragraph | Sentences | Claims | Orphans | Orphan
 * sentences |`, each sentence quoted, joined by ` · `). Never throws.
 */
function parsePass4Orphans(md: string): { state: 'judged' | 'not-run' | 'absent'; orphans: Array<{ paragraph: number; sentence: string }> } {
  const body = pass4Body(md);
  if (body === null) return { state: 'absent', orphans: [] };
  const hasTable = body.some((l) => l.trim().startsWith('| Paragraph |'));
  if (!hasTable && /^[ \t]*_\(not run(?: —|:)[^\n]*\)_[ \t]*$/m.test(body.join('\n'))) return { state: 'not-run', orphans: [] };
  const orphans: Array<{ paragraph: number; sentence: string }> = [];
  for (const line of body) {
    const t = line.trim();
    if (!t.startsWith('|') || t.startsWith('| Paragraph') || /^\|[\s|:-]+\|$/.test(t)) continue;
    const cells = t.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 5) continue;
    const paragraph = Number(cells[0]);
    if (!Number.isFinite(paragraph)) continue;
    for (const sentence of orphanSentences(cells.slice(4).join('|'))) orphans.push({ paragraph, sentence });
  }
  return { state: 'judged', orphans };
}

/**
 * Each registered section's advisory findings as its own VERIFICATION.md
 * records them (EXP-13, D-21-17): the Pass-2 rows that are not SUPPORTED and
 * the Pass-4 orphans — or that the passes were not run on the current draft.
 * The same fail-safe Pass-2 reader as done's UNSUPPORTED-claims gate (HIGH-3).
 * Never throws.
 */
export function readSectionAdvisory(paperRoot: string, sections: readonly DoneSection[] = doneSections(paperRoot)): SectionAdvisory[] {
  const out: SectionAdvisory[] = [];
  for (const s of sections) {
    const vPath = sectionVerification(s.identity.n, s.identity.slug, paperRoot);
    let md: string | null = null;
    try {
      md = existsSync(vPath) ? readFileSync(vPath, 'utf8') : null;
    } catch {
      md = null;
    }
    if (md === null) {
      out.push({ section: s.id, slug: s.identity.slug, pass2: 'absent', pass2Rows: [], pass4: 'absent', orphans: [] });
      continue;
    }
    const name = `${String(s.identity.n).padStart(2, '0')}${s.identity.suffix ?? ''}-${s.identity.slug}`;
    const p2Body = pass2Body(md);
    const notRun = p2Body !== null && !p2Body.some((l) => l.trim() === PASS2_TABLE_HEADER || l.trim() === PASS2_TABLE_HEADER_V1) && PASS2_NOT_RUN_RE.test(p2Body.join('\n'));
    const pass2 = p2Body === null ? 'absent' : notRun ? 'not-run' : 'judged';
    const pass2Rows = pass2 === 'judged' ? parseSectionPass2Rows(md, name, (v) => v !== 'SUPPORTED') : [];
    const p4 = parsePass4Orphans(md);
    out.push({ section: s.id, slug: s.identity.slug, pass2, pass2Rows, pass4: p4.state, orphans: p4.orphans });
  }
  return out;
}
