// bin/lib/hooks/stop.ts — the Stop hook's work (PLUG-14, RUN-23, D-17-37;
// HOOK-04 / M1 / C2-M2).
//
// When the agent stops, release the paper's session lock ONLY when an MCP
// server of THIS Claude Code session left it behind: owner kind 'mcp', owner
// claudeSessionId equal to the `session_id` Claude Code passes on stdin, and
// the owner process no longer running (session-lock.ts
// releaseClaudeSessionLock). A live server's record is a tool call still in
// flight — an interrupted pensmith_write keeps drafting — and is kept (review
// round 3). A CLI session's lock, another Claude session's, or none is left
// alone. Then flush the session log.
//
// Both run under Promise.allSettled (never Promise.all), so a failing release
// can never abandon the flush (M1 / C2-M2). Returns what happened; the entry
// (hooks/stop.ts) prints nothing to stdout.

import { closeSessionLog } from '../session-log.js';
import { releaseClaudeSessionLock } from '../session-lock.js';

export interface StopOutcome {
  /** True when the lock this session's MCP server left behind was removed. */
  readonly released: boolean;
  /** One line per step that failed (the entry writes them to stderr). */
  readonly errors: readonly string[];
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Apply the Stop policy for the paper at `root` and Claude session `sessionId`. Never throws. */
export async function stopHook(root: string, sessionId: string | null): Promise<StopOutcome> {
  const [release, flush] = await Promise.allSettled([
    Promise.resolve().then(() => releaseClaudeSessionLock(root, sessionId ?? '')),
    closeSessionLog(),
  ]);
  const errors: string[] = [];
  if (release.status === 'rejected') errors.push(`session-lock release skipped: ${message(release.reason)}`);
  if (flush.status === 'rejected') errors.push(`session-log flush failed: ${message(flush.reason)}`);
  return { released: release.status === 'fulfilled' && release.value, errors };
}
