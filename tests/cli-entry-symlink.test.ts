// tests/cli-entry-symlink.test.ts — the CLI must run when started through a symlink.
//
// npm link, `npm i -g`, npx and node_modules/.bin all start the CLI through a
// symlink. Node resolves import.meta.url to the real file but leaves
// process.argv[1] as the link, so an entry check that compares the two as plain
// strings never dispatches: every command printed nothing and exited 0.
//
// These cases run the real CLI (the built dist/bin/pensmith.js and the
// TypeScript source) through the same link shapes npm creates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VERSION } from '../bin/lib/version.generated.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const BUILT = resolve(REPO, 'dist/bin/pensmith.js');
const SOURCE = resolve(REPO, 'bin/pensmith.ts');
const TSX_LOADER = import.meta.resolve('tsx');
// npm installs bins on Windows as .cmd shims, not symlinks, and creating a
// symlink there needs extra privileges; the defect is POSIX-only.
const POSIX_ONLY = { skip: process.platform === 'win32' ? 'symlinked bins are POSIX-only' : false };

function isolatedEnv(): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-link-home-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  return env;
}

function run(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, args, { cwd, env: isolatedEnv(), encoding: 'utf8', timeout: 60_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** A directory laid out like an npm prefix: lib/node_modules/pensmith -> repo, bin/pensmith -> its bin. */
function npmLinkLayout(): string {
  const prefix = mkdtempSync(join(tmpdir(), 'pensmith-link-prefix-'));
  mkdirSync(join(prefix, 'lib', 'node_modules'), { recursive: true });
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  // npm link symlinks the package folder itself, then links the bin into it.
  symlinkSync(REPO, join(prefix, 'lib', 'node_modules', 'pensmith'), 'dir');
  symlinkSync(
    join('..', 'lib', 'node_modules', 'pensmith', 'dist', 'bin', 'pensmith.js'),
    join(prefix, 'bin', 'pensmith'),
  );
  return join(prefix, 'bin', 'pensmith');
}

test('entry: the built CLI exists (run npm run build first)', () => {
  assert.ok(existsSync(BUILT), `expected ${BUILT} — run npm run build first`);
});

test('entry: the built CLI prints its version through a file symlink', POSIX_ONLY, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-link-'));
  const link = join(dir, 'pensmith');
  symlinkSync(BUILT, link);
  const r = run([link, '--version'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), VERSION, `no output through the symlink: stdout=${JSON.stringify(r.stdout)}`);
});

test('entry: the built CLI runs a verb through an npm-link style chain (linked package dir + linked bin)', POSIX_ONLY, () => {
  const bin = npmLinkLayout();
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-link-cwd-'));
  const v = run([bin, '--version'], cwd);
  assert.equal(v.stdout.trim(), VERSION, `--version through npm link printed ${JSON.stringify(v.stdout)}`);
  // `status` in a folder with no paper must say so; before the fix it printed nothing.
  const s = run([bin, 'status'], cwd);
  assert.match(s.stdout, /no active paper/, `status through npm link printed ${JSON.stringify(s.stdout + s.stderr)}`);
});

test('entry: the TypeScript source runs through a symlink too', POSIX_ONLY, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-link-src-'));
  const link = join(dir, 'pensmith.ts');
  symlinkSync(SOURCE, link);
  const r = run(['--import', TSX_LOADER, link, '--version'], dir);
  assert.equal(r.stdout.trim(), VERSION, `no output through the source symlink: ${JSON.stringify(r.stdout + r.stderr)}`);
});

test('entry: a script that imports the CLI module does not run the CLI', () => {
  // Tests and scripts import bin/pensmith.ts for its command table. Importing
  // must not dispatch: a bare dispatch in an empty folder would start intake.
  const cwd = mkdtempSync(join(tmpdir(), 'pensmith-link-import-'));
  const script = join(cwd, 'import-cli.mts');
  writeFileSync(
    script,
    `import { command } from ${JSON.stringify(pathToFileURL(SOURCE).href)};\n` +
      `process.stdout.write('imported ' + String(Object.keys(command.subCommands ?? {}).length) + '\\n');\n`,
  );
  const r = run(['--import', TSX_LOADER, script], cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^imported \d+\n$/, `importing the module produced CLI output: ${JSON.stringify(r.stdout)}`);
  assert.deepEqual(readdirSync(cwd).sort(), ['import-cli.mts'], 'importing the module must not write anything');
});
