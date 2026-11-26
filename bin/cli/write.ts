// bin/cli/write.ts — `pensmith write [<n>]`: draft a section, or every section.
//
// `pensmith write <n>` drafts one section. The drafter is given what the
// section needs and nothing else (bin/lib/drafter-input.ts): the outline's
// entry for it, its PLAN.md body without the frontmatter, its voice, and the
// works LIBRARY.json holds for the sources its PLAN.md assigns, as fenced
// data. It answers with JSON: the draft, and the claims no source supports
// ("gaps"), which stay out of the draft and are printed for the author. A
// draft that cites any other key, writes a citation as text or is empty is
// sent back once with the problems, then refused (exit 2, nothing saved).
// A section whose plan assigns sources the library holds none of is not
// drafted, since there would be nothing to cite.
//
// `pensmith write` with no <n> drafts the sections wave by wave in dependency
// order (bin/lib/write-orchestrator.ts), each through the same writer.

import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { readGoalFromConfig } from './goal.js';
import { sectionDraft, sectionPlan, paperDir } from '../lib/paths.js';
import { updatePlanFrontmatter } from '../lib/plan-status.js';
import { draftProblems, renderDrafterPrompt, SectionDraftSchema, type DrafterInput, type SectionDraft } from '../lib/drafter-input.js';
import { draftRefusal, loadSectionPlan, runAllSections, unusablePlanReason, type SectionPlanFile } from '../lib/write-orchestrator.js';
import { lastCheckedOutline, readOutline } from '../lib/outline-read.js';
import type { SectionNode } from '../lib/schemas/wave-graph.js';
import { styleMatchToVoiceHint } from '../lib/style-match.js';
import { StyleProfileSchema, type StyleProfile } from '../lib/schemas/style.js';
import { TutorialSubscriber } from '../lib/tutorial.js';
import { isNoLlmMode, MissingApiKeyError, resolveProviderId } from '../lib/anthropic.js';
import { completeChecked } from '../lib/structured-call.js';
import { loadLibrary, type Library } from '../lib/library.js';
import { sectionEntry } from '../lib/plan-store.js';
import { sourceContext } from '../lib/source-context.js';
import { getProviderApiKey } from '../lib/runtime.js';
import { sectionNumberArg, sectionSlugArg } from '../lib/section-slug.js';
import { artifactText, isPlaceholderParsed } from '../lib/placeholder.js';
import { EXIT_REFUSED } from '../lib/exit-codes.js';
import { CostCapExceededError } from '../lib/budget.js';
import { describeModelFailure } from '../lib/failure.js';

const DEFAULT_MAX_PARALLEL = 5;

/** A section that was not drafted: nothing to cite, or a draft that could not be used. Exit 2. */
export class DraftRefusedError extends Error {
  readonly exitCode = EXIT_REFUSED;
  constructor(message: string) {
    super(message);
    this.name = 'DraftRefusedError';
  }
}

/** One section's failure in plain words, as the CLI prints an unhandled one. */
function describeFailure(e: unknown): string {
  if (e instanceof DraftRefusedError) return `REFUSED — ${e.message}`;
  return describeModelFailure(e)?.text ?? `ERROR — ${e instanceof Error ? e.message : String(e)}`;
}

// The voice when neither the plan nor a style profile gives one.
const DEFAULT_VOICE_HINT = 'formal academic tone';

