// tests/export-confirm.test.ts — the export confirmation must fail closed.
//
// The approver asked a yes/no question that defaulted to yes, and the stdin
// prompt mapped any answer it did not recognise ('nope', 'cancel') to that
// default, so the paper exported. With no terminal (Claude Code's Bash tool,
// CI) a closed stdin crashed done with a stack trace instead. Now: the question
// defaults to no, only y/yes/n/no count, and with no terminal done exits 3 with
// a JSON description of the pending decision and exports nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askNumbered } from '../bin/lib/prompts/numbered.js';
import { PromptAbortedError } from '../bin/lib/prompts.js';
import { EXPORT_CONFIRM_QUESTION } from '../bin/cli/done.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

function stdinWith(lines: string[]): PassThrough {
  const s = new PassThrough({ allowHalfOpen: true });
  queueMicrotask(() => {
    for (const line of lines) s.write(`${line}\n`);
  });
  return s;
}

function sink(): PassThrough {
  const s = new PassThrough();
  s.resume();
  return s;
}

test('confirm prompt: an unrecognised answer never counts as yes, even when yes is the default', async () => {
  await assert.rejects(
    askNumbered(
      { id: 'c', kind: 'confirm', label: 'Proceed?', default: true },
      { stdin: stdinWith(['nope', 'cancel', 'whatever']), stderr: sink(), timeoutMs: 2000 },
    ),
    (err: unknown) => err instanceof PromptAbortedError,
  );
});

test('confirm prompt: an unrecognised answer asks again', async () => {
  const ans = await askNumbered(
    { id: 'c', kind: 'confirm', label: 'Proceed?', default: false },
    { stdin: stdinWith(['nope', 'y']), stderr: sink(), timeoutMs: 2000 },
  );
  assert.deepEqual(ans, { id: 'c', kind: 'confirm', value: true });
});

test('export confirmation: the question defaults to no, so an empty answer does not export', async () => {
  assert.equal(EXPORT_CONFIRM_QUESTION.kind, 'confirm');
  assert.equal(EXPORT_CONFIRM_QUESTION.default, false);
  const ans = await askNumbered(EXPORT_CONFIRM_QUESTION, { stdin: stdinWith(['']), stderr: sink(), timeoutMs: 2000 });
  assert.equal(ans.kind === 'confirm' && ans.value, false);
});

// A compiled paper whose one section is verified against its current draft.
function cleanCompiledPaper(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-export-confirm-'));
  const pdir = join(root, '.paper');
  const sdir = join(pdir, 'sections', '01-intro');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'export-confirm', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }),
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
  writeFileSync(join(sdir, 'VERIFICATION.md'), 'Status: verified\n\n## Pass-1\n\n## Pass-3\n');
  writeFileSync(join(pdir, 'DRAFT.md'), `# Intro\n\n${draft}`);
  return root;
}

function runDone(root: string, input: string | undefined): { status: number | null; stdout: string; stderr: string } {
  const home = mkdtempSync(join(tmpdir(), 'pensmith-export-confirm-home-'));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'LOCALAPPDATA']) env[k] = home;
  delete env['ANTHROPIC_API_KEY'];
  delete env['GPTZERO_API_KEY'];
  env['PENSMITH_NO_LLM'] = '1';
  env['PENSMITH_OFFLINE'] = '1';
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, 'done', '--format', 'md'], {
    cwd: root,
    env,
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function lastJsonLine(stdout: string): Record<string, unknown> {
  const line = stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON line on stdout: ${stdout}`);
  return JSON.parse(line) as Record<string, unknown>;
}

test('done without a terminal: exits 3 with the pending decision and exports nothing', () => {
  const root = cleanCompiledPaper();
  const r = runDone(root, undefined);
  assert.equal(r.status, 3, `expected exit 3; stdout=${r.stdout} stderr=${r.stderr}`);
  const pending = lastJsonLine(r.stdout);
  assert.equal(pending['gate'], 'export');
  assert.equal(pending['needs_confirmation'], true);
  assert.deepEqual(pending['options'], ['export', 'cancel']);
  assert.equal(pending['default'], 'cancel');
  assert.ok(pending['issues'] && typeof pending['issues'] === 'object', 'the pending decision carries the advisory issues');
  assert.doesNotMatch(r.stdout + r.stderr, /--yolo/, 'the pending message must never suggest --yolo');
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing may be exported while the decision is pending');
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.md')), 'the paper must not be marked final');
});

test('done without a terminal: an answer piped on stdin is not read as a confirmation', () => {
  const root = cleanCompiledPaper();
  const r = runDone(root, 'nope\n');
  assert.equal(r.status, 3, `expected exit 3; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.ok(!existsSync(join(root, '.paper', 'export')), "a piped 'nope' must not export the paper");
});
