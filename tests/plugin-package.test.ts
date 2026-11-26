// tests/plugin-package.test.ts
//
// plugin/ is the only installed payload. A marketplace install copies that
// directory and nothing else, runs no npm install, and must end up with one
// skill, one hook and a `pensmith` executable on the Bash tool's PATH. These
// tests check the layout and then run the payload from a copy outside the
// repository, which is how Claude Code runs it after an install.
//
// plugin/dist and the copied assets are built by `npm run bundle` and are
// never committed; tests that need them fail with that instruction.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { builtPluginFile } from './lib/built-plugin.js';
import { fileHashes, filesUnder } from './lib/files.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pluginDir = path.join(repoRoot, 'plugin');
const at = (...rel: string[]): string => path.join(pluginDir, ...rel);
const built = (rel: string): string => builtPluginFile(pluginDir, rel);
const BUNDLES = ['dist/pensmith.mjs', 'dist/hook.mjs'];
// Every file git tracks under plugin/. Everything else there is generated.
const HAND_WRITTEN = [
  '.claude-plugin/plugin.json',
  'README.md',
  'bin/pensmith',
  'bin/pensmith.cmd',
  'hooks/hooks.json',
  'skills/pensmith/SKILL.md',
];
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

const pkg = readJson<{ version: string; bin?: Record<string, string>; files?: string[] }>(
  path.join(repoRoot, 'package.json'),
);

// A strict parse, not the engine's error-tolerant frontmatter reader: invalid
// YAML in the shipped skill must fail this test, because Claude Code rejects it.
function frontmatter(md: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  assert.ok(m, 'SKILL.md must start with YAML frontmatter');
  const data = (parseYaml(m[1]!) ?? {}) as Record<string, unknown>;
  assert.ok(Object.keys(data).length > 0, 'SKILL.md frontmatter must not be empty');
  return { data, body: m[2]! };
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

test('the marketplace installs the release branch and the repo root is not itself a plugin', () => {
  const market = readJson<{ name: string; plugins: Array<{ name: string; source: unknown }> }>(
    path.join(repoRoot, '.claude-plugin', 'marketplace.json'),
  );
  assert.equal(market.name, 'pensmith');
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0]!.name, 'pensmith');
  // plugin/ in this branch has no bundle; the release workflow publishes the
  // built payload at the root of the release branch, so users get the last
  // published release, never an unbuilt checkout.
  assert.deepEqual(market.plugins[0]!.source, { source: 'github', repo: 'ZeusCraft10/pensmith', ref: 'release' });
  const manifest = readJson<{ repository: string }>(at('.claude-plugin', 'plugin.json'));
  assert.equal(manifest.repository, 'https://github.com/ZeusCraft10/pensmith', 'the release source is this repository');
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
  // The SessionStart hook and the CLI run `node`, which the native installer does not provide.
  assert.match(String(manifest['description']), /Node\.js 22\.12\+? (or newer )?on (your )?PATH/, 'the description must name the Node requirement');
});

test('the payload has no package.json or lockfile, so no npm install ever runs', () => {
  for (const f of ['package.json', 'package-lock.json', 'node_modules']) {
    assert.ok(!existsSync(at(f)), `plugin/${f} must not exist`);
  }
});

