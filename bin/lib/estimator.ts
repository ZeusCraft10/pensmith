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
// when FINAL.md exists. Nothing left → `nothing left to run ($0.00)`.
//
// NO network and NO LLM call: this module reads files only (STATE.json,
// PLAN.md frontmatter, SESSION.log, config files, the assignment text). It
// never writes COSTS.jsonl. Under PENSMITH_NO_LLM every model row is $0.00.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadState } from './state.js';
import { readSectionState } from './router.js';
import { paperDir, sectionPlan } from './paths.js';
import { slugSpec } from './llm-models.js';
import { costOf, resolvePrice, type ResolvedPrice } from './pricing.js';
import { resolveRuntime, resolveSlug, type ResolvedRuntime } from './runtime.js';
import { parseLlmRecords } from './replay.js';
import { tryReadPaperConfigSync } from './config.js';
import { resolveCostCap } from './budget.js';

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

/** Calls per section for the advisory verify passes (Pass 2 per citation, Pass 4 per ambiguous sentence). */
export const VERIFY_CALLS_PER_SECTION = Object.freeze({ 'claim-support': 6, 'orphan-label': 4 });

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
  section?: number;
}

/** The model calls one run of each cost-incurring verb makes (other verbs make none). */
const STEP_SLUGS: Readonly<Record<string, ReadonlyArray<readonly [string, number]>>> = Object.freeze({
  new: [['intake-clarifier', 1]],
  research: [['topic-disambiguator', 1], ['source-evaluator', 1]],
  outline: [['outline-author', 1]],
  plan: [['section-planner', 1]],
  write: [['section-drafter', 1]],
  verify: Object.entries(VERIFY_CALLS_PER_SECTION),
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
  wave: readonly number[],
  price: (step: string, slugs: Array<[string, number]>) => EstimateRow,
): EstimateRow[] {
  const slugs = STEP_SLUGS[scope.verb];
  if (!slugs) {
    // compile, done, add, status, … make no model call.
    return [{ step: scope.verb, calls: [], inputTokens: 0, outputTokens: 0, usd: 0, fallbackPrice: false, note: 'no model calls' }];
  }
  const calls = slugs.map(([s, c]) => [s, c] as [string, number]);
  const sectionRow = (n: number): EstimateRow => {
    const step = `${scope.verb} §${n}`;
    return all.find((r) => r.step === step) ?? price(step, calls);
  };
  if (scope.verb === 'plan' || scope.verb === 'write' || scope.verb === 'verify') {
    if (scope.section !== undefined) return [sectionRow(scope.section)];
    if (scope.verb === 'write') return wave.map(sectionRow);
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

  let sections: Array<{ n: number; slug: string }> = [];
  let stateOk = false;
  try {
    const state = await loadState(root);
    sections = [...(state.sections ?? [])].sort((a, b) => a.n - b.n);
    stateOk = true;
  } catch {
    stateOk = false;
  }

  const lengthWords = derivedLength(root, args.from);
  const sectionSource: 'state' | 'derived' = sections.length > 0 ? 'state' : 'derived';
  let rows: EstimateRow[] = [];

  const intakeDone = existsSync(path.join(pDir, 'INTAKE.md')) || stateOk;
  if (!intakeDone) rows.push(row(rt, root, 'new', [['intake-clarifier', 1]], stubbed));
  if (!existsSync(path.join(pDir, 'LIBRARY.json'))) {
    rows.push(row(rt, root, 'research', [['topic-disambiguator', 1], ['source-evaluator', 1]], stubbed));
  }

  const verifyCalls: Array<[string, number]> = Object.entries(VERIFY_CALLS_PER_SECTION);
  if (sections.length === 0) {
    rows.push(row(rt, root, 'outline', [['outline-author', 1]], stubbed));
    const count = sectionCountForLength(lengthWords);
    for (let n = 1; n <= count; n += 1) {
      rows.push(row(rt, root, `plan §${n}`, [['section-planner', 1]], stubbed));
      rows.push(row(rt, root, `write §${n}`, [['section-drafter', 1]], stubbed));
      rows.push(row(rt, root, `verify §${n}`, verifyCalls, stubbed));
    }
  } else {
    for (const { n, slug } of sections) {
      const st = readSectionState(sectionPlan(n, slug, root));
      const status = st.absent ? 'unplanned' : st.status;
      if (status === 'verified') continue;
      const planDone = ['writing', 'written', 'verifying', 'failed', 'unverifiable'].includes(status);
      const writeDone = ['written', 'verifying', 'failed', 'unverifiable'].includes(status);
      if (!planDone) rows.push(row(rt, root, `plan §${n}`, [['section-planner', 1]], stubbed));
      if (!writeDone) rows.push(row(rt, root, `write §${n}`, [['section-drafter', 1]], stubbed));
      rows.push(row(rt, root, `verify §${n}`, verifyCalls, stubbed));
    }
  }

  if (!existsSync(path.join(pDir, 'DRAFT.md'))) {
    rows.push({ step: 'compile', calls: [], inputTokens: 0, outputTokens: 0, usd: 0, fallbackPrice: false, note: 'no model calls' });
  }
  if (!existsSync(path.join(pDir, 'FINAL.md'))) {
    rows.push({ step: 'done', calls: [], inputTokens: 0, outputTokens: 0, usd: 0, fallbackPrice: false, note: 'no model calls' });
  }

  if (args.scope !== undefined) {
    const wave = sections.filter(({ n, slug }) => !readSectionState(sectionPlan(n, slug, root)).absent).map((s) => s.n);
    rows = scopeRows(rows, args.scope, wave, (step, slugs) => row(rt, root, step, slugs, stubbed));
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
    sectionCount: sections.length > 0 ? sections.length : sectionCountForLength(lengthWords),
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
