// tests/paper-layout.test.ts — STATE.json and config.toml live in .paper/.
//
// Up to v0.2 pensmith wrote STATE.json and config.toml into the project root,
// which is the user's own folder (often a thesis repo with its own
// config.toml), while the PRD, the workflow bodies and the hook said
// .paper/. Now both live in .paper/, and a project laid out the old way is
// moved on first use without touching files pensmith did not write.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initState, loadState, StateNotFoundError, updateState } from '../bin/lib/state.js';
import { readGoalFromConfig } from '../bin/cli/goal.js';
import { resolveCostCap } from '../bin/lib/budget.js';
import { resolveCitationStyle } from '../bin/lib/citation-style.js';
import { resolveNextAction } from '../bin/lib/router.js';
import { migrateLegacyLayout } from '../bin/lib/migrations/layout.js';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'pensmith-layout-'));
}

const LEGACY_STATE = {
  $schemaVersion: 2,
  paperId: '11111111-2222-4333-8444-555555555555',
  createdAt: '2026-01-02T03:04:05.000Z',
  sections: [{ n: 1, slug: 'intro' }],
};

test('initState writes .paper/STATE.json and nothing in the project root', async () => {
  const root = tmpRoot();
  await initState(root);
  assert.ok(existsSync(join(root, '.paper', 'STATE.json')));
  assert.ok(!existsSync(join(root, 'STATE.json')), 'the project root is the user\'s folder');
  const state = await loadState(root);
  assert.equal(typeof state.paperId, 'string');
});

test('a project laid out the old way is moved into .paper/ on first use', async () => {
  const root = tmpRoot();
  mkdirSync(join(root, '.paper'));
  writeFileSync(join(root, '.paper', '.gitignore'), '# mine\nINTAKE.raw.local\n*.local\n');
  writeFileSync(join(root, 'STATE.json'), JSON.stringify(LEGACY_STATE, null, 2) + '\n');
  // pensmith wrote this config.toml; the comment is the user's own edit.
  const config = '# my paper\n[project]\ngoal = "learning"   # keep\n\n[budget]\ncost_cap_usd = 9\n';
  writeFileSync(join(root, 'config.toml'), config);

  // What the dispatcher runs before any verb.
  assert.equal(await migrateLegacyLayout(root), true);
  const state = await loadState(root);
  assert.equal(state.paperId, LEGACY_STATE.paperId);
  assert.deepEqual(state.sections, LEGACY_STATE.sections);
  assert.ok(!existsSync(join(root, 'STATE.json')), 'the root STATE.json is moved, not copied');
  assert.ok(existsSync(join(root, '.paper', 'STATE.json')));

  // A config.toml with only pensmith's tables moves as it is, comments and all.
  assert.equal(readFileSync(join(root, '.paper', 'config.toml'), 'utf8'), config);
  assert.ok(!existsSync(join(root, 'config.toml')));
  assert.equal(readGoalFromConfig(root), 'learning');
  assert.equal(resolveCostCap(root).capUsd, 9);

  // The added PDF texts are kept out of git from now on; the user's lines stay.
  const gi = readFileSync(join(root, '.paper', '.gitignore'), 'utf8');
  assert.match(gi, /^# mine\nINTAKE\.raw\.local\n\*\.local\n/);
  assert.match(gi, /^sources\/$/m);
});

test('a shared root config.toml is left as it is; pensmith copies only its own tables', async () => {
  const root = tmpRoot();
  mkdirSync(join(root, '.paper'));
  writeFileSync(join(root, 'STATE.json'), JSON.stringify(LEGACY_STATE));
  // A Hugo site config that intake once added a [project] table to.
  const hugo = 'baseURL = "https://example.org/"\ntitle = "My site" # hugo\n\n[project]\ncitation_style = "mla"\n';
  writeFileSync(join(root, 'config.toml'), hugo);

  await migrateLegacyLayout(root);
  assert.equal(readFileSync(join(root, 'config.toml'), 'utf8'), hugo, 'never rewrite a file pensmith did not create');
  assert.match(readFileSync(join(root, '.paper', 'config.toml'), 'utf8'), /\[project\][\s\S]*citation_style = "mla"/);
  assert.doesNotMatch(readFileSync(join(root, '.paper', 'config.toml'), 'utf8'), /baseURL/);
  assert.equal(resolveCitationStyle(root).style, 'mla');
});

test('a root STATE.json that is not pensmith\'s is not touched, and the paper has no state', async () => {
  const root = tmpRoot();
  mkdirSync(join(root, '.paper'));
  const theirs = '{"build": 3}\n';
  writeFileSync(join(root, 'STATE.json'), theirs);
  await assert.rejects(loadState(root), StateNotFoundError);
  assert.equal(readFileSync(join(root, 'STATE.json'), 'utf8'), theirs);
  assert.equal((await resolveNextAction(root)).verb, 'new');
});

test('settings are read from .paper/config.toml only, not from a config.toml in the project root', async () => {
  const root = tmpRoot();
  await initState(root);
  writeFileSync(join(root, 'config.toml'), '[project]\ngoal = "learning"\ncitation_style = "ieee"\n[budget]\ncost_cap_usd = 1\n');
  assert.equal(readGoalFromConfig(root), 'draft');
  assert.equal(resolveCostCap(root).source, 'default');
  assert.notEqual(resolveCitationStyle(root).style, 'ieee');

  writeFileSync(join(root, '.paper', 'config.toml'), '[project]\ngoal = "both"\n');
  assert.equal(readGoalFromConfig(root), 'both');
});

test('updateState migrates too, so no writer recreates STATE.json in the project root', async () => {
  const root = tmpRoot();
  writeFileSync(join(root, 'STATE.json'), JSON.stringify(LEGACY_STATE));
  await updateState(root, (s) => ({ ...s, sections: [] }));
  assert.ok(!existsSync(join(root, 'STATE.json')));
  assert.deepEqual((await loadState(root)).sections, []);
});

test('the CLI moves an old layout before it reads any setting, even for a verb that loads no state', async () => {
  const { spawnSync } = await import('node:child_process');
  const { isolatedCliEnv } = await import('./lib/cli-env.js');
  const root = tmpRoot();
  mkdirSync(join(root, '.paper'));
  writeFileSync(join(root, 'STATE.json'), JSON.stringify(LEGACY_STATE));
  writeFileSync(join(root, 'config.toml'), '[budget]\ncost_cap_usd = 0.01\n');
  // compile reads no STATE.json, so only the dispatcher can have moved it.
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(import.meta.dirname, '..', 'bin', 'pensmith.ts'), 'compile'], {
    cwd: root,
    env: isolatedCliEnv({ PENSMITH_NO_LLM: '1' }),
    encoding: 'utf8',
  });
  assert.ok(!existsSync(join(root, 'STATE.json')), r.stderr);
  assert.ok(!existsSync(join(root, 'config.toml')), r.stderr);
  assert.equal(readFileSync(join(root, '.paper', 'config.toml'), 'utf8'), '[budget]\ncost_cap_usd = 0.01\n');
  assert.match(r.stderr, /moved STATE\.json into \.paper\//);
});

