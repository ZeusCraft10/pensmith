import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// stdout-protocol gate (T-07-01 / T-02-06-02): a hook's stdout is the Claude
// Code hook-protocol channel — it MUST be empty OR exactly one parseable JSON
// frame. Phase 7 Plan 07-03 upgraded SessionStart to emit a single
// { systemMessage } resume frame WHEN a .paper/HANDOFF.json exists; the other
// three hooks must NEVER write stdout. These tests run from the repo root cwd
// (which has no .paper/HANDOFF.json), so even SessionStart takes its no-op path
// and emits nothing here. The JSON-frame case is covered by
// tests/hooks/session-start.test.ts (it seeds a HANDOFF in a tmpdir cwd).

// Three hooks must produce ABSOLUTELY no stdout, ever.
const SILENT_HOOKS = [
  'hooks/pre-compact.ts',
  'hooks/post-tool-use.ts',
  'hooks/stop.ts',
];

for (const hook of SILENT_HOOKS) {
  test(`TIER-03/07: ${hook} exists and exits 0 with empty stdout`, () => {
    assert.ok(existsSync(hook), `${hook} missing`);
    // Hooks run under Node via tsx. Execute via tsx to avoid build coupling.
    const out = execFileSync(process.execPath, [
      '--import', 'tsx', hook,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // Must produce no stdout (would corrupt hook-protocol frame).
    assert.equal(out, '', `${hook} stdout MUST be empty, got: ${out}`);
  });
}

// SessionStart: in the NO-HANDOFF path (repo-root cwd has none) stdout must
// STILL be empty — it only emits the documented JSON frame when there is a
// paper to resume. The populated-HANDOFF JSON-frame case lives in
// tests/hooks/session-start.test.ts and is not duplicated here.
test('TIER-03/07: hooks/session-start.ts exits 0; empty stdout in the no-HANDOFF path', () => {
  assert.ok(existsSync('hooks/session-start.ts'), 'hooks/session-start.ts missing');
  // Defensive: only meaningful while the repo root has no .paper/HANDOFF.json.
  assert.ok(
    !existsSync('.paper/HANDOFF.json'),
    'precondition: repo root must have no .paper/HANDOFF.json for the no-op stdout assertion',
  );
  const out = execFileSync(process.execPath, [
    '--import', 'tsx', 'hooks/session-start.ts',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(out, '', `session-start stdout MUST be empty with no HANDOFF, got: ${out}`);
});

test('TIER-03: hooks/hooks.json declares all 4 hooks', () => {
  assert.ok(existsSync('hooks/hooks.json'), 'hooks/hooks.json missing');
  const raw = readFileSync('hooks/hooks.json', 'utf8');
  const parsed = JSON.parse(raw) as { schemaVersion: number; hooks: Array<{ event: string; script: string }> };
  assert.equal(parsed.schemaVersion, 1);
  const events = parsed.hooks.map((h) => h.event).sort();
  assert.deepEqual(events, ['PostToolUse', 'PreCompact', 'SessionStart', 'Stop'].sort());
  // Every declared script must exist under hooks/.
  for (const h of parsed.hooks) {
    assert.ok(existsSync(`hooks/${h.script}`), `hooks/${h.script} declared in hooks.json but missing on disk`);
  }
});
