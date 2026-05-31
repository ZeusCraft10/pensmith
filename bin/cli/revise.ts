// bin/cli/revise.ts — `pensmith revise` verb entrypoint (WRTE-02, D-06).
//
// THIN ORCHESTRATOR — delegates 100% to bin/lib/revise.ts::runRevise.
// No business logic here. The verb args map 1:1 to ReviseOptions.

import { defineCommand } from 'citty';
import { runRevise } from '../lib/revise.js';
import { paperDir } from '../lib/paths.js';
import path from 'node:path';

export const reviseCommand = defineCommand({
  meta: {
    name: 'revise',
    description: 'Swap a flagged citation via LLM proposal. Approval gate default-on (--yolo skips).',
  },
  args: {
    n: {
      type: 'positional',
      description: 'Section number (1-based).',
      required: true,
      valueHint: '3',
    },
    section: {
      type: 'string',
      alias: 'n',
      description: 'Alias for section number.',
    },
    slug: {
      type: 'string',
      description: 'Section slug (lowercase-kebab; defaults to "placeholder").',
    },
    yolo: {
      type: 'boolean',
      description: 'Skip approval gate; auto-accept LLM proposal (retry cap = 2, then RETRY_EXHAUSTED).',
      default: false,
    },
    research: {
      type: 'string',
      description: 'Append research query to project RESEARCH.md + section RESEARCH-LOG.md (D-09).',
    },
  },
  async run({ args }) {
    const n = Number(args.n);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`pensmith revise: <n> must be a positive integer; got ${JSON.stringify(args.n)}`);
    }
    const slug = (args.slug && typeof args.slug === 'string' ? args.slug : 'placeholder');
    const paperRoot = path.resolve(process.cwd());

    const reviseOpts = {
      paperRoot,
      n,
      slug,
      yolo: args.yolo === true,
      ...(typeof args.research === 'string' ? { research: args.research } : {}),
    };
    const result = await runRevise(reviseOpts);

    if (result.status === 'accepted') {
      process.stdout.write(
        `pensmith revise: accepted — swapped [@${result.patchedCitekey ?? '?'}] → ` +
        `[@${result.replacementCitekey ?? '(removed)'}]\n` +
        `  DRAFT.md patched; verified_against_draft_hash reset to null.\n` +
        `  Run \`pensmith verify ${n}\` to re-verify.\n`,
      );
    } else if (result.status === 'rejected') {
      process.stdout.write(`pensmith revise: proposal rejected — DRAFT.md unchanged.\n`);
    } else if (result.status === 'retry_exhausted') {
      process.stdout.write(
        `pensmith revise: RETRY_EXHAUSTED — auto-loop exhausted 2 attempts. ` +
        `VERIFICATION.md updated. Manual intervention required.\n`,
      );
      process.exitCode = 1;
    } else if (result.status === 'no_failures') {
      process.stdout.write(`pensmith revise: no failing citations found in VERIFICATION.md.\n`);
    } else if (result.status === 'research_only') {
      process.stdout.write(`pensmith revise: research appended to project RESEARCH.md + RESEARCH-LOG.md.\n`);
    }

    // Ensure paperDir is referenced (for tooling that checks imports)
    void paperDir;

    return result;
  },
});

export default reviseCommand;
