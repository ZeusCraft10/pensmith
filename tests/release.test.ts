// tests/release.test.ts
//
// Users install the plugin from the `release` branch, which holds the built
// plugin/ payload at its root. scripts/release.mjs is what the release
// workflow runs to check a tag and publish that branch. These tests run it
// against a throwaway source repository and a bare "origin", the way the
// workflow runs it against GitHub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));

interface Fixture {
  root: string;
  src: string;
  origin: string;
  env: NodeJS.ProcessEnv;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Run {
  const res = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 60_000 });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function git(fx: Fixture, args: string[], cwd = fx.src): string {
  const r = run('git', args, cwd, fx.env);
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function put(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function setVersion(fx: Fixture, version: string): void {
  put(path.join(fx.src, 'package.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);
  put(path.join(fx.src, 'plugin', '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`);
}

/** What `npm run bundle` leaves behind: gitignored bundles and copies of the root assets. */
function bundle(fx: Fixture, marker: string): void {
  put(path.join(fx.src, 'plugin', 'dist', 'pensmith.mjs'), `#!/usr/bin/env node\n// ${marker}\n`);
  put(path.join(fx.src, 'plugin', 'dist', 'hook.mjs'), `// ${marker}\n`);
  for (const asset of ['templates/prompt.md', 'LICENSE']) {
    const to = path.join(fx.src, 'plugin', ...asset.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(path.join(fx.src, ...asset.split('/')), to);
  }
}

/** Files under `dir`, as sorted posix paths relative to it, with any .git directory left out. */
function filesUnder(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== '.git') out.push(...filesUnder(dir, rel));
    } else {
      out.push(rel);
    }
  }
  return out.sort();
}

function commitAndTag(fx: Fixture, tag: string): void {
  git(fx, ['add', '-A']);
  git(fx, ['commit', '-q', '-m', `source for ${tag}`]);
  git(fx, ['tag', tag]);
}

/** A source repository at v1.2.3 with a built payload, and an empty bare origin. */
function fixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'pensmith-release-'));
  const gitconfig = path.join(root, 'gitconfig');
  writeFileSync(gitconfig, '');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Nothing from the machine's git config (signing, hooks, autocrlf) leaks in.
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_AUTHOR_NAME: 'Release Test',
    GIT_AUTHOR_EMAIL: 'release-test@example.invalid',
    GIT_COMMITTER_NAME: 'Release Test',
    GIT_COMMITTER_EMAIL: 'release-test@example.invalid',
  };
  const fx: Fixture = { root, src: path.join(root, 'src'), origin: path.join(root, 'origin.git'), env };
  git(fx, ['init', '-q', '--bare', fx.origin], root);
  mkdirSync(fx.src);
  git(fx, ['init', '-q', '-b', 'main']);
  // The generated payload, and the repository's patterns for local files that
  // must never ship (an unredacted intake, a paper workspace, secrets, logs).
  put(path.join(fx.src, '.gitignore'), [
    '/plugin/dist/', '/plugin/templates/', '/plugin/LICENSE',
    '.paper/', '.env', '*.log', '**/INTAKE.raw.local', '',
  ].join('\n'));
  setVersion(fx, '1.2.3');
  put(path.join(fx.src, 'plugin', 'bin', 'pensmith'), '#!/bin/sh\nexec node "$(dirname "$0")/../dist/pensmith.mjs" "$@"\n');
  // Committed without the executable bit; the release tree must set it anyway.
  chmodSync(path.join(fx.src, 'plugin', 'bin', 'pensmith'), 0o644);
  // A Windows shim keeps its CRLF line endings.
  put(path.join(fx.src, 'plugin', 'bin', 'pensmith.cmd'), '@echo off\r\nnode "%~dp0\\..\\dist\\pensmith.mjs" %*\r\n');
  put(path.join(fx.src, 'plugin', 'skills', 'old', 'SKILL.md'), '---\nname: old\n---\n');
  // Root assets that `npm run bundle` copies into the payload.
  put(path.join(fx.src, 'templates', 'prompt.md'), 'You are a careful drafter.\nCite only mapped sources.\n');
  put(path.join(fx.src, 'LICENSE'), 'Fixture licence.\nAll rights reserved.\n');
  put(path.join(fx.src, 'bin', 'cli.ts'), 'export {};\n');
  commitAndTag(fx, 'v1.2.3');
  git(fx, ['remote', 'add', 'origin', fx.origin]);
  git(fx, ['push', '-q', 'origin', 'main', '--tags']);
  bundle(fx, 'build 1.2.3');
  return fx;
}

const release = (fx: Fixture, ...args: string[]): Run => run(process.execPath, [script, ...args], fx.src, fx.env);

/** The release branch on origin: path -> mode, or null if it does not exist. */
function releaseFiles(fx: Fixture): Map<string, string> | null {
  const head = run('git', ['--git-dir', fx.origin, 'rev-parse', '--verify', '--quiet', 'refs/heads/release'], fx.root, fx.env);
  if (head.status !== 0) return null;
  const listing = git(fx, ['--git-dir', fx.origin, 'ls-tree', '-r', '--full-tree', 'refs/heads/release'], fx.root);
  return new Map(listing.split('\n').map((line) => {
    const [meta, file] = line.split('\t');
    return [file!, meta!.split(' ')[0]!];
  }));
}

