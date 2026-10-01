// bin/lib/estimator.ts — `--estimate` projection (RUN-20) and the per-call
// projection the session cost cap uses (RUN-18, RUN-26; D-17-26, D-17-27).
//
// Per-call projection (projectCallUsd): the input estimate plus
// min(p90 output, max_tokens) at the model price. The p90 comes from this
// paper's SESSION.log kind:"llm" records once a slug has at least 5 samples,
// else the shipped per-slug default (llm-models.ts). max_tokens stays the hard
// per-call ceiling; it is never the projection.
//
// Whole-paper projection (projectEstimate): models and prices come from the
// resolved runtime (runtime.ts resolveRuntime / resolveSlug) and pricing.ts;
// a row priced with the fallback price is flagged. With no STATE.json the
// section count is derived from the assignment (an `assignment.*` file in the
// paper root, `--from`, INTAKE.md or [project] length_target_words). Completed
// steps are excluded: intake when INTAKE.md exists, research when LIBRARY.json
// exists, outline when sections are registered, each verified section (and a
// section's finished plan/write steps), compile when DRAFT.md exists and done
// unless FINAL.md is absent or stale (done-record.ts: a current FINAL.md is
// finished; one written by hand is attention, which runs nothing). Nothing
// left → `nothing left to run ($0.00)`.
//
// The advisory verify passes are priced from the text they will read
// (D-20-28, D-20-29; review round 2): a section's verify is one claim-support
// call per (citing sentence, key) pair and one orphan-label call per prose
// paragraph — counted in its DRAFT.md (verify/draft-text.ts, the splitter the
// passes use) when it has one, else from its plan's word target at
// WORDS_PER_PARAGRAPH and the discipline band's highest citations per
// paragraph (at least one pair per assigned source). done runs Pass 4 over the
// whole paper: one orphan-label call per paragraph of the compiled DRAFT.md,
// or of the sections' drafts and plans before compile.
//
// Phase 21 (D-21-27): compile makes N−1 `smoother` calls (one per section
// boundary, unless `[compile] smooth_transitions = false`) and one
// `claim-consistency` call (two or more sections, `[compile]
// contradiction_pairs` > 0); done makes one `humanizer` call per section when
// the user's humanizer skill is installed and `[humanizer] enabled` is not
// false (compileCallsFor, humanizerCallsFor).
//
// NO network and NO LLM call: this module reads files only (STATE.json,
// PLAN.md frontmatter, SESSION.log, config files, the assignment text). It
// never writes COSTS.jsonl. Under PENSMITH_NO_LLM every model row is $0.00.
//
// The research row (SRC-08, SRC-09) is one topic-disambiguator call plus
// ceil(candidates / EVALUATOR_BATCH) source-evaluator calls, where the
// candidate count is estimated from the adapter plan the paper would use (its
// discipline preset and `[sources] allowed_databases`) at the maximum query
// count (bin/lib/adapter-plan.ts estimatedResearchCandidates). `plan N
// --research` (GRND-17) is priced as its own pass: the source-evaluator calls
// over its two queries' candidates (no disambiguator), plus the
// section-planner call only with `--revise`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadState } from './state.js';
import { readSectionInfo } from './router.js';
import { paperDir, sectionDraft, sectionPlan } from './paths.js';
import { loadFrontmatterDocSync } from './frontmatter.js';
import { claimPairs, proseParagraphs } from './verify/draft-text.js';
import { formatSectionId, sectionIdOf, sortBySectionId } from './section-id.js';
import { slugSpec } from './llm-models.js';
import { costOf, resolvePrice, type ResolvedPrice } from './pricing.js';
import { resolveRuntime, resolveSlug, type ResolvedRuntime } from './runtime.js';
import { parseLlmRecords } from './replay.js';
import { tryReadPaperConfigSync } from './config.js';
import { resolveCostCap } from './budget.js';
import { planAdapters, zoteroConfigured, estimatedResearchCandidates, evaluatorCallsFor, PLANNABLE_ADAPTERS } from './adapter-plan.js';
import { MAX_QUERIES } from './query-expansion.js';
import { resolveDiscipline } from './disciplines.js';
import { readIntakeBrief } from './intake-brief.js';
import { isResearchDone } from './research-sentinel.js';
import { finalMdState } from './done-record.js';
import { isHumanizerSkillPresent } from './ecosystem-presence.js';
import { DEFAULT_CONTRADICTION_PAIRS } from './schemas/config.js';

