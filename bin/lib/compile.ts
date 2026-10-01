// bin/lib/compile.ts — the compile pipeline (COMP-01..07, ARCH-20; Phase 21
// EXP-05, EXP-10..13).
//
// runCompile composes the Phase 1-3 chokepoints into a single, lock-guarded,
// read-only-on-sections pipeline that produces .paper/DRAFT.md +
// .paper/COMPILE-REPORT.md + .paper/COMPILE-INPUTS.json (it never rewrites
// .paper/CITATIONS.bib — BRDTH-01). Every write routes through the D-07
// atomicWriteFile sole-writer chokepoint. The only section files compile writes
// are a stale or unverifiable section's VERIFICATION.md and PLAN.md, through its
// re-verify (D-08); never a DRAFT.md, never another section's files (ARCH-20).
//
// Pipeline:
//   0. Acquire .paper/.compile.lock for the WHOLE run (§P-6).
//   1. parseOutline; for each section in OUTLINE order ((n, suffix) — D-11):
//        - LOCAL RECORDS ADD REFUSALS, NEVER REMOVE THEM (D-20-04): a missing
//          PLAN.md / DRAFT.md / VERIFICATION.md, a missing or `failed` Status
//          line, a PLAN.md write block (FEED-04) or `failed` status, a
//          --dry-run verification outside --dry-run (RUN-27) refuse.
//        - STALENESS (COMP-01 / D-08): a draft changed since its verification is
//          re-verified through the injected seam (production: verify.ts
//          verifySection with the advisory passes off); an `unverifiable`
//          section is re-verified the same way.
//        - RECOMPUTE (VRFY-25, D-20-23): the ONE gate core (verify/gate.ts) over
//          the section's EXACT draft bytes — every blocking row refuses.
//   2. THE HEADINGS (EXP-05, D-21-13): `# <paper title>` (OUTLINE.md's H1, else
//      the brief's title) and `## <section title>` per section. The text
//      scanners (TEXT_SCANNERS), the citation grammar, the quote extractor and
//      the bare-identifier reader run over every heading compile adds: a
//      heading that holds anything the gate would judge refuses, naming the fix
//      (retitle it in OUTLINE.md and run `pensmith outline`) — the headings are
//      text no section gate judged. A section draft whose first line is a
//      heading equal to its own title loses that line (it would print twice).
//      If ANY refuse reason was collected, REFUSE: no DRAFT.md is written.
//   3. N-1 per-boundary smoothing (COMP-03 / D-12 / D-13; EXP-10, D-21-14):
//      only the last prose paragraph of section N and the first of N+1 go to
//      the smoother, masked by the ONE rewrite guard (rewrite-guard.ts: every
//      citation and every Pass-3 quote becomes a placeholder) and validated by
//      it (placeholder multiset, headings, only the two paragraphs, the cited
//      keys, the quotes, nothing new the gate would check). A rejected boundary
//      keeps the raw text and the report says why; a skipped step names its
//      mode (dry-run, no LLM, offline, --no-smooth, --raw, config).
//   4. The surface consistency scan (COMP-04, flags only), the cross-section
//      contradiction check (EXP-11, claim-consistency.ts: the heuristic floor
//      always, one capped `claim-consistency` call when wired), and citation
//      density against the discipline band with its sources (EXP-12).
//   5. atomicWriteFile DRAFT.md + COMPILE-REPORT.md (fully populated, EXP-13) +
//      COMPILE-INPUTS.json v3 (the compiled sections' content and verified
//      hashes, the sha256 of the DRAFT.md written and of its headings — the
//      router and done read it, VRFY-27, D-21-13). compile never writes
//      LIBRARY.json, .paper/CITATIONS.bib or last_verified. Under --dry-run the
//      stub-draft marker lines are removed from the compiled draft (VRFY-24).
//
// The smoother, the contradiction judge and the re-verify are injectable seams
// so CI never touches a live model (bin/cli/compile.ts wires the real ones);
// the gate core and the rewrite guard are not injectable.

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
import { extractCitedKeysForVerification, findCitations, stripLeadingBom } from './citation-token.js';
import { runConsistencyScan, type SectionSpan } from './consistency-scan.js';
import { computeCitationDensity, resolveDensityBand } from './citation-density.js';
import {
  renderCompileReport,
  citationDensityForReport,
  type TransitionEntry,
  type ConsistencyEntry,
  type StalenessEntry,
} from './compile-report.js';
import { sectionWriteBlockReason } from './plan-status.js';
import { networkMode } from './http-mock.js';
import { compilePaperTitle, headingsSha256, writeCompileInputs, type CompileHeadings } from './compile-inputs.js';
import { outlineProblem, sectionRegistryProblem } from './section-registry.js';
import { recomputeGate, gateRefusals, loadBibliography, stripStubMarker, TEXT_SCANNERS, type AcceptedQuote, type ByoQuote } from './verify/gate.js';
import { extractQuotes } from './quote-extractor.js';
import { findBareIdentifiers } from './doi.js';
import { tryReadPaperConfigSync } from './config.js';
import { parseVerificationMd, verificationRecordReasons } from './verify/verification-md.js';
import { readQuoteAcceptances, sectionDirOfPlan } from './quote-acceptance.js';
import { maskForRewrite, validateRewrite } from './rewrite-guard.js';
import {
  applyConsistencyReply,
  collectClaims,
  consistencyCandidates,
  type ConsistencyPair,
  type ConsistencyVerdict,
  type ContradictionReport,
} from './claim-consistency.js';
import { DEFAULT_CONTRADICTION_PAIRS } from './schemas/config.js';
import { readPaperBrief } from './paper-brief.js';
import { readSectionAdvisory, type DoneSection } from './done-gate.js';