/** origin's release history, newest first: subject and parent count. */
function releaseLog(fx: Fixture): Array<{ subject: string; parents: number }> {
  return git(fx, ['--git-dir', fx.origin, 'log', '--format=%s%x09%P', 'refs/heads/release'], fx.root)
    .split('\n')
    .map((line) => {
      const [subject, parents] = line.split('\t');
      return { subject: subject!, parents: parents ? parents.split(' ').length : 0 };
    });
}

const show = (fx: Fixture, spec: string): string => git(fx, ['--git-dir', fx.origin, 'show', spec], fx.root);

/** The exact bytes of a blob on origin, such as `refs/heads/release:bin/pensmith`. */
function blob(fx: Fixture, spec: string): Buffer {
  const res = spawnSync('git', ['--git-dir', fx.origin, 'cat-file', 'blob', spec], { cwd: fx.root, env: fx.env });
  assert.equal(res.status, 0, `git cat-file blob ${spec}: ${res.stderr}`);
  return res.stdout;
}

/** The payload files `npm run bundle` and git leave under plugin/, which a release must ship exactly. */
const PAYLOAD = [
  '.claude-plugin/plugin.json',
  'LICENSE',
  'bin/pensmith',
  'bin/pensmith.cmd',
  'dist/hook.mjs',
  'dist/pensmith.mjs',
  'skills/old/SKILL.md',
  'templates/prompt.md',
];

test('check accepts a tag that names the package and plugin version, and nothing else', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(release(fx, 'check', 'v1.2.3').status, 0);

  for (const tag of ['v1.2.4', '1.2.3', 'v1.2.3-rc.1']) {
    const r = release(fx, 'check', tag);
    assert.notEqual(r.status, 0, `${tag} must be refused`);
    assert.match(r.stderr, /1\.2\.3/, 'the refusal names the version it expected');
  }

  // A plugin.json left behind on the old version is refused even with the right tag.
  put(path.join(fx.src, 'plugin', '.claude-plugin', 'plugin.json'), `${JSON.stringify({ name: 'fixture', version: '1.2.2' })}\n`);
  const r = release(fx, 'check', 'v1.2.3');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /plugin\.json/);
});

test('the first publish creates the release branch with the built payload at its root', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  const r = release(fx, 'publish', 'v1.2.3');
  assert.equal(r.status, 0, r.stderr);

  const files = releaseFiles(fx);
  assert.ok(files, 'origin must have a release branch');
  assert.deepEqual([...files.keys()].sort(), ['.gitattributes', ...PAYLOAD].sort(),
    'exactly plugin/, gitignored build output included, its own .gitattributes, and nothing from outside it');
  assert.equal(files.get('bin/pensmith'), '100755');
  assert.equal(files.get('dist/pensmith.mjs'), '100755');
  assert.match(show(fx, 'refs/heads/release:dist/pensmith.mjs'), /build 1\.2\.3/);
  assert.deepEqual(releaseLog(fx), [{ subject: 'release v1.2.3', parents: 0 }]);

  // The source checkout is left exactly as it was.
  assert.equal(git(fx, ['status', '--porcelain']), '');
  assert.equal(git(fx, ['branch', '--list', 'release']), '');
});

test('a later publish commits on top of the previous release and drops removed files', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(release(fx, 'publish', 'v1.2.3').status, 0);

  // The next release, published from a fresh clone the way CI checks out a tag.
  setVersion(fx, '1.2.4');
  rmSync(path.join(fx.src, 'plugin', 'skills', 'old'), { recursive: true });
  put(path.join(fx.src, 'plugin', 'skills', 'new', 'SKILL.md'), '---\nname: new\n---\n');
  commitAndTag(fx, 'v1.2.4');
  git(fx, ['push', '-q', 'origin', 'main', '--tags']);
  const clone = path.join(fx.root, 'ci');
  // A file:// URL, because git ignores --depth for a plain local path.
  git(fx, ['clone', '-q', '--depth', '1', '--branch', 'v1.2.4', pathToFileURL(fx.origin).href, clone], fx.root);
  const ci: Fixture = { ...fx, src: clone };
  assert.equal(git(ci, ['rev-parse', '--is-shallow-repository']), 'true', 'like actions/checkout, a shallow clone');
  bundle(ci, 'build 1.2.4');
  const r = release(ci, 'publish', 'v1.2.4');
  assert.equal(r.status, 0, r.stderr);

  assert.deepEqual(releaseLog(fx), [
    { subject: 'release v1.2.4', parents: 1 },
    { subject: 'release v1.2.3', parents: 0 },
  ], 'history is kept: the new release sits on the previous one');
  const files = releaseFiles(fx)!;
  assert.ok(files.has('skills/new/SKILL.md'));
  assert.ok(!files.has('skills/old/SKILL.md'), 'a file removed from plugin/ leaves the release branch');
  assert.equal(JSON.parse(show(fx, 'refs/heads/release:.claude-plugin/plugin.json')).version, '1.2.4');
  assert.match(show(fx, 'refs/heads/release:dist/hook.mjs'), /build 1\.2\.4/);
});

