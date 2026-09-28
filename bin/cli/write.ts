// bin/cli/write.ts — `pensmith write [<n>]` verb entrypoint (WRTE-01, WRTE-04).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. In Tier 1 the workflow
// body delegates to the model with the `section-drafter` prompt
// (D-12 LOCKED slug). In Tier 2 (portable CLI) the verb calls complete()
// via the Phase 11 transport (GEN-02).
//
// Plan 04-03 — wave mode. When invoked WITHOUT a positional <n>, the verb
// schedules ALL planned sections into waves and writes them wave-by-wave via
// `bin/lib/write-orchestrator.ts::runAllSections`, calling the SAME per-section
// writer for each node (so the WRTE-04 chokepoint runs per section — no bypass).
// The single-section `pensmith write <n>` path is unchanged.
//
// The drafter-input chokepoint (WRTE-04, T-3-10) closes here:
// `assertDrafterInput` is invoked BEFORE any prompt invocation to prevent
// caller-injected fields from widening the drafter's context. Both the
// single-section path AND the per-node wave writer route through it.
//
// Phase 17 wiring (RUN-07): run() calls assertLlmConfigured('write') before
// any section is touched, in both modes — a missing key is one line through
// the dispatcher ('Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY (or configure
// a local endpoint)'). Under PENSMITH_NO_LLM=1 the probe is a no-op and
// complete() returns the deterministic stub.

import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { readGoalFromConfig } from './goal.js';
import { sectionDraft, sectionPlan, paperDir, projectRoot } from '../lib/paths.js';
import { updatePlanFrontmatter } from '../lib/plan-status.js';
import { assertDrafterInput } from '../lib/drafter-input.js';
import { runAllSections } from '../lib/write-orchestrator.js';
import { parseOutline } from '../lib/outline-parse.js';
import type { SectionNode } from '../lib/schemas/wave-graph.js';
import { styleMatchToVoiceHint } from '../lib/style-match.js';
import { StyleProfileSchema, type StyleProfile } from '../lib/schemas/style.js';
import { TutorialSubscriber } from '../lib/tutorial.js';
import { loadFrontmatterDocSync } from '../lib/frontmatter.js';
import { PlanFrontmatterSchema } from '../lib/schemas/plan-frontmatter.js';
import { loadPrompt, interpolate } from '../lib/prompt-loader.js';
import { complete, assertLlmConfigured, isFatalLlmError } from '../lib/anthropic.js';
import { resolveSectionArg } from '../lib/section-slug.js';
import { EXIT_COST_CAP, EXIT_ERROR, type ExitCode } from '../lib/exit-codes.js';
import { classifyFailure, failureLine } from '../lib/verb-outcome.js';

// Phase 11 — the section-draft placeholder constant has been removed. write now
// calls complete() for real generation (GEN-02). With no key configured, run()
// refuses up front (assertLlmConfigured, GEN-06 / RUN-07). With
// PENSMITH_NO_LLM=1: complete() returns the deterministic stub.

const DEFAULT_MAX_PARALLEL = 5;

// STYL-03 default tone — the never-empty fallback when neither a PLAN.md voice
// line nor a style-match profile is available.
const DEFAULT_VOICE_HINT = 'Formal academic tone (Tier-2 placeholder).';

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
 * STYL-03 consumer — load the paper's STYLE.json (when present) and parse it via
 * StyleProfileSchema INSIDE a try/catch. A malformed/partial STYLE.json must
 * fall back to the default tone, NEVER throw inside the write verb (T-08-05-05).
 * Returns the parsed profile + its path, or { profile: undefined } when the file
 * is absent or unparseable.
 */
