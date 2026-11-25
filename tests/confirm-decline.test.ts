// tests/confirm-decline.test.ts — a yes/no prompt that gets no clear answer means no.
//
// The numbered yes/no prompt gives up after three answers that are not y or n,
// and at the end of input, by throwing. done counted that as "no", but add's
// remap question, sketch's proceed question and the GPTZero consent question
// let it escape, so a stray answer crashed the verb with a stack trace (exit 1)
// after add had already saved the source. Each now treats it as a decline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confirmOrNo } from '../bin/lib/prompts.js';
import { sketchCommand } from '../bin/cli/sketch.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { writeCompileManifestFixture, writeVerificationFixture } from './lib/verification-fixture.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');
// stdin, stdout and stderr report a terminal; stdin is the pipe the test writes to.
const FAKE_TERMINAL =
  'data:text/javascript,process.stdin.isTTY=true;process.stdout.isTTY=true;process.stderr.isTTY=true;';

interface RunResult { status: number | null; stdout: string; stderr: string }

function runCli(
  args: string[],
  cwd: string,
  input: string,
  opts: { terminal?: boolean; env?: Record<string, string> } = {},
): RunResult {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-confirm-home-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  delete env['ANTHROPIC_API_KEY'];
  delete env['GPTZERO_API_KEY'];
  delete env['PENSMITH_OFFLINE'];
  env['PENSMITH_NO_LLM'] = '1';
  env['PENSMITH_TEST_CASSETTES'] = '1';
  env['PENSMITH_PROMPT_MODE'] = 'numbered';
  Object.assign(env, opts.env ?? {});
  const preload = opts.terminal === true ? ['--import', FAKE_TERMINAL] : [];
  const r = spawnSync(process.execPath, [...preload, '--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    input,
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function assertNoCrash(r: RunResult, what: string): void {
  assert.doesNotMatch(r.stderr, /PromptAbortedError|PromptTimeoutError|\n\s+at /, `${what} crashed: ${r.stderr}`);
}

test('confirmOrNo: unclear answers, end of input and a timeout all mean no', async () => {
  const sink = new PassThrough();
  sink.resume();
  const q = { id: 'c', kind: 'confirm', label: 'Proceed?', default: true } as const;
  const lines = (text: string): PassThrough => {
    const s = new PassThrough();
    queueMicrotask(() => s.end(text));
    return s;
  };
  assert.equal(await confirmOrNo(q, { mode: 'numbered', stdin: lines('nope\n'), stderr: sink, timeoutMs: 2000 }), false);
  assert.equal(await confirmOrNo(q, { mode: 'numbered', stdin: lines(''), stderr: sink, timeoutMs: 2000 }), false);
  assert.equal(await confirmOrNo(q, { mode: 'numbered', stdin: new PassThrough(), stderr: sink, timeoutMs: 50 }), false);
  assert.equal(await confirmOrNo(q, { mode: 'numbered', stdin: lines('y\n'), stderr: sink, timeoutMs: 2000 }), true);
});

test('add: an unclear answer to the remap question keeps the source and skips the remap', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-confirm-add-'));
  mkdirSync(join(root, '.paper'));
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'confirm-add', createdAt: new Date().toISOString(), sections: [] }),
  );
  const r = runCli(['add', '10.1038/nphys1170'], root, 'maybe\n');
  assertNoCrash(r, 'add');
  assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'), /10\.1038\/nphys1170/i, 'the source is still added');
});

test('sketch: an unclear answer to the proceed question cancels and creates nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-confirm-sketch-'));
  const prevCwd = process.cwd();
  const prevMode = process.env['PENSMITH_PROMPT_MODE'];
  const realStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  const stdin = new PassThrough();
  const realWrite = process.stdout.write.bind(process.stdout);
  let stdout = '';
  let dispatched = false;
  process.chdir(dir);
  process.env['PENSMITH_PROMPT_MODE'] = 'numbered';
  // The numbered prompt reads process.stdin; give it the answer.
  Object.defineProperty(process, 'stdin', { configurable: true, get: () => stdin });
  queueMicrotask(() => stdin.end('maybe\n'));
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return (realWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    const run = sketchCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    const result = await run({
      args: {
        thesis: 'Tidal barrages reshape estuaries',
        yolo: false,
        __dispatch: () => {
          dispatched = true;
          return Promise.resolve();
        },
      },
    });
    assert.deepEqual(result, { ok: false });
  } finally {
    process.stdout.write = realWrite;
    if (realStdin) Object.defineProperty(process, 'stdin', realStdin);
    process.chdir(prevCwd);
    if (prevMode === undefined) delete process.env['PENSMITH_PROMPT_MODE'];
    else process.env['PENSMITH_PROMPT_MODE'] = prevMode;
  }
  assert.match(stdout, /pensmith sketch: cancelled/);
  assert.equal(dispatched, false, 'a declined sketch must not start a paper');
  assert.deepEqual(readdirSync(dir), [], 'a declined sketch writes nothing');
});

test('done at a terminal: an unclear answer to the GPTZero consent question declines it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-confirm-done-'));
  const pdir = join(root, '.paper');
  const sdir = join(pdir, 'sections', '01-intro');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'confirm-done', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }),
  );
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    '| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | |\n',
  );
  writeFileSync(join(pdir, 'CITATIONS.bib'), '');
  const draft = 'Tidal barrages change estuary sediment over decades.\n';
  writeFileSync(join(sdir, 'DRAFT.md'), draft);
  writeFileSync(
    join(sdir, 'PLAN.md'),
    `---\nsection: 1\nslug: intro\nstatus: verified\nassigned_sources: []\nverified_against_draft_hash: ${computeDraftHash(Buffer.from(draft), [])}\n---\n`,
  );
  writeVerificationFixture(sdir, { n: 1, slug: 'intro', draft });
  writeFileSync(join(pdir, 'DRAFT.md'), `# Intro\n\n${draft}`);
  await writeCompileManifestFixture(root, [{ n: 1, slug: 'intro' }]);

  // The consent question comes first. The input ends before the export
  // question, which then gets no answer in time.
  const r = runCli(['done', '--format', 'md', '--raw'], root, 'maybe\n', {
    terminal: true,
    env: { GPTZERO_API_KEY: 'fake-gptzero-confirm-test', PENSMITH_PROMPT_TIMEOUT_MS: '1500' },
  });
  assertNoCrash(r, 'done');
  assert.match(r.stderr, /Send paper text to GPTZero/, `the consent question must be asked; stderr=${r.stderr}`);
  assert.match(r.stdout, /GPTZero honesty scoring declined/, r.stdout);
  assert.match(r.stdout, /export cancelled by user/, 'with no answer to the export question, nothing is exported');
  assert.equal(r.status, 2);
  assert.ok(!existsSync(join(pdir, 'export')));
});
