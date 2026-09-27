// Child-process driver for tests/session-lock.test.ts: exercises the session
// lock API in a sandboxed data dir and prints one JSON line.
//
// usage:
//   session-ops.ts reentrant <root>
//   session-ops.ts parallel <root> <n,n,...> <holdMs>   (MCP-style withPaperSession calls)
//   session-ops.ts acquire <root>                        (one CLI-kind acquire + release)

import { existsSync } from 'node:fs';
import {
  acquireSessionLock,
  readSessionLock,
  withPaperSession,
  sessionLockFile,
} from '../../../bin/lib/session-lock.js';

const [op, root, arg1, arg2] = process.argv.slice(2);
if (!op || !root) throw new Error('usage: session-ops.ts <op> <root> ...');

async function main(): Promise<unknown> {
  if (op === 'reentrant') {
    const a = await acquireSessionLock(root, { kind: 'mcp', verb: 'a' });
    const b = await acquireSessionLock(root, { kind: 'mcp', verb: 'b' });
    const afterFirstRelease = (await a.release(), existsSync(sessionLockFile(root)));
    await b.release();
    return { sameFile: a.file === b.file, afterFirstRelease, afterSecondRelease: existsSync(sessionLockFile(root)) };
  }
  if (op === 'parallel') {
    const sections = (arg1 ?? '').split(',').map(Number);
    const holdMs = Number(arg2 ?? '300');
    const spans = await Promise.all(
      sections.map((n, i) =>
        withPaperSession(root, { verb: `call-${i}`, section: n }, async () => {
          const start = Date.now();
          const owner = readSessionLock(root);
          await new Promise((r) => setTimeout(r, holdMs));
          return { n, start, end: Date.now(), ownerKind: owner?.kind ?? null, ownerPid: owner?.pid ?? null };
        }),
      ),
    );
    return { pid: process.pid, spans, lockAfter: existsSync(sessionLockFile(root)) };
  }
  if (op === 'acquire') {
    const h = await acquireSessionLock(root, { kind: 'cli', verb: 'test' });
    await h.release();
    return { acquired: true, lockAfter: existsSync(sessionLockFile(root)) };
  }
  throw new Error(`unknown op ${op}`);
}

try {
  process.stdout.write(JSON.stringify({ ok: true, result: await main() }) + '\n');
} catch (e) {
  const err = e as Error & { exitCode?: number };
  process.stdout.write(JSON.stringify({ ok: false, name: err.name, message: err.message, exitCode: err.exitCode ?? null }) + '\n');
}
