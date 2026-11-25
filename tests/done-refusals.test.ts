// tests/done-refusals.test.ts — done refuses a humanized FINAL.md it cannot vouch for.
//
// When a humanizer runs, done exports FINAL.md instead of the compiled draft.
// Two checks stand between that text and the export: placeholder text from
// PENSMITH_NO_LLM is not a paper, and the humanized text must cite exactly the
// keys the verified draft cites (GATE-04). Both refuse with exit 2 and export
// nothing, --yolo included. The humanizer is injected through the exporter's
// test runner seam, so done runs in this process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doneCommand } from '../bin/cli/done.js';
import { __setTaskRunnerForTest } from '../bin/lib/exporter.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { noLlmPlaceholderText } from '../bin/lib/placeholder.js';

const DRAFT = 'Tidal barrages change estuary sediment over decades [@real2020].\n';

/** A compiled paper whose one section is verified against its current draft. */
function compiledPaper(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-done-refusals-'));
  const pdir = join(root, '.paper');
  const sdir = join(pdir, 'sections', '01-intro');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'done-refusals', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }),
  );
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    '| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | real2020 |\n',
  );
  writeFileSync(join(pdir, 'CITATIONS.bib'), '@article{real2020, title={Real}, author={Doe, Jane}, year={2020}}\n');
  writeFileSync(join(sdir, 'DRAFT.md'), DRAFT);
  writeFileSync(
    join(sdir, 'PLAN.md'),
    `---\nsection: 1\nslug: intro\nstatus: verified\nassigned_sources: [real2020]\nverified_against_draft_hash: ${computeDraftHash(Buffer.from(DRAFT), ['real2020'])}\n---\n`,
  );
  writeFileSync(join(sdir, 'VERIFICATION.md'), 'Status: verified\n\n## Pass-1\n\n- real2020: **OK** — titleJW=1.00, authorJW=1.00 — ok\n\n## Pass-3\n');
  writeFileSync(join(pdir, 'DRAFT.md'), `# Intro\n\n${DRAFT}`);
  return root;
}

interface DoneRun { exitCode: number | undefined; stdout: string }

/** Run `done --yolo --format md` in `root` with `humanized` as the humanizer's output. */
async function runDoneWithHumanizer(root: string, humanized: string): Promise<DoneRun> {
  const prevCwd = process.cwd();
  const saved = { NO_LLM: process.env['PENSMITH_NO_LLM'], OFFLINE: process.env['PENSMITH_OFFLINE'] };
  const prevExit = process.exitCode;
  const realWrite = process.stdout.write.bind(process.stdout);
  let stdout = '';
  process.chdir(root);
  process.env['PENSMITH_NO_LLM'] = '1';
  process.env['PENSMITH_OFFLINE'] = '1';
  process.exitCode = undefined;
  __setTaskRunnerForTest(() => Promise.resolve({ output: humanized }));
  // Copy what done prints, and still pass every write on: the test reporter
  // writes to this stream too.
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return (realWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    const run = doneCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await run({ args: { yolo: true, raw: false, format: 'md' } });
    return { exitCode: process.exitCode as number | undefined, stdout };
  } finally {
    process.stdout.write = realWrite;
    __setTaskRunnerForTest(null);
    // done sets the exit code of this test process; put it back.
    process.exitCode = prevExit;
    process.chdir(prevCwd);
    if (saved.NO_LLM === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = saved.NO_LLM;
    if (saved.OFFLINE === undefined) delete process.env['PENSMITH_OFFLINE'];
    else process.env['PENSMITH_OFFLINE'] = saved.OFFLINE;
  }
}

test('done: a humanized FINAL.md that is placeholder text is refused with exit 2, --yolo included', async () => {
  const root = compiledPaper();
  const r = await runDoneWithHumanizer(root, noLlmPlaceholderText('Humanize the paper'));
  assert.equal(r.exitCode, 2, r.stdout);
  assert.match(r.stdout, /BLOCKED — the humanized FINAL\.md is placeholder text/);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing may be exported');
});

test('done: a humanized FINAL.md that changes the cited keys is refused with exit 2, --yolo included', async () => {
  const root = compiledPaper();
  const r = await runDoneWithHumanizer(root, '# Intro\n\nTidal barrages reshape estuaries [@ghost2021].\n');
  assert.equal(r.exitCode, 2, r.stdout);
  assert.match(r.stdout, /GATE-04 BLOCKED .*citekey-set mismatch/);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing may be exported');
});

test('done: a humanized FINAL.md with the same cited keys exports', async () => {
  // The guard for the two refusals above: the seam and fixture can export.
  const root = compiledPaper();
  const r = await runDoneWithHumanizer(root, '# Intro\n\nOver decades, tidal barrages change estuary sediment [@real2020].\n');
  assert.equal(r.exitCode, undefined, r.stdout);
  assert.match(r.stdout, /pensmith done: exported /);
  assert.ok(existsSync(join(root, '.paper', 'export')), 'the paper is exported');
});