// The boundary helper moved to the one rewrite guard (D-21-14); re-exported for callers of compile.
export { boundaryAdditions } from './rewrite-guard.js';

/** The boundary window handed to the (injectable) smoother seam. */
export interface SmoothBoundaryInput {
  /** Title of the section that ENDS at this boundary. */
  sectionATitle: string;
  /** Last prose paragraph of section A, masked: citations → {{cite_K_M}}, Pass-3 quotes → {{quote_K_M}}. */
  tail: string;
  /** Title of the section that STARTS at this boundary. */
  sectionBTitle: string;
  /** First prose paragraph of section B, masked the same way. */
  head: string;
}

/** The re-verify seam input (staleness path — Pass 1+3 only). */
export interface ReVerifyInput {
  n: number;
  slug: string;
  /** The section's letter (§1a), absent for §1 (GRND-09). */
  suffix?: string;
  /**
   * The draft has not changed since its record (an `unverifiable` section, not
   * a stale one): the record's advisory sections — judged on this very draft —
   * are kept (review round 2).
   */
  keepAdvisory?: boolean;
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
  /**
   * The `--discipline` flag (COMP-05, EXP-12): it overrides the paper's own
   * discipline AND the config band. Omitted: the paper's discipline (GRND-06
   * layers) and `[verification] citation_density_min/max`.
   */
  discipline?: string;
  /**
   * Boundary smoother seam. Receives the masked boundary window and returns
   * the rewritten boundary text (rewritten tail, a blank line, rewritten
   * head). The pipeline owns the masking and the validation (rewrite-guard.ts).
   * Omitted → no smoothing (raw concat), reported with `smoothSkip`.
   */
  smoothBoundary?: (input: SmoothBoundaryInput) => Promise<string>;
  /** Why smoothing does not run when `smoothBoundary` is omitted (e.g. `dry-run`, `no LLM`, `--no-smooth`); default `no smoother wired`. */
  smoothSkip?: string;
  /**
   * The claim-consistency judge seam (EXP-11): judges the capped candidate
   * pairs (one call). Omitted → the heuristic floor alone, reported with
   * `consistencySkip`.
   */
  judgeConsistency?: (pairs: readonly ConsistencyPair[]) => Promise<readonly ConsistencyVerdict[]>;
  /** Why the model contradiction check does not run when `judgeConsistency` is omitted; default `no judge wired`. */
  consistencySkip?: string;
  /**
   * Which seam errors end the compile instead of being recorded (production:
   * anthropic.ts isFatalLlmError — the never-skippable cost cap, a missing key
   * or bad runtime config, a replay miss). Any other smoother or judge error
   * keeps the raw text and is reported. Default: none.
   */
  isFatal?: (err: unknown) => boolean;
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
  /** The boundary outcomes (EXP-10). */
  transitions?: TransitionEntry[];
  /** Why smoothing did not run at all, when it did not. */
  smoothingSkipped?: string;
  /** The contradiction check (EXP-11). */
  contradictions?: ContradictionReport;
  /** The paper title compile wrote as `# <title>` (EXP-05). */
  title?: string;
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
  /** The PLAN.md body (its `## Claims` feed the contradiction check). */
  planBody: string;
}

