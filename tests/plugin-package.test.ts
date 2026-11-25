// tests/plugin-package.test.ts
//
// plugin/ is the only installed payload. A marketplace install copies that
// directory and nothing else, runs no npm install, and must end up with one
// skill, one hook and a `pensmith` executable on the Bash tool's PATH. These
// tests check the layout and then run the payload from a copy outside the
// repository, which is how Claude Code runs it after an install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = path.join(repoRoot, 'plugin');
const at = (...rel: string[]): string => path.join(pluginDir, ...rel);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

const pkg = readJson<{ version: string; bin?: Record<string, string>; files?: string[] }>(
  path.join(repoRoot, 'package.json'),
);

function frontmatter(md: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  assert.ok(m, 'SKILL.md must start with YAML frontmatter');
  return { data: (parseYaml(m[1]!) ?? {}) as Record<string, unknown>, body: m[2]! };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

test('the marketplace points at ./plugin and the repo root is not itself a plugin', () => {
  const market = readJson<{ name: string; plugins: Array<{ name: string; source: unknown }> }>(
    path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
  );
  assert.equal(market.name, 'pensmith');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0]!.name, 'pensmith');
  assert.equal(market.plugins[0]!.source, './plugin');
  assert.ok(!existsSync(path.join(repoRoot, '.claude-plugin', 'plugin.json')), 'remove the root plugin.json');
  for (const legacy of ['skills/pensmith.md', 'skills/plan-section.md', 'skills/write-section.md', 'skills/verify-section.md', 'hooks/hooks.json']) {
    assert.ok(!existsSync(path.join(repoRoot, legacy)), `legacy plugin file ${legacy} must be gone`);
  }
});

test('plugin.json carries the required metadata and nothing that overrides discovery', () => {
  const manifest = readJson<Record<string, unknown>>(at('.claude-plugin', 'plugin.json'));
  assert.equal(manifest['name'], 'pensmith');
  assert.equal(manifest['version'], '0.3.0-alpha.1');
  assert.equal(manifest['version'], pkg.version, 'plugin and package versions must match');
  for (const key of ['description', 'homepage', 'repository', 'license']) {
    assert.equal(typeof manifest[key], 'string', `plugin.json ${key} must be a string`);
  }
  assert.equal(manifest['license'], 'AGPL-3.0-or-later');
  assert.equal(typeof (manifest['author'] as { name?: unknown } | undefined)?.name, 'string');
  assert.ok(Array.isArray(manifest['keywords']) && (manifest['keywords'] as unknown[]).length > 0);
  assert.match(String(manifest['privacyPolicyUrl']), /^https:\/\/.+PRIVACY\.md$/);
  // skills/ and hooks/hooks.json are discovered from their default locations; an
  // explicit `skills` array of objects is what made `claude plugin install` abort.
  for (const key of ['skills', 'hooks', 'mcpServers', 'commands', 'agents']) {
    assert.ok(!(key in manifest), `plugin.json must not set ${key}`);
  }
  assert.match(String(manifest['description']), /alpha/i, 'the description must say this is an alpha');
});

test('the payload has no package.json or lockfile, so no npm install ever runs', () => {
  for (const f of ['package.json', 'package-lock.json', 'node_modules']) {
    assert.ok(!existsSync(at(f)), `plugin/${f} must not exist`);
  }
});

test('there is exactly one skill, at skills/pensmith/SKILL.md', () => {
  const skillDirs = readdirSync(at('skills'), { withFileTypes: true });
  assert.deepEqual(skillDirs.map((d) => d.name), ['pensmith']);
  assert.ok(skillDirs[0]!.isDirectory());
  assert.ok(existsSync(at('skills', 'pensmith', 'SKILL.md')));
});

