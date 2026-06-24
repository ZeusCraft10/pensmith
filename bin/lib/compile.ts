// bin/lib/compile.ts — the Phase-4 compile pipeline (COMP-01..07, ARCH-20).
//
// Phase 4 Plan 04-05 — the phase keystone. runCompile composes the Phase 1-3
// chokepoints into a single, lock-guarded, read-only-on-sections pipeline that
// produces .paper/DRAFT.md + .paper/COMPILE-REPORT.md and regenerates
// .paper/CITATIONS.bib. Every write routes through the D-07 atomicWriteFile
// sole-writer chokepoint; section files are NEVER written (ARCH-20).
//
// Pipeline (04-RESEARCH §F, with the CANONICAL COMP meanings from this plan):
//   0. Acquire .paper/.compile.lock for the WHOLE run (§P-6 — no mid-pipeline
//      race on the output files).
//   1. parseOutline; for each section in OUTLINE order (sort by n — D-11):
//        - read PLAN.md frontmatter (assigned_sources, verified_against_draft_hash,
//          slug) + the section's DRAFT.md bytes + its VERIFICATION.md.
//        - REFUSE-GATE (COMP-01): any FABRICATED / MIS-CITED / quote-NOT_FOUND
//          verdict in VERIFICATION.md → collect a refuse reason naming the
//          section + citekey.
//        - STALENESS (COMP-01 / D-08): if verified_against_draft_hash !=
//          computeDraftHash(draftBytes, assigned_sources) → WARN + re-verify
//          (Pass 1 + Pass 3 ONLY, NEVER Pass 2/4). A re-verify failure adds a
//          refuse reason; an all-pass records a Compile-Staleness-Resolved event.
//      If ANY refuse reason was collected, REFUSE: do NOT write .paper/DRAFT.md.
//   2. Concatenate section drafts in OUTLINE order (COMP-02), each normalized to
//      exactly one trailing '\n', joined with '\n\n'.
//   3. N-1 per-boundary smoothing (COMP-03 / D-12 / D-13): substitute
//      [@key] → {{cite_K_M}} BEFORE the smoother call (the model never sees raw
//      tokens); after the call, require output placeholder-set == input set —
//      any drift REJECTS that boundary (keep original prose) and records a
//      Transitions-Changed rejection. Then run the consistency scan (COMP-04,
//      flags only) and citation density (COMP-05, warn-only vs discipline target).
//   4. Regenerate .paper/CITATIONS.bib (D-19) from the union of compiled
//      citekeys; atomicWriteFile DRAFT.md + COMPILE-REPORT.md (schema v1, D-14).
//
// The smoother + re-verify transports are injectable seams so CI never touches a
// live model/network. Production callers (bin/cli/compile.ts) wire the real
// loadPrompt('smoother') + model call and the runPass1 + runPass3 re-verify.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir } from './paths.js';
import { loadOutline } from './outline.js';
import { parseOutline, type ParsedOutlineSection } from './outline-parse.js';
import { parseFrontmatter } from './frontmatter.js';
import { atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { computeDraftHash } from './draft-hash.js';
import { extractCitekeys, replaceCitekeys } from './citation-token.js';
import { runConsistencyScan, type SectionSpan } from './consistency-scan.js';
import { computeCitationDensity } from './citation-density.js';
import { writeBibtex } from './bibtex-write.js';
import { parseBib } from './citations.js';
import {
  renderCompileReport,
  type TransitionEntry,
  type ConsistencyEntry,
  type CitationDensityEntry,
  type StalenessEntry,
} from './compile-report.js';
import type { SourceCandidate } from './schemas/source-candidate.js';
import { parseVerdictRows } from './verify/verdict-rows.js';

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
  /** Present ONLY so a test can prove Pass 2/4 are never wired here. */
  runPass2?: () => void;
  runPass4?: () => void;
}

