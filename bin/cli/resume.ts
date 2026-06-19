// bin/cli/resume.ts — `pensmith resume` verb entrypoint (UX-02, HOOK-02 Tier-2).
//
// THIN ORCHESTRATOR + H4 LIFECYCLE: `resume` reads HANDOFF.json for the resume
// SUMMARY only, then computes the NEXT WORK VERB via resolveNextAction() — which
// IGNORES HANDOFF and NEVER returns 'resume' — dispatches to that work verb
// through the SHARED dispatchVerb helper (forwarding global flags ≥ yolo so a
// resolved compile/done skips its OWN approval gate, C3-HIGH-2), and then CLEARS
// HANDOFF.json (best-effort rmSync) so a stale pointer cannot re-trigger resume.
// resume MUST NEVER dispatch to itself — no resume→resume loop (H4).
//
// stdout-only for the underlying verb; the resume summary goes to STDERR (parity).

import { defineCommand } from 'citty';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir } from '../lib/paths.js';
import { resolveNextAction } from '../lib/router.js';
import { HandoffSchema, type Handoff } from '../lib/schemas/handoff.js';
import { dispatchVerb } from '../pensmith.js';

function safeReadHandoff(paperRoot: string): Handoff | null {
  const handoffPath = join(paperDir(paperRoot), 'HANDOFF.json');
  if (!existsSync(handoffPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(handoffPath, 'utf8'));
    const r = HandoffSchema.safeParse(raw);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const resumeCommand = defineCommand({
  meta: {
    name: 'resume',
    description: 'Resume the active paper: summarize the last handoff and run the next work verb.',
  },
  args: {
    'dry-run': { type: 'boolean', description: 'Zero external API calls.', default: false },
    estimate: { type: 'boolean', description: 'Project cost; do not execute.', default: false },
    yolo: { type: 'boolean', description: 'Skip approval gates.', default: false },
    'show-prompts': { type: 'boolean', description: 'Echo every LLM prompt to stderr.', default: false },
  },
  async run({ args }) {
    const paperRoot = process.cwd();

    // SUMMARY only — reading HANDOFF does NOT route (H4). safeParse never throws.
    const handoff = safeReadHandoff(paperRoot);
    if (handoff && handoff.phase !== 'done') {
      process.stderr.write(
        `pensmith resume: last at phase='${handoff.phase}', section='${handoff.current_section ?? 'none'}'. ` +
          `Next: ${handoff.next_action}\n`,
      );
    }

    // Compute the next WORK verb via the HANDOFF-BLIND resolver — returns
    // plan/write/verify/compile/done (or a status terminus), NEVER 'resume'.
    const decision = await resolveNextAction(paperRoot);
    process.stderr.write(`pensmith resume: → ${decision.verb}\n`);

    const verbArgs: Record<string, unknown> = {};
    if ('n' in decision) verbArgs.n = decision.n;
    if ('slug' in decision) verbArgs.slug = decision.slug;
    if ('reason' in decision) verbArgs.reason = decision.reason;

    const result = await dispatchVerb(decision.verb, {
      args: verbArgs,
      globalFlags: {
        yolo: args.yolo === true,
        dryRun: args['dry-run'] === true,
        estimate: args.estimate === true,
        showPrompts: args['show-prompts'] === true,
      },
    });

    // CONSUME the HANDOFF: best-effort delete so a stale pointer can never
    // re-trigger resume on the next bare invocation (H4 lifecycle).
    try {
      rmSync(join(paperDir(paperRoot), 'HANDOFF.json'), { force: true });
    } catch {
      /* best-effort consume */
    }

    return result;
  },
});

export default resumeCommand;