// STYL-03 / Pitfall 7 — extract an EXPLICIT per-section voice direction from a
// section PLAN.md. A user can pin the section's voice either in frontmatter
// (`voice_hint: …`) or as a `Voice:` line inside the ## Brief body. Either form
// is the user's explicit per-section direction and MUST win over the inferred
// style-match render. Returns the trimmed direction, or '' when absent.
function planVoiceDirection(planMd: string): string {
  if (typeof planMd !== 'string' || planMd.length === 0) return '';
  // (a) frontmatter `voice_hint:` (the artifact contract names this token).
  const fmMatch = /(?:^|\n)voice_hint:\s*(.+)/.exec(planMd);
  if (fmMatch && typeof fmMatch[1] === 'string') {
    const v = fmMatch[1].replace(/^["']|["']$/g, '').trim();
    if (v.length > 0) return v;
  }
  // (b) a body `Voice: …` line (the ## Brief convention the RED test pins).
  const bodyMatch = /(?:^|\n)\s*Voice:\s*(.+)/.exec(planMd);
  if (bodyMatch && typeof bodyMatch[1] === 'string') {
    const v = bodyMatch[1].trim();
    if (v.length > 0) return v;
  }
  return '';
}

/**
 * STYL-03 / Pitfall 7 — resolve the drafter's effective voice hint by STRICT
 * priority:
 *
 *   1. an EXPLICIT PLAN.md voice direction (frontmatter `voice_hint:` or a
 *      `Voice:` line in the body) ALWAYS wins — the user's per-section
 *      direction is never overridden by the inferred style profile (T-08-05-02);
 *   2. else, when a style profile is present, the style-match render
 *      (styleMatchToVoiceHint — PURE, no I/O);
 *   3. else, the non-empty DEFAULT_VOICE_HINT.
 *
 * PURE — no I/O. The caller (writeOneSection) reads the section PLAN.md +
 * STYLE.json from disk and passes the parsed values in. Exported so the
 * write-style-integration contract test can pin the precedence directly.
 */
export function resolveVoiceHint(input: {
  planMd: string;
  styleProfile?: StyleProfile;
}): string {
  const planVoice = planVoiceDirection(input.planMd);
  if (planVoice.length > 0) return planVoice; // (1) section override WINS.
  if (input.styleProfile) return styleMatchToVoiceHint(input.styleProfile); // (2)
  return DEFAULT_VOICE_HINT; // (3) never empty.
}

/**
 * The paper's STYLE.json, when there is one that parses. A malformed or
 * partial STYLE.json falls back to the default tone; it never stops `write`.
 */
function loadStyleProfile(paperRoot: string): StyleProfile | undefined {
  const stylePath = path.join(paperDir(paperRoot), 'STYLE.json');
  if (!existsSync(stylePath)) return undefined;
  try {
    return StyleProfileSchema.parse(JSON.parse(readFileSync(stylePath, 'utf8')));
  } catch {
    return undefined;
  }
}

/**
 * Construct the educator-mode subscriber in the CLI tier (the SOLE goal-aware
 * seam — Foundation never imports this). Returns `undefined` for goal=draft (the
 * zero-activation contract) and on any construction error (non-fatal, mirrors
 * runStyleProducerNonFatal): a bad subscriber must never break `write`.
 *
 * goal is read via the SHARED readGoalFromConfig from bin/cli/goal.ts (L5 dedup —
 * one helper, two consumers: this file + the four goal-aware router callers).
 */
function makeSubscriberNonFatal(paperRoot: string): TutorialSubscriber | undefined {
  const goal = readGoalFromConfig(paperRoot);
  if (goal !== 'learning' && goal !== 'both') return undefined;
  try {
    return new TutorialSubscriber({
      tutorialPath: path.join(paperDir(paperRoot), 'TUTORIAL.md'),
      goal,
    });
  } catch (e) {
    process.stderr.write(
      `pensmith write: WARN — tutorial subscriber construction failed (non-fatal): ${(e as Error).message}\n`,
    );
    return undefined;
  }
}

/**
 * What every section of one `write` run reads alike, read once per run: the
 * outline (as lastCheckedOutline reads it), STYLE.json, and LIBRARY.json,
 * loaded only when a section has sources to show.
 */
interface WriteRun {
  outline: ReturnType<typeof lastCheckedOutline>;
  profile: StyleProfile | undefined;
  library: () => Promise<Library>;
}

/** A WriteRun for the paper at `paperRoot`, with `outline` as the section list. */
function writeRun(paperRoot: string, outline: WriteRun['outline']): WriteRun {
  let library: Promise<Library> | undefined;
  return { outline, profile: loadStyleProfile(paperRoot), library: () => (library ??= loadLibrary(paperRoot)) };
}

/** The works a section's plan assigns, from LIBRARY.json, with the keys it holds none for. */
async function sectionSources(run: WriteRun, n: number, slug: string, assigned: string[]): Promise<DrafterInput['sources']> {
  if (assigned.length === 0) {
    // An introduction or conclusion may need none, but the author should
    // know the drafter had nothing to cite.
    process.stderr.write(
      `pensmith write: section ${n} (${slug}) has no assigned sources, so it is drafted to cite none; ` +
        'a claim that needs a source is listed as a gap, not written.\n',
    );
    return [];
  }
  let library;
  try {
    library = await run.library();
  } catch (e) {
    throw new DraftRefusedError(
      `not drafted: .paper/LIBRARY.json cannot be read (${(e as Error).message.split('\n')[0]}), ` +
        `so the sources its plan assigns cannot be shown to the drafter. Repair it, or run \`pensmith research\`.`,
    );
  }
  const { sources, missing } = sourceContext(library, assigned);
  if (sources.length === 0) {
    throw new DraftRefusedError(
      `not drafted: none of the sources its plan assigns (${assigned.join(', ')}) is in .paper/LIBRARY.json, ` +
        `so it has nothing to cite. Add them (\`pensmith add\` or \`pensmith research\`), or plan the section again ` +
        `(\`pensmith plan ${n} --force\`).`,
    );
  }
  if (missing.length > 0) {
    process.stderr.write(
      `pensmith write: WARN — section ${n} (${slug}): ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} assigned but not in ` +
        `.paper/LIBRARY.json, so the drafter is not shown ${missing.length === 1 ? 'it' : 'them'} and the draft cannot cite ` +
        `${missing.length === 1 ? 'it' : 'them'}.\n`,
    );
  }
  return sources;
}

/** Print the claims the drafter left out because no source supports them. */
function reportGaps(n: number, slug: string, gaps: SectionDraft['gaps']): void {
  if (gaps.length === 0) return;
  process.stderr.write(
    `pensmith write: section ${n} (${slug}): ${gaps.length} claim${gaps.length === 1 ? '' : 's'} the plan asks for ` +
      `${gaps.length === 1 ? 'has' : 'have'} no supporting source and ${gaps.length === 1 ? 'was' : 'were'} left out of the draft:\n` +
      gaps.map((g) => `  - ${g.claim} (${g.reason})\n`).join(''),
  );
}

/**
 * Draft one section: build the drafter's input from the outline, PLAN.md and
 * LIBRARY.json, render the prompt from it, ask for a draft that cites only
 * the section's sources, and save it as DRAFT.md. Both `pensmith write <n>`
 * and each node of a wave write run through here. Returns DRAFT.md's path
 * and the sources the plan assigns.
 */
async function writeOneSection(
  n: number,
  slug: string,
  force: boolean,
  run: WriteRun,
): Promise<{ path: string; assigned: string[] }> {
  const paperRoot = process.cwd();
  const planPath = sectionPlan(n, slug, paperRoot);
  // The PLAN.md is checked as a wave write checks it: one that cannot be
  // read, or whose frontmatter cannot be used, is planned again with --force.
  let plan: SectionPlanFile | null;
  try {
    plan = await loadSectionPlan(paperRoot, n, slug);
  } catch (e) {
    throw new DraftRefusedError(`not drafted: ${unusablePlanReason(n, e)}.`);
  }
  // No PLAN.md reads as a stub, which is always refused.
  const refusal = draftRefusal(n, plan?.frontmatter.status ?? 'stub', force);
  if (refusal !== null || plan === null) throw new DraftRefusedError(`not drafted: ${refusal}.`);
  // A PLAN.md written under PENSMITH_NO_LLM holds a placeholder, not a plan.
  // A model asked to draft from it would invent the section.
  if (!isNoLlmMode() && isPlaceholderParsed(plan.text, plan.frontmatter)) {
    throw new DraftRefusedError(
      `not drafted: its PLAN.md is a placeholder written without a model (PENSMITH_NO_LLM), not a plan. ` +
        `Plan the section with \`pensmith plan ${n} --force\`.`,
    );
  }
  const { text: planMd, body, frontmatter: { status, assigned_sources: assigned } } = plan;
  const sources = await sectionSources(run, n, slug, assigned);

  const { outline, profile } = run;
  const { title, purpose, depends_on, word_target } = sectionEntry(outline, n, slug);
  const input: DrafterInput = {
    section: { number: n, slug, title, purpose, depends_on, word_target: word_target && word_target > 0 ? word_target : null },
    paper: { title: outline?.paper_title ?? '', thesis: outline?.stored?.thesis ?? '' },
    brief: body.trim() || `(The plan gives no brief: write the section "${title}" as the outline describes it.)`,
    voice: resolveVoiceHint({ planMd, ...(profile ? { styleProfile: profile } : {}) }),
    sources,
  };
  const system = renderDrafterPrompt(input, assigned);

  // A planned section is 'writing' during the call, so a draft that does not
  // finish leaves it to be written again. A drafted section being drafted
  // again (--force) keeps its status until the new draft is saved: its
  // DRAFT.md is unchanged until then, and 'writing' would let a plain
  // `pensmith write` replace it.
  if (status === 'planned') {
    await updatePlanFrontmatter(planPath, (fm) => {
      fm.status = 'writing';
    });
  }

  const sourceKeys = sources.map((s) => s.citekey);
  const answer = await completeChecked({
    system,
    messages: [{ role: 'user', content: `Write section ${n}, "${title}".` }],
    role: 'write',
    scope: 'section',
    scopeId: `write-${n}`,
    schema: SectionDraftSchema,
    problemsOf: (d) => draftProblems(d, sourceKeys),
    noun: 'draft',
  });
  if ('problems' in answer) {
    throw new DraftRefusedError(
      'not drafted, and nothing was saved: the draft still cannot be used after one repair:\n' +
        answer.problems.map((p) => `  - ${p}`).join('\n'),
    );
  }

  // A draft about to be replaced (only --force, or a re-plan, gets here with
  // one) is kept beside the new one.
  const targetPath = sectionDraft(n, slug, paperRoot);
  if (existsSync(targetPath)) await atomicWriteFile(`${targetPath}.bak`, readFileSync(targetPath));
  if ('placeholder' in answer) {
    await atomicWriteFile(targetPath, artifactText(answer.placeholder));
  } else {
    await atomicWriteFile(targetPath, `${answer.value.draft.trim()}\n`);
    reportGaps(n, slug, answer.value.gaps);
  }

  // 'written' sends the router on to verify. verify owns
  // verified_against_draft_hash, so a new draft leaves the old hash stale and
  // compile re-verifies it.
  if (!(await updatePlanFrontmatter(planPath, (fm) => { fm.status = 'written'; }))) {
    process.stderr.write(
      `pensmith write: WARN — could not set status:'written' on ${planPath} ` +
      `(PLAN.md absent/unwritable); the router may not advance this section to verify.\n`,
    );
  }
  return { path: targetPath, assigned };
}

export const writeCommand = defineCommand({
  meta: {
    name: 'write',
    description:
      'Draft DRAFT.md for one planned section, or (no <n>) every planned section in waves; --force drafts a drafted one again.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based). Omit to write ALL sections wave-by-wave.',
      required: false,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: "Section slug: the outline's for this section, which --slug must match. Only with no outline does it name the folder.",
    },
    'max-parallel': {
      type: 'string',
      description:
        'Wave-mode concurrency cap (Tier 1 default 5; Tier 2 forces 1 with a WARN).',
    },
    force: {
      type: 'boolean',
      description: 'Draft a section that is already drafted again (its DRAFT.md is kept as DRAFT.md.bak).',
      default: false,
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    const force = args.force === true;
    // An <n> that is not a section number is invalid input (exit 2), with a
    // key or without one.
    const waveMode = args.n === undefined || args.n === null || args.n === '';
    const n = waveMode ? null : sectionNumberArg('write', args.n);
    if (!waveMode && n === null) return { ok: false, mode: 'invalid-input' };
    // Without a key there is no drafter to ask, and write says so before it
    // looks at any section (in a wave, before the first one starts).
    if (!isNoLlmMode()) {
      try {
        await getProviderApiKey(await resolveProviderId());
      } catch (e) {
        if (e instanceof MissingApiKeyError) {
          process.stderr.write(
            'pensmith write: ERROR — no LLM key configured.\n' +
            'Set ANTHROPIC_API_KEY (or configure a provider in runtime.json) to enable real generation.\n' +
            'Run inside Claude Code (Tier 1) for key-free operation.\n',
          );
          process.exitCode = 1;
          return { ok: false, mode: 'no-key-configured' };
        }
        throw e;
      }
    }

    // ---- Wave mode: no positional <n> ----
    // When <n> is absent, schedule the sections that have something to draft
    // into waves and write them wave by wave, each through writeOneSection.
    // Progress streams as JSON lines to stdout; warnings go to stderr.
    if (n === null) {
      const rawMax = typeof args['max-parallel'] === 'string' ? Number(args['max-parallel']) : DEFAULT_MAX_PARALLEL;
      const maxParallel = Number.isInteger(rawMax) && rawMax >= 1 ? rawMax : DEFAULT_MAX_PARALLEL;

      const paperRoot = process.cwd();

      // A missing, placeholder, hand-edited or section-less outline is
      // reported here with its reason, and the list is handed to the wave
      // orchestrator (write-orchestrator.ts), which reads it with
      // readOutlineOrThrow only when it is not given one.
      const outline = readOutline(paperRoot);
      if (!outline.ok || outline.outline.sections.length === 0) {
        process.stderr.write(
          `pensmith write: no usable outline (${outline.ok ? 'it has no sections' : outline.detail}) — run \`pensmith outline\` ` +
          `to create the section table first.\n`,
        );
        process.exitCode = EXIT_REFUSED;
        return { ok: false, mode: 'no-outline' };
      }

      // Goal awareness is confined to the CLI tier. goal=draft yields undefined,
      // so the `subscriber ? … : undefined` below makes the Foundation callback a
      // no-op — the zero-branch mechanism. Foundation never imports tutorial.ts.
      const subscriber = makeSubscriberNonFatal(paperRoot);
      const run = writeRun(paperRoot, outline.outline);
      // Once one section is refused over the cost cap, the paper is at its
      // ceiling: sections not yet started are not attempted.
      let capRefusal: CostCapExceededError | null = null;
      const results = await runAllSections(paperRoot, {
        maxParallel,
        outline: outline.outline,
        force,
        writeSection: async (node: SectionNode) => {
          if (capRefusal) {
            process.stderr.write(
              `pensmith write: section ${node.n} (${node.slug}): not drafted, because the paper is at its cost cap.\n`,
            );
            throw capRefusal;
          }
          process.stdout.write(
            JSON.stringify({ event: 'section_start', wave: node.computed_wave, section: node.slug }) + '\n',
          );
          try {
            await writeOneSection(node.n, node.slug, force, run);
          } catch (e) {
            if (e instanceof CostCapExceededError) capRefusal ??= e;
            process.stderr.write(`pensmith write: section ${node.n} (${node.slug}): ${describeFailure(e)}\n`);
            throw e;
          }
          process.stdout.write(
            JSON.stringify({ event: 'section_done', wave: node.computed_wave, section: node.slug, status: 'done' }) + '\n',
          );
        },
        // Additive observer: the key is present ONLY when a subscriber was
        // constructed (goal ∈ {learning, both}). goal=draft omits it entirely →
        // the Foundation guard is a no-op (zero-branch). The conditional spread
        // satisfies exactOptionalPropertyTypes (never pass an explicit undefined).
        ...(subscriber
          ? {
              onSectionWritten: (evt: {
                n: number;
                slug: string;
                planPath: string;
                assignedSources: string[];
              }) => subscriber.emit({ kind: 'section.written', payload: evt }),
            }
          : {}),
      });

      // Drain the subscriber so TUTORIAL.md is complete before returning. No-op
      // when no subscriber was constructed (goal=draft).
      await subscriber?.flush();

      for (const wave of results) {
        const counts = wave.sections.reduce<Record<string, number>>((acc, s) => {
          acc[s.status] = (acc[s.status] ?? 0) + 1;
          return acc;
        }, {});
        process.stdout.write(
          JSON.stringify({ event: 'wave_complete', wave: wave.wave, results: counts }) + '\n',
        );
      }

      for (const wave of results) {
        for (const s of wave.sections) {
          if (s.unusablePlan) {
            process.stderr.write(`pensmith write: section ${s.n} (${s.slug}): ERROR — not drafted, because ${s.error}.\n`);
          }
          if (s.status === 'skipped') {
            process.stderr.write(`pensmith write: section ${s.n} (${s.slug}): not drafted, because ${s.error}.\n`);
          }
          if (s.status === 'blocked') {
            process.stderr.write(
              `pensmith write: section ${s.n} (${s.slug}): not drafted, because a section it depends on was not.\n`,
            );
          }
        }
      }

      // citty does not map a verb's return value to an exit code, so set it
      // here: 2 when any section was refused (the cost cap, a declined
      // request), else 1 when any failed.
      const failed = results.flatMap((w) => w.sections.filter((s) => s.status === 'failed'));
      const anyFailed = failed.length > 0;
      if (failed.some((s) => s.exitCode === EXIT_REFUSED)) process.exitCode = EXIT_REFUSED;
      else if (anyFailed) process.exitCode = 1;
      return { ok: !anyFailed, mode: 'wave', waves: results };
    }

    // ---- Single-section mode: positional <n> present ----
    // The slug comes from the outline's section n; an explicit --slug wins.
    const paperRoot = process.cwd();
    const outline = lastCheckedOutline(paperRoot);
    const slug = sectionSlugArg('write', paperRoot, n, args.slug, outline);
    if (slug === null) return { ok: false, mode: 'not-in-outline' };
    // Construct the goal-aware subscriber for a single-section re-do too, so a
    // re-write in learning/both mode still re-annotates TUTORIAL.md. goal=draft
    // yields undefined → the emit/flush below are no-ops and DRAFT.md is
    // byte-unchanged for every goal (the writer never sees the subscriber).
    const subscriber = makeSubscriberNonFatal(paperRoot);

    let written: { path: string; assigned: string[] };
    try {
      written = await writeOneSection(n, slug, force, writeRun(paperRoot, outline));
    } catch (e) {
      if (e instanceof DraftRefusedError) {
        process.stderr.write(`pensmith write: section ${n} (${slug}): ${describeFailure(e)}\n`);
        process.exitCode = e.exitCode;
        return { ok: false, mode: 'refused' };
      }
      throw e;
    }

    if (subscriber) {
      subscriber.emit({
        kind: 'section.written',
        payload: {
          n,
          slug,
          planPath: sectionPlan(n, slug, paperRoot),
          assignedSources: written.assigned,
        },
      });
      await subscriber.flush();
    }

    process.stdout.write(`pensmith write: wrote DRAFT.md to ${written.path}\n`);
    return { ok: true, path: written.path, mode: 'real' };
  },
});

export default writeCommand;