test('the payload carries its own README, because a release puts plugin/ at the root of the release branch', () => {
  // On the release branch the repository README is not there, and the plugin
  // directory refuses a plugin without one.
  const readme = readFileSync(at('README.md'), 'utf8');
  assert.ok(readme.split(/\s+/).filter(Boolean).length >= 40, 'at least 40 words on what the plugin does');
  assert.match(readme, /\/plugin marketplace add ZeusCraft10\/pensmith/);
  assert.match(readme, /\/plugin install pensmith@pensmith/);
  assert.match(readme, /Node\.js 22\.12/);
  assert.match(readme, /ANTHROPIC_API_KEY/, 'say that drafting needs an API key in this alpha');
  assert.match(readme, /alpha/i);
  assert.match(readme, /https:\/\/github\.com\/ZeusCraft10\/pensmith\/blob\/main\/PRIVACY\.md/);
  assert.ok(!/undetectable|evade detection|bypass detect|avoid detection/i.test(readme));
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

test('the bundles and runtime assets are built into plugin/', () => {
  for (const f of BUNDLES) assert.ok(statSync(built(f)).size > 1000, `plugin/${f} must be a real bundle`);
  const cli = readFileSync(built('dist/pensmith.mjs'), 'utf8');
  assert.match(cli, /^#!\/usr\/bin\/env node\n/);
  // Node prints a DEP0040 warning to the user's terminal when the deprecated
  // punycode core module loads; the bundle must use the userland package. The
  // require helper is renamed when minified, so match a call by any name.
  assert.ok(!/\("punycode"\)/.test(cli), 'the CLI bundle must not load the punycode core module');
  for (const dir of ['templates/prompts', 'templates/citation-styles', 'templates/presets', 'references']) {
    const src = readdirSync(path.join(repoRoot, dir)).sort();
    assert.deepEqual(readdirSync(at(dir)).sort(), src, `plugin/${dir} must mirror ${dir}: run \`npm run bundle\``);
  }
  assert.ok(existsSync(at('LICENSE')), 'the payload carries its licence');
});

test('git tracks only the hand-written payload; built output stays out of source history', () => {
  // The built payload is published on the release branch. Committing it here
  // would add megabytes to the history every marketplace add clones.
  const tracked = execFileSync('git', ['ls-files', '--', 'plugin'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter(Boolean).map((f) => f.replace(/^plugin\//, '')).sort();
  assert.deepEqual(tracked, [...HAND_WRITTEN].sort(), 'only the hand-written plugin files belong in git');
  // Each generated file is gitignored, so a build leaves nothing to commit.
  const untracked = execFileSync('git', ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', 'plugin'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n').filter((l) => l.startsWith('??'));
  assert.deepEqual(untracked, [], 'every generated plugin file must be gitignored');
  for (const f of [...BUNDLES, 'templates/prompts/section-drafter.md', 'references/doctor-output.md', 'LICENSE']) {
    const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', `plugin/${f}`], { cwd: repoRoot });
    assert.equal(ignored.status, 0, `plugin/${f} is generated and must be gitignored`);
  }
});

test('the bundles are minified, keep their names and carry the bundled licence notices', () => {
  // Each release commits the built payload to the release branch, so the
  // bundle size is what every release adds to that branch's history. Before
  // minifying, the CLI was 8.9 MB and the hook 0.5 MB.
  const MiB = 1024 * 1024;
  const budgets: Array<[string, number]> = [['dist/pensmith.mjs', 7 * MiB], ['dist/hook.mjs', 0.35 * MiB]];
  for (const [f, max] of budgets) {
    const size = statSync(built(f)).size;
    assert.ok(size <= max, `plugin/${f} is ${(size / MiB).toFixed(2)} MiB, over its ${(max / MiB).toFixed(2)} MiB budget: build it minified`);
    // keepNames: minifying renames functions and classes, and esbuild then
    // restores each original `.name` through this helper, so error names and
    // stack traces stay readable.
    assert.match(
      readFileSync(built(f), 'utf8'),
      /\([\w$]+,[\w$]+\)=>[\w$]+\([\w$]+,"name",\{value:[\w$]+,configurable:!0\}\)/,
      `plugin/${f} must be minified with keepNames`,
    );
  }
  // The licence comments of the inlined packages, collected at the end of the file.
  assert.match(readFileSync(built('dist/pensmith.mjs'), 'utf8'), /Bundled license information:[\s\S]*Copyright/);
});

test('every package-root lookup in shipped source recognises the installed plugin root', () => {
  // The bundle runs from plugin/dist with no package.json above it, so each
  // module that locates templates/ or references/ must also stop at the
  // directory that holds .claude-plugin/plugin.json.
  const offenders = ['bin', 'hooks']
    .flatMap((dir) => filesUnder(path.join(repoRoot, dir), { keep: (n) => n.endsWith('.ts') }))
    .filter((f) => {
      const src = readFileSync(f, 'utf8');
      return /function findPkgRoot\(/.test(src) && !/\.claude-plugin/.test(src);
    })
    .map((f) => path.relative(repoRoot, f));
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

let installedRoot: string | undefined;
after(() => {
  if (installedRoot) rmSync(installedRoot, { recursive: true, force: true });
});

/** One installed-like copy of the payload, shared by the tests below (none of them writes to it). */
function installedCopy(): string {
  for (const f of BUNDLES) built(f);
  installedRoot ??= mkdtempSync(path.join(tmpdir(), 'pensmith-installed-'));
  const dest = path.join(installedRoot, 'pensmith', pkg.version);
  if (!existsSync(dest)) cpSync(pluginDir, dest, { recursive: true });
  return dest;
}

function runPensmith(
  copy: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env, ...extraEnv };
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

test('the installed CLI starts a paper from assignment.txt: intake, a dry run, status and an offline research step', () => {
  // The journey runs the source CLI, so this is the run that loads the
  // bundle's copied assets (the intake prompt, the disclaimer) mid-pipeline.
  const copy = installedCopy();
  const cwd = mkdtempSync(path.join(tmpdir(), 'pensmith-installed-paper-'));
  const assignment = 'Write a 1500-word essay on whether the visible lattice points form islands.\n';
  writeFileSync(path.join(cwd, 'assignment.txt'), assignment);
  const env = { PENSMITH_NO_LLM: '1' };

  const asked = runPensmith(copy, ['--offline'], cwd, env);
  assert.equal(asked.status, 3, `bare pensmith stops for the intake answers\n${asked.stdout}${asked.stderr}`);
  const pendingLine = `${asked.stdout}\n${asked.stderr}`.split('\n').find((l) => l.startsWith('{"pending"'));
  assert.ok(pendingLine, asked.stdout + asked.stderr);
  const pending = JSON.parse(pendingLine) as { pending: string; questions: Array<{ id: string; suggested: string }> };
  assert.equal(pending.pending, 'intake-questions');
  const given: Record<string, string> = {
    discipline: 'other', length_words: '1500', citation_style: 'apa', audience: 'an undergraduate course', counterargument: 'optional',
  };
  const answers = Object.fromEntries(pending.questions.map((q) => [q.id, given[q.id] ?? q.suggested]));

  const intake = runPensmith(copy, ['new', '--offline', '--answers', JSON.stringify(answers)], cwd, env);
  assert.equal(intake.status, 0, intake.stdout + intake.stderr);
  assert.ok(readFileSync(path.join(cwd, '.paper', 'PROJECT.md'), 'utf8').includes(assignment.trim()), 'the assignment is kept');
  assert.ok(existsSync(path.join(cwd, '.paper', 'INTAKE.json')));

  const before = fileHashes(path.join(cwd, '.paper'));
  const dry = runPensmith(copy, ['--dry-run'], cwd, env);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /the next step is `pensmith research`/);
  assert.deepEqual(fileHashes(path.join(cwd, '.paper')), before, '--dry-run leaves .paper/ as it was');

  const status = runPensmith(copy, ['status'], cwd, env);
  assert.equal(status.status, 0, status.stdout + status.stderr);
  assert.match(status.stdout, /next: research/);

  const research = runPensmith(copy, ['--offline'], cwd, env);
  assert.equal(research.status, 0, research.stdout + research.stderr);
  assert.match(research.stdout + research.stderr, /research: skipped \(offline\)/);
});

test('the installed CLI parses a PDF without printing a Buffer() deprecation warning', () => {
  // Node prints DEP0005 for `new Buffer()` called from outside node_modules. In
  // the bundle nothing is under node_modules, so pdf.js copying the Buffer that
  // pdf-parse hands it (`new value.constructor(value)`) warned on every PDF.
  const copy = installedCopy();
  const cwd = mkdtempSync(path.join(tmpdir(), 'pensmith-add-pdf-'));
  mkdirSync(path.join(cwd, '.paper'));
  const pdf = path.join(repoRoot, 'tests', 'fixtures', 'pdf', 'byo-text.pdf');
  // --offline, not --dry-run: a dry run reads nothing, so it would never reach pdf.js.
  const r = runPensmith(copy, ['add', pdf, '--offline'], cwd);
  assert.doesNotMatch(r.stderr, /could not read local PDF/, 'the PDF must actually be parsed');
  assert.match(r.stdout + r.stderr, /offline/, 'add must get past parsing to the (refused) title lookup');
  assert.doesNotMatch(r.stderr, /DeprecationWarning|DEP0005/, `stderr: ${r.stderr}`);
  for (const f of BUNDLES) {
    assert.doesNotMatch(readFileSync(built(f), 'utf8'), /new Buffer\(/, `plugin/${f} must not call the deprecated Buffer constructor`);
  }
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
