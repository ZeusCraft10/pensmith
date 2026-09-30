// bin/lib/compile.ts — the Phase-4 compile pipeline (COMP-01..07, ARCH-20).
//
// Phase 4 Plan 04-05 — the phase keystone. runCompile composes the Phase 1-3
// chokepoints into a single, lock-guarded, read-only-on-sections pipeline that
// produces .paper/DRAFT.md + .paper/COMPILE-REPORT.md (it never rewrites
// .paper/CITATIONS.bib — BRDTH-01). Every write routes through the D-07 atomicWriteFile
// sole-writer chokepoint; section files are NEVER written (ARCH-20).
//
// Pipeline (04-RESEARCH §F, with the CANONICAL COMP meanings from this plan):
//   0. Acquire .paper/.compile.lock for the WHOLE run (§P-6 — no mid-pipeline
//      race on the output files).
//   1. parseOutline; for each section in OUTLINE order (sort by n — D-11):
//        - read PLAN.md frontmatter (assigned_sources, verified_against_draft_hash,
//          slug) + the section's DRAFT.md bytes + its VERIFICATION.md.
//        - LOCAL RECORDS ADD REFUSALS, NEVER REMOVE THEM (D-20-04): a missing
//          PLAN.md / DRAFT.md / VERIFICATION.md, a missing or `failed` Status
//          line, a PLAN.md write block (FEED-04) or `failed` status, a
//          --dry-run verification outside --dry-run (RUN-27) refuse.
//        - STALENESS (COMP-01 / D-08): if verified_against_draft_hash !=
//          computeDraftHash(draftBytes, assigned_sources) → WARN + re-verify
//          through the injected seam (production: verify.ts verifySection with
//          the advisory passes off — it rewrites that section's VERIFICATION.md
//          and PLAN.md, never a DRAFT.md). A re-verify failure refuses; an
//          all-pass records a Compile-Staleness-Resolved event.
//        - RECOMPUTE (VRFY-25, D-20-23): the ONE gate core (verify/gate.ts)
//          over the section's EXACT draft bytes with its assigned_sources and
//          quote acceptances — every blocking row refuses, whatever the local
//          files say (a forged VERIFICATION.md or PLAN.md cannot pass it).
//      If ANY refuse reason was collected, REFUSE: do NOT write .paper/DRAFT.md.
//   2. Concatenate section drafts in OUTLINE order (COMP-02), each normalized to
//      exactly one trailing '\n', joined with '\n\n'.
//   3. N-1 per-boundary smoothing (COMP-03 / D-12 / D-13): substitute
//      [@key] → {{cite_K_M}} BEFORE the smoother call (the model never sees raw
//      tokens); after the call, require output placeholder-set == input set —
//      any drift REJECTS that boundary (keep original prose) and records a
//      Transitions-Changed rejection. Then run the consistency scan (COMP-04,
//      flags only) and citation density (COMP-05, warn-only vs discipline target).
//   4. atomicWriteFile DRAFT.md + COMPILE-REPORT.md (schema v1, D-14) +
//      COMPILE-INPUTS.json v2 (the compiled sections' content and verified
//      hashes, and the sha256 of the DRAFT.md written — the router and done
//      read it, VRFY-27). compile never writes LIBRARY.json,
//      .paper/CITATIONS.bib or last_verified: the bib stays the full library
//      rendered from LIBRARY.json by bin/lib/library.ts (BRDTH-01 / D-17-43);
//      citeproc renders cited keys only. Under --dry-run the stub-draft marker
//      lines are removed from the compiled draft (VRFY-24).
//
// The smoother + re-verify transports are injectable seams so CI never touches a
// live model. Production callers (bin/cli/compile.ts) wire verify.ts
// verifySection as the re-verify; the gate core is not injectable.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir, sectionDraft, sectionPlan, sectionVerification } from './paths.js';
import { loadOutline } from './outline.js';
import { orderedOutlineSections, outlineSectionId, parseOutline, type ParsedOutlineSection } from './outline-parse.js';
import { loadFrontmatterDoc } from './frontmatter.js';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { computeDraftHash } from './draft-hash.js';
import { extractCitedKeysForVerification, replaceCitations } from './citation-token.js';
import { runConsistencyScan, type SectionSpan } from './consistency-scan.js';
import { computeCitationDensity } from './citation-density.js';
import {
  renderCompileReport,
  citationDensityForReport,
  type TransitionEntry,
  type ConsistencyEntry,
  type StalenessEntry,
} from './compile-report.js';
import { sectionWriteBlockReason } from './plan-status.js';
import { networkMode } from './http-mock.js';
import { writeCompileInputs } from './compile-inputs.js';
import { outlineProblem, sectionRegistryProblem } from './section-registry.js';
import { recomputeGate, gateRefusals, loadBibliography, stripStubMarker, type AcceptedQuote, type ByoQuote } from './verify/gate.js';
import { verificationRecordReasons } from './verify/verification-md.js';
import { readQuoteAcceptances, sectionDirOfPlan } from './quote-acceptance.js';

