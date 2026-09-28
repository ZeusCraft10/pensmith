// bin/cli/next.ts — `pensmith next` verb entrypoint (UX-01, UX-02, GRND-18).
//
// THIN ORCHESTRATOR: resolves the next WORK action via resolveNextAction()
// (which IGNORES HANDOFF per H4 and NEVER throws per C4/C5-HIGH), announces it,
// and runs ONE routed step through the SHARED runRouted helper exported by
// bin/pensmith.ts — the same step a bare `pensmith` runs (D-18-28): a section's
// plan → write → verify, any other decision its one verb, each dispatched with
// the forwarded global flags (≥ yolo) exactly as if invoked explicitly
// (C3-HIGH-2). Under --dry-run it loops to the end of the paper (D-18-30). No
// business logic lives here.
//
// stdout-only rule: the resolved-verb diagnostic and the `pensmith: ran …;
// next: …` summary go to STDERR (not stdout) so `next`'s stdout stays
// byte-equivalent to the underlying verbs' stdout (tier/scripting parity).
// No 17th verb is introduced.

import { defineCommand } from 'citty';
import { runRouted } from '../pensmith.js';

export const nextCommand = defineCommand({
  meta: {
    name: 'next',
    description: 'Take the next step of the active paper (for a section: plan, write and verify it).',
  },
  // Declare the four global flags so `pensmith next --yolo` parses; they are
  // forwarded into the dispatched verbs' args via dispatchVerb (C3-HIGH-2).
  args: {
    'dry-run': { type: 'boolean', description: 'Work in ./.paper-dry-run/ with no network or model call; loop to the end of the paper.', default: false },
    estimate: { type: 'boolean', description: 'Project cost; do not execute.', default: false },
    yolo: { type: 'boolean', description: 'Skip approval gates.', default: false },
    'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },
  },
  async run({ args }) {
    return runRouted({
      globalFlags: {
        yolo: args.yolo === true,
        dryRun: args['dry-run'] === true || process.env['PENSMITH_DRY_RUN'] === '1',
        estimate: args.estimate === true,
        showPrompts: args['show-prompts'] === true,
      },
      announce: (decision) => {
        process.stderr.write(`pensmith next: → ${decision.verb}\n`);
      },
    });
  },
});

export default nextCommand;
