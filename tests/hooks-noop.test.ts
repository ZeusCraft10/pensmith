import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const HOOKS = [
  'hooks/session-start.ts',
  'hooks/pre-compact.ts',
  'hooks/post-tool-use.ts',
  'hooks/stop.ts',
];

for (const hook of HOOKS) {
  test(`TIER-03/07: ${hook} exists and exits 0`, () => {
    assert.ok(existsSync(hook), `${hook} missing`);
    // Hooks run under Node via tsx. Execute via tsx to avoid build coupling.
    const out = execFileSync(process.execPath, [
      '--import', 'tsx', hook,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // Must produce no stdout (would corrupt hook-protocol frame).
    assert.equal(out, '', `${hook} stdout MUST be empty, got: ${out}`);
  });
}

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
