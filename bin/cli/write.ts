// bin/cli/write.ts — `pensmith write <n>` verb entrypoint (WRTE-01, WRTE-04).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. In Tier 1 the workflow
// body delegates to the model with the `section-drafter` prompt
// (D-12 LOCKED slug). In Tier 2 (portable CLI) the verb writes a
// placeholder `.paper/sections/<NN>-<slug>/DRAFT.md`.
//
// The drafter-input chokepoint (WRTE-04, T-3-10) closes here:
// `assertDrafterInput` is invoked BEFORE any prompt invocation to prevent
// caller-injected fields from widening the drafter's context.
//
// Phase 3 Tier-2 fallback: see Plan 07 amendment.

import { defineCommand } from 'citty';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { sectionDraft } from '../lib/paths.js';
import { assertDrafterInput } from '../lib/drafter-input.js';

const TIER2_DRAFT = [
  '# Section DRAFT (Tier-2 placeholder)',
  '',
  '[Pensmith Tier 2: this section requires LLM drafting. Run in Claude Code,',
  ' or set ANTHROPIC_API_KEY for direct API access (Phase 4 work).]',
  '',
].join('\n');

const DEFAULT_SLUG = 'placeholder';

export const writeCommand = defineCommand({
  meta: {
    name: 'write',
    description: 'Draft DRAFT.md for one section (drafter-input contract enforced).',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based).',
      required: true,
      valueHint: '3',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to "placeholder" in Tier-2 mode).',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
  },
  async run({ args }) {
    // Phase 3 Tier-2 fallback: see Plan 07 amendment.
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`pensmith write: <n> must be a positive integer; got ${JSON.stringify(args.n)}`);
    }
    const slug = (args.slug && typeof args.slug === 'string' ? args.slug : DEFAULT_SLUG);

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

    const targetPath = sectionDraft(n, slug);
    await atomicWriteFile(targetPath, TIER2_DRAFT);
    process.stdout.write(`pensmith write: wrote Tier-2 placeholder DRAFT.md to ${targetPath}\n`);
    return { ok: true, path: targetPath, mode: 'tier2-placeholder' };
  },
});

export default writeCommand;
