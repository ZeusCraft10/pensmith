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
} from 'node:fs';
import { dirname } from 'node:path';

const CHECKPOINTS_PATH = '.claude/CHECKPOINTS.jsonl';
const THROTTLE_MS = 60_000;

interface PostToolUseInput {
  tool?: string;
  cwd?: string;
}

export async function onPostToolUse(input: PostToolUseInput = {}): Promise<void> {
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

    mkdirSync(dirname(CHECKPOINTS_PATH), { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      tool: input.tool ?? 'unknown',
    });
    appendFileSync(CHECKPOINTS_PATH, entry + '\n', 'utf8');
  } catch {
    /* silent — hooks must not crash session */
  }
}

export default onPostToolUse;