/** The boundary window handed to the (injectable) smoother seam. */
export interface SmoothBoundaryInput {
  /** Title of the section that ENDS at this boundary. */
  sectionATitle: string;
  /** Last paragraph of section A, with [@key] already → {{cite_K_M}} placeholders. */
  tail: string;
  /** Title of the section that STARTS at this boundary. */
  sectionBTitle: string;
  /** First paragraph of section B, with [@key] already → {{cite_K_M}} placeholders. */
  head: string;
}

/** The re-verify seam input (staleness path — Pass 1+3 only). */
export interface ReVerifyInput {
  n: number;
  slug: string;
  /** The section's letter (§1a), absent for §1 (GRND-09). */
  suffix?: string;
  /** Present ONLY so a test can prove Pass 2/4 are never wired here. */
  runPass2?: () => void;
  runPass4?: () => void;
}

export interface ReVerifyResult {
  passed: boolean;
  /** Citekeys that re-verify flagged (named in the refuse reason on failure). */
  failingCitekeys: string[];
  /** The re-verify's own refusal lines (the gate core's wording), when it has them. */
  reasons?: string[];
}

export interface RunCompileOpts {
  paperRoot: string;
  yolo?: boolean;
  /** Enable the opt-in heading-tense consistency heuristic (COMP-04). */
  lintHeadings?: boolean;
  /** Discipline preset for the citation-density target (COMP-05). */
  discipline?: string;
  /**
   * Boundary smoother seam. Returns the rewritten boundary text (rewritten
   * tail, a blank line, rewritten head). The pipeline owns placeholder
   * substitution + post-call token-set equality. Omit → no smoothing (raw concat).
   */
  smoothBoundary?: (input: SmoothBoundaryInput) => Promise<string>;
  /**
   * Staleness re-verify seam (Pass 1 + Pass 3 only — D-08). Omit → a stale
   * section is treated as a re-verify failure (fail-safe: never let a stale
   * section escape unverified). Production wires runPass1 + runPass3.
   */
  reVerify?: (input: ReVerifyInput) => Promise<ReVerifyResult>;
  /** WARN sink (default: process.stderr). */
  onWarn?: (msg: string) => void;
}

export interface CompileResult {
  refused: boolean;
  refuseReasons?: string[];
  draftPath?: string;
  reportPath?: string;
  bibPath?: string;
  sectionsCount: number;
  staleResolvedCount: number;
}

interface LoadedSection {
  outline: ParsedOutlineSection;
  slug: string;
  /** Normalized to exactly one trailing '\n'. */
  draft: string;
  draftBytes: Buffer;
  assignedSources: string[];
  storedHash: string | null;
  /** PLAN.md `status`. */
  planStatus: string | null;
  /** Set when the PLAN.md says the draft must not ship (a failed or unfinished write, FEED-04). */
  writeBlock: string | null;
}

/** Normalize a draft to end in exactly one '\n' (§F). */
function normalizeTrailingNewline(s: string): string {
  return s.replace(/\n+$/, '') + '\n';
}

