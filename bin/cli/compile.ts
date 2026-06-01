// bin/cli/compile.ts — `pensmith compile` verb entrypoint (COMP-07, D-24).
//
// THIN DELEGATOR — 100% delegates to bin/lib/compile.ts::runCompile.
// No business logic here. No console.* (MCP-frame safety).
//
// D-24: `compile` is in the locked 16-verb list (UX02_VERBS). Do NOT add a new
// verb — compile was already declared in verbs.ts. This file promotes the
// Phase 2 stub to a real loader in REAL_VERB_LOADERS (bin/pensmith.ts).

import { defineCommand } from 'citty';
import { runCompile } from '../lib/compile.js';

export const compileCommand = defineCommand({
  meta: {
    name: 'compile',
    description: 'Assemble all verified section drafts into .paper/DRAFT.md + COMPILE-REPORT.md.',
  },
  args: {
    yolo: {
      type: 'boolean',
      description: 'Skip approval gates.',
      default: false,
    },
    'lint-headings': {
      type: 'boolean',
      description: 'Enable heading-tense-drift consistency heuristic (off by default).',
      default: false,
    },
  },
  async run({ args }) {
    const result = await runCompile({
      yolo: args['yolo'],
      lintHeadings: args['lint-headings'],
    });

    if (result.ok) {
      process.stdout.write(`pensmith compile: OK\n`);
      if (result.draftPath) {
        process.stdout.write(`  DRAFT.md: ${result.draftPath}\n`);
      }
      if (result.reportPath) {
        process.stdout.write(`  COMPILE-REPORT.md: ${result.reportPath}\n`);
      }
    } else {
      process.stdout.write(`pensmith compile: REFUSED — ${result.reason ?? 'unknown error'}\n`);
      process.exit(1);
    }
  },
});
