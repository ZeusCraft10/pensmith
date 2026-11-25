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
//        - read PLAN.md frontmatter (assigned_sources, slug), the section's
//          DRAFT.md bytes and the verdicts verify recorded in VERIFICATION.json
//          (never the Markdown report rendered from them).
//        - REFUSE-GATE (COMP-01): no record, a record verify could not check,
//          a failed status, or any blocking verdict → collect a refuse reason
//          naming the section and the citation.
//        - STALENESS (COMP-01 / D-08): when the draft, its assigned sources, a
//          cited CITATIONS.bib entry or the acknowledgements changed since the
//          record was made → WARN + re-verify (Pass 1 + Pass 3 ONLY, NEVER
//          Pass 2/4). A re-verify failure adds a refuse reason; an all-pass
//          records a Compile-Staleness-Resolved event.
//      If ANY refuse reason was collected, REFUSE: do NOT write .paper/DRAFT.md,
//      and move a DRAFT.md left by an earlier compile aside to DRAFT.stale.md.
//   2. Concatenate section drafts in OUTLINE order (COMP-02), each normalized to
//      exactly one trailing '\n', joined with '\n\n'. The outline's paper title
//      leads as `# Title` and each section opens with `## <outline title>`
//      (drafts are written without one).
//   3. N-1 per-boundary smoothing: replace every citation, in any Pandoc
//      form, with a {{cite_K_M}} placeholder BEFORE the smoother call (the
//      model never sees a citation); after the call, require output
//      placeholder-set == input set and no citation the model wrote itself —
//      any drift REJECTS that boundary (keep original prose) and records a
//      Transitions-Changed rejection. Then run the consistency scan (flags
//      only) and citation density (warn-only vs discipline target).
//   4. Refuse if the manuscript cites a work CITATIONS.bib does not hold, else
//      regenerate .paper/CITATIONS.bib from the cited works; atomicWriteFile
//      DRAFT.md + COMPILE-REPORT.md, then COMPILE-MANIFEST.json, the hashes
//      done checks before it exports (bin/lib/compile-manifest.ts).
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
import { atomicRename, atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { runConsistencyScan, type SectionSpan } from './consistency-scan.js';
import { computeCitationDensity } from './citation-density.js';
import { writeBibtex } from './bibtex-write.js';
import { parseBibOrEmpty } from './citations.js';
import {
  citedKeys,
  codeRanges,
  exportCitations,
  findCitations,
  findRawCitations,
  replaceCitations,
} from './citation-grammar.js';
import { deepEqual } from './deep-equal.js';
import {
  renderCompileReport,
  type TransitionEntry,
  type ConsistencyEntry,
  type CitationDensityEntry,
  type StalenessEntry,
} from './compile-report.js';
import type { SourceCandidate } from './schemas/source-candidate.js';
import { isPlaceholderText } from './placeholder.js';
import { parseBibForPass1, type Bib } from './verify/pass1.js';
import { readAcknowledgements } from './verify/acknowledgements.js';
import {
  bibEntryHashes,
  readVerificationRecord,
  sha256,
  verificationGate,
  verificationStaleness,
} from './verify/verification-record.js';
import { writeCompileManifest, type ManifestSection } from './compile-manifest.js';

/** The boundary window handed to the (injectable) smoother seam. */
export interface SmoothBoundaryInput {
  /** Title of the section that ENDS at this boundary. */
  sectionATitle: string;
  /** Last paragraph of section A, its citations already {{cite_K_M}} placeholders. */
  tail: string;
  /** Title of the section that STARTS at this boundary. */
  sectionBTitle: string;
  /** First paragraph of section B, its citations already {{cite_K_M}} placeholders. */
  head: string;
}

/** The re-verify seam input (staleness path — Pass 1+3 only). */
export interface ReVerifyInput {
  n: number;
  slug: string;
  /** The section's DRAFT.md as compile read it: the text it will compile. */
  draft?: string;
  /** Present ONLY so a test can prove Pass 2/4 are never wired here. */
  runPass2?: () => void;
  runPass4?: () => void;
}

export interface ReVerifyResult {
  passed: boolean;
  /** Citekeys that re-verify flagged (named in the refuse reason on failure). */
  failingCitekeys: string[];
  /** The refusal for each blocking verdict, when the seam gives them; replaces the citekey list. */
  reasons?: string[];
  /** What passes but must not look clean (an acknowledged retraction, a quotation with no citation). */
  warnings?: string[];
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
  /** On a refusal: where an earlier compile's DRAFT.md was moved, if there was one. */
  staleDraftPath?: string;
  draftPath?: string;
  reportPath?: string;
  bibPath?: string;
  sectionsCount: number;
  staleResolvedCount: number;
}

interface LoadedSection {
  outline: ParsedOutlineSection;
  slug: string;
  /** The section folder. */
  dir: string;
  /** Normalized to exactly one trailing '\n'. */
  draft: string;
  draftBytes: Buffer;
  assignedSources: string[];
}

/** Normalize a draft to end in exactly one '\n' (§F). */
function normalizeTrailingNewline(s: string): string {
  return s.replace(/\n+$/, '') + '\n';
}

/**
 * `draft` under a `## <title>` heading. A draft that already opens with a
 * heading keeps it; one that opens with a top-level `# ` heading has all its
 * headings moved down a level, so the paper title stays the only `# `.
 * A `#` line inside a code block is code and stays as it is.
 */
function withSectionHeading(draft: string, title: string): string {
  const body = draft.replace(/^\s+/, '');
  if (/^#{2,6}\s/.test(body)) return body;
  if (/^#\s/.test(body)) {
    const code = codeRanges(body);
    return body.replace(/^(#{1,5})(?=\s)/gm, (m: string, hashes: string, at: number) =>
      code.some(([a, b]) => at >= a && at < b) ? m : `#${hashes}`,
    );
  }
  return title.trim() ? `## ${title.trim()}\n\n${body}` : body;
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

/** A placeholder holds no `@` or bracket, so it never reads as a citation. */
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
 * Replace every citation in `text`, in any Pandoc form (`[see @a, p. 3; @b]`,
 * `-@a`, `@a [p. 4]`), with a fresh {{cite_K_M}} placeholder. Returns the
 * masked text and the placeholder→citation restore map.
 */
function substitutePlaceholders(text: string, k: number): { masked: string; restore: Map<string, string> } {
  const restore = new Map<string, string>();
  const masked = replaceCitations(text, (c) => {
    const ph = makePlaceholder(k, restore.size);
    restore.set(ph, c.raw);
    return ph;
  });
  return { masked, restore };
}

/** Restore every {{cite_K_M}} placeholder back to its citation. */
function restorePlaceholders(text: string, restore: Map<string, string>): string {
  let out = text;
  for (const [ph, token] of restore) {
    out = out.split(ph).join(token);
  }
  return out;
}

/** The citations and citation-like text of `text`, as a sorted list to compare. */
function citationFingerprint(text: string): string[] {
  const cites = findCitations(text);
  return [...cites.map((c) => c.raw), ...findRawCitations(text, cites).map((r) => r.raw)].sort();
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

  return {
    outline: outlineSection,
    slug: outlineSection.slug,
    dir,
    draft: normalizeTrailingNewline(draftBytes.toString('utf8')),
    draftBytes,
    assignedSources,
  };
}

/**
 * Finish a refusal. A DRAFT.md from an earlier compile no longer reflects the
 * sections; left in place, the router would send the user to `done` and done
 * would read it. Move it aside (kept, not deleted) and say where it went.
 */
async function refuse(paperRoot: string, result: CompileResult): Promise<CompileResult> {
  const draftPath = join(paperDir(paperRoot), 'DRAFT.md');
  if (!existsSync(draftPath)) return result;
  const staleDraftPath = join(paperDir(paperRoot), 'DRAFT.stale.md');
  try {
    await atomicRename(draftPath, staleDraftPath);
  } catch (err) {
    // On Windows a file another program holds open cannot be renamed. The
    // refusal stands either way; the user has to know the old draft is still
    // where done reads it.
    const code = (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : String(err));
    return {
      ...result,
      refuseReasons: [
        ...(result.refuseReasons ?? []),
        `could not move the earlier compiled .paper/DRAFT.md aside (${code}); delete it before running 'pensmith done'`,
      ],
    };
  }
  return { ...result, staleDraftPath };
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
    const raw = await loadOutline(paperDir(opts.paperRoot));
    let outline: ReturnType<typeof parseOutline>;
    try {
      outline = parseOutline(raw);
    } catch {
      return refuse(opts.paperRoot, {
        refused: true,
        refuseReasons: [
          "no usable outline: .paper/OUTLINE.md has no section table — run 'pensmith outline' first",
        ],
        sectionsCount: 0,
        staleResolvedCount: 0,
      });
    }
    if (outline.sections.length === 0) {
      return refuse(opts.paperRoot, {
        refused: true,
        refuseReasons: [
          "no sections in .paper/OUTLINE.md — run 'pensmith outline' to populate the section table",
        ],
        sectionsCount: 0,
        staleResolvedCount: 0,
      });
    }
    const ordered = outline.sections.slice().sort((a, b) => a.n - b.n);

    // The bibliography, read once: each record's cited entries are compared
    // with it, and the manuscript's citations are checked against it.
    const bibPath = join(paperDir(opts.paperRoot), 'CITATIONS.bib');
    const bibText = existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '';
    let bib: Bib;
    try {
      bib = await parseBibForPass1(bibText);
    } catch (err) {
      return refuse(opts.paperRoot, {
        refused: true,
        refuseReasons: [`.paper/CITATIONS.bib could not be read (${err instanceof Error ? err.message : String(err)}) — fix it, then verify again`],
        sectionsCount: 0,
        staleResolvedCount: 0,
      });
    }

    const loaded: LoadedSection[] = [];
    const refuseReasons: string[] = [];
    const stalenessResolved: StalenessEntry[] = [];
    const manifestSections: ManifestSection[] = [];

    for (const os of ordered) {
      const where = `section ${os.n} (${os.slug})`;
      const sec = await loadSection(opts.paperRoot, os);
      if (!sec) {
        refuseReasons.push(`${where}: missing PLAN.md or DRAFT.md`);
        continue;
      }
      if (isPlaceholderText(sec.draft)) {
        refuseReasons.push(
          `${where}: DRAFT.md is placeholder text, not a draft (PENSMITH_NO_LLM) — ` +
          `re-run 'pensmith write ${os.n}' with a model configured`,
        );
        continue;
      }
      loaded.push(sec);

      // GATE-01: the verdicts verify recorded. A section with none was never
      // verified and never compiles; VERIFICATION.md is only their rendering.
      const read = readVerificationRecord(join(sec.dir, 'VERIFICATION.json'));
      if (!read.ok) {
        refuseReasons.push(
          read.problem === 'missing'
            ? `${where}: never verified (no VERIFICATION.json) — run 'pensmith verify ${os.n}'`
            : `${where}: its recorded verdicts could not be read (${read.detail}) — run 'pensmith verify ${os.n}'`,
        );
        continue;
      }
      const record = read.record;
      if (record.section !== os.n || record.slug !== os.slug) {
        refuseReasons.push(`${where}: VERIFICATION.json is the record of section ${record.section} (${record.slug}) — run 'pensmith verify ${os.n}'`);
        continue;
      }
      // Refuse-gate: a section verify did not pass, or any blocking verdict,
      // whatever the status says.
      const gate = verificationGate(record, where);
      refuseReasons.push(...gate.reasons);
      for (const w of gate.warnings) warn(`WARN: ${w}`);
      if (gate.reasons.length > 0) continue;

      // Staleness (COMP-01 / D-08): the record must still describe the section.
      const stale = verificationStaleness(record, {
        draftBytes: sec.draftBytes,
        assignedSources: sec.assignedSources,
        bib,
        acknowledgementsSha256: readAcknowledgements(join(sec.dir, 'ACKNOWLEDGEMENTS.json')).sha256,
      });
      if (stale.length > 0) {
        warn(`WARN: ${where} stale (${stale.join('; ')}) — re-verifying (Pass 1+3)`);
        // Without a seam a stale section is a re-verify failure: it never
        // escapes unverified. The seam checks the text compile will use.
        const reVerify =
          opts.reVerify ??
          (async () => ({ passed: false, failingCitekeys: [] } as ReVerifyResult));
        const result = await reVerify({ n: os.n, slug: os.slug, draft: sec.draftBytes.toString('utf8') });
        for (const w of result.warnings ?? []) warn(`WARN: ${w}`);
        if (!result.passed) {
          if (result.reasons && result.reasons.length > 0) {
            refuseReasons.push(...result.reasons);
          } else {
            const named =
              result.failingCitekeys.length > 0
                ? result.failingCitekeys.map((ck) => `[@${ck}]`).join(', ')
                : '(stale, re-verify failed)';
            refuseReasons.push(`${where}: staleness re-verify FAILED — ${named}`);
          }
          continue;
        }
        stalenessResolved.push({
          section: `${os.n} (${os.slug})`,
          prior_hash: (record.draft_hash ?? 'null').slice(0, 12),
          new_hash: sha256(sec.draftBytes).slice(0, 12),
          re_verify_passed: true,
        });
      }
      manifestSections.push({
        n: os.n,
        slug: os.slug,
        draft_sha256: sha256(sec.draftBytes),
        verification_sha256: read.sha256,
        re_verified: stale.length > 0,
      });
    }

    // REFUSE: no DRAFT.md write, no bib regen (COMP-01 — bad citation never escapes).
    if (refuseReasons.length > 0) {
      for (const r of refuseReasons) warn(`REFUSE: ${r}`);
      return refuse(opts.paperRoot, {
        refused: true,
        refuseReasons,
        sectionsCount: loaded.length,
        staleResolvedCount: stalenessResolved.length,
      });
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
      const boundary = `${k + 1}→${k + 2}`;
      // Keep the original prose at this boundary, and say why.
      const reject = (why: string): void => {
        warn(`WARN: boundary ${boundary} smoothing ${why}`);
        transitions.push({ boundary, status: 'rejected', before_chars: beforeChars, after_chars: beforeChars });
      };

      if (!opts.smoothBoundary) {
        transitions.push({ boundary, status: 'skipped', before_chars: beforeChars, after_chars: beforeChars });
        continue;
      }

      // Mask every citation → {{cite_K_M}} BEFORE the model sees the window.
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
        reject(`threw (${err instanceof Error ? err.message : String(err)}) — keeping original prose`);
        continue;
      }

      // D-13: post-call token-set equality. ANY drift → reject (keep original).
      const outputSet = placeholderSet(smoothed);
      if (!setsEqual(inputSet, outputSet)) {
        reject('rejected — citation placeholder set drifted; keeping original prose');
        continue;
      }

      // Split the smoothed output back into rewritten tail + head and restore
      // the real citations (mask maps merged — placeholders are unique across
      // the K / K+1 namespaces).
      const restore = new Map<string, string>([...tailMask.restore, ...headMask.restore]);
      const parts = smoothed.split(/\n\s*\n/);
      const newTail = restorePlaceholders((parts[0] ?? smoothed), restore);
      const newHead = restorePlaceholders(parts.length > 1 ? parts.slice(1).join('\n\n') : '', restore);

      // The model may also have written a citation of its own (`@key`,
      // `(Author, 2020)`): the boundary must cite exactly what it cited before.
      if (!deepEqual(citationFingerprint(`${tailRaw}\n\n${headRaw}`), citationFingerprint(`${newTail}\n\n${newHead}`))) {
        reject('rejected — the smoother changed the citations; keeping original prose');
        continue;
      }
      left[li] = newTail;
      if (newHead.trim().length > 0) right[ri] = newHead;
      drafts[k] = left.join('\n\n');
      drafts[k + 1] = right.join('\n\n');
      transitions.push({ boundary, status: 'smoothed', before_chars: beforeChars, after_chars: newTail.length + newHead.length });
    }

    // Build the compiled manuscript (outline order, one blank line between):
    // the paper title, then each section under its outline title.
    const title = outline.paper_title.trim();
    const head = title ? `# ${title}\n\n` : '';
    let cursor = head.length;
    const spans: SectionSpan[] = [];
    const pieces: string[] = [head];
    for (let i = 0; i < loaded.length; i += 1) {
      const piece = withSectionHeading(normalizeTrailingNewline(drafts[i] ?? ''), loaded[i]!.outline.title);
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
    // A bracketed citation of a work the bibliography does not hold would
    // export as a raw token with no reference, so it refuses here. A
    // narrative `@word` with no entry is text: compile reads the citations
    // through the same function the exporter does.
    const bibEntries = await parseBibOrEmpty(bibText);
    const inBib = new Set(bibEntries.map((e) => String(e['id'] ?? '')));
    const missing = exportCitations(compiled, inBib).unknownCited;
    if (missing.length > 0) {
      const reasons = missing.map((key) => `citation [@${key}] has no entry in .paper/CITATIONS.bib — re-run research or \`pensmith add\` it, then verify`);
      for (const r of reasons) warn(`REFUSE: ${r}`);
      return refuse(opts.paperRoot, {
        refused: true,
        refuseReasons: reasons,
        sectionsCount: loaded.length,
        staleResolvedCount: stalenessResolved.length,
      });
    }
    await regenerateBib(new Set(citedKeys(findCitations(compiled))), bibEntries, bibPath);

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

    // What done checks before it exports: the manuscript, each section's draft
    // and recorded verdicts, and each cited entry of the bibliography as
    // compile left it.
    const bibAfter = await parseBibForPass1(existsSync(bibPath) ? readFileSync(bibPath, 'utf8') : '');
    const bibHashes: Record<string, string> = {};
    for (const [key, hash] of Object.entries(bibEntryHashes(citedKeys(findCitations(compiled)), bibAfter))) {
      if (hash !== null) bibHashes[key] = hash;
    }
    await writeCompileManifest(opts.paperRoot, {
      $schemaVersion: 1,
      compiled_at: new Date().toISOString(),
      draft_sha256: sha256(Buffer.from(compiled, 'utf8')),
      sections: manifestSections,
      bib_entries: bibHashes,
    });

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
 * Regenerate .paper/CITATIONS.bib from the works the compiled manuscript
 * cites, in any citation form, through the bibtex-write.ts writer. Metadata
 * is pulled from the existing bib; an uncited entry is dropped.
 */
async function regenerateBib(
  compiledCitekeys: ReadonlySet<string>,
  entries: ReadonlyArray<Record<string, unknown>>,
  bibPath: string,
): Promise<void> {
  const now = new Date().toISOString();
  const candidates: SourceCandidate[] = [];
  for (const e of entries) {
    const x = e as {
      id?: string;
      title?: string | string[];
      author?: Array<{ family?: string; given?: string }>;
      DOI?: string;
      ISBN?: string;
      number?: string;
      note?: string;
      issued?: { 'date-parts'?: number[][] };
    };
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

    // Preserve the publication year (audit #5). citation-js parses BibTeX
    // `year = {2020}` into CSL `issued.date-parts[0][0]`; the prior code never
    // read it, so writeBibtex (which emits a year only when c.year is a number)
    // stripped the year from EVERY regenerated citation.
    const yearRaw = x.issued?.['date-parts']?.[0]?.[0];
    const year = typeof yearRaw === 'number' && Number.isFinite(yearRaw) ? yearRaw : undefined;

    // Preserve the persistent identifier for DOI-less sources (audit #17): a book
    // (ISBN) or arXiv preprint (CSL `number`) carries no DOI, so writeBibtex's
    // toCsl persistent-id gate would DROP it entirely. Carry ISBN / arXiv id
    // (the extra fields toCsl reads) so DOI-less sources survive the round-trip.
    const isbn = typeof x.ISBN === 'string' && x.ISBN.trim() ? x.ISBN.trim() : undefined;
    // CSL `number` is ALSO the generic journal issue number, so only treat it as
    // an arXiv id when it is arXiv-SHAPED (CodeRabbit) — otherwise a DOI-less
    // journal article with an issue number would be re-emitted as a fabricated
    // arXiv preprint. New-style: 2305.12345 (optional vN); old-style: hep-th/9901001.
    const numberRaw = typeof x.number === 'string' ? x.number.trim() : '';
    const isArxivId =
      /^\d{4}\.\d{4,5}(v\d+)?$/.test(numberRaw) ||
      /^[a-z-]+(\.[a-z]{2})?\/\d{7}(v\d+)?$/i.test(numberRaw);
    const arxivId = !x.DOI && isArxivId ? numberRaw : undefined;

    candidates.push({
      source: arxivId ? 'arxiv' : 'crossref',
      id: x.DOI ?? id,
      title: title || id,
      authors: authors.length > 0 ? authors : ['Unknown'],
      ...(x.DOI !== undefined ? { doi: x.DOI } : {}),
      ...(year !== undefined ? { year } : {}),
      ...(isbn !== undefined ? { isbn } : {}),
      ...(arxivId !== undefined ? { arxivId } : {}),
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