test('the skill description is short, user-facing and scoped to academic-paper work', () => {
  const { data } = frontmatter(readFileSync(at('skills', 'pensmith', 'SKILL.md'), 'utf8'));
  assert.equal(data['name'], 'pensmith');
  assert.match(String(data['name']), /^[a-z0-9-]+$/);
  const desc = String(data['description'] ?? '');
  assert.ok(desc.length > 0 && desc.length <= 500, `description is ${desc.length} chars; keep it under 500`);
  assert.match(desc, /Use when/);
  assert.match(desc, /academic paper/i);
  assert.match(desc, /\.paper\//);
  // Bare conversational phrases hijack ordinary coding sessions.
  for (const phrase of [/"continue"/i, /"resume"/i, /what'?s next/i, /where am i/i]) {
    assert.ok(!phrase.test(desc), `description must not trigger on ${phrase}`);
  }
  // Build-process jargon costs always-on tokens and means nothing to the model.
  for (const jargon of [/§/, /\bPRD\b/, /\bD-\d+/, /\b\d{2}-\d{2}\b/, /locked-16/i, /\bPLUMBING\b/]) {
    assert.ok(!jargon.test(desc), `description must not contain ${jargon}`);
  }
  assert.equal(data['allowed-tools'], 'Bash(pensmith:*)');
});

test('the skill body drives the CLI, its exit codes and the pending-decision protocol honestly', () => {
  const { body } = frontmatter(readFileSync(at('skills', 'pensmith', 'SKILL.md'), 'utf8'));
  assert.match(body, /pensmith status/);
  assert.match(body, /pensmith next/);
  assert.match(body, /--json/);
  assert.match(body, /exit (code )?3/i);
  assert.match(body, /AskUserQuestion/);
  assert.match(body, /ANTHROPIC_API_KEY/, 'the body must state that Phase-1 generation needs an API key');
  assert.match(body, /--yolo/);
  assert.ok(!/undetectable|evade detection|bypass detect|avoid detection/i.test(body),
    'the skill must not frame anything as detection evasion');
});

test('hooks.json declares one SessionStart hook in the spec format, exec form', () => {
  const hooks = readJson<{ hooks: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>> }>(
    at('hooks', 'hooks.json'),
  );
  assert.deepEqual(Object.keys(hooks), ['hooks']);
  assert.deepEqual(Object.keys(hooks.hooks), ['SessionStart'], 'only SessionStart: no PreCompact, PostToolUse or Stop');
  const groups = hooks.hooks['SessionStart']!;
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.matcher, 'startup|resume|compact');
  assert.equal(groups[0]!.hooks.length, 1);
  const h = groups[0]!.hooks[0]!;
  assert.equal(h['type'], 'command');
  assert.equal(h['command'], 'node');
  assert.deepEqual(h['args'], ['${CLAUDE_PLUGIN_ROOT}/dist/hook.mjs']);
  assert.equal(typeof h['timeout'], 'number');
});

test('bin/pensmith is an executable POSIX shim and bin/pensmith.cmd exists', () => {
  const shim = readFileSync(at('bin', 'pensmith'), 'utf8');
  assert.match(shim, /^#!\/bin\/sh\n/);
  assert.match(shim, /dist\/pensmith\.mjs/);
  const mode = execFileSync('git', ['ls-files', '--stage', '--', 'plugin/bin/pensmith'], { cwd: repoRoot, encoding: 'utf8' });
  assert.match(mode, /^100755 /, `plugin/bin/pensmith must be committed executable, got: ${mode.trim()}`);
  assert.match(readFileSync(at('bin', 'pensmith.cmd'), 'utf8'), /dist\\pensmith\.mjs/);
});

test('the committed bundles and runtime assets are present', () => {
  for (const f of ['dist/pensmith.mjs', 'dist/hook.mjs']) {
    assert.ok(statSync(at(f)).size > 1000, `plugin/${f} must be a real bundle`);
    // A fresh clone (and so a marketplace install) only has what git tracks.
    const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', `plugin/${f}`], { cwd: repoRoot });
    assert.equal(ignored.status, 1, `plugin/${f} must not be gitignored`);
  }
  assert.match(readFileSync(at('dist', 'pensmith.mjs'), 'utf8'), /^#!\/usr\/bin\/env node\n/);
  for (const dir of ['templates/prompts', 'templates/citation-styles', 'templates/presets', 'references']) {
    const src = readdirSync(path.join(repoRoot, dir)).sort();
    assert.deepEqual(readdirSync(at(dir)).sort(), src, `plugin/${dir} must mirror ${dir}`);
  }
  assert.ok(existsSync(at('LICENSE')), 'the payload carries its licence');
});

test('every package-root lookup in shipped source recognises the installed plugin root', () => {
  // The bundle runs from plugin/dist with no package.json above it, so each
  // module that locates templates/ or references/ must also stop at the
  // directory that holds .claude-plugin/plugin.json.
  const offenders: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.ts')) {
        const src = readFileSync(full, 'utf8');
        if (/function findPkgRoot\(/.test(src) && !/\.claude-plugin/.test(src)) offenders.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, 'bin'));
  walk(path.join(repoRoot, 'hooks'));
  // The cassette replayer only runs under the test runner, which never uses the bundle.
  const allowed = new Set([path.join('bin', 'lib', 'http-mock.ts')]);
  assert.deepEqual(offenders.filter((f) => !allowed.has(f)), []);
});

test('package.json publishes the plugin payload and links its CLI', () => {
  assert.equal(pkg.bin?.['pensmith'], 'plugin/dist/pensmith.mjs');
  assert.ok(pkg.files?.includes('plugin/'), 'files must include plugin/');
  assert.ok(!pkg.files?.some((f) => /^(dist|skills|hooks|workflows|agents)\/?$/.test(f)), `stale entries in files: ${pkg.files?.join(', ')}`);
});

// ---------------------------------------------------------------------------
// The payload, run from an installed-like copy
// ---------------------------------------------------------------------------

function installedCopy(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pensmith-installed-'));
  const dest = path.join(root, 'pensmith', '0.3.0-alpha.1');
  cpSync(pluginDir, dest, { recursive: true });
  return dest;
}

function runPensmith(copy: string, args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  // A user's shell does not carry the test runner's cassette switches.
  delete env['PENSMITH_TEST_CASSETTES'];
  delete env['PENSMITH_NETWORK_TESTS'];
  if (process.platform === 'win32') {
    const res = spawnSync('cmd.exe', ['/d', '/c', path.join(copy, 'bin', 'pensmith.cmd'), ...args], { cwd, encoding: 'utf8', env, timeout: 60_000 });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
  }
  // Through a symlink in another directory, the way a PATH entry or npm link reaches it.
  const linkDir = mkdtempSync(path.join(tmpdir(), 'pensmith-link-'));
  const link = path.join(linkDir, 'pensmith');
  symlinkSync(path.join(copy, 'bin', 'pensmith'), link);
  const res = spawnSync(link, args, { cwd, encoding: 'utf8', env, timeout: 60_000 });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

test('the installed CLI prints its version through a symlinked shim', () => {
  const copy = installedCopy();
  const r = runPensmith(copy, ['--version'], tmpdir());
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stdout.trim(), pkg.version);
});

test('the bundled CLI runs through a symlink to the bundle itself, as npm link and package.json bin create', { skip: process.platform === 'win32' && 'npm creates .cmd shims on Windows, not symlinks' }, () => {
  const copy = installedCopy();
  const linkDir = mkdtempSync(path.join(tmpdir(), 'pensmith-npm-link-'));
  const link = path.join(linkDir, 'pensmith');
  symlinkSync(path.join(copy, 'dist', 'pensmith.mjs'), link);
  const r = spawnSync(link, ['--version'], { cwd: linkDir, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stdout.trim(), pkg.version, 'the entry-point check must survive the symlink');
});

test('the installed CLI finds its runtime assets: doctor reports the install as complete', () => {
  const copy = installedCopy();
  const cwd = mkdtempSync(path.join(tmpdir(), 'pensmith-doctor-cwd-'));
  const r = runPensmith(copy, ['doctor', '--json'], cwd);
  const report = JSON.parse(r.stdout) as { probes: Record<string, { severity: string; summary: string; detail?: string }> };
  for (const id of ['build-artifact-resolves', 'intake-outline-verify-wiring', 'node-version']) {
    const p = report.probes[id];
    assert.ok(p, `doctor must run ${id}`);
    assert.equal(p.severity, 'PASS', `${id}: ${p.summary} ${p.detail ?? ''}`);
  }
  assert.ok(!existsSync(path.join(cwd, '.paper')), 'doctor must not create a workspace');
});

test('the installed hook is silent outside a paper and gives context inside one', () => {
  const copy = installedCopy();
  const hook = path.join(copy, 'dist', 'hook.mjs');
  const plain = mkdtempSync(path.join(tmpdir(), 'pensmith-plain-'));
  const quiet = spawnSync(process.execPath, [hook], { input: JSON.stringify({ cwd: plain, source: 'startup' }), encoding: 'utf8', timeout: 30_000 });
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.equal(quiet.stdout, '');
  assert.deepEqual(readdirSync(plain), []);

  const paper = mkdtempSync(path.join(tmpdir(), 'pensmith-paper-'));
  mkdirSync(path.join(paper, '.paper'));
  writeFileSync(path.join(paper, 'notes.txt'), 'x');
  const loud = spawnSync(process.execPath, [hook], { input: JSON.stringify({ cwd: paper, source: 'compact' }), encoding: 'utf8', timeout: 30_000 });
  assert.equal(loud.status, 0, loud.stderr);
  const frame = JSON.parse(loud.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(frame.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(frame.hookSpecificOutput.additionalContext, /pensmith skill/);
});
