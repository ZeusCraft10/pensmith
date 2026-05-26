// bin/cli/outline.ts — `pensmith outline` verb entrypoint (OUTL-01).
//
// Plan 03-07 Task 7.2 — Tier-2 thin orchestrator. In Tier 1 the workflow
// body delegates to the model with the `outline-author` prompt
// (D-12 LOCKED slug). In Tier 2 (portable CLI) the verb writes a
// placeholder `.paper/OUTLINE.md` so downstream `plan`/`write` verbs
// have something to read.
//
// Phase 3 Tier-2 fallback: see Plan 07 amendment.

import { defineCommand } from 'citty';
import path from 'node:path';
import { atomicWriteFile } from '../lib/atomic-write.js';
import { paperDir } from '../lib/paths.js';

const TIER2_OUTLINE = [
  '# Pensmith Outline (Tier-2 placeholder)',
  '',
  '[Pensmith Tier 2: this section requires LLM drafting. Run in Claude Code,',
  ' or set ANTHROPIC_API_KEY for direct API access (Phase 4 work).]',
  '',
  '## 1 — Introduction',
  '## 2 — Background',
  '## 3 — Method',
  '## 4 — Discussion',
  '## 5 — Conclusion',
  '',
].join('\n');

export const outlineCommand = defineCommand({
  meta: {
    name: 'outline',
    description: 'Propose a section outline (approval-gated unless --yolo).',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip the approval gate.',
      default: false,
    },
  },
  async run() {
    // Phase 3 Tier-2 fallback: see Plan 07 amendment.
    const outlinePath = path.join(paperDir(), 'OUTLINE.md');
    await atomicWriteFile(outlinePath, TIER2_OUTLINE);
    process.stdout.write(`pensmith outline: wrote Tier-2 placeholder to ${outlinePath}\n`);
    return { ok: true, path: outlinePath, mode: 'tier2-placeholder' };
  },
});

export default outlineCommand;
