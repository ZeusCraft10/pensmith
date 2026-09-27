// Child-process holder for tests/session-lock.test.ts: take the paper's
// session lock as a CLI (or MCP) session and keep it until killed — the
// "another pensmith session is running" side of RUN-23.
//
// usage: hold-session.ts <root> <cli|mcp> [claudeSessionId]
// prints: {"held":true,"pid":<pid>,"file":"<lock file>"} once the lock is held.

import { acquireSessionLock } from '../../../bin/lib/session-lock.js';

const [root, kind, claude] = process.argv.slice(2);
if (!root || (kind !== 'cli' && kind !== 'mcp')) throw new Error('usage: hold-session.ts <root> <cli|mcp> [claudeSessionId]');

const handle = await acquireSessionLock(root, { kind, verb: 'write', claudeSessionId: claude ?? null });
process.stdout.write(JSON.stringify({ held: true, pid: process.pid, file: handle.file }) + '\n');
// Hold until killed (SIGKILL in the stale-lock test) or asked to exit on stdin.
setInterval(() => undefined, 1_000);
process.stdin.on('data', () => {
  void handle.release().then(() => process.exit(0));
});
