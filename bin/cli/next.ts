// bin/cli/next.ts — `pensmith next` verb entrypoint (UX-01, UX-02).
//
// THIN ORCHESTRATOR: resolves the next WORK action via resolveNextAction()
// (which IGNORES HANDOFF per H4 and NEVER throws per C4/C5-HIGH) and dispatches
// to that verb through the SHARED dispatchVerb helper exported by bin/pensmith.ts
// — so the resolved verb receives the forwarded global flags (≥ yolo) exactly as
// if invoked explicitly (C3-HIGH-2). No business logic lives here.
//
// stdout-only rule: the resolved-verb diagnostic goes to STDERR (not stdout) so
// `next`'s stdout stays byte-equivalent to the underlying verb's stdout
// (tier/scripting parity). No 17th verb is introduced.

import { defineCommand } from 'citty';
import { resolveNextAction } from '../lib/router.js';
import { dispatchVerb } from '../pensmith.js';

export const nextCommand = defineCommand({
  meta: {
    name: 'next',
    description: 'Resolve and execute the next pending action for the active paper.',
  },
  // Declare the four global flags so `pensmith next --yolo` parses; they are
  // forwarded into the dispatched verb's args via dispatchVerb (C3-HIGH-2).
  args: {
    'dry-run': { type: 'boolean', description: 'Zero external API calls.', default: false },
    estimate: { type: 'boolean', description: 'Project cost; do not execute.', default: false },
    yolo: { type: 'boolean', description: 'Skip approval gates.', default: false },
    'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },
  },
  async run({ args }) {
    const paperRoot = process.cwd();
    const decision = await resolveNextAction(paperRoot);
    process.stderr.write(`pensmith next: → ${decision.verb}\n`);

    // Build the per-verb args from the decision (n/slug where applicable).
    const verbArgs: Record<string, unknown> = {};
    if ('n' in decision) verbArgs.n = decision.n;
    if ('slug' in decision) verbArgs.slug = decision.slug;
    if ('reason' in decision) verbArgs.reason = decision.reason;

    return dispatchVerb(decision.verb, {
      args: verbArgs,
      globalFlags: {
        yolo: args.yolo === true,
        dryRun: args['dry-run'] === true,
        estimate: args.estimate === true,
        showPrompts: args['show-prompts'] === true,
      },
    });
  },
});

export default nextCommand;