/** Split markdown into paragraphs (blocks separated by blank lines). */
function splitParagraphs(md: string): string[] {
  return md.split(/\n\s*\n/);
}

/** First non-empty paragraph index in a paragraph list. */
function firstParaIdx(paras: string[]): number {
  for (let i = 0; i < paras.length; i += 1) {
    if ((paras[i] ?? '').trim().length > 0) return i;
  }
  return -1;
}

/** Last non-empty paragraph index in a paragraph list. */
function lastParaIdx(paras: string[]): number {
  for (let i = paras.length - 1; i >= 0; i -= 1) {
    if ((paras[i] ?? '').trim().length > 0) return i;
  }
  return -1;
}

/** The placeholder family is disjoint from CITATION_TOKEN_RE by construction. */
function makePlaceholder(k: number, m: number): string {
  return `{{cite_${k}_${m}}}`;
}

/** Extract the set of {{cite_K_M}} placeholder tokens from a string. */
function placeholderSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const m of s.matchAll(/\{\{cite_\d+_\d+\}\}/g)) set.add(m[0]);
  return set;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Substitute every citation in `text` with a fresh {{cite_K_M}} placeholder.
 * Returns the substituted text and the placeholder→citation restore map.
 * Every citation is masked — a bare `[@key]`, but also a mixed-case key, a
 * locator, a multi-key cluster, `[-@k]`, `@{k}` and a narrative `@k`
 * (citation-token.ts replaceCitations over findCitations) — so the smoother
 * can never rewrite or drop a citation the placeholder-set check would not
 * see (fail closed; Phase 19 review round 2, D-18-40).
 */
function substitutePlaceholders(text: string, k: number): { masked: string; restore: Map<string, string> } {
  const restore = new Map<string, string>();
  let m = 0;
  const masked = replaceCitations(text, (cluster) => {
    const ph = makePlaceholder(k, m);
    m += 1;
    restore.set(ph, cluster.text);
    return ph;
  });
  return { masked, restore };
}

/** Restore every {{cite_K_M}} placeholder back to its [@key]. */
function restorePlaceholders(text: string, restore: Map<string, string>): string {
  let out = text;
  for (const [ph, token] of restore) {
    out = out.split(ph).join(token);
  }
  return out;
}

async function loadSection(
  paperRoot: string,
  outlineSection: ParsedOutlineSection,
): Promise<LoadedSection | string> {
  // GRND-09: the section's folder is found by its slug (`NN[a]-<slug>`).
  const draftPath = sectionDraft(outlineSection.n, outlineSection.slug, paperRoot);
  const planPath = sectionPlan(outlineSection.n, outlineSection.slug, paperRoot);
  const id = outlineSectionId(outlineSection);
  if (!existsSync(planPath)) return `missing PLAN.md or DRAFT.md (no PLAN.md) — run \`pensmith plan ${id}\``;
  if (!existsSync(draftPath)) return `missing PLAN.md or DRAFT.md (no DRAFT.md) — run \`pensmith write ${id}\``;

  const draftBytes = readFileSync(draftPath);
  // CONF-04: the versioned PLAN.md reader (a v0 file is migrated in memory; a
  // newer one is refused with "upgrade pensmith"). compile writes a section's
  // PLAN.md only through its staleness re-verify.
  let frontmatter: Record<string, unknown>;
  try {
    ({ frontmatter } = await loadFrontmatterDoc('plan', planPath));
  } catch (e) {
    return `PLAN.md cannot be read (${(e as Error).message.split('\n')[0] ?? ''}) — fix it, or re-plan with \`pensmith plan ${id}\``;
  }
  const assignedSources = Array.isArray(frontmatter['assigned_sources'])
    ? (frontmatter['assigned_sources'] as unknown[]).map(String)
    : [];
  const rawHash = frontmatter['verified_against_draft_hash'];
  const storedHash = typeof rawHash === 'string' ? rawHash : null;

  return {
    outline: outlineSection,
    slug: outlineSection.slug,
    draft: normalizeTrailingNewline(draftBytes.toString('utf8')),
    draftBytes,
    assignedSources,
    storedHash,
    planStatus: typeof frontmatter['status'] === 'string' ? frontmatter['status'] : null,
    writeBlock: sectionWriteBlockReason(frontmatter, id),
  };
}

