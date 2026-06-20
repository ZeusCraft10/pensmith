// bin/cli/write.ts — `pensmith write [<n>]` verb entrypoint (WRTE-01, WRTE-04).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. In Tier 1 the workflow
// body delegates to the model with the `section-drafter` prompt
// (D-12 LOCKED slug). In Tier 2 (portable CLI) the verb writes a
// placeholder `.paper/sections/<NN>-<slug>/DRAFT.md`.
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
// Phase 3 Tier-2 fallback: see Plan 07 amendment.

import { defineCommand } from 'citty';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionDraft, sectionPlan, paperDir } from '../lib/paths.js';
import { assertDrafterInput } from '../lib/drafter-input.js';
import { runAllSections } from '../lib/write-orchestrator.js';
import type { SectionNode } from '../lib/schemas/wave-graph.js';
import { styleMatchToVoiceHint } from '../lib/style-match.js';
import { StyleProfileSchema, type StyleProfile } from '../lib/schemas/style.js';

const TIER2_DRAFT = [
  '# Section DRAFT (Tier-2 placeholder)',
  '',
  '[Pensmith Tier 2: this section requires LLM drafting. Run in Claude Code,',
  ' or set ANTHROPIC_API_KEY for direct API access (Phase 4 work).]',
  '',
].join('\n');

const DEFAULT_SLUG = 'placeholder';
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
 * Write ONE section's DRAFT.md. This is the single-section drafter path,
 * factored out so BOTH `pensmith write <n>` and the wave orchestrator's
 * per-node callback share it verbatim. The WRTE-04 chokepoint
 * (`assertDrafterInput`) runs HERE, before any write — so the wave branch can
 * never bypass it.
 */
async function writeOneSection(n: number, slug: string): Promise<string> {
  const paperRoot = process.cwd();

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
  // prompt invocation. Strict-schema throws on extra fields, missing fields, or
  // wrong types. In Tier 2 placeholder mode we still call this to exercise the
  // chokepoint code-path and surface any drift at runtime. styleProfilePath is
  // passed ONLY when a STYLE.json was successfully loaded (additive optional).
  assertDrafterInput({
    planPath: `.paper/sections/${String(n).padStart(2, '0')}-${slug}/PLAN.md`,
    sources: [],
    wordTarget: 300,
    voiceHint,
    ...(styleProfilePath ? { styleProfilePath } : {}),
  });

  const targetPath = sectionDraft(n, slug);
  await atomicWriteFile(targetPath, TIER2_DRAFT);
  return targetPath;
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
      description: 'Section slug (lowercase-kebab; defaults to "placeholder" in Tier-2 mode).',
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
      const rawMax = typeof args['max-parallel'] === 'string' ? Number(args['max-parallel']) : DEFAULT_MAX_PARALLEL;
      const maxParallel = Number.isInteger(rawMax) && rawMax >= 1 ? rawMax : DEFAULT_MAX_PARALLEL;

      const paperRoot = process.cwd();
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
      });

      for (const wave of results) {
        const counts = wave.sections.reduce<Record<string, number>>((acc, s) => {
          acc[s.status] = (acc[s.status] ?? 0) + 1;
          return acc;
        }, {});
        process.stdout.write(
          JSON.stringify({ event: 'wave_complete', wave: wave.wave, results: counts }) + '\n',
        );
      }

      const anyFailed = results.some((w) => w.sections.some((s) => s.status === 'failed'));
      return { ok: !anyFailed, mode: 'wave', waves: results };
    }

    // ---- Single-section mode: positional <n> present (UNCHANGED) ----
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`pensmith write: <n> must be a positive integer; got ${JSON.stringify(args.n)}`);
    }
    const slug = (args.slug && typeof args.slug === 'string' ? args.slug : DEFAULT_SLUG);

    const targetPath = await writeOneSection(n, slug);
    process.stdout.write(`pensmith write: wrote Tier-2 placeholder DRAFT.md to ${targetPath}\n`);
    return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
  },
});

export default writeCommand;