// ---------------------------------------------------------------------------
// Per-call projection
// ---------------------------------------------------------------------------

/** Minimum samples before a recorded p90 replaces the shipped default. */
export const MIN_P90_SAMPLES = 5;

/** Nearest-rank p90 of a sample list (null when empty). */
export function p90(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(0.9 * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

const recorded = new Map<string, Map<string, number[]>>();

function samplesFor(root: string): Map<string, number[]> {
  const logFile = path.join(paperDir(root), 'SESSION.log');
  let bySlug = recorded.get(logFile);
  if (bySlug) return bySlug;
  bySlug = new Map();
  if (existsSync(logFile)) {
    try {
      for (const r of parseLlmRecords(readFileSync(logFile, 'utf8'))) {
        if (typeof r.output_tokens !== 'number' || r.stop_reason === 'max_tokens') continue;
        const list = bySlug.get(r.slug) ?? [];
        list.push(r.output_tokens);
        bySlug.set(r.slug, list);
      }
    } catch {
      /* an unreadable log falls back to shipped defaults */
    }
  }
  recorded.set(logFile, bySlug);
  return bySlug;
}

/** Record a finished call's output tokens so later projections in this process see it. */
export function recordOutputSample(root: string, slug: string, outputTokens: number): void {
  const bySlug = samplesFor(root);
  const list = bySlug.get(slug) ?? [];
  list.push(outputTokens);
  bySlug.set(slug, list);
}

/** Test-only: drop the cached SESSION.log samples. */
export function _resetSamplesForTest(): void {
  recorded.clear();
}

/** The p90 output tokens for `slug`: recorded (>= 5 samples) or the shipped default. */
export function p90OutputFor(root: string, slug: string): { tokens: number; source: 'recorded' | 'default' } {
  const spec = slugSpec(slug);
  const samples = samplesFor(root).get(slug) ?? [];
  if (samples.length >= MIN_P90_SAMPLES) {
    const v = p90(samples);
    if (v !== null) return { tokens: v, source: 'recorded' };
  }
  return { tokens: spec.p90Output, source: 'default' };
}

/** input estimate + min(p90, max_tokens) output, at `price`. */
export function projectCallUsd(
  price: ResolvedPrice,
  inputTokens: number,
  p90Output: number,
  maxTokens: number,
): { outputTokens: number; usd: number } {
  const outputTokens = Math.min(p90Output, maxTokens);
  return { outputTokens, usd: costOf(price, { inputTokens, outputTokens }) };
}

/** Rough token count for text (chars / 4, the heuristic the cap check uses before a call). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

// ---------------------------------------------------------------------------
// Whole-paper projection (--estimate and the --yolo pre-flight)
// ---------------------------------------------------------------------------

export interface EstimateCall {
  slug: string;
  calls: number;
  model: string;
  fallbackPrice: boolean;
}

export interface EstimateRow {
  step: string;
  calls: EstimateCall[];
  inputTokens: number;
  outputTokens: number;
  usd: number;
  fallbackPrice: boolean;
  note?: string;
}

export interface EstimateResult {
  rows: EstimateRow[];
  totalUsd: number;
  capUsd: number;
  exceedsCap: boolean;
  nothingLeft: boolean;
  llmStubbed: boolean;
  provider: string;
  generationModel: string | null;
  judgmentModel: string | null;
  sectionCount: number;
  sectionSource: 'state' | 'derived';
  lengthWords: number;
}

/**
 * How many words a prose paragraph holds, for a section not drafted yet: the
 * advisory passes' calls are counted per paragraph (Pass 4's audit, and Pass
 * 2's pairs through the discipline's citations per paragraph).
 */
export const WORDS_PER_PARAGRAPH = 110;

/** A section's advisory work: the (citing sentence, key) pairs Pass 2 judges and the paragraphs Pass 4 audits. */
export interface AdvisoryWork {
  readonly pairs: number;
  readonly paragraphs: number;
}

/** The advisory work of a drafted text: one claim-support call per pair (D-20-28), one orphan-label call per prose paragraph at most (D-20-29). */
export function draftAdvisoryWork(md: string): AdvisoryWork {
  return { pairs: claimPairs(md).length, paragraphs: proseParagraphs(md).length };
}

/**
 * The advisory work of a section not drafted yet: its words in paragraphs, and
 * as many citations per paragraph as the discipline's band allows at most — at
 * least one pair per assigned source.
 */
export function plannedAdvisoryWork(words: number, assignedSources: number, citationsPerParagraph: number): AdvisoryWork {
  const paragraphs = Math.max(1, Math.ceil(Math.max(1, words) / WORDS_PER_PARAGRAPH));
  return { pairs: Math.max(assignedSources, Math.ceil(paragraphs * citationsPerParagraph)), paragraphs };
}

/** The model calls of one section's verify: claim-support per pair, orphan-label per paragraph. */
export function verifyCallsFor(work: AdvisoryWork): Array<[string, number]> {
  return [['claim-support', work.pairs], ['orphan-label', work.paragraphs]];
}

const DEFAULT_LENGTH_WORDS = 1500;

/** Parse a length target from assignment text: "1500-word", "2,500 words", "8 pages". */
export function parseLengthWords(text: string): number | null {
  const words = /(\d{1,3}(?:,\d{3})+|\d{2,6})\s*(?:-|\s)?\s*words?\b/i.exec(text);
  if (words?.[1]) {
    const n = Number(words[1].replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  const pages = /(\d{1,3})\s*(?:-|\s)?\s*pages?\b/i.exec(text);
  if (pages?.[1]) {
    const n = Number(pages[1]);
    if (Number.isFinite(n) && n > 0) return n * 275;
  }
  return null;
}

/** Section count from a length target: one section per ~500 words, 3..8. */
export function sectionCountForLength(words: number): number {
  return Math.min(8, Math.max(3, Math.round(words / 500)));
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Assignment text candidates: --from, then `assignment.*` (text formats) in the root. */
function assignmentText(root: string, from: string | undefined): string | null {
  if (from) {
    const t = readText(path.resolve(root, from));
    if (t !== null) return t;
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    entries = [];
  }
  for (const name of entries.sort()) {
    if (/^assignment\.(txt|md|markdown|text)$/i.test(name)) {
      const t = readText(path.join(root, name));
      if (t !== null) return t;
    }
  }
  return null;
}

function derivedLength(root: string, from: string | undefined): number {
  const cfgWords = tryReadPaperConfigSync(root)?.project?.length_target_words;
  if (typeof cfgWords === 'number' && cfgWords > 0) return cfgWords;
  for (const text of [readText(path.join(paperDir(root), 'INTAKE.md')), assignmentText(root, from)]) {
    if (text === null) continue;
    const n = parseLengthWords(text);
    if (n !== null) return n;
  }
  return DEFAULT_LENGTH_WORDS;
}

interface Built {
  inputTokens: number;
  outputTokens: number;
  usd: number;
  fallbackPrice: boolean;
  call: EstimateCall;
}

function priceCall(rt: ResolvedRuntime, root: string, slug: string, calls: number, stubbed: boolean): Built {
  const spec = slugSpec(slug);
  const sr = resolveSlug(rt, slug);
  const model = sr.model ?? '(unset)';
  if (stubbed) {
    return { inputTokens: 0, outputTokens: 0, usd: 0, fallbackPrice: false, call: { slug, calls, model: 'stub', fallbackPrice: false } };
  }
  const price = resolvePrice(rt.provider, model, rt.priceOverride);
  const p = p90OutputFor(root, slug);
  const one = projectCallUsd(price, spec.inputEstimate, p.tokens, spec.maxTokens);
  const fallbackPrice = price.source === 'fallback';
  return {
    inputTokens: spec.inputEstimate * calls,
    outputTokens: one.outputTokens * calls,
    usd: one.usd * calls,
    fallbackPrice,
    call: { slug, calls, model, fallbackPrice },
  };
}

function row(rt: ResolvedRuntime, root: string, step: string, slugs: Array<[string, number]>, stubbed: boolean): EstimateRow {
  const r: EstimateRow = { step, calls: [], inputTokens: 0, outputTokens: 0, usd: 0, fallbackPrice: false };
  for (const [slug, calls] of slugs) {
    if (calls <= 0) continue;
    const b = priceCall(rt, root, slug, calls, stubbed);
    r.calls.push(b.call);
    r.inputTokens += b.inputTokens;
    r.outputTokens += b.outputTokens;
    r.usd += b.usd;
    r.fallbackPrice = r.fallbackPrice || b.fallbackPrice;
  }
  return r;
}

/**
 * The steps ONE invocation runs (the --yolo cost pre-flight, D-17-27, and
 * `--estimate` on an explicit verb): the named verb, and for plan / write /
 * verify the named section — or, for `write` with no section (wave mode), every
 * section with a PLAN.md (a wave re-drafts verified sections too).
 */
export interface EstimateScope {
  verb: string;
  /** The section id: a number, or its text with a letter (`1a`, GRND-09). */
  section?: number | string;
  /**
   * `verify` over the sections a wave `write` drafts (GRND-15: a wave write
   * verifies every section it drafts), instead of the sections still to verify.
   */
  wave?: boolean;
  /**
   * `plan N --research <q>` (GRND-17): the section-scoped research pass —
   * source-evaluator calls over its two queries' candidates — instead of the
   * planner's call; the section-planner call is added only with `--revise`.
   */
  research?: boolean;
  /** `plan N --revise` (with --research: the planner runs after the pass). */
  revise?: boolean;
}

/**
 * The model calls of one `pensmith research` run: one topic-disambiguator call
 * and one source-evaluator call per EVALUATOR_BATCH candidates, the candidates
 * estimated from the adapter plan this paper would use (never reads the
 * network; an unreadable brief or config falls back to the preset defaults).
 */
export function researchCalls(root: string, env: Readonly<Record<string, string | undefined>> = process.env): Array<[string, number]> {
  const candidates = estimatedResearchCandidates(MAX_QUERIES, researchAdapterCount(root, env));
  return [['topic-disambiguator', 1], ['source-evaluator', Math.max(1, evaluatorCallsFor(candidates))]];
}

/** How many queries a section-scoped research pass runs (the query, and the query joined to the section title). */
export const SECTION_RESEARCH_QUERIES = 2;

/**
 * The model calls of one `plan N --research` pass
 * (bin/lib/section-research.ts): no disambiguator, one source-evaluator call
 * per EVALUATOR_BATCH candidates of its two queries.
 */
export function sectionResearchCalls(root: string, env: Readonly<Record<string, string | undefined>> = process.env): Array<[string, number]> {
  const candidates = estimatedResearchCandidates(SECTION_RESEARCH_QUERIES, researchAdapterCount(root, env));
  return [['source-evaluator', Math.max(1, evaluatorCallsFor(candidates))]];
}

/** The highest citations per paragraph of the paper's discipline band (the drafter writes within it). */
function citationsPerParagraph(root: string): number {
  let intakeDiscipline: string | undefined;
  try {
    intakeDiscipline = readIntakeBrief(root)?.brief.discipline;
  } catch {
    intakeDiscipline = undefined;
  }
  const config = tryReadPaperConfigSync(root);
  return resolveDiscipline({ discipline: { intake: intakeDiscipline, config: config?.project?.discipline_preset } }).densityPerParagraph.max;
}

/** A section's PLAN.md word target and assigned-source count (never throws: a missing or unreadable plan has neither). */
function planFacts(planPath: string): { words: number | null; assigned: number } {
  try {
    if (!existsSync(planPath)) return { words: null, assigned: 0 };
    const fm = loadFrontmatterDocSync('plan', planPath).frontmatter as { word_target?: unknown; assigned_sources?: unknown };
    const words = typeof fm.word_target === 'number' && fm.word_target > 0 ? fm.word_target : null;
    return { words, assigned: Array.isArray(fm.assigned_sources) ? fm.assigned_sources.length : 0 };
  } catch {
    return { words: null, assigned: 0 };
  }
}

/** How many adapters this paper's research plan would ask (its preset and `[sources] allowed_databases`). */
function researchAdapterCount(root: string, env: Readonly<Record<string, string | undefined>>): number {
  const config = tryReadPaperConfigSync(root);
  let intakeDiscipline: string | undefined;
  try {
    intakeDiscipline = readIntakeBrief(root)?.brief.discipline;
  } catch {
    intakeDiscipline = undefined;
  }
  const plan = planAdapters({
    preference: resolveDiscipline({ discipline: { intake: intakeDiscipline, config: config?.project?.discipline_preset } }).sourcePreference,
    allowed: config?.sources?.allowed_databases,
    zoteroConfigured: zoteroConfigured(env),
    available: PLANNABLE_ADAPTERS,
  });
  return plan.entries.length;
}

/**
 * compile's model calls (D-21-27, EXP-10, EXP-11): one `smoother` call per
 * section boundary (N−1) unless `[compile] smooth_transitions = false`, and
 * one `claim-consistency` call for a paper of two or more sections unless
 * `[compile] contradiction_pairs = 0`.
 */
export function compileCallsFor(root: string, sectionCount: number): Array<[string, number]> {
  let config: ReturnType<typeof tryReadPaperConfigSync> = null;
  try {
    config = tryReadPaperConfigSync(root);
  } catch {
    config = null;
  }
  const calls: Array<[string, number]> = [];
  if (sectionCount < 2) return calls;
  if (config?.compile?.smooth_transitions !== false) calls.push(['smoother', sectionCount - 1]);
  if ((config?.compile?.contradiction_pairs ?? DEFAULT_CONTRADICTION_PAIRS) > 0) calls.push(['claim-consistency', 1]);
  return calls;
}

/**
 * done's humanizer calls (D-21-27, EXP-14): one `humanizer` call per section
 * of the compiled paper when the user's humanizer skill is installed and
 * `[humanizer] enabled` is not false — done skips the humanizer otherwise.
 */
export function humanizerCallsFor(root: string, sectionCount: number): Array<[string, number]> {
  let enabled = true;
  try {
    enabled = tryReadPaperConfigSync(root)?.humanizer?.enabled !== false;
  } catch {
    enabled = true;
  }
  return enabled && sectionCount > 0 && isHumanizerSkillPresent() ? [['humanizer', sectionCount]] : [];
}

/** The model calls one run of each cost-incurring verb makes (other verbs make none; research: researchCalls; verify and done: per section / paper). */
const STEP_SLUGS: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = Object.freeze({
  new: [['intake-clarifier', 1]],
  outline: [['outline-author', 1]],
  plan: [['section-planner', 1]],
  write: [['section-drafter', 1]],
});

/**
 * Narrow the remaining-pipeline rows to the steps of `scope`. A step that is
 * already done but run again (re-research, a re-plan of §2, a re-draft of a
 * verified section) is priced anyway: this invocation will make those calls.
 * `wave` lists the sections a wave `write` (no section) drafts — every section
 * with a PLAN.md, verified ones included (write-orchestrator runAllSections).
 * A verb that makes no model call is one `no model calls` row.
 */
function scopeRows(
  all: readonly EstimateRow[],
  scope: EstimateScope,
  wave: ReadonlyArray<number | string>,
  price: (step: string, slugs: Array<[string, number]>) => EstimateRow,
  research: ReadonlyArray<readonly [string, number]>,
  sectionResearch: ReadonlyArray<readonly [string, number]>,
  /** A section's verify calls (its draft's pairs and paragraphs, or its plan's). */
  verifyCalls: (id: number | string) => Array<[string, number]>,
  /** done's calls: the humanizer per section and the whole-paper Pass 4. */
  doneCalls: Array<[string, number]>,
  /** compile's calls: the smoother per boundary and the claim-consistency call. */
  compileCalls: Array<[string, number]>,
): EstimateRow[] {
  if (scope.research === true && scope.verb === 'plan') {
    // GRND-17: the section pass's evaluator calls; `plan --revise` re-plans after it.
    const calls: Array<[string, number]> = [
      ...sectionResearch.map(([sl, c]) => [sl, c] as [string, number]),
      ...(scope.revise === true ? [['section-planner', 1] as [string, number]] : []),
    ];
    const at = scope.section !== undefined ? ` §${scope.section}` : '';
    return [price(`${scope.verb}${at} --research`, calls)];
  }
  if (scope.verb === 'done') return [all.find((r) => r.step === 'done') ?? price('done', doneCalls)];
  if (scope.verb === 'compile' && compileCalls.length > 0) return [all.find((r) => r.step === 'compile' && r.calls.length > 0) ?? price('compile', compileCalls)];
  const slugs = scope.verb === 'research' ? research : scope.verb === 'verify' ? [] : STEP_SLUGS[scope.verb];
  if (!slugs) {
    // compile, add, status, … make no model call.
    return [{ step: scope.verb, calls: [], inputTokens: 0, outputTokens: 0, usd: 0, fallbackPrice: false, note: 'no model calls' }];
  }
  const calls = slugs.map(([s, c]) => [s, c] as [string, number]);
  const sectionRow = (n: number | string): EstimateRow => {
    const step = `${scope.verb} §${n}`;
    return all.find((r) => r.step === step) ?? price(step, scope.verb === 'verify' ? verifyCalls(n) : calls);
  };
  if (scope.verb === 'plan' || scope.verb === 'write' || scope.verb === 'verify') {
    if (scope.section !== undefined) return [sectionRow(scope.section)];
    if (scope.verb === 'write' || (scope.verb === 'verify' && scope.wave === true)) return wave.map(sectionRow);
    return all.filter((r) => r.step.startsWith(`${scope.verb} §`));
  }
  return [all.find((r) => r.step === scope.verb) ?? price(scope.verb, calls)];
}

/**
 * Project the remaining cost of the paper at `paperRoot` (or, with `scope`,
 * of one invocation's steps). Never bills, never dials. A missing or corrupt
 * STATE.json is treated as "nothing registered yet" (C2-H1 / C4-HIGH: never
 * throws for on-disk state). An invalid runtime configuration DOES throw
 * (RuntimeConfigError), because no honest price exists for an unknown provider.
 */
export async function projectEstimate(args: {
  paperRoot: string;
  sessionCapUsd?: number;
  from?: string;
  scope?: EstimateScope;
}): Promise<EstimateResult> {
  const root = args.paperRoot;
  const stubbed = process.env['PENSMITH_NO_LLM'] === '1';
  const rt = await resolveRuntime({ paperRoot: root });
  const pDir = paperDir(root);

  let sections: Array<{ n: number; suffix?: string | undefined; slug: string }> = [];
  let stateOk = false;
  try {
    const state = await loadState(root);
    // GRND-09: (n, suffix) order — §1 < §1a < §2.
    sections = sortBySectionId(state.sections ?? []);
    stateOk = true;
  } catch {
    stateOk = false;
  }

  const lengthWords = derivedLength(root, args.from);
  const sectionSource: 'state' | 'derived' = sections.length > 0 ? 'state' : 'derived';
  let rows: EstimateRow[] = [];

  const intakeDone = existsSync(path.join(pDir, 'INTAKE.md')) || stateOk;
  if (!intakeDone) rows.push(row(rt, root, 'new', [['intake-clarifier', 1]], stubbed));
  const research = researchCalls(root);
  if (!isResearchDone(pDir)) {
    rows.push(row(rt, root, 'research', research, stubbed));
  }

  // The advisory passes' calls come from the text they will read (D-20-28/29):
  // a section's draft when it has one, else its plan's words at the
  // discipline's highest citation density.
  const perParagraph = citationsPerParagraph(root);
  const sectionCount = sections.length > 0 ? sections.length : sectionCountForLength(lengthWords);
  const defaultWords = Math.max(1, Math.round(lengthWords / sectionCount));
  const workOf = new Map<string, AdvisoryWork>();
  const sectionWork = (id: string, n: number, slug: string): AdvisoryWork => {
    const known = workOf.get(id);
    if (known !== undefined) return known;
    const draft = readText(sectionDraft(n, slug, root));
    const plan = planFacts(sectionPlan(n, slug, root));
    const work = draft !== null && draft.trim() !== '' ? draftAdvisoryWork(draft) : plannedAdvisoryWork(plan.words ?? defaultWords, plan.assigned, perParagraph);
    workOf.set(id, work);
    return work;
  };
  const verifyCallsOf = (key: number | string): Array<[string, number]> => {
    const s = sections.find((x) => formatSectionId(sectionIdOf(x.n, x.suffix)) === String(key));
    return verifyCallsFor(s !== undefined ? sectionWork(String(key), s.n, s.slug) : plannedAdvisoryWork(defaultWords, 0, perParagraph));
  };
  if (sections.length === 0) {
    rows.push(row(rt, root, 'outline', [['outline-author', 1]], stubbed));
    for (let n = 1; n <= sectionCount; n += 1) {
      rows.push(row(rt, root, `plan §${n}`, [['section-planner', 1]], stubbed));
      rows.push(row(rt, root, `write §${n}`, [['section-drafter', 1]], stubbed));
      rows.push(row(rt, root, `verify §${n}`, verifyCallsFor(plannedAdvisoryWork(defaultWords, 0, perParagraph)), stubbed));
    }
  } else {
    for (const { n, suffix, slug } of sections) {
      const id = formatSectionId(sectionIdOf(n, suffix));
      const st = readSectionInfo(sectionPlan(n, slug, root));
      const status = st.absent ? 'unplanned' : st.status;
      if (status === 'verified') continue;
      // GRND-13: the outline's stub (`stub: true`) still needs its plan; a
      // planner-written PLAN.md is `planned` without `stub`.
      const planDone = (status === 'planned' && !st.stub) || ['writing', 'written', 'verifying', 'failed', 'unverifiable'].includes(status);
      const writeDone = ['written', 'verifying', 'failed', 'unverifiable'].includes(status);
      if (!planDone) rows.push(row(rt, root, `plan §${id}`, [['section-planner', 1]], stubbed));
      if (!writeDone) rows.push(row(rt, root, `write §${id}`, [['section-drafter', 1]], stubbed));
      // A section that will be (re-)drafted is priced from its plan, not the draft it replaces.
      const work = writeDone ? sectionWork(id, n, slug) : plannedAdvisoryWork(planFacts(sectionPlan(n, slug, root)).words ?? defaultWords, st.assignedSources.length, perParagraph);
      if (!writeDone) workOf.set(id, work);
      rows.push(row(rt, root, `verify §${id}`, verifyCallsFor(work), stubbed));
    }
  }

  // done runs Pass 4 over the whole exported paper (VRFY-23): one orphan-label call per paragraph at most.
  const compiled = readText(path.join(pDir, 'DRAFT.md'));
  const paperParagraphs =
    compiled !== null
      ? draftAdvisoryWork(compiled).paragraphs
      : sections.length > 0
        ? sections.reduce((sum, s) => sum + sectionWork(formatSectionId(sectionIdOf(s.n, s.suffix)), s.n, s.slug).paragraphs, 0)
        : sectionCount * plannedAdvisoryWork(defaultWords, 0, perParagraph).paragraphs;
  // D-21-27: compile smooths each boundary and judges the cross-section
  // claims; done humanizes each section (when the skill is installed).
  const compileCalls = compileCallsFor(root, sectionCount);
  const doneCalls: Array<[string, number]> = [...humanizerCallsFor(root, sectionCount), ['orphan-label', paperParagraphs]];
  if (compiled === null) {
    rows.push(
      compileCalls.length > 0
        ? row(rt, root, 'compile', compileCalls, stubbed)
        : { step: 'compile', calls: [], inputTokens: 0, outputTokens: 0, usd: 0, fallbackPrice: false, note: 'no model calls' },
    );
  }
  const finalState = finalMdState(root);
  if (finalState === 'absent' || finalState === 'stale') {
    rows.push(row(rt, root, 'done', doneCalls, stubbed));
  }

  if (args.scope !== undefined) {
    const wave = sections
      .filter(({ n, slug }) => {
        // A wave write drafts every planned section; the outline's stubs are skipped (GRND-16).
        const r = readSectionInfo(sectionPlan(n, slug, root));
        return !r.absent && !r.stub;
      })
      .map((s) => formatSectionId(sectionIdOf(s.n, s.suffix)));
    rows = scopeRows(rows, args.scope, wave, (step, slugs) => row(rt, root, step, slugs, stubbed), research, sectionResearchCalls(root), verifyCallsOf, doneCalls, compileCalls);
  }

  const totalUsd = rows.reduce((acc, r) => acc + r.usd, 0);
  const capUsd = args.sessionCapUsd ?? resolveCostCap(root).capUsd;
  const gen = resolveSlug(rt, 'outline-author').model;
  const judg = resolveSlug(rt, 'claim-support').model;
  return {
    rows,
    totalUsd,
    capUsd,
    exceedsCap: totalUsd > capUsd,
    nothingLeft: rows.length === 0,
    llmStubbed: stubbed,
    provider: rt.provider,
    generationModel: gen,
    judgmentModel: judg,
    sectionCount,
    sectionSource,
    lengthWords,
  };
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function num(n: number): string {
  return n.toLocaleString('en-US');
}

/** The printed `--estimate` table (stdout). */
export function renderEstimate(est: EstimateResult): string {
  if (est.nothingLeft) return 'pensmith estimate: nothing left to run ($0.00)';
  const header =
    `pensmith estimate — ${est.provider}: generation ${est.generationModel ?? '(unset)'}, ` +
    `judgment ${est.judgmentModel ?? '(unset)'}${est.llmStubbed ? ' (LLM stubbed: $0.00)' : ''}; ` +
    `${est.sectionCount} section(s)${est.sectionSource === 'derived' ? ` (from a ${num(est.lengthWords)}-word target)` : ''}`;
  const lines = [header, ''];
  const w = Math.max(10, ...est.rows.map((r) => r.step.length));
  lines.push(`  ${'step'.padEnd(w)}  ${'calls'.padStart(5)}  ${'in tokens'.padStart(10)}  ${'out tokens'.padStart(10)}  ${'cost'.padStart(9)}  models`);
  for (const r of est.rows) {
    const calls = r.calls.reduce((a, c) => a + c.calls, 0);
    const models = r.note ?? [...new Set(r.calls.map((c) => `${c.model}${c.fallbackPrice ? ' (fallback price)' : ''}`))].join(', ');
    lines.push(
      `  ${r.step.padEnd(w)}  ${String(calls).padStart(5)}  ${num(r.inputTokens).padStart(10)}  ${num(r.outputTokens).padStart(10)}  ${money(r.usd).padStart(9)}  ${models}`,
    );
  }
  lines.push('');
  lines.push(
    `  total: ${money(est.totalUsd)} (cap ${money(est.capUsd)}; projected from p90 output per call, estimated ±50%)` +
      (est.exceedsCap ? ' — EXCEEDS the session cost cap' : ''),
  );
  return lines.join('\n');
}
