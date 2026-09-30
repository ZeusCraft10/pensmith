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
//   - on the SessionStart that follows a compaction (`source: compact`) only,
//     a summary of a HANDOFF.json that is not done — the pointer the PreCompact
//     hook wrote moments before, read through loadHandoff (which migrates v1
//     in memory). Review round 2: HANDOFF.json stays on disk until `pensmith
//     resume`, so on a later startup or resume it can describe a position the
//     paper has long left and contradict the router's step; there the router
//     line alone is the context;
//   - the instruction to run `/pensmith` to continue.
// It never emits `systemMessage` and never writes stdout itself: it returns
// the protocol object, and hooks/session-start.ts prints it as one JSON line.
//
// Only validated or router-derived values reach the model (review round 1).
// `.paper/` may be shared or synced, so anyone who can write a paper's files
// could otherwise put instructions into every session opened in its folder.
// The context therefore never quotes free text read from the paper:
//   - the next step is nextActionOf(decision, { quoteDetail: false }): the
//     verb, the section id and the STATE.json slug (schema-checked
//     `[a-z0-9-]+`), never the router's attention detail, which can carry a
//     PLAN.md failure_reason or status, VERIFICATION.md rows or an OUTLINE.md
//     problem — an attention step names `/pensmith status` instead;
//   - the HANDOFF summary is its `last_updated` (an ISO datetime), `phase` and
//     `position` (enums) and `section` (SECTION_ID_RE) only — never its
//     `next_action` or `current_section` strings.
// The folder path is the one the session runs in, which Claude Code already
// knows.

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
  /** The hook input's `source` (startup | resume | clear | compact | fork); the HANDOFF summary is added only for `compact`. */
  readonly source?: string | undefined;
}

/** Claude Code caps additionalContext at 10,000 characters; stay far below. */
const MAX_CONTEXT_CHARS = 2_000;

function nextStepLine(decision: RouterDecision): string {
  return `Next step (the pensmith router): ${nextActionOf(decision, { quoteDetail: false })}`;
}

/** The resume context for the paper at `root`. Writes nothing but the `state.load` events every STATE.json read appends to SESSION.log; never throws. */
export async function buildSessionStartContext(root: string, opts: SessionStartOptions = {}): Promise<string> {
  let decision: RouterDecision;
  try {
    decision = await resolveNextAction(root, opts.routeOptions ?? {});
  } catch {
    decision = { verb: 'status', reason: 'attention' };
  }
  const lines = [`This folder holds a pensmith paper (${path.join(path.resolve(root), '.paper')}).`, nextStepLine(decision)];
  const handoff = opts.source === 'compact' ? loadHandoff(paperDir(root)) : null;
  if (handoff !== null && handoff.phase !== 'done') {
    lines.push(
      `Before the last context compaction (${handoff.last_updated}) it was at ${describeHandoffPosition(handoff, { slugFallback: false })}.`,
    );
  }
  lines.push(
    decision.verb === 'status' && decision.reason === 'done'
      ? 'Nothing more is routed for this paper; run /pensmith status to review it.'
      : 'To continue the paper, run /pensmith: each run takes the next step, and a section\'s plan, write and verify are one step (/pensmith status shows where it stands).',
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