/** Normalize a draft to end in exactly one '\n' (§F). */
function normalizeTrailingNewline(s: string): string {
  return s.replace(/\n+$/, '') + '\n';
}

/** Split markdown into paragraphs (blocks separated by blank lines). */
function splitParagraphs(md: string): string[] {
  return md.split(/\n\s*\n/);
}

/** A prose paragraph: not blank, not a heading, list, table, block quote, code fence or rule. */
function isProseParagraph(p: string): boolean {
  if (p.trim().length === 0) return false;
  return !/^\s{0,3}(?:#{1,6}(?:\s|$)|[-*+]\s|\d+[.)]\s|\||>|```|~~~|(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(p);
}

/** First prose paragraph index in a paragraph list, or -1. */
function firstProseIdx(paras: string[]): number {
  for (let i = 0; i < paras.length; i += 1) if (isProseParagraph(paras[i] ?? '')) return i;
  return -1;
}

/** Last prose paragraph index in a paragraph list, or -1. */
function lastProseIdx(paras: string[]): number {
  for (let i = paras.length - 1; i >= 0; i -= 1) if (isProseParagraph(paras[i] ?? '')) return i;
  return -1;
}

/** Normalised heading text for the duplicate-title check. */
function headingKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[*_`]/g, '').replace(/[\s.:;!?]+$/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The draft without a first heading line that repeats the section's own title
 * (compile adds `## <title>`; the drafter writes no title, a hand-written or
 * older draft may). Only that one line (and the blank lines after it) goes.
 */
export function dropDuplicateTitleHeading(draft: string, title: string): string {
  const m = /^(?:[ \t]*\n)*[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t#]*\n(?:[ \t]*\n)*/.exec(draft);
  if (m === null || headingKey(m[1] ?? '') !== headingKey(title)) return draft;
  return draft.slice(m[0].length);
}

/**
 * What a heading compile adds would bring into the compiled text that no
 * section gate judged (EXP-05, D-21-13): a citation of any form the grammar
 * reads, a text finding (an unparseable or unsupported citation form), a
 * direct quote, a bare identifier — or a heading that is empty or spans lines.
 * One short phrase, or null when it is plain text.
 */
export function headingProblem(text: string, quoteMinWords?: number): string | null {
  if (text.trim().length === 0) return 'is empty';
  if (/[\r\n]/.test(text)) return 'spans more than one line';
  const asLine = `${text}\n`;
  const cited = extractCitedKeysForVerification(asLine);
  if (cited.length > 0 || findCitations(asLine).length > 0) return `holds a citation (${cited.map((k) => `@${k}`).join(', ') || 'a citation form'})`;
  const finding = TEXT_SCANNERS.flatMap((scan) => scan(asLine))[0];
  if (finding !== undefined) return `holds ${finding.verdict} \`${finding.text}\``;
  const quote = extractQuotes(asLine, quoteMinWords !== undefined ? { minWords: quoteMinWords } : {})[0];
  if (quote !== undefined) return `holds a direct quote ("${quote.text.slice(0, 40)}")`;
  const id = findBareIdentifiers(asLine)[0];
  if (id !== undefined) return `holds an identifier (${id.text})`;
  return null;
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
  let planBody: string;
  try {
    ({ frontmatter, body: planBody } = await loadFrontmatterDoc('plan', planPath));
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
    // A leading byte-order mark is stripped as Pandoc strips it from a file
    // (review round 3): mid-way through the compiled DRAFT.md it would be a
    // character Pandoc keeps, not what the section's gate judged.
    draft: normalizeTrailingNewline(stripLeadingBom(draftBytes.toString('utf8'))),
    draftBytes,
    assignedSources,
    storedHash,
    planStatus: typeof frontmatter['status'] === 'string' ? frontmatter['status'] : null,
    writeBlock: sectionWriteBlockReason(frontmatter, id),
    planBody,
  };
}

/** One line of a seam error, for the report. */
function oneLineError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return (msg.split('\n')[0] ?? msg).slice(0, 200);
}

/**
 * Run the compile pipeline. See module header for the full contract.
 */
export async function runCompile(opts: RunCompileOpts): Promise<CompileResult> {
  const warn = opts.onWarn ?? ((m: string) => process.stderr.write(`${m}\n`));
  const lockResource = join(paperDir(opts.paperRoot), '.compile.lock');

  return withLock(lockResource, async (): Promise<CompileResult> => {
    // ---- Step 1: load sections in OUTLINE order + refuse-gate + staleness ----
    // Audit M2: a missing / section-less OUTLINE.md is a REFUSAL (the CLI prints
    // refuseReasons), not a raw parseOutline stack trace.
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
    const config = tryReadPaperConfigSync(opts.paperRoot);
    const quoteMinWords = config?.verification?.quote_min_words;
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

      // A section's own record can only add refusals (D-20-04): never
      // verified (no VERIFICATION.md / no Status line), `Status: failed`, a
      // --dry-run verification outside --dry-run, a failed PLAN.md. Such a
      // section is refused as it stands — compile never verifies it in the
      // user's place — and the recomputation below still runs, so the refusal
      // names the rows.
      const freshHash = computeDraftHash(sec.draftBytes, sec.assignedSources);
      const stale = sec.storedHash !== freshHash;
      const verifPath = sectionVerification(os.n, os.slug, opts.paperRoot);
      const verificationMd = existsSync(verifPath) ? readFileSync(verifPath, 'utf8') : null;
      // A stale section's record judged its older draft by definition; the
      // staleness re-verify below rewrites it, so only a current section's
      // record is compared with the draft it holds.
      const recordReasons = verificationRecordReasons(verificationMd, id, stale ? null : freshHash, dryRun);
      if (sec.planStatus === 'failed' && !recordReasons.some((r) => r.startsWith("VERIFICATION.md Status is 'failed'"))) {
        recordReasons.push(`PLAN.md status is 'failed' — repair the section, then \`pensmith verify ${id}\``);
      }
      for (const reason of recordReasons) refuseReasons.push(`${label}: ${reason}`);

      // A section whose own record says `unverifiable` (a source that could
      // not be reached, a quote with no checkable text): its verification is
      // re-run like a stale one, so when the gate core below now passes it
      // its VERIFICATION.md and PLAN.md say `verified`. Its verdict, pass or
      // not, is left to the gate core.
      const recordStatus = verificationMd !== null ? (parseVerificationMd(verificationMd).status ?? '').toLowerCase() : '';
      const unverifiable = !stale && recordReasons.length === 0 && (sec.planStatus === 'unverifiable' || recordStatus === 'unverifiable');
      if (unverifiable) {
        warn(`WARN: ${label} is unverifiable — re-verifying (Pass 1+3; its claim-support and orphan results for this unchanged draft are kept)`);
        const reVerify = opts.reVerify ?? (async () => ({ passed: false, failingCitekeys: [] } as ReVerifyResult));
        await reVerify(os.suffix !== undefined ? { n: os.n, slug: os.slug, suffix: os.suffix, keepAdvisory: true } : { n: os.n, slug: os.slug, keepAdvisory: true });
      }

      // Staleness (COMP-01 / D-08): the draft changed since its (sound)
      // verification — re-verify it now.
      if (recordReasons.length === 0 && stale) {
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

    // ---- Step 2: the headings compile adds (EXP-05, D-21-13) ----------------
    const title = compilePaperTitle(opts.paperRoot, outline.paper_title);
    const retitle = 'retitle it in .paper/OUTLINE.md and run `pensmith outline`';
    if (title.length === 0) {
      refuseReasons.push(`the paper has no title — add it as the H1 line (\`# <title>\`) of .paper/OUTLINE.md and run \`pensmith outline\``);
    } else {
      const problem = headingProblem(title, quoteMinWords);
      if (problem !== null) refuseReasons.push(`the paper title "${title}" ${problem} — compile writes it as the paper's \`# \` heading, which no section verified; ${retitle} (the H1 line)`);
    }
    for (const os of ordered) {
      const problem = headingProblem(os.title.trim(), quoteMinWords);
      if (problem !== null) {
        refuseReasons.push(`section ${outlineSectionId(os)} (${os.slug}): its title "${os.title.trim()}" ${problem} — compile writes it as the section's \`## \` heading, which no section verified; ${retitle}`);
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

    // ---- Step 3: the section texts in OUTLINE order (COMP-02) ---------------
    // VRFY-24: a --dry-run preview's stub drafts carry the stub-draft marker;
    // the compiled dry-run draft (and so every dry-run export) does not.
    if (dryRun) for (const s of loaded) s.draft = normalizeTrailingNewline(stripStubMarker(s.draft));
    // A first heading that repeats the section's title would print twice under `## <title>`.
    const drafts = loaded.map((s) => normalizeTrailingNewline(dropDuplicateTitleHeading(s.draft, s.outline.title)));

    // ---- Step 4: N-1 per-boundary smoothing (EXP-10, D-21-14) ---------------
    const transitions: TransitionEntry[] = [];
    const smoothingSkipped = opts.smoothBoundary === undefined ? (opts.smoothSkip ?? 'no smoother wired') : undefined;
    for (let k = 0; k < drafts.length - 1; k += 1) {
      const left = splitParagraphs(drafts[k] ?? '');
      const right = splitParagraphs(drafts[k + 1] ?? '');
      const li = lastProseIdx(left);
      const ri = firstProseIdx(right);
      // The boundary between the two sections' ids (GRND-09: `1→1a`, `1a→2`).
      const leftSec = loaded[k] as LoadedSection;
      const rightSec = loaded[k + 1] as LoadedSection;
      const boundary = `${outlineSectionId(leftSec.outline)}→${outlineSectionId(rightSec.outline)}`;
      if (li === -1 || ri === -1) {
        transitions.push({ boundary, status: 'skipped', reason: 'no prose paragraph at the boundary', before_chars: 0, after_chars: 0 });
        continue;
      }
      const tailRaw = (left[li] ?? '').trim();
      const headRaw = (right[ri] ?? '').trim();
      const window = `${tailRaw}\n\n${headRaw}`;
      const beforeChars = tailRaw.length + headRaw.length;

      if (opts.smoothBoundary === undefined) {
        transitions.push({ boundary, status: 'skipped', reason: smoothingSkipped ?? 'no smoother wired', before_chars: beforeChars, after_chars: beforeChars, before: window });
        continue;
      }

      // D-13 / D-21-14: the model never sees a citation or a Pass-3 quote.
      const mask = maskForRewrite(window, { namespace: k, ...(quoteMinWords !== undefined ? { quoteMinWords } : {}) });
      const [tailMasked = '', headMasked = ''] = mask.masked.split(/\n[ \t]*\n/);
      let smoothed: string;
      try {
        smoothed = await opts.smoothBoundary({ sectionATitle: leftSec.outline.title, tail: tailMasked, sectionBTitle: rightSec.outline.title, head: headMasked });
      } catch (err) {
        // A fatal error (the cost cap, an unusable config, a replay miss) ends
        // the compile before anything is written; anything else keeps the raw prose.
        if (opts.isFatal?.(err) === true) throw err;
        const reason = `smoother failed: ${oneLineError(err)}`;
        warn(`WARN: boundary ${boundary} smoothing ${reason} — keeping original prose`);
        transitions.push({ boundary, status: 'rejected', reason, before_chars: beforeChars, after_chars: beforeChars, before: window });
        continue;
      }
      const verdict = validateRewrite({ original: window, mask, rewritten: smoothed, allowedParagraphs: [0, 1], ...(quoteMinWords !== undefined ? { quoteMinWords } : {}) });
      if (!verdict.ok) {
        const reason = verdict.reasons[0] ?? 'rewrite rejected';
        warn(`WARN: boundary ${boundary} smoothing rejected (${reason}) — keeping original prose`);
        transitions.push({ boundary, status: 'rejected', reason, before_chars: beforeChars, after_chars: beforeChars, before: window });
        continue;
      }
      const [newTail = tailRaw, newHead = headRaw] = verdict.text.split(/\n[ \t]*\n/);
      left[li] = newTail;
      right[ri] = newHead;
      drafts[k] = normalizeTrailingNewline(left.join('\n\n'));
      drafts[k + 1] = normalizeTrailingNewline(right.join('\n\n'));
      transitions.push({ boundary, status: 'smoothed', before_chars: beforeChars, after_chars: newTail.length + newHead.length, before: window, after: verdict.text });
    }

    // ---- Step 5: the compiled manuscript: `# title`, then `## section` + text ----
    const headings: CompileHeadings = { title, sections: loaded.map((s) => ({ id: outlineSectionId(s.outline), title: s.outline.title.trim() })) };
    const pieces: string[] = [`# ${title}\n\n`];
    let cursor = pieces[0]!.length;
    const spans: SectionSpan[] = [];
    for (let i = 0; i < loaded.length; i += 1) {
      const sec = loaded[i] as LoadedSection;
      const body = normalizeTrailingNewline(drafts[i] ?? '');
      const block = `## ${sec.outline.title.trim()}\n\n${body}${i < loaded.length - 1 ? '\n' : ''}`;
      const start = cursor;
      pieces.push(block);
      cursor += block.length;
      spans.push({ n: sec.outline.n, slug: sec.slug, start, end: cursor });
    }
    const compiled = pieces.join('');

    // ---- Step 6: advisory checks (flags only, never refuse) -----------------
    const consistencyWarnings = runConsistencyScan(compiled, spans, { lintHeadings: opts.lintHeadings === true });
    const consistencyEntries: ConsistencyEntry[] = consistencyWarnings.map((w) => ({ detail: w.detail }));

    // EXP-11: the cross-section contradiction check — the heuristic floor
    // always, one capped claim-consistency call when the judge is wired.
    const cap = config?.compile?.contradiction_pairs ?? DEFAULT_CONTRADICTION_PAIRS;
    const claims = collectClaims(loaded.map((s, i) => ({ section: outlineSectionId(s.outline), slug: s.slug, title: s.outline.title.trim(), planBody: s.planBody, draft: drafts[i] ?? '' })));
    const { pairs, sent } = consistencyCandidates(claims, { maxPairs: cap });
    let verdicts: readonly ConsistencyVerdict[] | null = null;
    let consistencySkipped = '';
    if (opts.judgeConsistency === undefined) consistencySkipped = `skipped (${opts.consistencySkip ?? 'no judge wired'})`;
    else if (cap === 0) consistencySkipped = 'skipped (config: contradiction_pairs = 0)';
    else if (sent.length === 0) consistencySkipped = 'not needed (no cross-section claim pair shares content terms)';
    else {
      try {
        verdicts = await opts.judgeConsistency(sent);
      } catch (err) {
        if (opts.isFatal?.(err) === true) throw err;
        consistencySkipped = `failed (${oneLineError(err)})`;
        warn(`WARN: the contradiction check's model call failed (${oneLineError(err)}) — the heuristic flags stand`);
      }
    }
    const contradictions = applyConsistencyReply({ pairs, sent, verdicts, cap, skipped: consistencySkipped });
    if (contradictions.flagged.length > 0) warn(`WARN: ${contradictions.flagged.length} cross-section contradiction(s) flagged — see COMPILE-REPORT.md ## Contradictions`);

    // EXP-12: density against the discipline band, each with its source.
    let paperDiscipline: { slug: string; source: 'preset' | 'intake' | 'config' | 'flag' } | undefined;
    try {
      const d = readPaperBrief(opts.paperRoot).discipline.slug;
      paperDiscipline = { slug: d.value, source: d.source };
    } catch {
      paperDiscipline = undefined;
    }
    const density = resolveDensityBand({
      flagDiscipline: opts.discipline,
      paperDiscipline,
      configMin: config?.verification?.citation_density_min,
      configMax: config?.verification?.citation_density_max,
    });
    if (density.warning !== undefined) warn(`WARN: ${density.warning}`);
    const densityReport = computeCitationDensity(
      loaded.map((s, i) => ({ n: s.outline.n, suffix: s.outline.suffix, slug: s.slug, text: drafts[i] ?? '' })),
      density.discipline,
      { band: density.band },
    );
    const densityForReport = citationDensityForReport(densityReport, { discipline: density.disciplineSource, band: density.bandSource });
    for (const w of densityReport.warnings) warn(`WARN: citation density — ${w.detail}`);

    // EXP-13: each section's advisory findings from its own record.
    const advisorySections: DoneSection[] = loaded.map((s) => ({
      identity: { n: s.outline.n, slug: s.slug, ...(s.outline.suffix !== undefined ? { suffix: s.outline.suffix } : {}) },
      id: outlineSectionId(s.outline),
      planPath: sectionPlan(s.outline.n, s.slug, opts.paperRoot),
      assignedSources: s.assignedSources,
      verifiedHash: s.storedHash,
      currentDraftHash: null,
    }));
    const advisory = readSectionAdvisory(opts.paperRoot, advisorySections);

    // ---- Step 7: emit DRAFT + REPORT + INPUTS (COMP-07) ----------------------
    // BRDTH-01 / D-17-43: compile never rewrites .paper/CITATIONS.bib.
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
      title,
      transitions,
      ...(smoothingSkipped !== undefined ? { smoothing_skipped: smoothingSkipped } : {}),
      consistency_flags: consistencyEntries,
      citation_density: densityForReport.entries,
      citation_density_summary: densityForReport.summary,
      staleness_resolved: stalenessResolved,
      advisory,
      accepted_quotes: acceptedQuotes.map((a) => ({ section: a.section ?? '', id: a.id, citekey: a.citekey, excerpt: a.excerpt, accepted_at: a.acceptedAt, via: a.via })),
      local_file_quotes: byoQuotes.map((q) => ({ id: q.id, citekey: q.citekey, excerpt: q.snippet, file: q.localFile })),
      contradictions,
    });
    await atomicWriteFile(reportPath, report);
    // What this compile was made from (compile-inputs.ts): the router decides
    // whether DRAFT.md is current from these content hashes, never from mtimes;
    // done checks the compiled DRAFT.md, its headings and every section's
    // verified hash against them (VRFY-27, D-21-13).
    await writeCompileInputs(
      opts.paperRoot,
      loaded.map((s) => ({ n: s.outline.n, suffix: s.outline.suffix, slug: s.slug })),
      compiledAt,
      {
        compiledDraftSha256: createHash('sha256').update(compiled, 'utf8').digest('hex'),
        verifiedHashes,
        headingsSha256: headingsSha256(headings),
      },
    );

    return {
      refused: false,
      draftPath,
      reportPath,
      bibPath,
      sectionsCount: loaded.length,
      staleResolvedCount: stalenessResolved.length,
      transitions,
      ...(smoothingSkipped !== undefined ? { smoothingSkipped } : {}),
      contradictions,
      title,
    };
  });
}

export default runCompile;
