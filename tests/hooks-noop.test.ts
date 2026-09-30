// tests/hooks-noop.test.ts — every hook bundle outside a paper (PLUG-14,
// D-23a-15; T-07-01 stdout protocol).
//
// The plugin's hooks fire in every project the plugin is enabled in, so in a
// folder with no paper each of the four bundles (`node plugin/dist/hooks/
// <name>.mjs`, as Claude Code runs them) must exit 0 in under 500 ms, print
// nothing on stdout and create no file — neither in the folder nor in the data
// dir — whatever arrives on stdin: Claude Code's JSON, nothing, an empty body
// or garbage. The time is the best of three spawns (the hook's own cost, not
// the test runner's scheduling noise); every spawn must also stay under 2 s.
//
// (The v0 hooks.json shape case that lived here is gone: stream layout's
// tests/manifest.test.ts asserts the spec's plugin/hooks/hooks.json.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { changedPaths, sandbox, snapshot } from './helpers/paper-cli-harness.js';
import { assertBundlesPresent, hookInput, runHook, type HookName } from './hooks/hook-runner.js';

assertBundlesPresent();

const HOOKS: readonly HookName[] = ['session-start', 'pre-compact', 'post-tool-use', 'stop'];
const BUDGET_MS = 500;

for (const name of HOOKS) {
  test(`PLUG-14: ${name} outside a paper exits 0 in < ${BUDGET_MS} ms with empty stdout and creates no file`, () => {
    const sb = sandbox(`hook-noop-${name}`);
    const cwd = sb.project('not-a-paper');
    // A folder a Claude Code user works in: it has a .claude/ of its own.
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    const beforeCwd = snapshot(cwd);
    const beforeData = snapshot(sb.data);
    const times: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const r = runHook(sb, name, { cwd, input: hookInput(name, cwd) });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, '', `${name} stdout must be empty outside a paper`);
      assert.equal(r.stderr, '', `${name} has nothing to report outside a paper`);
      assert.ok(r.ms < 2_000, `${name} took ${r.ms.toFixed(0)} ms`);
      times.push(r.ms);
    }
    const best = Math.min(...times);
    assert.ok(best < BUDGET_MS, `${name} took ${best.toFixed(0)} ms (best of ${times.map((t) => t.toFixed(0)).join(', ')})`);
    for (const input of [null, '', '{not json', '[1,2]', JSON.stringify({ cwd: 'relative/path' })]) {
      const r = runHook(sb, name, { cwd, input });
      assert.equal(r.status, 0, `${name} with stdin ${JSON.stringify(input)}: ${r.stderr}`);
      assert.equal(r.stdout, '');
    }
    assert.deepEqual(changedPaths(beforeCwd, snapshot(cwd)), [], 'no file created in the folder');
    assert.deepEqual(changedPaths(beforeData, snapshot(sb.data)), [], 'no file created in the data dir');
  });
}
