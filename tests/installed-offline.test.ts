// tests/installed-offline.test.ts — RUN-05 / RUN-27: the installed package
// never reads tests/ at runtime.
//
// Packs the BUILT package (`npm pack`; run `npm run build` first) and installs
// it with `npm install -g --offline --prefix <tmp>` from the npm cache, then
// runs the installed CLI from a temp project:
//   - `--dry-run research --yolo` finds >= 5 synthetic dry-run sources from the
//     packaged corpus (templates/dry-run/corpus.json) — no ENOENT on
//     tests/fixtures, which the package does not ship;
//   - `PENSMITH_OFFLINE=1 … verify 1` fails closed with the "not shipped"
//     message and writes no verdicts (never 0-result research or
//     all-FABRICATED verdicts from missing fixtures).
// The static half (no tests/ path is resolved at runtime outside http-mock.ts)
// is the `tests-path-at-runtime` chokepoint row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const IS_WIN = process.platform === 'win32';

/** Run npm: through its JS entry when npm launched us, else the platform shim. */
function npm(args: string[], cwd: string): SpawnSyncReturns<string> {
  const execPath = process.env['npm_execpath'];
  const opts = { cwd, encoding: 'utf8' as const, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'], timeout: 300_000 };
  if (typeof execPath === 'string' && execPath.endsWith('.js')) {
    return spawnSync(process.execPath, [execPath, ...args], opts);
  }
  return IS_WIN
    ? spawnSync('npm.cmd', args.map((a) => (/\s/.test(a) ? `"${a}"` : a)), { ...opts, shell: true })
    : spawnSync('npm', args, opts);
}

/** A user's environment: no test context, no PENSMITH_* unless given, isolated data dir. */
function userEnv(scratch: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'NODE_TEST_CONTEXT' || k.startsWith('PENSMITH_') || k.startsWith('npm_')) continue;
    if (/^(ANTHROPIC|OPENAI|GPTZERO)_/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, XDG_DATA_HOME: join(scratch, 'data'), LOCALAPPDATA: join(scratch, 'data'), ...extra };
}

let installed: { cli: string; pkgDir: string; scratch: string } | null = null;

/** Pack + install once per file. */
function install(): { cli: string; pkgDir: string; scratch: string } {
  if (installed) return installed;
  assert.ok(existsSync(join(REPO, 'dist', 'bin', 'pensmith.js')), 'dist/ missing — run `npm run build` first');
  const scratch = mkdtempSync(join(tmpdir(), 'pensmith-installed-'));
  const packDir = join(scratch, 'pack');
  const prefix = join(scratch, 'prefix');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(prefix, { recursive: true });

  const pack = npm(['pack', '--ignore-scripts', '--silent', '--pack-destination', packDir], REPO);
  assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
  const tgz = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  assert.ok(tgz, `npm pack produced a tarball in ${packDir}`);

  const inst = npm(
    ['install', '-g', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, join(packDir, tgz)],
    scratch,
  );
  assert.equal(inst.status, 0, `npm install -g --offline failed (is the npm cache populated by npm ci?): ${inst.stderr}`);

  const pkgName = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { name: string }).name;
  const pkgDir = IS_WIN ? join(prefix, 'node_modules', pkgName) : join(prefix, 'lib', 'node_modules', pkgName);
  assert.ok(existsSync(pkgDir), `installed package at ${pkgDir}`);
  assert.ok(!existsSync(join(pkgDir, 'tests')), 'the package ships no tests/ directory');
  assert.ok(existsSync(join(pkgDir, 'templates', 'dry-run', 'corpus.json')), 'the dry-run corpus ships under templates/');
  const binRel = (JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { bin: Record<string, string> }).bin[pkgName];
  assert.ok(binRel, 'package.json bin entry');
  installed = { cli: join(pkgDir, binRel), pkgDir, scratch };
  return installed;
}

function runInstalled(args: string[], cwd: string, extra: Record<string, string> = {}): SpawnSyncReturns<string> {
  const { cli, scratch } = install();
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, env: userEnv(scratch, extra), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000,
  });
}

test('RUN-05 / RUN-27: the installed package runs `--dry-run research --yolo` from the packaged corpus (>=5 synthetic, no ENOENT)', () => {
  const { scratch } = install();
  const project = mkdtempSync(join(scratch, 'dry-run-'));
  mkdirSync(join(project, '.paper'), { recursive: true });
  writeFileSync(
    join(project, '.paper', 'INTAKE.md'),
    '---\ntopic: medieval Icelandic sagas\ndiscipline: history\n---\n# Intake\n\nWrite a 1500-word essay on medieval Icelandic sagas.\n',
  );
  const r = runInstalled(['--dry-run', 'research', '--yolo'], project);
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 0, `dry-run research exits 0: ${out.slice(0, 2000)}`);
  assert.ok(!/ENOENT|tests[\\/]fixtures/.test(out), `no ENOENT and no tests/fixtures path: ${out.slice(0, 2000)}`);
  assert.match(r.stderr, /OFFLINE MODE \(reason: --dry-run\)/);
  const library = readFileSync(join(project, '.paper', 'LIBRARY.json'), 'utf8');
  const dois = new Set(library.match(/10\.0000\/pensmith-dryrun\.[0-9a-f]{8}/g) ?? []);
  assert.ok(dois.size >= 5, `>= 5 synthetic dry-run sources, got ${dois.size}`);
});

test('RUN-05: `PENSMITH_OFFLINE=1 verify 1` in the installed package fails closed with the not-shipped message and writes no verdicts', () => {
  const { scratch } = install();
  const project = mkdtempSync(join(scratch, 'offline-'));
  const secDir = join(project, '.paper', 'sections', '01-intro');
  mkdirSync(secDir, { recursive: true });
  writeFileSync(join(project, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'installed', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }));
  writeFileSync(join(project, '.paper', 'CITATIONS.bib'), '@article{aspelmeyer2009,\n  title = {Measured measurement},\n  author = {Aspelmeyer, Markus},\n  doi = {10.1038/nphys1170},\n  year = {2009}\n}\n');
  writeFileSync(join(secDir, 'DRAFT.md'), '# Intro\n\nA claim [@aspelmeyer2009].\n');
  const r = runInstalled(['verify', '1', '--slug', 'intro'], project, { PENSMITH_OFFLINE: '1' });
  assert.notEqual(r.status, 0, `offline verify must fail closed: ${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /offline fixtures are not shipped in the installed package; offline replay needs a source checkout/);
  assert.ok(!existsSync(join(secDir, 'VERIFICATION.md')), 'no VERIFICATION.md is written');
  assert.ok(!/FABRICATED|UNVERIFIABLE|MIS-CITED/.test(r.stdout), 'no verdicts at all');
});