test('reading an old layout moves nothing: loadState, the router and the --estimate preview only look', async () => {
  const { spawnSync } = await import('node:child_process');
  const { isolatedCliEnv } = await import('./lib/cli-env.js');
  const root = tmpRoot();
  const legacy = JSON.stringify(LEGACY_STATE);
  writeFileSync(join(root, 'STATE.json'), legacy);
  writeFileSync(join(root, 'config.toml'), '[budget]\ncost_cap_usd = 4\n');

  assert.equal((await loadState(root)).paperId, LEGACY_STATE.paperId);
  assert.equal((await resolveNextAction(root)).verb, 'research');
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), join(import.meta.dirname, '..', 'bin', 'pensmith.ts'), '--estimate'], {
    cwd: root,
    env: isolatedCliEnv({ PENSMITH_NO_LLM: '1' }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(root, 'STATE.json'), 'utf8'), legacy);
  assert.ok(existsSync(join(root, 'config.toml')));
  assert.ok(!existsSync(join(root, '.paper', 'STATE.json')));
});

test('a root STATE.json that an interrupted move left behind is removed; another paper\'s is not', async () => {
  const root = tmpRoot();
  mkdirSync(join(root, '.paper'));
  // The move wrote .paper/STATE.json and stopped before removing the old file.
  writeFileSync(join(root, '.paper', 'STATE.json'), JSON.stringify(LEGACY_STATE, null, 2) + '\n');
  writeFileSync(join(root, 'STATE.json'), JSON.stringify({ ...LEGACY_STATE, sections: [] }));
  await migrateLegacyLayout(root);
  assert.ok(!existsSync(join(root, 'STATE.json')));

  const other = { ...LEGACY_STATE, paperId: '99999999-2222-4333-8444-555555555555' };
  writeFileSync(join(root, 'STATE.json'), JSON.stringify(other));
  await migrateLegacyLayout(root);
  assert.ok(existsSync(join(root, 'STATE.json')), 'not the same paper: left for the user');
});
