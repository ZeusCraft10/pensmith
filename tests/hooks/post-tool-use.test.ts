// tests/hooks/post-tool-use.test.ts — Phase 7 Wave 0 coverage check for HOOK-03.
//
// HOOK-03 (the throttle gate) is ALREADY COMPLETE (hooks/post-tool-use.ts,
// Phase 3 Plan 03-08). This file is a COVERAGE CHECK / regression guard — it
// does NOT reimplement the hook. The throttle assertion PASSES now; the source
// sentinels (THROTTLE_MS + proper-lockfile) guard that HOOK-03 stays intact.
//
// stdout is the hook-protocol channel — empty always (T-07-01).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../hooks/post-tool-use.ts', import.meta.url));
const HOOK_MOD = new URL('../../hooks/post-tool-use.js', import.meta.url).href;
// Resolve tsx's loader to an ABSOLUTE file URL so the hook subprocess can load
// it regardless of cwd (a bare `--import tsx` resolves relative to the child's
// cwd, which is a tmpdir with no node_modules → ERR_MODULE_NOT_FOUND).
const TSX_LOADER = import.meta.resolve('tsx');
const CHECKPOINTS_REL = join('.claude', 'CHECKPOINTS.jsonl');

interface RunResult { status: number | null; stdout: string; stderr: string; }
function runHook(cwd: string): RunResult {
  try {
    const stdout = execFileSync(process.execPath, ['--import', TSX_LOADER, HOOK], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ? err.stdout.toString() : '',
      stderr: err.stderr ? err.stderr.toString() : '',
    };
  }
}

function freshCwd(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-post-tool-use-'));
}

// === exit 0 + empty stdout (hook-protocol) ===
test('HOOK-03: post-tool-use exits 0 with empty stdout', () => {
  const cwd = freshCwd();
  const res = runHook(cwd);
  assert.equal(res.status, 0, 'HOOK-03: post-tool-use exits 0');
  assert.equal(res.stdout, '', 'HOOK-03: stdout MUST be empty (hook-protocol channel)');
});

// === throttle: two quick invocations append AT MOST one line (THROTTLE_MS) ===
test('HOOK-03: two onPostToolUse calls in quick succession append AT MOST one CHECKPOINTS line (throttle)',
  async () => {
    const cwd = freshCwd();
    const prevCwd = process.cwd();
    process.chdir(cwd); // CHECKPOINTS_PATH is cwd-relative ('.claude/CHECKPOINTS.jsonl')
    try {
      const mod = (await import(HOOK_MOD)) as {
        onPostToolUse: (input?: { tool?: string; cwd?: string }) => Promise<void>;
      };
      await mod.onPostToolUse({ tool: 'Read' });
      await mod.onPostToolUse({ tool: 'Edit' }); // within THROTTLE_MS → must be suppressed
      const checkpoints = join(cwd, CHECKPOINTS_REL);
      assert.ok(existsSync(checkpoints), 'HOOK-03: first call must create CHECKPOINTS.jsonl');
      const lines = readFileSync(checkpoints, 'utf8').trim().split('\n').filter(Boolean);
      assert.ok(
        lines.length <= 1,
        `HOOK-03: the THROTTLE_MS gate must allow at most one line per minute, got ${lines.length}`,
      );
    } finally {
      process.chdir(prevCwd);
    }
  });

// === regression guard: HOOK-03 source keeps its throttle + lockfile sentinels ===
test('HOOK-03: post-tool-use.ts retains THROTTLE_MS and the proper-lockfile sentinel (no reimplementation)', () => {
  const src = readFileSync(HOOK, 'utf8');
  assert.match(src, /THROTTLE_MS/, 'HOOK-03: post-tool-use.ts must retain THROTTLE_MS (throttle gate)');
  assert.match(src, /proper-lockfile/, 'HOOK-03: post-tool-use.ts must retain the proper-lockfile guard (CR-04 race fix)');
  assert.match(src, /\.lock/, 'HOOK-03: the sentinel .lock file pattern must be preserved');
});
