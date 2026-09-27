#!/usr/bin/env node
// hooks/stop.ts — Phase 7 Plan 07-03 (HOOK-04 / M1 / C2-M2), RUN-23 (D-17-37).
//
// Claude Code Stop hook. Fires when the agent halts. It flushes the session log
// so a clean shutdown never loses buffered log records, and applies the
// session-lock release POLICY:
//
//   It releases the paper's session lock ONLY when the lock is owned by a
//   pensmith MCP server (kind 'mcp') of THIS Claude Code session — the owner's
//   claudeSessionId equals the `session_id` Claude Code passes on stdin. It
//   never removes any other process's lock (a CLI run in a terminal, another
//   Claude session); a crashed holder is cleared by stale detection instead.
//
// (The earlier unconditional force-release of a `.paper` lock is gone: it could
// delete a live CLI session's lock and let two sessions interleave.)
//
// The paper root resolves like the MCP server's: PENSMITH_PAPER_ROOT, else the
// hook's working directory — never the `pensmith open` pointer (D-17-33).
//
// The release + flush run inside Promise.allSettled (NOT Promise.all), so a
// failing release can never abandon the session-log flush (M1 / C2-M2).
//
// stdout protocol (T-07-01): this hook writes NOTHING to stdout. Diagnostics go
// to stderr. It never throws and ALWAYS exits 0 — a hook must not crash the
// session.

import { closeSessionLog } from '../bin/lib/session-log.js';
import { servicePaperRoot } from '../bin/lib/paths.js';
import { releaseClaudeSessionLock } from '../bin/lib/session-lock.js';

/** Bound on waiting for the hook's stdin JSON (Claude Code writes it at spawn). */
const STDIN_TIMEOUT_MS = 2_000;

/** Read the hook input JSON from stdin; null when absent, a TTY, or not JSON. */
async function readHookInput(): Promise<{ session_id?: unknown } | null> {
  if (process.stdin.isTTY) return null;
  const text = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    const finish = (): void => {
      clearTimeout(timer);
      process.stdin.removeAllListeners();
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    process.stdin.on('data', (c: Buffer) => chunks.push(c));
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as { session_id?: unknown }) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  try {
    const input = await readHookInput();
    const sessionId = typeof input?.session_id === 'string' ? input.session_id : '';
    const root = servicePaperRoot();
    const results = await Promise.allSettled([
      Promise.resolve().then(() => releaseClaudeSessionLock(root, sessionId)),
      closeSessionLog(),
    ]);
    const [release] = results;
    if (release?.status === 'rejected') {
      const msg = release.reason instanceof Error ? release.reason.message : String(release.reason);
      process.stderr.write(`[stop] session-lock release skipped: ${msg}\n`);
    }
  } catch (err) {
    // Silent on stderr only — hooks must never crash the session.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[stop] shutdown cleanup skipped: ${msg}\n`);
  }
}

await main();
process.exit(0);
