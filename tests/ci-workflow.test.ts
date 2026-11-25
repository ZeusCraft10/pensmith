// tests/ci-workflow.test.ts
//
// CI must gate on what Claude Code itself accepts, not on a home-made
// validator that approved invalid manifests: it installs the Claude Code CLI,
// validates the plugin and marketplace with `claude plugin validate --strict`,
// installs the plugin into a throwaway config dir, runs the shim through a
// symlink (scripts/plugin-smoke.mjs does all of that), and fails when the
// committed bundle is stale. It runs on Node 22 and 24 on three OSes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

interface Step { name?: string; run?: string; uses?: string; shell?: string }
interface Workflow { jobs: Record<string, { strategy?: { matrix?: { os?: string[]; node?: string[] } }; steps: Step[] }> }

const ci = parseYaml(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')) as Workflow;
const job = ci.jobs['check']!;
const runs = job.steps.map((s) => s.run ?? '').join('\n');

test('CI runs on Node 22 and 24 on Linux, macOS and Windows', () => {
  const matrix = job.strategy?.matrix ?? {};
  assert.deepEqual([...(matrix.os ?? [])].sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest']);
  assert.deepEqual([...(matrix.node ?? [])].map(String).sort(), ['22', '24']);
});

test('CI installs the Claude Code CLI and runs the plugin smoke', () => {
  assert.match(runs, /npm install -g @anthropic-ai\/claude-code/);
  assert.match(runs, /node scripts\/plugin-smoke\.mjs/);
  const smoke = readFileSync(new URL('../scripts/plugin-smoke.mjs', import.meta.url), 'utf8');
  for (const needle of ["'validate', target, '--strict'", "'marketplace', 'add'", "'install', 'pensmith@pensmith'", "'details', 'pensmith@pensmith'", 'symlinkSync']) {
    assert.ok(smoke.includes(needle), `plugin-smoke.mjs must exercise ${needle}`);
  }
});

test('CI fails when the committed plugin bundle is stale', () => {
  assert.match(runs, /npm run bundle:check/);
});

test('CI runs every gate once and nothing that pins the old plugin format', () => {
  for (const cmd of ['npm run lint', 'npm run typecheck', 'npm run build']) {
    assert.equal(runs.split(cmd).length - 1, 1, `${cmd} must run exactly once`);
  }
  assert.ok(!/test:tier-contract/.test(runs), 'npm test already runs the tier-contract suite');
  assert.ok(!/validate-plugin-manifest/.test(runs), 'the legacy manifest validator is gone');
});
