// bin/cli/write.ts — `pensmith write [<n>]` verb entrypoint (WRTE-01, WRTE-04).
//
// Single-section path (n provided): unchanged from Phase 3.
//   Tier-2 thin orchestrator. In Tier 1 the workflow body delegates to the
//   model with the `section-drafter` prompt (D-12 LOCKED slug). In Tier 2
//   (portable CLI) the verb writes a placeholder DRAFT.md.
//   The drafter-input chokepoint (WRTE-04, T-3-10) closes here:
//   `assertDrafterInput` is invoked BEFORE any prompt invocation.
//
// Wave-mode path (n absent, Plan 04-03):
//   Calls runAllSections(paperRoot, opts) — drains the wave graph from the
//   project OUTLINE.md wave-by-wave in bounded parallel (--max-parallel N)
//   or serial (Tier-2, --max-parallel forced 1 + one WARN). Progress is
//   streamed as structured JSON lines to stdout (D-13 / no console.*).
//   Each section in the wave loop invokes the EXISTING single-section path
//   (assertDrafterInput chokepoint preserved per WRTE-04 / T-04-11).
//
// Phase 3 Tier-2 fallback: see Plan 07 amendment.

import { defineCommand } from 'citty';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionDraft } from '../lib/paths.js';
import { assertDrafterInput } from '../lib/drafter-input.js';
import { runAllSections } from '../lib/write-orchestrator.js';
import type { SectionNode } from '../lib/schemas/wave-graph.js';

const TIER2_DRAFT = [
  '# Section DRAFT (Tier-2 placeholder)',
  '',
  '[Pensmith Tier 2: this section requires LLM drafting. Run in Claude Code,',
  ' or set ANTHROPIC_API_KEY for direct API access (Phase 4 work).]',
  '',
].join('\n');

const DEFAULT_SLUG = 'placeholder';

/**
 * Write a single section (Tier-2 placeholder). This is the per-section
 * writer used by BOTH the single-section path AND the wave-mode path.
 * assertDrafterInput is called for EVERY section — the WRTE-04 chokepoint
 * is never bypassed (T-04-11 mitigation).
 */
async function writeSingleSection(n: number, slug: string, paperRoot: string): Promise<void> {
  // T-3-10 / WRTE-04 chokepoint: validate the drafter input shape BEFORE
  // any prompt invocation. Strict-schema throws on extra fields, missing
  // fields, or wrong types. In Tier 2 placeholder mode we still call this
  // to exercise the chokepoint code-path and surface any drift at runtime.
  assertDrafterInput({
    planPath: `.paper/sections/${String(n).padStart(2, '0')}-${slug}/PLAN.md`,
    sources: [],
    wordTarget: 300,
    voiceHint: 'Formal academic tone (Tier-2 placeholder).',
  });

  const targetPath = sectionDraft(n, slug, paperRoot);
  await atomicWriteFile(targetPath, TIER2_DRAFT);
  // Progress line: structured JSON to stdout (no console.* — T-04-13 MCP frame integrity).
  process.stdout.write(
    JSON.stringify({ event: 'section_done', n, slug, path: targetPath }) + '\n',
  );
}

export const writeCommand = defineCommand({
  meta: {
    name: 'write',
    description: 'Draft DRAFT.md for sections. Without <n>, schedules all planned sections into waves.',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based). Omit for wave-mode (all sections).',
      required: false,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to "placeholder" in Tier-2 mode). Single-section path only.',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
    maxParallel: {
      type: 'string',
      description: 'Max concurrent section writes (wave-mode only; Tier 2 forces 1).',
      default: '5',
      alias: 'max-parallel',
    },
  },
  async run({ args }) {
    const paperRoot = process.cwd();

    // -----------------------------------------------------------------------
    // Single-section path: `pensmith write <n>` — unchanged from Phase 3.
    // -----------------------------------------------------------------------
    if (args.n !== undefined && args.n !== '') {
      const n = Number(args.n);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`pensmith write: <n> must be a positive integer; got ${JSON.stringify(args.n)}`);
      }
      const slug = (args.slug && typeof args.slug === 'string' ? args.slug : DEFAULT_SLUG);
      await writeSingleSection(n, slug, paperRoot);
      return { ok: true, path: sectionDraft(n, slug, paperRoot), mode: 'tier2-placeholder' };
    }

    // -----------------------------------------------------------------------
    // Wave-mode path: `pensmith write` (no <n>) — Plan 04-03.
    // -----------------------------------------------------------------------
    const rawMaxParallel = Number(args.maxParallel ?? '5');
    const maxParallel = Number.isInteger(rawMaxParallel) && rawMaxParallel >= 1
      ? rawMaxParallel
      : 5;

    // Stream wave_start event.
    process.stdout.write(JSON.stringify({ event: 'wave_start', mode: 'wave' }) + '\n');

    const waveResults = await runAllSections(paperRoot, {
      maxParallel,
      writeSection: async (node: SectionNode) => {
        await writeSingleSection(node.n, node.slug, paperRoot);
      },
    });

    // Stream wave_complete summary.
    const totalSections = waveResults.reduce((acc, r) => acc + r.wave.length, 0);
    const doneSections = waveResults
      .flatMap(r => r.wave)
      .filter(n => n.status === 'done')
      .length;
    const blockedSections = waveResults
      .flatMap(r => r.wave)
      .filter(n => n.status === 'blocked')
      .length;

    process.stdout.write(
      JSON.stringify({
        event: 'wave_complete',
        total: totalSections,
        done: doneSections,
        blocked: blockedSections,
        waves: waveResults.length,
      }) + '\n',
    );

    return { ok: true, mode: 'wave', total: totalSections, done: doneSections, blocked: blockedSections };
  },
});

export default writeCommand;
