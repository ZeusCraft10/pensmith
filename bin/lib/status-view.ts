// bin/lib/status-view.ts — the `pensmith status` view model (RUN-19), shared by
// the CLI (bin/cli/status.ts) and the MCP `paper://state` resource so both tiers
// expose the same fields (tests/tier-contract/status-fields.test.ts).
//
// Fields: title and name, class, `current: §N (step)`, per-section glyphs
// (✓ verified, ⌛ in progress, ⌽ pending, ! needs attention — ASCII [x] [~] [ ]
// [!] when the locale is not UTF-8), the cost meter
// `cost: $X.XX this session / $Y.YY total (cap $Z.ZZ)` (`cost: n/a (Claude
// session)` in Tier 1, where the user's Claude session does the generation),
// and `next: …` from the router.
//
// Read-only and NEVER throws: every input (STATE.json, PLAN.md frontmatter,
// config.toml, INTAKE.md, COSTS.jsonl) is read best-effort, like the router.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadState } from './state.js';
import { readSectionState, resolveNextAction, type RouterDecision } from './router.js';
import { paperDir, sectionPlan } from './paths.js';
import { CURRENT_CONFIG_VERSION, effectiveConfigRows, paperConfigPath, tryReadPaperConfigSync } from './config.js';
import { parseIntakeMd } from './intake-parse.js';
import { parseOutline } from './outline-parse.js';
import { resolveCostCap, sessionSpend, totalCost } from './budget.js';
import { isApiKeyPresent, resolveRuntime, resolveSlug } from './runtime.js';
import { SLUG_NAMES, slugSpec } from './llm-models.js';

export type GlyphSet = 'unicode' | 'ascii';
export type SectionPhase = 'verified' | 'in-progress' | 'pending' | 'attention';

const GLYPHS: Readonly<Record<GlyphSet, Readonly<Record<SectionPhase, string>>>> = Object.freeze({
  unicode: Object.freeze({ verified: '✓', 'in-progress': '⌛', pending: '⌽', attention: '!' }),
  ascii: Object.freeze({ verified: '[x]', 'in-progress': '[~]', pending: '[ ]', attention: '[!]' }),
});

/** UTF-8 glyphs only when the effective locale is UTF-8 (LC_ALL > LC_CTYPE > LANG). */
export function glyphSetFor(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): GlyphSet {
  const locale = env['LC_ALL'] || env['LC_CTYPE'] || env['LANG'];
  if (locale) return /utf-?8/i.test(locale) ? 'unicode' : 'ascii';
  // No locale variables: Windows terminals render UTF-8 from Node; POSIX defaults to the C locale.
  return platform === 'win32' ? 'unicode' : 'ascii';
}

export interface StatusSectionRow {
  n: number;
  slug: string;
  title: string;
  status: string;
  phase: SectionPhase;
  glyph: string;
}

export interface StatusView {
  exists: boolean;
  paperId: string | null;
  title: string;
  name: string;
  class: string;
  /** The section and step in progress, when the next action is per-section. */
  current: { n: number; slug: string; step: 'plan' | 'write' | 'verify' } | null;
  currentLine: string;
  sections: StatusSectionRow[];
  cost: {
    tier: 'cli' | 'mcp';
    sessionUsd: number | null;
    totalUsd: number;
    capUsd: number;
    line: string;
  };
  next: string;
  nextLine: string;
  /** Present when STATE.json is absent or unreadable. */
  problem: 'no-paper' | 'corrupt-state' | null;
}

