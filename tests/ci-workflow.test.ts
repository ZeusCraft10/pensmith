// tests/ci-workflow.test.ts
//
// CI must gate on what Claude Code itself accepts, not on a home-made
// validator that approved invalid manifests: it installs the Claude Code CLI,
// validates the plugin and marketplace with `claude plugin validate --strict`,
// installs the plugin into a throwaway config dir, runs the shim through a
// symlink (scripts/plugin-smoke.mjs does all of that). The plugin bundle is
// never committed: CI builds it before the tests and the smoke, so both run
// against the bundle the sources produce. It runs on Node 22 and 24 on three
// OSes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

interface Step { name?: string; run?: string; uses?: string; shell?: string }
interface Workflow { jobs: Record<string, { strategy?: { matrix?: { os?: string[]; node?: string[] } }; steps: Step[] }> }

const ci = parseYaml(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')) as Workflow;
const job = ci.jobs['check']!;
const runs = job.steps.map((s) => s.run ?? '').join('\n');
/** Index of the first step whose `run` matches. */
const stepIndex = (re: RegExp): number => job.steps.findIndex((s) => re.test(s.run ?? ''));

test('CI runs on Node 22 and 24 on Linux, macOS and Windows', () => {
  const matrix = job.strategy?.matrix ?? {};
  assert.deepEqual([...(matrix.os ?? [])].sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest']);
  assert.deepEqual([...(matrix.node ?? [])].map(String).sort(), ['22', '24']);
});

test('CI installs the Claude Code CLI and runs the plugin smoke', () => {
  // Pinned to an exact version known to pass the smoke, so a Claude Code
  // release cannot turn CI red (or green) on its own.
  assert.match(runs, /npm install -g @anthropic-ai\/claude-code@\d+\.\d+\.\d+(\s|$)/, 'pin the Claude Code CLI to an exact version');
  assert.match(runs, /node scripts\/plugin-smoke\.mjs/);
  const smoke = readFileSync(new URL('../scripts/plugin-smoke.mjs', import.meta.url), 'utf8');
  for (const needle of ["'validate', target, '--strict'", "'marketplace', 'add'", "'install', 'pensmith@pensmith'", "'details', 'pensmith@pensmith'", 'symlinkSync']) {
    assert.ok(smoke.includes(needle), `plugin-smoke.mjs must exercise ${needle}`);
  }
  // The real marketplace installs the release branch from GitHub, so the
  // smoke installs the same tree a release commits (release-tree.mjs) from a
  // throwaway local marketplace whose entry is "./plugin".
  for (const needle of ['payloadTree(', 'checkoutTree(', "source: './plugin'", 'assertBuilt(']) {
    assert.ok(smoke.includes(needle), `plugin-smoke.mjs must use ${needle}`);
  }
  assert.ok(!/'marketplace', 'add', repoRoot/.test(smoke), 'adding the checkout itself would install the published release, not this build');
});

test('CI builds the plugin bundle before the tests and the smoke, and never checks in a built one', () => {
  const bundle = stepIndex(/^npm run bundle\s*$/);
  assert.ok(bundle >= 0, 'CI must run `npm run bundle`');
  assert.ok(bundle < stepIndex(/npm run test(:coverage)?\b/), 'the bundle must be built before the tests');
  assert.ok(bundle < stepIndex(/node scripts\/plugin-smoke\.mjs/), 'the bundle must be built before the smoke');
  assert.ok(!/bundle:check|bundle\.mjs --check/.test(runs), 'there is no committed bundle to check');
});

test('npm run check builds the bundle before it runs the tests', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  const steps = (pkg.scripts['check'] ?? '').split('&&').map((s) => s.trim());
  assert.ok(steps.includes('npm run bundle'), `check must run npm run bundle: ${pkg.scripts['check']}`);
  assert.ok(steps.indexOf('npm run bundle') < steps.indexOf('npm test'), 'check must bundle before it tests');
  assert.ok(!('bundle:check' in pkg.scripts), 'the stale-committed-bundle check is gone');
});

test('CI runs every gate once and nothing that pins the old plugin format', () => {
  for (const cmd of ['npm run lint', 'npm run typecheck', 'npm run build']) {
    assert.equal(runs.split(cmd).length - 1, 1, `${cmd} must run exactly once`);
  }
  assert.ok(!/test:tier-contract/.test(runs), 'npm test already runs the tier-contract suite');
  assert.ok(!/validate-plugin-manifest/.test(runs), 'the legacy manifest validator is gone');
});
