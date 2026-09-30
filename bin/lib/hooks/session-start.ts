// bin/lib/hooks/session-start.ts — the SessionStart hook's work (PLUG-14,
// D-23a-15).
//
// When a Claude Code session starts, resumes or comes back from a compaction
// in a folder that holds a paper, give Claude (not the user) the paper's
// resume context: Claude Code adds `hookSpecificOutput.additionalContext` to
// the model's context, whereas `systemMessage` is only shown to the user —
// which is why the v0 hook's resume note never reached Claude. The context is
// one short paragraph:
//   - the router's next step for the paper (resolveNextAction, read-only —
//     the same step `/pensmith` and `pensmith next` take);
//   - a summary of a HANDOFF.json that is not done (the PreCompact hook's
//     pointer, read through loadHandoff, which migrates v1 in memory);
//   - the instruction to run `/pensmith` to continue.
// It never emits `systemMessage` and never writes stdout itself: it returns
// the protocol object, and hooks/session-start.ts prints it as one JSON line.

import path from 'node:path';
import { describeHandoffPosition, loadHandoff, nextActionOf } from '../handoff.js';
import { paperDir } from '../paths.js';
import { resolveNextAction, type ResolveOptions, type RouterDecision } from '../router.js';

export interface SessionStartOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: 'SessionStart';
    readonly additionalContext: string;
  };
}

export interface SessionStartOptions {
  /** The router's stop flags for this paper (the entry derives them like the CLI). */
  readonly routeOptions?: ResolveOptions;
}

/** Claude Code caps additionalContext at 10,000 characters; stay far below. */
const MAX_CONTEXT_CHARS = 2_000;

function nextStepLine(decision: RouterDecision): string {
  return `Next step (the pensmith router): ${nextActionOf(decision)}`;
}

/** The resume context for the paper at `root`. Read-only; never throws. */
export async function buildSessionStartContext(root: string, opts: SessionStartOptions = {}): Promise<string> {
  let decision: RouterDecision;
  try {
    decision = await resolveNextAction(root, opts.routeOptions ?? {});
  } catch {
    decision = { verb: 'status', reason: 'attention' };
  }
  const lines = [`This folder holds a pensmith paper (${path.join(path.resolve(root), '.paper')}).`, nextStepLine(decision)];
  const handoff = loadHandoff(paperDir(root));
  if (handoff !== null && handoff.phase !== 'done') {
    lines.push(
      `Before the last context compaction (${handoff.last_updated}) it was at ${describeHandoffPosition(handoff)}: ${handoff.next_action}`,
    );
  }
  lines.push(
    decision.verb === 'status' && decision.reason === 'done'
      ? 'The paper is finished; run /pensmith status to review it.'
      : 'To continue the paper, run /pensmith (one step at a time; /pensmith status shows where it stands).',
  );
  const text = lines.join('\n');
  return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS - 1)}…` : text;
}

/** The SessionStart protocol object for the paper at `root`. */
export async function sessionStartOutput(root: string, opts: SessionStartOptions = {}): Promise<SessionStartOutput> {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: await buildSessionStartContext(root, opts),
    },
  };
}