export interface ReVerifyResult {
  passed: boolean;
  /** Citekeys that re-verify flagged (named in the refuse reason on failure). */
  failingCitekeys: string[];
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
 * Substitute every [@key] in `text` with a fresh {{cite_K_M}} placeholder.
 * Returns the substituted text and the placeholder→[@key] restore map.
 */
function substitutePlaceholders(text: string, k: number): { masked: string; restore: Map<string, string> } {
  const restore = new Map<string, string>();
  let m = 0;
  const masked = replaceCitekeys(text, (key) => {
    const ph = makePlaceholder(k, m);
    m += 1;
    restore.set(ph, `[@${key}]`);
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
): Promise<LoadedSection | null> {
  const dir = join(paperDir(paperRoot), 'sections', `${String(outlineSection.n).padStart(2, '0')}-${outlineSection.slug}`);
  const draftPath = join(dir, 'DRAFT.md');
  const planPath = join(dir, 'PLAN.md');
  if (!existsSync(draftPath) || !existsSync(planPath)) return null;

  const draftBytes = readFileSync(draftPath);
  const planMd = readFileSync(planPath, 'utf8');
  const { frontmatter } = parseFrontmatter(planMd);
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
  };
}

/**
 * Run the Phase-4 compile pipeline. See module header for the full contract.
 */
export async function runCompile(opts: RunCompileOpts): Promise<CompileResult> {
  const warn = opts.onWarn ?? ((m: string) => process.stderr.write(`${m}\n`));
  const lockResource = `compile:${join(paperDir(opts.paperRoot), '.compile.lock')}`;

  return withLock(lockResource, async (): Promise<CompileResult> => {
    // ---- Step 1: load sections in OUTLINE order + refuse-gate + staleness ----
    const raw = await loadOutline(paperDir(opts.paperRoot));
    const outline = parseOutline(raw);
    const ordered = outline.sections.slice().sort((a, b) => a.n - b.n);

    const loaded: LoadedSection[] = [];
    const refuseReasons: string[] = [];
    const stalenessResolved: StalenessEntry[] = [];

    for (const os of ordered) {
      const sec = await loadSection(opts.paperRoot, os);
      if (!sec) {
        refuseReasons.push(`section ${os.n} (${os.slug}): missing PLAN.md or DRAFT.md`);
        continue;
      }
      loaded.push(sec);

      const verifPath = join(
        paperDir(opts.paperRoot), 'sections', `${String(os.n).padStart(2, '0')}-${os.slug}`, 'VERIFICATION.md',
      );
      const verificationMd = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : '';

      // GATE-01 (Phase 14): fail closed on missing/empty/unparseable VERIFICATION.md.
      // A section that was never verified must NEVER compile.
      // 'Status: unverifiable' passes this check (Pitfall 3) — those sections
      // proceed with zero verdict rows (no blocking citekeys) and compile normally.
      const hasStatus = /^Status:\s*\S/m.test(verificationMd);
      if (!hasStatus) {
        refuseReasons.push(
          `section ${os.n} (${os.slug}): no verifiable VERIFICATION.md (section never verified or verifier output unreadable)`,
        );
        continue; // skip the failing-citekey parse AND staleness check; section is already refused
      }

      // Refuse-gate (COMP-01 / GATE-02): any failing verdict blocks.
      for (const ck of parseVerdictRows(verificationMd)) {
        refuseReasons.push(`section ${os.n} (${os.slug}): citation [@${ck}] has a blocking verdict (FABRICATED/MIS-CITED/NOT_FOUND)`);
      }

      // Staleness (COMP-01 / D-08): recompute the per-section hash.
      const freshHash = computeDraftHash(sec.draftBytes, sec.assignedSources);
      if (sec.storedHash !== freshHash) {
        warn(`WARN: section ${os.n} (${os.slug}) stale — re-verifying (Pass 1+3)`);
        const reVerify =
          opts.reVerify ??
          (async () => ({ passed: false, failingCitekeys: [] } as ReVerifyResult));
        const result = await reVerify({ n: os.n, slug: os.slug });
        if (!result.passed) {
          const named =
            result.failingCitekeys.length > 0
              ? result.failingCitekeys.map((ck) => `[@${ck}]`).join(', ')
              : '(stale, re-verify failed)';
          refuseReasons.push(`section ${os.n} (${os.slug}): staleness re-verify FAILED — ${named}`);
        } else {
          stalenessResolved.push({
            section: `${os.n} (${os.slug})`,
            prior_hash: (sec.storedHash ?? 'null').slice(0, 12),
            new_hash: freshHash.slice(0, 12),
            re_verify_passed: true,
          });
        }
      }
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

      if (!opts.smoothBoundary) {
        transitions.push({ boundary: `${k + 1}→${k + 2}`, status: 'skipped', before_chars: beforeChars, after_chars: beforeChars });
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
        transitions.push({ boundary: `${k + 1}→${k + 2}`, status: 'rejected', before_chars: beforeChars, after_chars: beforeChars });
        continue;
      }

      // D-13: post-call token-set equality. ANY drift → reject (keep original).
      const outputSet = placeholderSet(smoothed);
      if (!setsEqual(inputSet, outputSet)) {
        warn(`WARN: boundary ${k + 1}→${k + 2} smoothing rejected — citation placeholder set drifted; keeping original prose`);
        transitions.push({ boundary: `${k + 1}→${k + 2}`, status: 'rejected', before_chars: beforeChars, after_chars: beforeChars });
        continue;
      }

      // Accepted: split the smoothed output back into rewritten tail + head and
      // restore the real [@key] tokens (mask maps merged — placeholders are
      // unique across the K / K+1 namespaces).
      const restore = new Map<string, string>([...tailMask.restore, ...headMask.restore]);
      const parts = smoothed.split(/\n\s*\n/);
      const newTail = restorePlaceholders((parts[0] ?? smoothed), restore);
      const newHead = restorePlaceholders(parts.length > 1 ? parts.slice(1).join('\n\n') : '', restore);
      left[li] = newTail;
      if (newHead.trim().length > 0) right[ri] = newHead;
      drafts[k] = left.join('\n\n');
      drafts[k + 1] = right.join('\n\n');
      transitions.push({ boundary: `${k + 1}→${k + 2}`, status: 'smoothed', before_chars: beforeChars, after_chars: newTail.length + newHead.length });
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
      loaded.map((s) => ({ n: s.outline.n, slug: s.slug, text: s.draft })),
      opts.discipline ?? 'default',
    );
    const densityEntries: CitationDensityEntry[] = densityReport.sections.map((d) => ({
      section: `${d.n} (${d.slug})`,
      citations_per_1000_words: Math.round(d.citations_per_1000_words * 10) / 10,
    }));
    for (const w of densityReport.warnings) warn(`WARN: citation density — ${w.detail}`);

    // ---- Step 4: regen CITATIONS.bib (D-19) + emit DRAFT + REPORT (COMP-07) -
    const bibPath = join(paperDir(opts.paperRoot), 'CITATIONS.bib');
    await regenerateBib(compiled, bibPath);

    const draftPath = join(paperDir(opts.paperRoot), 'DRAFT.md');
    await atomicWriteFile(draftPath, compiled);

    const reportPath = join(paperDir(opts.paperRoot), 'COMPILE-REPORT.md');
    const report = renderCompileReport({
      compiled_at: new Date().toISOString(),
      sections_count: loaded.length,
      stale_resolved_count: stalenessResolved.length,
      refuse_reasons: [],
      transitions,
      consistency_flags: consistencyEntries,
      citation_density: densityEntries,
      staleness_resolved: stalenessResolved,
    });
    await atomicWriteFile(reportPath, report);

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

/**
 * Regenerate .paper/CITATIONS.bib from the UNION of citekeys present in the
 * compiled manuscript (D-19 — via bibtex-write.ts / citation-js chokepoint).
 * Metadata is pulled from the existing bib; an uncited entry is dropped.
 */
async function regenerateBib(compiled: string, bibPath: string): Promise<void> {
  const compiledCitekeys = new Set(extractCitekeys(compiled));
  const existing = existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '';
  const entries = existing.trim().length > 0 ? await parseBib(existing) : [];

  const now = new Date().toISOString();
  const candidates: SourceCandidate[] = [];
  for (const e of entries) {
    const x = e as { id?: string; title?: string | string[]; author?: Array<{ family?: string; given?: string }>; DOI?: string; ISBN?: string; number?: string; note?: string };
    const id = String(x.id ?? '');
    if (!compiledCitekeys.has(id)) continue; // keep only cited keys (the union)
    const title = Array.isArray(x.title) ? (x.title[0] ?? '') : (x.title ?? '');
    const authors = (x.author ?? [])
      .map((a) => {
        const fam = String(a?.family ?? '').trim();
        const giv = String(a?.given ?? '').trim();
        return giv ? `${fam}, ${giv}` : fam;
      })
      .filter(Boolean);
    candidates.push({
      source: 'crossref',
      id: x.DOI ?? id,
      title: title || id,
      authors: authors.length > 0 ? authors : ['Unknown'],
      ...(x.DOI !== undefined ? { doi: x.DOI } : {}),
      retracted: x.note === 'RETRACTED',
      last_verified: now,
      citekey: id,
      raw: {},
    } as SourceCandidate);
  }

  // writeBibtex re-renders via the citation-js + atomic-write chokepoints and
  // resolves any base-26 collisions (D-19). An empty union → a zero-length bib.
  await writeBibtex(candidates, bibPath);
}

export default runCompile;