function phaseOf(status: string, absent: boolean, corrupt: boolean): SectionPhase {
  if (corrupt) return 'attention';
  if (absent) return 'pending';
  if (status === 'verified') return 'verified';
  if (status === 'writing' || status === 'written' || status === 'verifying') return 'in-progress';
  if (status === 'planned') return 'pending';
  return 'attention'; // failed, unverifiable, or an unknown status
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function describeNext(d: RouterDecision): string {
  if (d.verb === 'status') return `status (${d.reason})`;
  if ('n' in d) return `${d.verb} §${d.n}`;
  return d.verb;
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Build the status view for the paper at `root`. `tier: 'mcp'` renders the
 * Tier-1 cost line; `stopAfterResearch` is the goal-agnostic router flag the
 * CLI tier derives (bin/cli/goal.ts).
 */
export async function buildStatusView(
  root: string,
  opts: { tier: 'cli' | 'mcp'; glyphs?: GlyphSet; stopAfterResearch?: boolean } = { tier: 'cli' },
): Promise<StatusView> {
  const glyphs = GLYPHS[opts.glyphs ?? glyphSetFor()];
  const pDir = paperDir(root);
  const config = tryReadPaperConfigSync(root);
  const intake = parseIntakeMd(readText(path.join(pDir, 'INTAKE.md')));
  const name = path.basename(path.resolve(root)) || 'Untitled paper';
  const title = config?.project?.title?.trim() || intake.topic.trim() || name;
  const klass = config?.project?.class?.trim() || 'Unfiled';

  let paperId: string | null = null;
  let problem: StatusView['problem'] = null;
  let registered: Array<{ n: number; slug: string }> = [];
  try {
    const state = await loadState(root);
    paperId = state.paperId;
    registered = [...(state.sections ?? [])].sort((a, b) => a.n - b.n);
  } catch (e) {
    problem = (e as Error).name === 'StateNotFoundError' ? 'no-paper' : 'corrupt-state';
  }

  const titles = new Map<number, string>();
  try {
    for (const s of parseOutline(readText(path.join(pDir, 'OUTLINE.md'))).sections) titles.set(s.n, s.title);
  } catch {
    /* no outline table yet */
  }

  const sections: StatusSectionRow[] = registered.map(({ n, slug }) => {
    const r = readSectionState(sectionPlan(n, slug, root));
    const status = r.absent ? 'not planned' : r.corrupt ? 'corrupt/unreadable PLAN.md — needs attention' : r.status;
    const phase = phaseOf(r.status, r.absent, r.corrupt);
    return { n, slug, title: titles.get(n) ?? slug, status, phase, glyph: glyphs[phase] };
  });

  let decision: RouterDecision;
  try {
    decision = await resolveNextAction(root, { stopAfterResearch: opts.stopAfterResearch === true });
  } catch {
    decision = { verb: 'status', reason: 'attention' };
  }
  const current = decision.verb === 'plan' || decision.verb === 'write' || decision.verb === 'verify'
    ? { n: decision.n, slug: decision.slug, step: decision.verb }
    : null;
  const currentLine = current
    ? `current: §${current.n} (${current.step})`
    : `current: ${decision.verb === 'status' ? (decision.reason === 'done' ? 'complete' : 'needs attention') : decision.verb}`;

  const next = describeNext(decision);
  let totalUsd = 0;
  let sessionUsd: number | null = null;
  try {
    totalUsd = await totalCost({ root });
    if (opts.tier === 'cli') sessionUsd = await sessionSpend(root);
  } catch {
    totalUsd = 0;
  }
  const capUsd = resolveCostCap(root).capUsd;
  const costLine = opts.tier === 'mcp'
    ? 'cost: n/a (Claude session)'
    : `cost: ${money(sessionUsd ?? 0)} this session / ${money(totalUsd)} total (cap ${money(capUsd)})`;

  return {
    exists: paperId !== null,
    paperId,
    title,
    name,
    class: klass,
    current,
    currentLine,
    sections,
    cost: { tier: opts.tier, sessionUsd, totalUsd, capUsd, line: costLine },
    next,
    nextLine: `next: ${next}`,
    problem,
  };
}

/** The CLI rendering (stdout lines). */
export function renderStatusView(view: StatusView): string {
  if (view.problem === 'no-paper') {
    return 'pensmith status: no active paper — run `pensmith new` to start.';
  }
  const lines: string[] = ['pensmith status:'];
  lines.push(`  paper: ${view.title}${view.title !== view.name ? ` (${view.name})` : ''} — class ${view.class}`);
  if (view.problem === 'corrupt-state') {
    lines.push('  STATE.json is unreadable/corrupt — inspect or restore it.');
  } else if (view.paperId) {
    lines.push(`  id: ${view.paperId}`);
  }
  lines.push(`  ${view.currentLine}`);
  lines.push('  sections:');
  if (view.sections.length === 0) lines.push('    (none yet)');
  for (const s of view.sections) lines.push(`    ${s.glyph} §${s.n} ${s.slug}: ${s.status}`);
  lines.push(`  ${view.cost.line}`);
  lines.push(`  ${view.nextLine}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// `pensmith status --config` (CONF-01, RUN-26): every effective value and its
// source — default, preset, intake, config, env, flag or global (runtime.json).
// ---------------------------------------------------------------------------

function fmtValue(v: unknown): string {
  return JSON.stringify(v) ?? String(v);
}

function slugSourceLabel(s: string): string {
  if (s === 'slug-config') return 'config';
  if (s === 'slug-global') return 'global';
  if (s === 'tier-default' || s === 'slug-default') return 'default';
  return s;
}

/**
 * The `status --config` report. Throws the loader's one-line ConfigError /
 * RuntimeConfigError for an invalid config (so the user sees what to fix).
 */
export async function renderConfigView(root: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const rows = effectiveConfigRows(root, env);
  const rt = await resolveRuntime({ paperRoot: root, env });
  const lines: string[] = [
    `pensmith status --config (${path.relative(root, paperConfigPath(root)).split(path.sep).join('/')}, schema_version ${CURRENT_CONFIG_VERSION})`,
    '  config:',
  ];
  const w = Math.max(24, ...rows.map((r) => r.key.length));
  for (const r of rows) lines.push(`    ${r.key.padEnd(w)} = ${fmtValue(r.value)}  (${r.source})`);

  lines.push('  runtime:');
  const keyState = rt.apiKeyEnv === null ? 'no key needed' : isApiKeyPresent(rt.apiKeyEnv, env) ? 'set' : 'not set';
  const rtRows: Array<[string, string, string]> = [
    ['provider', rt.provider, rt.providerSource],
    ['model (generation)', rt.model ?? '(unset: set [runtime] model or pass --model)', rt.modelSource],
    ['endpoint', rt.endpoint ?? '(unset: set "endpoint" in the global runtime.json)', rt.endpointSource],
    ['api_key_env', rt.apiKeyEnv === null ? '(none)' : `${rt.apiKeyEnv} (${keyState})`, rt.apiKeyEnvSource],
    ['effort (generation)', rt.effort ?? '(per-slug defaults)', rt.effortSource],
    ['refusal_fallbacks', rt.refusalFallbacks, rt.refusalFallbacksSource],
    [
      'price override',
      rt.priceSource === null
        ? '(none)'
        : `in ${rt.priceOverride.inputPerMtok ?? '-'} / out ${rt.priceOverride.outputPerMtok ?? '-'} per MTok (unknown or local models only)`,
      rt.priceSource ?? 'default',
    ],
  ];
  for (const [k, v, src] of rtRows) lines.push(`    ${k.padEnd(w)} = ${v}  (${src})`);

  lines.push('  prompt slugs:');
  for (const slug of SLUG_NAMES) {
    const spec = slugSpec(slug);
    const sr = resolveSlug(rt, slug);
    lines.push(
      `    ${slug.padEnd(w)} ${spec.tier.padEnd(10)} ${(sr.model ?? '(unset)').padEnd(18)} effort ${sr.effort.padEnd(6)} ` +
        `(model: ${slugSourceLabel(sr.modelSource)}; effort: ${slugSourceLabel(sr.effortSource)})`,
    );
  }
  return lines.join('\n');
}
