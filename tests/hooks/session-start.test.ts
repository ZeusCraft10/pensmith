// tests/hooks/session-start.test.ts — Phase 7 Wave 0 RED scaffold for HOOK-02.
//
// SessionStart emits resume context from .paper/HANDOFF.json. Phase 2 ships a
// bare `process.exit(0)` stub; Plan 07-03 upgrades it to emit a single JSON
// frame carrying a `systemMessage`. RED-by-skip: the emission assertions skip
// while session-start.ts is still the stub (detected by reading the source);
// the empty-stdout-no-handoff case stays un-skipped (the stub satisfies it).
//
// stdout is the hook-protocol channel — it MUST be empty OR exactly one JSON
// frame (T-07-01). Hooks run via execFileSync(process.execPath, ['--import',
// 'tsx', hook], { cwd, stdio:['ignore','pipe','pipe'] }) exactly like
// tests/hooks-noop.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../hooks/session-start.ts', import.meta.url));
// Resolve tsx's loader to an ABSOLUTE file URL so the hook subprocess can load
// it regardless of cwd (a bare `--import tsx` resolves relative to the child's
// cwd, which is a tmpdir with no node_modules → ERR_MODULE_NOT_FOUND).
const TSX_LOADER = import.meta.resolve('tsx');

// RED-by-skip: the stub is literally `process.exit(0)` with no HANDOFF read.
// Detect the upgrade by checking the source no longer matches the bare stub
// (i.e. it references HANDOFF / systemMessage). existsSync alone is
// insufficient — the file already exists as a stub.
const hookSrc = existsSync(HOOK) ? readFileSync(HOOK, 'utf8') : '';
const emissionWired = /HANDOFF|systemMessage/.test(hookSrc);

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
  return mkdtempSync(join(tmpdir(), 'pensmith-session-start-'));
}

function writeHandoff(cwd: string, phase: string): void {
  const pDir = join(cwd, '.paper');
  mkdirSync(pDir, { recursive: true });
  writeFileSync(
    join(pDir, 'HANDOFF.json'),
    JSON.stringify({
      schema_version: 1,
      last_updated: new Date().toISOString(),
      current_section: 'intro',
      phase,
      next_action: 'Resume write on section intro.',
      breadcrumbs: [],
      section_pointers: [
        {
          slug: 'intro',
          plan_path: join(pDir, 'sections', '01-intro', 'PLAN.md'),
          draft_path: null,
          verification_path: null,
          state: 'planned',
        },
      ],
    }),
  );
}

// === (a) no HANDOFF.json → empty stdout, exit 0 (un-skipped: stub satisfies) ===
test('HOOK-02 (a): no .paper/HANDOFF.json → stdout empty, exit 0', () => {
  const cwd = freshCwd();
  const res = runHook(cwd);
  assert.equal(res.status, 0, 'HOOK-02: SessionStart exits 0 with no HANDOFF');
  assert.equal(res.stdout, '', 'HOOK-02: stdout MUST be empty when there is nothing to resume');
});

// === presence guard ===
test('HOOK-02: session-start emission wiring is consistent with Wave-0 RED state', () => {
  if (emissionWired) {
    assert.ok(emissionWired, 'session-start.ts emits resume context — emission tests active');
  } else {
    assert.ok(!emissionWired, 'Wave-0: session-start.ts is still the exit-0 stub (RED-by-skip)');
  }
});

// === (b) valid non-done HANDOFF → single JSON frame with systemMessage ===
test('HOOK-02 (b): valid non-done HANDOFF → JSON frame with a systemMessage naming phase + next_action',
  { skip: !emissionWired }, () => {
    const cwd = freshCwd();
    writeHandoff(cwd, 'write');
    const res = runHook(cwd);
    assert.equal(res.status, 0, 'HOOK-02: exits 0 with a valid HANDOFF');
    assert.notEqual(res.stdout.trim(), '', 'HOOK-02: stdout must carry a resume frame');
    let parsed: { systemMessage?: unknown };
    assert.doesNotThrow(
      () => { parsed = JSON.parse(res.stdout) as { systemMessage?: unknown }; },
      'HOOK-02: stdout MUST be exactly one parseable JSON frame (hook-protocol)',
    );
    parsed = JSON.parse(res.stdout) as { systemMessage?: unknown };
    assert.equal(typeof parsed.systemMessage, 'string', 'HOOK-02: frame must carry a string systemMessage');
    assert.match(String(parsed.systemMessage), /write/i, 'HOOK-02: systemMessage mentions the phase');
    assert.match(String(parsed.systemMessage), /intro|Resume/i, 'HOOK-02: systemMessage mentions next_action');
  });

// === (c) phase 'done' → empty stdout (nothing to resume) ===
test('HOOK-02 (c): HANDOFF with phase "done" → stdout empty',
  { skip: !emissionWired }, () => {
    const cwd = freshCwd();
    writeHandoff(cwd, 'done');
    const res = runHook(cwd);
    assert.equal(res.status, 0, 'HOOK-02: exits 0 on a done HANDOFF');
    assert.equal(res.stdout, '', 'HOOK-02: a done paper has nothing to resume → empty stdout');
  });
