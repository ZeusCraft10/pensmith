// tests/release-workflow.test.ts
//
// A tag push publishes the plugin users install: the built plugin/ payload on
// the release branch. The workflow must refuse a tag that does not match the
// versions, run every gate CI runs (with the same pinned Claude Code CLI)
// before it publishes, and never rewrite the branch. The publish logic itself
// is scripts/release.mjs, which tests/release.test.ts drives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

interface Step { name?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> }
interface Job { 'runs-on'?: string; permissions?: Record<string, string>; steps: Step[] }
interface Workflow {
  on: { push?: { tags?: string[]; branches?: string[] } } & Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: unknown;
  jobs: Record<string, Job>;
}

const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const wf = parseYaml(read('.github/workflows/release.yml')) as Workflow;
const jobs = Object.values(wf.jobs);
const steps = jobs.flatMap((j) => j.steps);
const runs = steps.map((s) => s.run ?? '').join('\n');
const at = (re: RegExp): number => steps.findIndex((s) => re.test(s.run ?? ''));

test('the release workflow runs only for v* tags, with write access to contents and nothing else', () => {
  assert.deepEqual(Object.keys(wf.on), ['push']);
  assert.deepEqual(wf.on.push, { tags: ['v*'] });
  assert.deepEqual(wf.permissions, { contents: 'write' });
  for (const j of jobs) assert.equal(j.permissions, undefined, 'no job widens the workflow permissions');
  assert.ok(wf.concurrency, 'two tag pushes must not publish at the same time');
});

test('it refuses a mismatched tag, then runs the full check and the plugin smoke before it publishes', () => {
  const order = [
    at(/node scripts\/release\.mjs check "\$GITHUB_REF_NAME"/),
    at(/^npm ci\s*$/),
    at(/npm run check\b/),
    at(/npm install -g @anthropic-ai\/claude-code@/),
    at(/node scripts\/plugin-smoke\.mjs/),
    at(/node scripts\/release\.mjs publish "\$GITHUB_REF_NAME"/),
  ];
  assert.ok(order.every((i) => i >= 0), `every step must be present: ${order.join(', ')}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'tag check, npm ci, check, CLI install, smoke, then publish');
});

test('it installs the same Claude Code CLI version that ci.yml pins', () => {
  const pin = (yml: string): string | undefined => /npm install -g @anthropic-ai\/claude-code@(\d+\.\d+\.\d+)(\s|$)/.exec(yml)?.[1];
  const ciPin = pin(read('.github/workflows/ci.yml'));
  assert.ok(ciPin, 'ci.yml pins an exact Claude Code version');
  assert.equal(pin(runs), ciPin);
});

test('it never force-pushes or rewrites the release branch', () => {
  assert.ok(!/--force|push\s+-f\b|\+refs\/|push[^\n]*\s\+/.test(runs), 'the release branch keeps its history');
  const script = read('scripts/release.mjs');
  const pushes = script.split('\n').filter((l) => /'push'/.test(l));
  assert.equal(pushes.length, 1, 'release.mjs pushes in one place');
  assert.ok(!/force|\+/.test(pushes[0]!.replace(/\$\{[^}]*\}/g, '')), `that push is a plain fast-forward: ${pushes[0]}`);
});
