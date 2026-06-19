#!/usr/bin/env node
// hooks/stop.ts — Phase 7 Plan 07-03 (HOOK-04 / M1 / C2-M2).
//
// Claude Code Stop hook. Fires when the agent halts. Best-effort releases the
// pensmith `.paper` lock AND flushes the session log so a clean shutdown never
// loses buffered log records.
//
// CRITICAL (M1 / C2-M2): no code acquires a `.paper`-keyed RESOURCE lock (locks
// are per-file), so release('.paper') typically REJECTS (proper-lockfile.unlock
// on an unheld stub). The release + flush therefore run inside
// Promise.allSettled (NOT Promise.all) — a rejected release can NEVER abandon
// the session-log flush. Both settle to completion regardless.
//
// stdout protocol (T-07-01): this hook writes NOTHING to stdout. Diagnostics go
// to stderr. It never throws and ALWAYS exits 0 — a hook must not crash the
// session.

import { resolve } from 'node:path';
import { release, forceRelease } from '../bin/lib/lock.js';
import { closeSessionLog } from '../bin/lib/session-log.js';

async function main(): Promise<void> {
  try {
    // Resource locks are keyed by ABSOLUTE path (lock.ts hashes the resource
    // string into a stub). Resolve `.paper` against the hook's cwd so this
    // matches whatever acquired the lock (callers lock join(cwd, '.paper')).
    const paperResource = resolve(process.cwd(), '.paper');
    // Promise.allSettled (NOT Promise.all) — the session-log flush MUST always
    // run to completion even when release() REJECTS on an unheld lock (M1 /
    // C2-M2). Both release() (the standard proper-lockfile unlock that rejects
    // cross-process / on an unheld lock — keeps the M1 rejection path real) and
    // forceRelease() (orphan cleanup that removes the on-disk lock directory the
    // halting session left behind) run alongside the flush; a rejection in
    // either can never abandon the flush.
    await Promise.allSettled([
      release(paperResource),
      forceRelease(paperResource),
      closeSessionLog(),
    ]);
  } catch (err) {
    // Silent on stderr only — hooks must never crash the session.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[stop] shutdown cleanup skipped: ${msg}\n`);
  }
}

await main();
process.exit(0);