function loadStyleProfile(
  paperRoot: string,
): { profile?: StyleProfile; styleProfilePath?: string } {
  // Resolve via paperDir() for producer/consumer path consistency — NOT a
  // hardcoded join(paperRoot, '.paper', 'STYLE.json').
  const stylePath = path.join(paperDir(paperRoot), 'STYLE.json');
  if (!existsSync(stylePath)) return {};
  try {
    const raw = readFileSync(stylePath, 'utf8');
    const profile = StyleProfileSchema.parse(JSON.parse(raw));
    return { profile, styleProfilePath: stylePath };
  } catch {
    // Malformed / partial STYLE.json — fall back to the default tone.
    return {};
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
 * Best-effort read of a section PLAN.md's `assigned_sources` citekeys for the
 * single-section provenance emit. Returns [] when the PLAN.md is absent or
 * unparseable — never throws (mirrors loadStyleProfile's degrade-to-default).
 */
function readAssignedSources(planPath: string): string[] {
  try {
    if (!existsSync(planPath)) return [];
    // CONF-04: the versioned reader (writeSection has already stamped the file).
    const { frontmatter } = loadFrontmatterDocSync('plan', planPath);
    return PlanFrontmatterSchema.parse(frontmatter).assigned_sources;
  } catch {
    return [];
  }
}

/**
 * Write ONE section's DRAFT.md. This is the single-section drafter path,
 * factored out so BOTH `pensmith write <n>` and the wave orchestrator's
 * per-node callback share it verbatim. The WRTE-04 chokepoint
 * (`assertDrafterInput`) runs HERE, before any write — so the wave branch can
 * never bypass it.
 */
async function writeOneSection(n: number, slug: string): Promise<string> {
  const paperRoot = projectRoot();

  // STYL-03 — resolve the effective voiceHint by strict priority BEFORE the
  // chokepoint: PLAN.md voice direction > style-match render > default. Read the
  // section PLAN.md (best-effort) for the per-section override, and load
  // STYLE.json (when the producer wrote one) for the style-match render. A
  // malformed STYLE.json or missing PLAN.md degrades to the default tone —
  // never throws (T-08-05-05).
  const planPath = sectionPlan(n, slug, paperRoot);
  let planMd = '';
  try {
    planMd = readFileSync(planPath, 'utf8');
  } catch {
    planMd = ''; // PLAN.md may not exist in Tier-2 placeholder mode.
  }
  const { profile, styleProfilePath } = loadStyleProfile(paperRoot);
  const voiceHint = resolveVoiceHint({
    planMd,
    ...(profile ? { styleProfile: profile } : {}),
  });

  // T-3-10 / WRTE-04 chokepoint: validate the drafter input shape BEFORE any
  // prompt invocation or complete() call. Strict-schema throws on extra fields,
  // missing fields, or wrong types. assertDrafterInput MUST precede complete()
  // (invariant 3 in 11-PATTERNS — WRTE-04 ordering preserved, T-11-07).
  // styleProfilePath is passed ONLY when a STYLE.json was successfully loaded.
  assertDrafterInput({
    planPath: `.paper/sections/${String(n).padStart(2, '0')}-${slug}/PLAN.md`,
    sources: [],
    wordTarget: 300,
    voiceHint,
    ...(styleProfilePath ? { styleProfilePath } : {}),
  });

  // ── Phase 11: call complete() AFTER assertDrafterInput (WRTE-04 preserved) ──
  // run() already asserted an LLM is configured (RUN-07); any provider error
  // propagates upward — the wave orchestrator isolates it per section, and the
  // single-section path reports it as one line through the dispatcher.
  // PENSMITH_NO_LLM=1: complete() short-circuits to the deterministic stub.
  const drafterPrompt = loadPrompt('section-drafter');
  const interpolatedDrafterPrompt = interpolate(drafterPrompt, {
    section: JSON.stringify({ number: n, slug, title: slug, depends_on: [], estimated_word_count: 300 }),
    brief: planMd || `Section ${n}: ${slug}`,
    assignedSources: '[]',
    voiceHint,
  });

  // Audit #9: mark the section 'writing' BEFORE drafting (D-08-AMENDED). If the
  // drafter throws, PLAN.md is left 'writing' so the router routes back to write
  // (retry), never silently stranding the section.
  await updatePlanFrontmatter(planPath, (fm) => {
    fm.status = 'writing';
  });

  const result = await complete({
    slug: 'section-drafter',
    section: n,
    system: interpolatedDrafterPrompt,
    messages: [{ role: 'user', content: `Write section ${n} (${slug}).` }],
  });

  const targetPath = sectionDraft(n, slug, paperRoot);
  await atomicWriteFile(targetPath, result.text);

  // Audit #9: mark the section 'written' so the router (router.ts:202) advances
  // to verify instead of re-routing the freshly-drafted section back to plan and
  // re-drafting. verify owns verified_against_draft_hash — write deliberately
  // does NOT set it, so a re-write leaves the old hash stale and compile's
  // staleness check forces re-verification (the write<->verify cycle-break).
  if (!(await updatePlanFrontmatter(planPath, (fm) => { fm.status = 'written'; }))) {
    process.stderr.write(
      `pensmith write: WARN — could not set status:'written' on ${planPath} ` +
      `(PLAN.md absent/unwritable); the router may not advance this section to verify.\n`,
    );
  }
  return targetPath;
}

/**
 * The wave's exit code from its failures' classified codes: EXIT_COST_CAP when
 * the session cap refused a call; else the code every failure shares (e.g. a
 * session-lock refusal); else EXIT_ERROR.
 */
function waveExitCode(codes: readonly ExitCode[]): ExitCode {
  if (codes.includes(EXIT_COST_CAP)) return EXIT_COST_CAP;
  const first = codes[0];
  if (first !== undefined && codes.every((c) => c === first)) return first;
  return EXIT_ERROR;
}

export const writeCommand = defineCommand({
  meta: {
    name: 'write',
    description:
      'Draft DRAFT.md for one section, or (no <n>) schedule all sections into waves.',
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
      description: 'Section slug (lowercase-kebab; defaults to the outline\'s slug for <n>).',
    },
    'max-parallel': {
      type: 'string',
      description:
        'Wave-mode concurrency cap (Tier 1 default 5; Tier 2 forces 1 with a WARN).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    // ---- Wave mode: no positional <n> ----
    // When <n> is absent, schedule ALL planned sections into waves and write
    // them wave-by-wave. Each node routes through writeOneSection (which runs
    // the WRTE-04 chokepoint per section — no bypass). Progress streams as
    // structured JSON lines to stdout (04-RESEARCH §L); WARN goes to stderr.
    if (args.n === undefined || args.n === null || args.n === '') {
      // CR-02 / RUN-07: GEN-06 fail-loud probe for wave mode, before any
      // section is dispatched (a per-section failure could not stop the wave).
      // One line through dispatch(): 'Set one of: ANTHROPIC_API_KEY, …'.
      await assertLlmConfigured('write');

      const rawMax = typeof args['max-parallel'] === 'string' ? Number(args['max-parallel']) : DEFAULT_MAX_PARALLEL;
      const maxParallel = Number.isInteger(rawMax) && rawMax >= 1 ? rawMax : DEFAULT_MAX_PARALLEL;

      const paperRoot = projectRoot();

      // Audit M2: a missing or section-less OUTLINE.md must yield a friendly
      // diagnostic, not a raw parseOutline stack trace from the wave orchestrator
      // (write-orchestrator.ts calls parseOutline, which throws "no section
      // table" on an absent/placeholder outline). Pre-check here and degrade
      // gracefully, mirroring `done`'s "run 'pensmith compile' first" stance.
      const outlinePath = path.join(paperDir(paperRoot), 'OUTLINE.md');
      let outlineSectionCount = 0;
      try {
        outlineSectionCount = parseOutline(readFileSync(outlinePath, 'utf8')).sections.length;
      } catch {
        outlineSectionCount = 0;
      }
      if (outlineSectionCount === 0) {
        process.stderr.write(
          `pensmith write: no usable outline at ${outlinePath} — run \`pensmith outline\` ` +
          `to create the section table first.\n`,
        );
        process.exitCode = 1;
        return { ok: false, mode: 'no-outline' };
      }

      // Goal awareness is confined to the CLI tier. goal=draft yields undefined,
      // so the `subscriber ? … : undefined` below makes the Foundation callback a
      // no-op — the zero-branch mechanism. Foundation never imports tutorial.ts.
      const subscriber = makeSubscriberNonFatal(paperRoot);
      const results = await runAllSections(paperRoot, {
        maxParallel,
        writeSection: async (node: SectionNode) => {
          process.stdout.write(
            JSON.stringify({ event: 'section_start', wave: node.computed_wave, section: node.slug }) + '\n',
          );
          await writeOneSection(node.n, node.slug);
          process.stdout.write(
            JSON.stringify({ event: 'section_done', wave: node.computed_wave, section: node.slug, status: 'done' }) + '\n',
          );
        },
        // Additive observer: the key is present ONLY when a subscriber was
        // constructed (goal ∈ {learning, both}). goal=draft omits it entirely →
        // the Foundation guard is a no-op (zero-branch). The conditional spread
        // satisfies exactOptionalPropertyTypes (never pass an explicit undefined).
        // RUN-09: a failure every later section would repeat (the session cost
        // cap, a missing key, an invalid runtime config, a replay miss) stops
        // the run — sections not yet started are reported `skipped`.
        stopOn: isFatalLlmError,
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

      // RUN-09 / RUN-12: every failed section gets ONE stderr line naming it and
      // the failure (classified exactly as the dispatcher would classify a
      // single-section run), and the run exits with the failures' documented
      // code — EXIT_COST_CAP when the session cap stopped it.
      const failures = results.flatMap((w) => w.sections.filter((s) => s.status === 'failed'));
      const codes: ExitCode[] = [];
      for (const f of failures) {
        const c = classifyFailure(f.cause ?? new Error(f.error ?? 'unknown error'));
        codes.push(c.code);
        process.stderr.write(`${failureLine(`pensmith write: section ${f.n} (${f.slug}) failed: ${c.message}`)}\n`);
      }
      const skipped = results.reduce((acc, w) => acc + w.sections.filter((s) => s.status === 'skipped').length, 0);
      if (skipped > 0) {
        process.stderr.write(`pensmith write: stopped — ${skipped} section(s) not attempted; fix the failure above and re-run \`pensmith write\`.\n`);
      }
      if (failures.length === 0) return { ok: true, mode: 'wave', waves: results };
      return { ok: false, mode: 'wave', waves: results, exitCode: waveExitCode(codes) };
    }

    // ---- Single-section mode: positional <n> present (UNCHANGED) ----
    // RUN-09: <n> must name one of the paper's sections (EXIT_USAGE otherwise —
    // before any model call, and no placeholder folder for a registered paper).
    const paperRoot = projectRoot();
    const { n, slug } = resolveSectionArg('write', paperRoot, args.n, args.slug);
    // GEN-06 / RUN-07 fail-loud probe: an LLM must be configured before the
    // section is touched (writeOneSection marks it 'writing' first).
    await assertLlmConfigured('write');
    // Construct the goal-aware subscriber for a single-section re-do too, so a
    // re-write in learning/both mode still re-annotates TUTORIAL.md. goal=draft
    // yields undefined → the emit/flush below are no-ops and DRAFT.md is
    // byte-unchanged for every goal (the writer never sees the subscriber).
    const subscriber = makeSubscriberNonFatal(paperRoot);

    const targetPath = await writeOneSection(n, slug);

    if (subscriber) {
      subscriber.emit({
        kind: 'section.written',
        payload: {
          n,
          slug,
          planPath: sectionPlan(n, slug, paperRoot),
          assignedSources: readAssignedSources(sectionPlan(n, slug, paperRoot)),
        },
      });
      await subscriber.flush();
    }

    process.stdout.write(`pensmith write: wrote DRAFT.md to ${targetPath}\n`);
    return { ok: true, path: targetPath, mode: 'real' };
  },
});

export default writeCommand;
