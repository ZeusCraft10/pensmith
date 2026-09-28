// tests/installed-offline.test.ts — RUN-05 / RUN-27: the installed package
// never reads tests/ at runtime.
//
// Packs the BUILT package (`npm pack`; run `npm run build` first) and installs
// it with `npm install -g --prefix <tmp>` from a loopback registry
// (tests/helpers/installed-package.ts), then runs the installed CLI from a temp
// project:
//   - `--dry-run research --yolo` finds >= 5 synthetic dry-run sources from the
//     packaged corpus (templates/dry-run/corpus.json) — no ENOENT on
//     tests/fixtures, which the package does not ship;
//   - `PENSMITH_OFFLINE=1 … verify 1` fails closed with the "not shipped"
//     message and writes no verdicts (never 0-result research or
//     all-FABRICATED verdicts from missing fixtures);
//   - `PENSMITH_OFFLINE=1 … resume --replay <id>` (RUN-17) reproduces a logged
//     step from its logged model response — it needs no source fixture.
// The static half (no tests/ path is resolved at runtime outside http-mock.ts)
// is the `tests-path-at-runtime` chokepoint row.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withLlmSandbox, readJsonl } from './helpers/llm-sandbox.js';
import { packAndInstall, type InstalledPackage } from './helpers/installed-package.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));

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

let pkg: InstalledPackage | null = null;
let installed: { cli: string; pkgDir: string; scratch: string } | null = null;

before(async () => {
  pkg = await packAndInstall('installed-offline');
  const { pkgDir, scratch } = pkg;
  assert.ok(!existsSync(join(pkgDir, 'tests')), 'the package ships no tests/ directory');
  assert.ok(existsSync(join(pkgDir, 'templates', 'dry-run', 'corpus.json')), 'the dry-run corpus ships under templates/');
  const pkgName = (JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { name: string }).name;
  const binRel = (JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as { bin: Record<string, string> }).bin[pkgName];
  assert.ok(binRel, 'package.json bin entry');
  installed = { cli: join(pkgDir, binRel), pkgDir, scratch };
});

after(async () => {
  await pkg?.close();
});

/** The installed package, packed + installed once per file in before(). */
function install(): { cli: string; pkgDir: string; scratch: string } {
  assert.ok(installed, 'the package was installed in before()');
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
  // A paper a dry run made (RUN-27: --dry-run never runs over a real paper).
  writeFileSync(join(project, '.paper', 'DRY-RUN.md'), '# made by pensmith --dry-run\n');
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

test('RUN-17 / RUN-05: `PENSMITH_OFFLINE=1 resume --replay <id>` works in the installed package (logged responses, no fixtures)', async () => {
  const { scratch } = install();
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test-installed-replay-0001' }, paper: false }, async (sb) => {
    // Record the step with the source checkout against the mock LLM.
    writeFileSync(join(sb.root, 'assignment.txt'), 'Write a 1500-word literature review on attention mechanisms in transformers, APA style.\n');
    const first = await sb.runTsx(null, ['new', '--from', 'assignment.txt', '--yolo']);
    assert.equal(first.status, 0, first.stderr);
    const rec = readJsonl(join(sb.paper, 'SESSION.log')).find((r) => r['kind'] === 'llm' && r['slug'] === 'intake-clarifier');
    assert.ok(rec, 'the intake-clarifier call was logged');
    const original = readFileSync(join(sb.paper, 'INTAKE.md'), 'utf8');
    const calls = sb.mock!.callCount();

    // Replay it with the INSTALLED package in a copy of the paper.
    const project = mkdtempSync(join(scratch, 'replay-'));
    cpSync(sb.paper, join(project, '.paper'), { recursive: true });
    writeFileSync(join(project, 'assignment.txt'), readFileSync(join(sb.root, 'assignment.txt')));
    rmSync(join(project, '.paper', 'INTAKE.md'));
    const r = runInstalled(['resume', '--replay', String(rec['id'])], project, { PENSMITH_OFFLINE: '1' });
    assert.equal(r.status, 0, `installed replay: ${r.stdout}\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /offline fixtures are not shipped/);
    assert.match(r.stderr, /\(sources offline: serving the logged model responses\)/);
    assert.equal(readFileSync(join(project, '.paper', 'INTAKE.md'), 'utf8'), original, 'reproduced byte-for-byte');
    assert.equal(sb.mock!.callCount(), calls, 'no model request');
  });
});
