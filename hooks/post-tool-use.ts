#!/usr/bin/env node
// hooks/post-tool-use.ts — Phase 3 Plan 03-08.
//
// Throttles CHECKPOINTS.jsonl writes to ≤1 per minute (T-3-DOS-04).
// Silent on error — hooks must not crash the session.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { lock } from 'proper-lockfile';

const CHECKPOINTS_PATH = '.claude/CHECKPOINTS.jsonl';
const CHECKPOINTS_LOCK_PATH = '.claude/CHECKPOINTS.jsonl.lock';
const THROTTLE_MS = 60_000;

interface PostToolUseInput {
  tool?: string;
  cwd?: string;
}

export async function onPostToolUse(input: PostToolUseInput = {}): Promise<void> {
  try {
    // CR-04 fix: gate the entire read-decide-append block under
    // proper-lockfile against a sentinel .lock file. Two concurrent
    // PostToolUse invocations previously raced — both saw the same
    // stale lastWriteAt, both passed the throttle gate, and both
    // appended. Partial-line interleaving across appendFileSync calls
    // could also corrupt JSONL and permanently break the throttle.
    //
    // Same locking pattern as bin/lib/handoff.ts: lock against a
    // sentinel file (NOT the target), realpath:false (target may not
    // exist on first run), stale:10s, retries 5x@50ms.
    mkdirSync(dirname(CHECKPOINTS_PATH), { recursive: true });
    writeFileSync(CHECKPOINTS_LOCK_PATH, '', { flag: 'a' });

    let release: (() => Promise<void>) | null = null;
    try {
      release = await lock(CHECKPOINTS_LOCK_PATH, {
        retries: { retries: 5, minTimeout: 50 },
        stale: 10_000,
        realpath: false,
      });
    } catch {
      // Could not acquire the lock — degrade silently per the
      // hooks-must-not-crash-session contract.
      return;
    }

    try {
      let lastWriteAt = 0;
      if (existsSync(CHECKPOINTS_PATH)) {
        const text = readFileSync(CHECKPOINTS_PATH, 'utf8').trim();
        if (text.length > 0) {
          const lines = text.split('\n');
          const last = lines[lines.length - 1];
          if (last) {
            try {
              const parsed = JSON.parse(last) as { ts?: unknown };
              if (typeof parsed.ts === 'string') {
                lastWriteAt = Date.parse(parsed.ts) || 0;
              }
            } catch {
              /* malformed last line — treat as 0 */
            }
          }
        }
      }
      if (Date.now() - lastWriteAt < THROTTLE_MS) return;

      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        tool: input.tool ?? 'unknown',
      });
      appendFileSync(CHECKPOINTS_PATH, entry + '\n', 'utf8');
    } finally {
      await release();
    }
  } catch {
    /* silent — hooks must not crash session */
  }
}

export default onPostToolUse;
