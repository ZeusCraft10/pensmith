// tests/plugin-layout.test.ts — PLUG-02 / D-23a-02: plugin/ is the one
// canonical plugin directory and the single home of every shipped asset.
//
// Both tiers read their workflow bodies, prompts, presets, references, skills
// and agents from plugin/ (the Tier-2 CLI through bin/lib/paths.ts pluginRoot(),
// Claude Code from the installed plugin). A copy anywhere else would drift from
// the one the plugin ships, so git may hold none outside plugin/ — except the
// negative-control fixture tests/fixtures/plugin-legacy/, which keeps the
// pre-v1 shapes on purpose. And the plugin directory must never contain what a
// marketplace install refuses or ignores: a bin/ (claude.ai and Cowork refuse
// the plugin), a CLAUDE.md (never loaded; `claude plugin validate` warns) or
// node_modules/ (the plugin runs from self-contained bundles).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXEMPT = 'tests/fixtures/plugin-legacy/';

/** Every tracked file, '/'-separated, relative to the repo root. */
function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/** The asset kinds that live only in plugin/, each with the test for a path. */
const ASSET_KINDS: ReadonlyArray<{ kind: string; test: (p: string) => boolean }> = [
  { kind: 'workflow body', test: (p) => /(?:^|\/)workflows\/[^/]+\.md$/.test(p) },
  { kind: 'prompt template', test: (p) => /(?:^|\/)templates\/prompts\//.test(p) || /(?:^|\/)prompts\/[^/]+\.md$/.test(p) },
  { kind: 'template or preset', test: (p) => /(?:^|\/)templates\//.test(p) || /(?:^|\/)presets\//.test(p) },
  { kind: 'reference', test: (p) => /(?:^|\/)references\/[^/]+\.md$/.test(p) },
  { kind: 'skill', test: (p) => /(?:^|\/)SKILL\.md$/.test(p) || /(?:^|\/)skills\/[^/]+\.md$/.test(p) },
  { kind: 'agent', test: (p) => /(?:^|\/)agents\//.test(p) },
  { kind: 'plugin manifest', test: (p) => /(?:^|\/)\.claude-plugin\/plugin\.json$/.test(p) },
  { kind: 'plugin hooks config', test: (p) => /(?:^|\/)hooks\/hooks\.json$/.test(p) },
];

test('PLUG-02: git holds no workflow, prompt, preset, reference, skill or agent file outside plugin/', () => {
  const offenders: string[] = [];
  for (const p of trackedFiles()) {
    if (p.startsWith('plugin/') || p.startsWith(EXEMPT)) continue;
    for (const { kind, test: matches } of ASSET_KINDS) {
      if (matches(p)) offenders.push(`${p} (${kind})`);
    }
  }
  assert.deepEqual(offenders, [], 'move these under plugin/ (bin/lib/paths.ts pluginRoot() resolves them there)');
});

test('PLUG-02: each asset kind is present in plugin/ (the guard above is not vacuous)', () => {
  const inPlugin = trackedFiles().filter((p) => p.startsWith('plugin/'));
  for (const { kind, test: matches } of ASSET_KINDS) {
    assert.ok(inPlugin.some(matches), `plugin/ holds at least one ${kind}`);
  }
});

test('PLUG-02: the negative-control fixture is the only exemption, and it keeps its old shapes', () => {
  const legacy = trackedFiles().filter((p) => p.startsWith(EXEMPT));
  for (const f of ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'skills/pensmith.md']) {
    assert.ok(legacy.includes(`${EXEMPT}${f}`), `${EXEMPT}${f} is tracked`);
  }
});

test('PLUG-02: plugin/ holds only plugin components — no bin/, CLAUDE.md or node_modules/', () => {
  const pluginDir = path.join(REPO, 'plugin');
  for (const forbidden of ['bin', 'CLAUDE.md', 'node_modules', 'package.json']) {
    assert.ok(!existsSync(path.join(pluginDir, forbidden)), `plugin/${forbidden} must not exist`);
  }
  const allowed = new Set(['.claude-plugin', 'skills', 'agents', 'hooks', 'workflows', 'templates', 'references', 'dist']);
  const top = readdirSync(pluginDir);
  assert.deepEqual(top.filter((e) => !allowed.has(e)), [], `plugin/ top level: ${top.join(', ')}`);
  const tracked = trackedFiles().filter((p) => p.startsWith('plugin/'));
  assert.deepEqual(
    tracked.filter((p) => /^plugin\/(?:bin|node_modules)\//.test(p) || /(?:^|\/)CLAUDE\.md$/.test(p)),
    [],
    'git tracks no bin/, node_modules/ or CLAUDE.md under plugin/',
  );
});

test('PLUG-02: the repo root is not a plugin — its .claude-plugin/ holds only the marketplace', () => {
  assert.deepEqual(readdirSync(path.join(REPO, '.claude-plugin')).sort(), ['marketplace.json']);
  assert.ok(!existsSync(path.join(REPO, 'hooks', 'hooks.json')), 'the hooks config lives in plugin/hooks/');
  for (const gone of ['workflows', 'templates', 'references', 'skills', 'agents']) {
    assert.ok(!existsSync(path.join(REPO, gone)), `${gone}/ moved to plugin/${gone}/`);
  }
});