/**
 * Run the Phase-4 compile pipeline. See module header for the full contract.
 */
export async function runCompile(opts: RunCompileOpts): Promise<CompileResult> {
  const warn = opts.onWarn ?? ((m: string) => process.stderr.write(`${m}\n`));
  const lockResource = join(paperDir(opts.paperRoot), '.compile.lock');

  return withLock(lockResource, async (): Promise<CompileResult> => {
    // ---- Step 1: load sections in OUTLINE order + refuse-gate + staleness ----
    // Audit M2: a missing / section-less OUTLINE.md is a REFUSAL (the CLI prints
    // refuseReasons), not a raw parseOutline stack trace. loadOutline returns ''
    // for an absent file and parseOutline throws "no section table" on '' or a
    // placeholder, so both degenerate cases land here gracefully.
    const raw = await loadOutline(opts.paperRoot);
    let outline: ReturnType<typeof parseOutline>;
    try {
      outline = parseOutline(raw);
    } catch (e) {
      // Review round 3: a present but broken OUTLINE.md (a hand edit with one
      // bad row) names parseOutline's line-numbered reason and the fix; only
      // a missing or table-less one says "run pensmith outline".
      const problem = outlineProblem(opts.paperRoot);
      return {
        refused: true,
        refuseReasons: [
          `no usable outline: ${problem ?? `.paper/OUTLINE.md has no section table (${(e as Error).message.replace(/^outline-parse:\s*/, '')}) — run 'pensmith outline' first`}`,
        ],
        sectionsCount: 0,
        staleResolvedCount: 0,
      };
    }
    if (outline.sections.length === 0) {
      return {
        refused: true,
        refuseReasons: [
          "no sections in .paper/OUTLINE.md — run 'pensmith outline' to populate the section table",
        ],
        sectionsCount: 0,
        staleResolvedCount: 0,
      };
    }
    // Review round 2 (section-registry.ts): STATE.json is the authority on the
    // paper's sections. When the user's OUTLINE.md lists other sections, compile
    // would compile a different set than is registered — refuse, naming the fix.
    const registry = sectionRegistryProblem(opts.paperRoot);
    if (registry !== null) {
      return { refused: true, refuseReasons: [registry], sectionsCount: 0, staleResolvedCount: 0 };
    }
    // D-11 / GRND-09: OUTLINE order is (n, suffix) — §1 < §1a < §2.
    const ordered = orderedOutlineSections(outline);

    const loaded: LoadedSection[] = [];
    const refuseReasons: string[] = [];
    const stalenessResolved: StalenessEntry[] = [];
    const acceptedQuotes: AcceptedQuote[] = [];
    const byoQuotes: ByoQuote[] = [];
    const verifiedHashes = new Map<string, string>();
    const dryRun = networkMode().dryRun;
    // The one bibliography every section's gate reads (entry by entry; an
    // unreadable or broken file is a REFUSED reason through the rows, never a stack).
    const bib = loadBibliography(opts.paperRoot);

    for (const os of ordered) {
      // GRND-09: the section as the user types it (`1a`), so a refusal names
      // the command that fixes THIS section, never its neighbour §1.
      const id = outlineSectionId(os);
      const label = `section ${id} (${os.slug})`;
      const sec = await loadSection(opts.paperRoot, os);
      if (typeof sec === 'string') {
        refuseReasons.push(`${label}: ${sec}`);
        continue;
      }
      loaded.push(sec);

      // FEED-04 (D-18-25): a failed or unfinished write keeps the OLDER draft on
      // disk; the router reports the section as attention, so compile must not
      // ship that older draft as if it were the section.
      if (sec.writeBlock !== null) {
        refuseReasons.push(`${label}: ${sec.writeBlock}`);
        continue;
      }

      // Staleness (COMP-01 / D-08): recompute the per-section hash.
      const freshHash = computeDraftHash(sec.draftBytes, sec.assignedSources);
      if (sec.storedHash !== freshHash) {
        warn(`WARN: ${label} stale — re-verifying (Pass 1+3)`);
        const reVerify =
          opts.reVerify ??
          (async () => ({ passed: false, failingCitekeys: [] } as ReVerifyResult));
        // The re-verify rewrites this section's VERIFICATION.md and PLAN.md
        // (production: verifySection, advisory passes off). Its verdict is
        // never the last word: the gate core below recomputes the section
        // whatever the seam answered (D-20-23).
        const result = await reVerify(os.suffix !== undefined ? { n: os.n, slug: os.slug, suffix: os.suffix } : { n: os.n, slug: os.slug });
        if (!result.passed) {
          const reasons = result.reasons ?? [];
          if (reasons.length > 0) {
            for (const r of reasons) refuseReasons.push(`${label}: staleness re-verify FAILED — ${r}`);
          } else {
            const named =
              result.failingCitekeys.length > 0
                ? result.failingCitekeys.map((ck) => `[@${ck}]`).join(', ')
                : '(stale, re-verify failed)';
            refuseReasons.push(`${label}: staleness re-verify FAILED — ${named}`);
          }
          continue;
        }
        stalenessResolved.push({
          section: `${id} (${os.slug})`,
          prior_hash: (sec.storedHash ?? 'null').slice(0, 12),
          new_hash: freshHash.slice(0, 12),
          re_verify_passed: true,
        });
      } else {
        // A current verification's own record can only add refusals (D-20-04);
        // the recomputation below still runs, so the refusal names the rows.
        const verifPath = sectionVerification(os.n, os.slug, opts.paperRoot);
        const verificationMd = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : null;
        const recordReasons = verificationRecordReasons(verificationMd, id, freshHash, dryRun);
        if (sec.planStatus === 'failed' && !recordReasons.some((r) => r.startsWith("VERIFICATION.md Status is 'failed'"))) {
          recordReasons.push(`PLAN.md status is 'failed' — repair the section, then \`pensmith verify ${id}\``);
        }
        for (const reason of recordReasons) refuseReasons.push(`${label}: ${reason}`);
      }

      // VRFY-25 (D-20-23): the ONE gate core over the EXACT bytes compile
      // concatenates, with the section's assigned_sources and quote acceptances.
      const planPath = sectionPlan(os.n, os.slug, opts.paperRoot);
      const gate = await recomputeGate({
        root: opts.paperRoot,
        text: sec.draftBytes.toString('utf8'),
        allowedKeys: new Set(sec.assignedSources),
        scope: { kind: 'section', id },
        dryRun,
        acceptanceSets: [{ currentDraftHash: freshHash, acceptances: readQuoteAcceptances(sectionDirOfPlan(planPath)), section: id }],
        bib,
      });
      const refusals = gateRefusals(gate, { kind: 'section', id });
      if (refusals.length > 0) {
        for (const r of refusals) refuseReasons.push(`${label}: ${r}`);
        continue;
      }
      acceptedQuotes.push(...gate.accepted.map((a) => ({ ...a, section: id })));
      byoQuotes.push(...gate.byoQuotes);
      verifiedHashes.set(id, freshHash);
    }

    // REFUSE: no DRAFT.md write, no bib regen (COMP-01 — bad citation never escapes).
    if (refuseReasons.length > 0) {
      for (const r of refuseReasons) warn(`REFUSE: ${r}`);
      return {
        refused: true,
        refuseReasons,
        sectionsCount: loaded.length,
        staleResolvedCount: stalenessResolved.length,
      };
    }

    // ---- Step 2: concat in OUTLINE order (COMP-02) -------------------------
    // VRFY-24: a --dry-run preview's stub drafts carry the stub-draft marker;
    // the compiled dry-run draft (and so every dry-run export) does not.
    if (dryRun) for (const s of loaded) s.draft = normalizeTrailingNewline(stripStubMarker(s.draft));
    // Keep per-section draft strings so per-boundary smoothing can replace only
    // the adjacent paragraphs without disturbing the rest of each section.
    const drafts = loaded.map((s) => s.draft);

    // ---- Step 3: N-1 per-boundary smoothing (COMP-03 / D-12 / D-13) --------
    const transitions: TransitionEntry[] = [];
    for (let k = 0; k < drafts.length - 1; k += 1) {
      const left = splitParagraphs(drafts[k] ?? '');
      const right = splitParagraphs(drafts[k + 1] ?? '');
      const li = lastParaIdx(left);
      const ri = firstParaIdx(right);
      if (li === -1 || ri === -1) continue; // empty section → nothing to smooth

      const tailRaw = left[li] ?? '';
      const headRaw = right[ri] ?? '';
      const beforeChars = tailRaw.length + headRaw.length;
      // The boundary between the two sections' ids (GRND-09: `1→1a`, `1a→2`).
      const leftSec = loaded[k] as LoadedSection;
      const rightSec = loaded[k + 1] as LoadedSection;
      const boundary = `${outlineSectionId(leftSec.outline)}→${outlineSectionId(rightSec.outline)}`;

      if (!opts.smoothBoundary) {
        transitions.push({ boundary, status: 'skipped', before_chars: beforeChars, after_chars: beforeChars });
        continue;
      }

      // D-13: mask [@key] → {{cite_K_M}} BEFORE the model sees the window.
      const tailMask = substitutePlaceholders(tailRaw, k);
      const headMask = substitutePlaceholders(headRaw, k + 1);
      const inputSet = new Set<string>([...placeholderSet(tailMask.masked), ...placeholderSet(headMask.masked)]);

      let smoothed: string;
      try {
        smoothed = await opts.smoothBoundary({
          sectionATitle: loaded[k]?.outline.title ?? '',
          tail: tailMask.masked,
          sectionBTitle: loaded[k + 1]?.outline.title ?? '',
          head: headMask.masked,
        });
      } catch (err) {
        // Smoothing is best-effort prose — a seam error NEVER refuses compile.
        warn(`WARN: boundary ${k + 1}→${k + 2} smoothing threw (${err instanceof Error ? err.message : String(err)}) — keeping original prose`);
        transitions.push({ boundary, status: 'rejected', before_chars: beforeChars, after_chars: beforeChars });
        continue;
      }

      // D-13: post-call token-set equality. ANY drift → reject (keep original).
      const outputSet = placeholderSet(smoothed);
      if (!setsEqual(inputSet, outputSet)) {
        warn(`WARN: boundary ${k + 1}→${k + 2} smoothing rejected — citation placeholder set drifted; keeping original prose`);
        transitions.push({ boundary, status: 'rejected', before_chars: beforeChars, after_chars: beforeChars });
        continue;
      }

      // Accepted: split the smoothed output back into rewritten tail + head and
      // restore the real [@key] tokens (mask maps merged — placeholders are
      // unique across the K / K+1 namespaces).
      const restore = new Map<string, string>([...tailMask.restore, ...headMask.restore]);
      const parts = smoothed.split(/\n\s*\n/);
      const newTail = restorePlaceholders((parts[0] ?? smoothed), restore);
      const newHead = restorePlaceholders(parts.length > 1 ? parts.slice(1).join('\n\n') : '', restore);

      // D-18-40: the placeholders cover every citation the reader finds, but
      // the model could still write a NEW one (or rebuild one from its prose)
      // — a citation no section verified. The smoothed boundary must cite
      // exactly the keys the original did (the one fail-closed grammar), else
      // it is rejected like a drift.
      const citedBefore = new Set(extractCitedKeysForVerification(`${tailRaw}\n\n${headRaw}`));
      const citedAfter = new Set(extractCitedKeysForVerification(`${newTail}\n\n${newHead}`));
      if (!setsEqual(citedBefore, citedAfter)) {
        warn(`WARN: boundary ${k + 1}→${k + 2} smoothing rejected — the smoothed text cites different sources; keeping original prose`);
        transitions.push({ boundary, status: 'rejected', before_chars: beforeChars, after_chars: beforeChars });
        continue;
      }
      left[li] = newTail;
      if (newHead.trim().length > 0) right[ri] = newHead;
      drafts[k] = left.join('\n\n');
      drafts[k + 1] = right.join('\n\n');
      transitions.push({ boundary, status: 'smoothed', before_chars: beforeChars, after_chars: newTail.length + newHead.length });
    }

    // Build the compiled manuscript (outline order, one blank line between).
    let cursor = 0;
    const spans: SectionSpan[] = [];
    const pieces: string[] = [];
    for (let i = 0; i < loaded.length; i += 1) {
      const piece = normalizeTrailingNewline(drafts[i] ?? '');
      const start = cursor;
      const sep = i < loaded.length - 1 ? '\n' : '';
      const block = piece + sep; // piece already ends with one '\n'; sep adds the blank line
      pieces.push(block);
      cursor += block.length;
      spans.push({ n: loaded[i]!.outline.n, slug: loaded[i]!.slug, start, end: cursor });
    }
    const compiled = pieces.join('');

    // Consistency scan (COMP-04, flags only) + citation density (COMP-05, warn).
    const consistencyWarnings = runConsistencyScan(compiled, spans, { lintHeadings: opts.lintHeadings === true });
    const consistencyEntries: ConsistencyEntry[] = consistencyWarnings.map((w) => ({ detail: w.detail }));

    const densityReport = computeCitationDensity(
      loaded.map((s) => ({ n: s.outline.n, suffix: s.outline.suffix, slug: s.slug, text: s.draft })),
      opts.discipline ?? 'default',
    );
    // GRND-06: citations per paragraph against the preset's band (PRD §8).
    const density = citationDensityForReport(densityReport);
    for (const w of densityReport.warnings) warn(`WARN: citation density — ${w.detail}`);

    // ---- Step 4: emit DRAFT + REPORT (COMP-07) -------------------------------
    // BRDTH-01 / D-17-43: compile never rewrites .paper/CITATIONS.bib. It is the
    // full research library, rendered from LIBRARY.json by bin/lib/library.ts
    // (the one writer); citeproc renders only the keys the draft cites. (The old
    // cited-only regeneration pruned the library and once emptied it — EXP-01.)
    const bibPath = join(paperDir(opts.paperRoot), 'CITATIONS.bib');

    const draftPath = join(paperDir(opts.paperRoot), 'DRAFT.md');
    await atomicWriteFile(draftPath, compiled);

    const reportPath = join(paperDir(opts.paperRoot), 'COMPILE-REPORT.md');
    const compiledAt = new Date().toISOString();
    const report = renderCompileReport({
      compiled_at: compiledAt,
      sections_count: loaded.length,
      stale_resolved_count: stalenessResolved.length,
      refuse_reasons: [],
      transitions,
      consistency_flags: consistencyEntries,
      citation_density: density.entries,
      citation_density_summary: density.summary,
      staleness_resolved: stalenessResolved,
      accepted_quotes: acceptedQuotes.map((a) => ({ section: a.section ?? '', id: a.id, citekey: a.citekey, excerpt: a.excerpt, accepted_at: a.acceptedAt, via: a.via })),
      local_file_quotes: byoQuotes.map((q) => ({ id: q.id, citekey: q.citekey, excerpt: q.snippet, file: q.localFile })),
    });
    await atomicWriteFile(reportPath, report);
    // What this compile was made from (compile-inputs.ts): the router decides
    // whether DRAFT.md is current from these content hashes, never from mtimes;
    // done checks the compiled DRAFT.md and every section's verified hash
    // against them (VRFY-27).
    await writeCompileInputs(
      opts.paperRoot,
      loaded.map((s) => ({ n: s.outline.n, suffix: s.outline.suffix, slug: s.slug })),
      compiledAt,
      { compiledDraftSha256: createHash('sha256').update(compiled, 'utf8').digest('hex'), verifiedHashes },
    );

    return {
      refused: false,
      draftPath,
      reportPath,
      bibPath,
      sectionsCount: loaded.length,
      staleResolvedCount: stalenessResolved.length,
    };
  });
}

export default runCompile;