test('publishing the same tag again adds no commit', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(release(fx, 'publish', 'v1.2.3').status, 0);
  const again = release(fx, 'publish', 'v1.2.3');
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already/);
  assert.equal(releaseLog(fx).length, 1);
});

test('publish refuses an unbuilt payload, a wrong tag or uncommitted changes, and pushes nothing', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));

  rmSync(path.join(fx.src, 'plugin', 'dist'), { recursive: true });
  let r = release(fx, 'publish', 'v1.2.3');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /run `npm run bundle`/);
  bundle(fx, 'build 1.2.3');

  // A copied asset missing from the payload: the bundle is out of date.
  rmSync(path.join(fx.src, 'plugin', 'templates'), { recursive: true });
  r = release(fx, 'publish', 'v1.2.3');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /plugin\/templates\/prompt\.md/);
  assert.match(r.stderr, /run `npm run bundle`/);
  bundle(fx, 'build 1.2.3');

  r = release(fx, 'publish', 'v1.2.4');
  assert.notEqual(r.status, 0, 'a tag that does not match the version');

  // A tag that does not point at the checked-out commit.
  put(path.join(fx.src, 'bin', 'cli.ts'), 'export const changed = true;\n');
  git(fx, ['commit', '-q', '-am', 'after the tag']);
  r = release(fx, 'publish', 'v1.2.3');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /v1\.2\.3/);
  git(fx, ['reset', '-q', '--hard', 'v1.2.3']);

  // Uncommitted source changes would ship a bundle the tag does not describe.
  put(path.join(fx.src, 'bin', 'cli.ts'), 'export const dirty = true;\n');
  r = release(fx, 'publish', 'v1.2.3');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /uncommitted/);
  git(fx, ['checkout', '-q', '--', 'bin/cli.ts']);

  // The right version, but no such tag to say which source it was built from.
  git(fx, ['tag', '-d', 'v1.2.3']);
  r = release(fx, 'publish', 'v1.2.3');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no tag v1\.2\.3/);

  assert.equal(releaseFiles(fx), null, 'nothing reached origin');
});

test('the release tree matches the plugin/ payload byte for byte', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(release(fx, 'publish', 'v1.2.3').status, 0);
  const pluginDir = path.join(fx.src, 'plugin');
  assert.deepEqual(filesUnder(pluginDir), PAYLOAD);
  for (const f of PAYLOAD) {
    assert.deepEqual(blob(fx, `refs/heads/release:${f}`), readFileSync(path.join(pluginDir, ...f.split('/'))), f);
  }
});

test('a clone of the release branch has the payload bytes even with core.autocrlf=true', (t) => {
  // Claude Code installs the release branch with a plain `git clone`, which
  // follows the user's git config. Windows' default core.autocrlf=true would
  // otherwise check out CRLF copies: a prompt template whose hash no longer
  // matches its pin, and a bin/pensmith whose `#!/bin/sh\r` cannot run.
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  assert.equal(release(fx, 'publish', 'v1.2.3').status, 0);
  const clone = path.join(fx.root, 'installed');
  git(fx, ['-c', 'core.autocrlf=true', 'clone', '-q', '--depth', '1', '--branch', 'release', pathToFileURL(fx.origin).href, clone], fx.root);

  for (const f of ['bin/pensmith', 'templates/prompt.md', 'skills/old/SKILL.md']) {
    assert.ok(!readFileSync(path.join(clone, ...f.split('/'))).includes(0x0d), `${f} must have no CR`);
  }
  for (const f of PAYLOAD) {
    const checkedOut = readFileSync(path.join(clone, ...f.split('/')));
    assert.deepEqual(checkedOut, readFileSync(path.join(fx.src, 'plugin', ...f.split('/'))), `${f} must check out byte for byte`);
  }
  assert.deepEqual(filesUnder(clone), ['.gitattributes', ...PAYLOAD].sort());
});

test('files git ignores under plugin/ never reach the release branch', (t) => {
  const fx = fixture();
  t.after(() => rmSync(fx.root, { recursive: true, force: true }));
  // Local files that land under plugin/ and that git ignores, so the clean
  // checkout check cannot see them.
  const strays = ['.env', '.paper/STATE.json', 'skills/old/INTAKE.raw.local', 'templates/INTAKE.raw.local', 'dist/debug.log'];
  for (const f of strays) put(path.join(fx.src, 'plugin', ...f.split('/')), 'private\n');
  assert.equal(git(fx, ['status', '--porcelain', '--untracked-files=all']), '', 'git ignores every stray');

  const r = release(fx, 'publish', 'v1.2.3');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([...releaseFiles(fx)!.keys()].sort(), ['.gitattributes', ...PAYLOAD].sort(),
    'only tracked plugin files, the bundles and the copied assets ship');
});
