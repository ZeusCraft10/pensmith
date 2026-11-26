// bin/lib/compile.ts — the compile pipeline.
//
// runCompile turns the verified sections into .paper/DRAFT.md and
// .paper/COMPILE-REPORT.md under one lock, and never writes into a section
// folder. It leaves .paper/CITATIONS.bib as verify read it: the export writes
// the cited subset of it into the export folder, and rewriting it here would
// change the entries every section's verdicts are about.
//
// Pipeline:
//   0. Acquire .paper/.compile.lock for the whole run, so no other compile
//      races on the output files.
//   1. readOutline (outline-store.ts); for each section in outline order:
//        - read PLAN.md frontmatter (assigned_sources), the section's DRAFT.md
//          bytes and the verdicts verify recorded in VERIFICATION.json (never
//          the Markdown report rendered from them);
//        - refuse a section with no record, a record verify could not check, a
//          failed status, or any blocking verdict, naming the citation;
//        - when the draft, its assigned sources, a cited CITATIONS.bib entry or
//          the acknowledgements changed since the record was made, warn and
//          re-verify (Pass 1 and Pass 3 only, never the advisory Pass 2/4). A
//          failed re-verify refuses the section.
//      Any refusal: write no DRAFT.md, and move one left by an earlier compile
//      aside to DRAFT.stale.md.
//   2. Concatenate the drafts in outline order, each ending in exactly one
//      '\n', joined by a blank line, under `# <paper title>` and one
//      `## <outline title>` per section.
//   3. Smooth each boundary between sections: every citation becomes a
//      {{cite_K_M}} placeholder before the smoother sees the text (the model
//      never sees a citation), and a boundary whose placeholders or citations
//      changed keeps its original prose. Then the consistency scan (flags
//      only) and citation density (a warning against the discipline target).
//   4. Refuse if the manuscript cites a work CITATIONS.bib does not hold; else
//      write DRAFT.md and COMPILE-REPORT.md, then COMPILE-MANIFEST.json, the
//      hashes done checks before it exports (bin/lib/compile-manifest.ts).
//
// The smoother and re-verify are injectable seams, so tests never reach a
// model or the network. bin/cli/compile.ts wires the production re-verify.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir, sectionAcknowledgements, sectionDraft, sectionPlan, sectionVerificationRecord } from './paths.js';
import { type ParsedOutlineSection } from './outline-parse.js';
import { readOutline } from './outline-read.js';
import { parseFrontmatter } from './frontmatter.js';
import { atomicRename, atomicWriteFile } from './atomic-write.js';
import { withLock } from './lock.js';
import { runConsistencyScan, type SectionSpan } from './consistency-scan.js';
import { computeCitationDensity } from './citation-density.js';
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
import { isPlaceholderText } from './placeholder.js';
import { parseBibForPass1, readBibText, type Bib } from './verify/pass1.js';
import { readAcknowledgements } from './verify/acknowledgements.js';
import { assignedSourcesFrom } from './plan-status.js';
import {
  readVerificationRecord,
  sha256,
  verificationGate,
  verificationStaleness,
} from './verify/verification-record.js';
import { manifestBibEntries, writeCompileManifest, type ManifestSection } from './compile-manifest.js';

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

/**
 * The re-verify seam input (staleness path — Pass 1+3 only). The draft is the
 * one compile read; the seam reads the section's other inputs (PLAN.md,
 * CITATIONS.bib, ACKNOWLEDGEMENTS.json) when it runs, so an edit made while
 * compile runs is re-verified as it is then.
 */
