// tests/dry-run.test.ts — `--dry-run` shows the next step and changes nothing.
//
// --dry-run used to set PENSMITH_NO_LLM and run the verb, so write/plan/intake/
// outline saved placeholder text over the user's real drafts and plans, moved a
// verified section back to "written" and registered papers globally. Now a dry
// run resolves what would run, prints the files it would read and write and the
// model and network calls it would make, and exits before any verb runs.
//
// Each case snapshots every file under the paper folder (STATE.json and .paper/)
// and the isolated global state, runs the real CLI with every proxy pointed at
// a counting listener, and requires the snapshot to be byte-identical and the
// listener to have seen no connection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicAppendFile, atomicRename, atomicWriteFile, DryRunWriteError } from '../bin/lib/atomic-write.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

interface Listener { url: string; connections: () => number; close: () => Promise<void> }

async function countingListener(): Promise<Listener> {
  let count = 0;
  const server = net.createServer((sock) => {
    count++;
    sock.on('error', () => { /* ignore */ });
    sock.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    connections: () => count,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

interface RunResult { status: number | null; stdout: string; stderr: string }

function runCli(
  args: string[],
  cwd: string,
  home: string,
  proxyUrl: string,
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['PENSMITH_TEST_CASSETTES', 'PENSMITH_OFFLINE', 'PENSMITH_NO_LLM', 'PENSMITH_DRY_RUN']) delete env[k];
  for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy']) env[k] = proxyUrl;
  env['NO_PROXY'] = '';
  env['no_proxy'] = '';
  // Keys present, so a verb that did run would try to call out.
  env['ANTHROPIC_API_KEY'] = 'sk-ant-fake-dry-run-test';
  env['GPTZERO_API_KEY'] = 'fake-gptzero-dry-run-test';
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  Object.assign(env, extraEnv);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** path -> sha256 for every file under `dir` (lock stubs in the global lock folder excluded). */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const rel = relative(dir, full);
      // Reading STATE.json takes a lock, which touches an empty stub file in
      // the global lock folder. It is not paper state.
      if (rel.split(sep).includes('locks')) continue;
      if (statSync(full).isDirectory()) walk(full);
      else out.set(rel, createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

const PLAN_VERIFIED_DRAFT = 'Tidal barrages change estuary sediment over decades [@real2020].\n';

/** A paper mid-pipeline: section 1 verified, section 2 planned, nothing compiled yet. */
function paperMidway(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-dry-run-'));
  const pdir = join(root, '.paper');
  mkdirSync(join(pdir, 'sections', '01-intro'), { recursive: true });
  mkdirSync(join(pdir, 'sections', '02-methods'), { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 2,
      paperId: 'dry-run',
      createdAt: '2026-11-01T00:00:00.000Z',
      sections: [{ n: 1, slug: 'intro' }, { n: 2, slug: 'methods' }],
    }),
  );
  writeFileSync(join(pdir, 'INTAKE.md'), '# Intake\n\nTidal energy policy, 2000 words, APA.\n');
  writeFileSync(join(pdir, 'LIBRARY.json'), '{"$schemaVersion":1,"entries":[]}\n');
  writeFileSync(join(pdir, 'CITATIONS.bib'), '@article{real2020, title={Real}, author={Doe, Jane}, year={2020}, doi={10.1000/real}}\n');
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    [
      '# Tidal Energy',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Introduction | | 300 | real2020 |',
      '| 2 | methods | Methods | intro | 500 | |',
      '',
    ].join('\n'),
  );
  const hash = computeDraftHash(Buffer.from(PLAN_VERIFIED_DRAFT), ['real2020']);
  writeFileSync(
    join(pdir, 'sections', '01-intro', 'PLAN.md'),
    `---\nsection: 1\nslug: intro\ntitle: Introduction\nstatus: verified\nassigned_sources: [real2020]\nverified_against_draft_hash: ${hash}\n---\n## Brief\n\nHand-edited plan.\n`,
  );
  writeFileSync(join(pdir, 'sections', '01-intro', 'DRAFT.md'), PLAN_VERIFIED_DRAFT);
  writeFileSync(join(pdir, 'sections', '01-intro', 'VERIFICATION.md'), 'Status: verified\n\n## Pass-1\n\n- real2020: **OK** — titleJW=1.00, authorJW=1.00 — ok\n');
  writeFileSync(
    join(pdir, 'sections', '02-methods', 'PLAN.md'),
    '---\nsection: 2\nslug: methods\ntitle: Methods\nstatus: planned\nassigned_sources: []\n---\n## Brief\n\nDescribe the methods.\n',
  );
  return root;
}

const METHODS_DRAFT = 'We compare sediment cores from three estuaries.\n';

/** paperMidway with section 2 drafted and verified too: ready to compile. */
function paperReadyToCompile(): string {
  const root = paperMidway();
  const sdir = join(root, '.paper', 'sections', '02-methods');
  writeFileSync(join(sdir, 'DRAFT.md'), METHODS_DRAFT);
  writeFileSync(
    join(sdir, 'PLAN.md'),
    `---\nsection: 2\nslug: methods\ntitle: Methods\nstatus: verified\nassigned_sources: []\nverified_against_draft_hash: ${computeDraftHash(Buffer.from(METHODS_DRAFT), [])}\n---\n## Brief\n\nDescribe the methods.\n`,
  );
  writeFileSync(join(sdir, 'VERIFICATION.md'), 'Status: verified\n\n## Pass-1\n\n## Pass-3\n');
  return root;
}

/** paperReadyToCompile with a compiled .paper/DRAFT.md: ready for done. */
function paperCompiled(): string {
  const root = paperReadyToCompile();
  writeFileSync(join(root, '.paper', 'DRAFT.md'), `# Tidal Energy\n\n${PLAN_VERIFIED_DRAFT}\n${METHODS_DRAFT}`);
  return root;
}

/**
 * The same command without --dry-run must change the fixture, or the dry-run
 * case proves nothing: a step that would have written nothing anyway leaves
 * the snapshot unchanged whether or not the dry run ran it. Recorded
 * cassettes and placeholder generation keep this run off the network.
 */
async function assertRealRunWrites(args: string[], root: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-dry-run-home-'));
  const before = snapshot(root);
  const listener = await countingListener();
  try {
    const r = await runCli(args, root, home, listener.url, { PENSMITH_TEST_CASSETTES: '1', PENSMITH_NO_LLM: '1' });
    assert.equal(r.status, 0, `pensmith ${args.join(' ')} (no --dry-run): stdout=${r.stdout} stderr=${r.stderr}`);
    assert.notDeepEqual(
      snapshot(root),
      before,
      `pensmith ${args.join(' ')} (no --dry-run) wrote nothing, so its dry-run case is vacuous: stdout=${r.stdout} stderr=${r.stderr}`,
    );
  } finally {
    await listener.close();
  }
}

async function assertDryRunChangesNothing(
  args: string[],
  root: string,
  expect: RegExp[],
  extraEnv: Record<string, string> = {},
): Promise<RunResult> {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-dry-run-home-'));
  const before = snapshot(root);
  const homeBefore = snapshot(home);
  const listener = await countingListener();
  try {
    const r = await runCli(args, root, home, listener.url, extraEnv);
    assert.equal(r.status, 0, `pensmith ${args.join(' ')}: stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stdout, /dry run/i, `pensmith ${args.join(' ')} must say it is a dry run: ${r.stdout}`);
    for (const re of expect) assert.match(r.stdout, re, `pensmith ${args.join(' ')}: ${r.stdout}`);
    assert.deepEqual(snapshot(root), before, `pensmith ${args.join(' ')} changed the paper folder`);
    assert.deepEqual(snapshot(home), homeBefore, `pensmith ${args.join(' ')} changed global state`);
    assert.equal(listener.connections(), 0, `pensmith ${args.join(' ')} made a network request`);
    return r;
  } finally {
    await listener.close();
  }
}

test('dry run: `write 1` on a verified section names the draft it would replace and leaves it alone', async () => {
  const root = paperMidway();
  await assertDryRunChangesNothing(['write', '1', '--dry-run'], root, [
    /would run `pensmith write 1`/,
    /\.paper\/sections\/01-intro\/DRAFT\.md/,
    /model/i,
  ]);
});

test('dry run: `write` (all sections), `plan 2` and `verify 1` change nothing', async () => {
  const root = paperMidway();
  await assertDryRunChangesNothing(['write', '--dry-run'], root, [/would run `pensmith write`/]);
  await assertDryRunChangesNothing(['plan', '2', '--dry-run'], root, [/\.paper\/sections\/02-methods\/PLAN\.md/]);
  await assertDryRunChangesNothing(['verify', '1', '--dry-run'], root, [/\.paper\/sections\/01-intro\/VERIFICATION\.md/]);
});

test('dry run: research, outline, compile and done change nothing where the real step would write', async () => {
  // Each fixture is one the real step writes to; assertRealRunWrites shows it.
  await assertRealRunWrites(['research', '--yolo'], paperMidway());
  await assertDryRunChangesNothing(['research', '--dry-run', '--yolo'], paperMidway(), [/LIBRARY\.json/]);
  await assertRealRunWrites(['outline', '--yolo', '--force'], paperMidway());
  await assertDryRunChangesNothing(['outline', '--dry-run', '--yolo', '--force'], paperMidway(), [/OUTLINE\.md/]);
  await assertRealRunWrites(['compile'], paperReadyToCompile());
  await assertDryRunChangesNothing(['compile', '--dry-run'], paperReadyToCompile(), [/\.paper\/DRAFT\.md/]);
  await assertRealRunWrites(['done', '--yolo', '--format', 'md'], paperCompiled());
  await assertDryRunChangesNothing(['done', '--dry-run', '--yolo', '--format', 'md'], paperCompiled(), [/export/]);
});

test('dry run: bare `pensmith`, `next` and `resume` name the step the router would take', async () => {
  const root = paperMidway();
  // Section 1 is verified; section 2's status is "planned", which the router
  // sends to plan. The dry run must name that step and change nothing.
  for (const args of [['--dry-run'], ['next', '--dry-run'], ['resume', '--dry-run']]) {
    await assertDryRunChangesNothing(args, root, [/the next step is `pensmith plan 2`/, /\.paper\/sections\/02-methods\/PLAN\.md/]);
  }
});

test('dry run: an old-format STATE.json is read as upgraded but not rewritten', async () => {
  const root = paperMidway();
  // A v1 STATE.json: reading it runs a migration, which normally saves the
  // upgraded file. A dry run must use the upgrade in memory only.
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 1,
      paperId: '22222222-2222-2222-2222-222222222222',
      createdAt: '2026-11-01T00:00:00.000Z',
      sections: [{ n: 1, slug: 'intro', state: 'verified' }, { n: 2, slug: 'methods', state: 'planned' }],
    }),
  );
  await assertDryRunChangesNothing(['--dry-run'], root, [/the next step is `pensmith plan 2`/]);
});

test('dry run: PENSMITH_DRY_RUN=1 in the environment is a dry run too', async () => {
  // Otherwise the verb would run, call the model, and only then fail to save.
  const root = paperMidway();
  await assertDryRunChangesNothing(['write', '1'], root, [/would run `pensmith write 1`/], { PENSMITH_DRY_RUN: '1' });
});

test('dry run: `new --from` in an empty folder creates no paper', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-dry-run-new-'));
  writeFileSync(join(dir, 'assignment.txt'), 'Write about tidal energy.\n');
  await assertDryRunChangesNothing(['new', '--from', 'assignment.txt', '--dry-run'], dir, [/would run `pensmith new`/, /INTAKE\.md/]);
  assert.deepEqual(readdirSync(dir), ['assignment.txt']);
});

test('dry run: a dry run still refuses an unknown command', async () => {
  const root = paperMidway();
  const home = mkdtempSync(join(tmpdir(), 'pensmith-dry-run-home-'));
  const listener = await countingListener();
  try {
    const r = await runCli(['wrtie', '1', '--dry-run'], root, home, listener.url);
    assert.equal(r.status, 2, r.stderr);
  } finally {
    await listener.close();
  }
});

test('dry run: atomic writes refuse outside a .dry-run folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-dry-run-write-'));
  const prev = process.env['PENSMITH_DRY_RUN'];
  process.env['PENSMITH_DRY_RUN'] = '1';
  try {
    await assert.rejects(atomicWriteFile(join(dir, '.paper', 'DRAFT.md'), 'x'), DryRunWriteError);
    await assert.rejects(atomicAppendFile(join(dir, '.paper', 'SESSION.log'), 'x\n'), DryRunWriteError);
    writeFileSync(join(dir, 'a.md'), 'a');
    await assert.rejects(atomicRename(join(dir, 'a.md'), join(dir, 'b.md')), DryRunWriteError);
    assert.deepEqual(readdirSync(dir), ['a.md'], 'nothing may be created, appended or renamed');
    // The scratch overlay is the one place a dry run may write.
    await atomicWriteFile(join(dir, '.paper', '.dry-run', 'PLAN.md'), 'scratch');
    assert.equal(readFileSync(join(dir, '.paper', '.dry-run', 'PLAN.md'), 'utf8'), 'scratch');
  } finally {
    if (prev === undefined) delete process.env['PENSMITH_DRY_RUN'];
    else process.env['PENSMITH_DRY_RUN'] = prev;
  }
});
