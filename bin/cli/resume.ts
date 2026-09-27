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
//
// `resume --replay <entryId>` (RUN-17, D-17-30) is a flag on this verb, not a
// new verb: it finds the kind:"llm" record `<entryId>` in .paper/SESSION.log,
// re-dispatches its verb and section with the argv that session logged, and —
// when sources are offline (PENSMITH_OFFLINE=1) — serves every logged model
// response matched by (slug, sha256 of the request body), so the artifact is
// reproduced exactly with no provider call. A log written with
// `[logging] session_bodies = "redacted"` is reported as not replayable.

import { defineCommand, runCommand } from 'citty';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { paperDir } from '../lib/paths.js';
import { resolveNextAction } from '../lib/router.js';
import { HandoffSchema, type Handoff } from '../lib/schemas/handoff.js';
import { dispatchVerb, REAL_VERB_LOADERS } from '../pensmith.js';
import { readGoalFromConfig, stopAfterResearchFor, renderLearningEndState } from './goal.js';
import { UX02_VERBS, type Ux02Verb } from '../lib/verbs.js';
import { isOfflineMode } from '../lib/http-mock.js';
import {
  activateReplay,
  deactivateReplay,
  isReplayable,
  loggedArgv,
  readLlmRecords,
  ReplayError,
} from '../lib/replay.js';

/** Global flags that never belong to a verb's own argv. */
const REPLAY_DROPPED_FLAGS = new Set(['--replay', '--estimate', '--show-prompts', '--dry-run']);

/**
 * The argv to re-dispatch `verb` with: the logged invocation's own tokens after
 * the verb when it was that verb, else the section positional plus the logged
 * --yolo (a bare-router chain logged no verb-specific flags).
 */
function replayArgs(verb: string, section: number | undefined, logged: string[] | null): string[] {
  const argv = (logged ?? []).filter((a) => !REPLAY_DROPPED_FLAGS.has(a));
  const idx = argv.indexOf(verb);
  if (idx >= 0) return argv.slice(idx + 1);
  const out = section !== undefined && section > 0 ? [String(section)] : [];
  if (argv.includes('--yolo')) out.push('--yolo');
  return out;
}

async function runReplay(paperRoot: string, entryId: string): Promise<unknown> {
  const records = readLlmRecords(paperRoot);
  const rec = records.find((r) => r.id === entryId);
  if (!rec) throw new ReplayError(`replay: no SESSION.log model-call record with id ${entryId} in ${join(paperDir(paperRoot), 'SESSION.log')}`);
  if (!isReplayable(rec)) {
    throw new ReplayError(
      `replay: ${entryId} is not replayable — its bodies were not stored ` +
        '([logging] session_bodies = "redacted" keeps only hashes, token counts, cost and previews)',
    );
  }
  const verb = rec.verb;
  if (!verb || !(UX02_VERBS as readonly string[]).includes(verb)) {
    throw new ReplayError(`replay: ${entryId} names no dispatchable verb (${verb ?? 'none'})`);
  }
  const loader = REAL_VERB_LOADERS[verb as Ux02Verb];
  if (!loader) throw new ReplayError(`replay: verb ${verb} has no implementation to re-dispatch`);
  const rawArgs = replayArgs(verb, rec.section, loggedArgv(paperRoot, rec.run_id));
  const offline = isOfflineMode();
  process.stderr.write(
    `pensmith resume: replaying ${entryId} → ${verb} ${rawArgs.join(' ')}`.trimEnd() +
      (offline ? ' (sources offline: serving the logged model responses)\n' : ' (online: calling the model again)\n'),
  );
  if (offline) activateReplay(records);
  try {
    const cmd = await loader();
    return await runCommand(cmd, { rawArgs });
  } finally {
    deactivateReplay();
  }
}

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
    replay: {
      type: 'string',
      description: 'Re-run the step that logged this SESSION.log entry id (offline: serve the logged model responses).',
    },
  },
  async run({ args }) {
    const paperRoot = process.cwd();

    if (typeof args.replay === 'string' && args.replay.length > 0) {
      return runReplay(paperRoot, args.replay);
    }

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
    // Goal-aware tier: map goal → the router's goal-AGNOSTIC stopAfterResearch.
    const stop = stopAfterResearchFor(readGoalFromConfig(paperRoot));
    const decision = await resolveNextAction(paperRoot, { stopAfterResearch: stop });

    // Learning hard-stop: render the per-claim learning end-state to TUTORIAL.md
    // INSTEAD OF dispatching the status verb's generic "ready to export" message.
    // Still CONSUME the HANDOFF afterward so a stale pointer cannot re-trigger.
    if (stop && decision.verb === 'status' && decision.reason === 'done') {
      await renderLearningEndState(paperRoot);
      try {
        rmSync(join(paperDir(paperRoot), 'HANDOFF.json'), { force: true });
      } catch {
        /* best-effort consume */
      }
      return { ok: true, mode: 'learning-end-state' };
    }

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