export interface ReVerifyInput {
  n: number;
  slug: string;
  /** The section's DRAFT.md as compile read it: the text it will compile. */
  draft: string;
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
  /** Enable the opt-in heading-tense consistency heuristic. */
  lintHeadings?: boolean;
  /** Discipline preset for the citation-density target. */
  discipline?: string;
  /**
   * Boundary smoother seam. Returns the rewritten boundary text (rewritten
   * tail, a blank line, rewritten head). The pipeline owns placeholder
   * substitution + post-call token-set equality. Omit → no smoothing (raw concat).
   */
  smoothBoundary?: (input: SmoothBoundaryInput) => Promise<string>;
  /**
   * Staleness re-verify seam (Pass 1 + Pass 3 only). Omit → a stale
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
}

/** Normalize a draft to end in exactly one '\n'. */
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

/** The section's files as compile reads them, or why it cannot. */
async function loadSection(
  paperRoot: string,
  outlineSection: ParsedOutlineSection,
): Promise<LoadedSection | string> {
  const { n, slug } = outlineSection;
  let draftPath: string;
  let planPath: string;
  try {
    draftPath = sectionDraft(n, slug, paperRoot);
    planPath = sectionPlan(n, slug, paperRoot);
  } catch (err) {
    return `no section folder for it (${err instanceof Error ? err.message : String(err)})`;
  }
  if (!existsSync(draftPath) || !existsSync(planPath)) return 'missing PLAN.md or DRAFT.md';

  const draftBytes = readFileSync(draftPath);
  return {
    outline: outlineSection,
    slug,
    draft: normalizeTrailingNewline(draftBytes.toString('utf8')),
    draftBytes,
    assignedSources: assignedSourcesFrom(parseFrontmatter(readFileSync(planPath, 'utf8')).frontmatter),
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
    // ---- Step 1: load sections in outline order + refuse-gate + staleness ----
    // No usable outline (none, a placeholder, an unchecked hand edit, or a
    // table that cannot be read) is a refusal with the reason, never a stack trace.
    const read = readOutline(opts.paperRoot);
    if (!read.ok) {
      return refuse(opts.paperRoot, {
        refused: true,
        refuseReasons: [`no usable outline: ${read.detail}`],
        sectionsCount: 0,
        staleResolvedCount: 0,
      });
    }
    const outline = read.outline;
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
    const bibText = readBibText(opts.paperRoot);
    let bib: Bib;
    try {
      bib = await parseBibForPass1(bibText ?? '');
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
      if (typeof sec === 'string') {
        refuseReasons.push(`${where}: ${sec}`);
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

      // The verdicts verify recorded. A section with none was never
      // verified and never compiles; VERIFICATION.md is only their rendering.
      const read = readVerificationRecord(sectionVerificationRecord(os.n, os.slug, opts.paperRoot));
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

      // Staleness: the record must still describe the section.
      const stale = verificationStaleness(record, {
        draftBytes: sec.draftBytes,
        assignedSources: sec.assignedSources,
        bib,
        acknowledgementsSha256: readAcknowledgements(sectionAcknowledgements(os.n, os.slug, opts.paperRoot)).sha256,
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
          why: stale,
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

    // Refuse: no DRAFT.md is written, so a bad citation never escapes.
    if (refuseReasons.length > 0) {
      for (const r of refuseReasons) warn(`REFUSE: ${r}`);
      return refuse(opts.paperRoot, {
        refused: true,
        refuseReasons,
        sectionsCount: loaded.length,
        staleResolvedCount: stalenessResolved.length,
      });
    }

    // ---- Step 2: concatenate in outline order --------------------------------
    // Keep per-section draft strings so per-boundary smoothing can replace only
    // the adjacent paragraphs without disturbing the rest of each section.
    const drafts = loaded.map((s) => s.draft);

    // ---- Step 3: smooth each boundary between sections ----------------------
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

      // The placeholders must come back exactly: any drift rejects the boundary.
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

    // Consistency scan (flags only) and citation density (a warning).
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

    // ---- Step 4: write the manuscript, the report and the manifest ---------
    // A bracketed citation of a work the bibliography does not hold would
    // export as a raw token with no reference, so it refuses here. A
    // narrative `@word` with no entry is text: compile reads the citations
    // through the same function the exporter does.
    const { cites: rendered, unknownCited: missing } = exportCitations(compiled, new Set(bib.entries.keys()));
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
    // and recorded verdicts, and the bibliography entry of each work the
    // export renders (every one is in CITATIONS.bib, or compile refused above).
    await writeCompileManifest(opts.paperRoot, {
      $schemaVersion: 1,
      compiled_at: new Date().toISOString(),
      draft_sha256: sha256(Buffer.from(compiled, 'utf8')),
      sections: manifestSections,
      bib_entries: manifestBibEntries(citedKeys(rendered), bib),
    });

    return {
      refused: false,
      draftPath,
      reportPath,
      sectionsCount: loaded.length,
      staleResolvedCount: stalenessResolved.length,
    };
  });
}

export default runCompile;
