// tests/final-bound-to-export.test.ts — FINAL.md marks an export that happened.
//
// FINAL.md is the router's "this paper was exported" mark. The humanizer
// wrote it before the export gate ran, so a refused, cancelled or failed
// export still left it, and the router reported the paper done although
// nothing was exported. compile never touched it, so after a section was
// redone and the paper compiled again, an old FINAL.md still read as done.
// And the humanized text was checked against the sources only where a
// source's text could be read: a changed quotation from a paywalled source
// was exported unblocked.
//
// Now the humanized text is kept under a staging name until the export
// succeeds; FINAL.md and .paper/EXPORT.json are written only then; compile
// moves an earlier FINAL.md aside; and a humanized text whose citations or
// quotations are not the compiled draft's, span for span, is refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doneCommand } from '../bin/cli/done.js';
import { __setTaskRunnerForTest } from '../bin/lib/exporter.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';
import { runCompile } from '../bin/lib/compile.js';
import { readCompileManifest } from '../bin/lib/compile-manifest.js';
import { sha256 } from '../bin/lib/verify/verification-record.js';
import { writeCompileManifestFixture, writeVerificationFixture } from './lib/verification-fixture.js';
import { noLlmPlaceholderText } from '../bin/lib/placeholder.js';

const QUOTE = 'tidal barrages change estuary sediment over many decades of operation';
const DRAFT = `As Doe put it, "${QUOTE}" [@real2020, p. 4].\n`;

/** A compiled paper whose one section quotes a work whose text cannot be read. */
async function compiledPaper(draft = DRAFT): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-final-bound-'));
  const pdir = join(root, '.paper');
  const sdir = join(pdir, 'sections', '01-intro');
  mkdirSync(sdir, { recursive: true });
  writeFileSync(
    join(root, 'STATE.json'),
    JSON.stringify({ $schemaVersion: 2, paperId: 'final-bound', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }),
  );
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    '| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | real2020 |\n',
  );
  writeFileSync(join(pdir, 'CITATIONS.bib'), '@article{real2020, title={Real}, author={Doe, Jane}, year={2020}, doi={10.1000/real}}\n');
  writeFileSync(join(sdir, 'DRAFT.md'), draft);
  writeFileSync(
    join(sdir, 'PLAN.md'),
    `---\nsection: 1\nslug: intro\nstatus: unverifiable\nassigned_sources: [real2020]\nverified_against_draft_hash: ${computeDraftHash(Buffer.from(draft), ['real2020'])}\n---\n`,
  );
  writeVerificationFixture(sdir, {
    n: 1, slug: 'intro', draft, assignedSources: ['real2020'],
    quotes: draft.includes(QUOTE) ? [{ citekey: 'real2020', quote: QUOTE, verdict: 'PDF_UNAVAILABLE' }] : [],
    status: draft.includes(QUOTE) ? 'unverifiable' : 'verified',
  });
  writeFileSync(join(pdir, 'DRAFT.md'), `# Intro\n\n${draft}`);
  await writeCompileManifestFixture(root, [{ n: 1, slug: 'intro' }]);
  return root;
}

interface DoneRun { exitCode: number | undefined; stdout: string }

/** Run `done --yolo --format md` in `root`, with `humanized` as the humanizer's output when given. */
async function runDone(root: string, humanized?: string): Promise<DoneRun> {
  const prevCwd = process.cwd();
  const saved = { NO_LLM: process.env['PENSMITH_NO_LLM'], OFFLINE: process.env['PENSMITH_OFFLINE'] };
  const prevExit = process.exitCode;
  const realWrite = process.stdout.write.bind(process.stdout);
  let stdout = '';
  process.chdir(root);
  process.env['PENSMITH_NO_LLM'] = '1';
  delete process.env['PENSMITH_OFFLINE'];
  process.exitCode = undefined;
  if (humanized !== undefined) __setTaskRunnerForTest(() => Promise.resolve({ output: humanized }));
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    stdout += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return (realWrite as (c: string | Uint8Array, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    const run = doneCommand.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>;
    await run({ args: { yolo: true, raw: humanized === undefined, format: 'md' } });
    return { exitCode: process.exitCode as number | undefined, stdout };
  } finally {
    process.stdout.write = realWrite;
    __setTaskRunnerForTest(null);
    process.exitCode = prevExit;
    process.chdir(prevCwd);
    if (saved.NO_LLM === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = saved.NO_LLM;
    if (saved.OFFLINE === undefined) delete process.env['PENSMITH_OFFLINE'];
    else process.env['PENSMITH_OFFLINE'] = saved.OFFLINE;
  }
}

const final = (root: string): string => join(root, '.paper', 'FINAL.md');

test('done: a humanized text that is refused leaves no FINAL.md, so the paper is not marked done', async () => {
  const root = await compiledPaper();
  const r = await runDone(root, noLlmPlaceholderText('Humanize the paper'));
  assert.equal(r.exitCode, 2, r.stdout);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'nothing may be exported');
  assert.ok(!existsSync(final(root)), 'FINAL.md must not exist after a refused export');
  assert.ok(!existsSync(join(root, '.paper', 'EXPORT.json')), 'no export is recorded');
});

test('done: a humanized quotation with one word changed is refused even though its source text cannot be read', async () => {
  const root = await compiledPaper();
  const changed = `As Doe put it, "${QUOTE.replace('many', 'several')}" [@real2020, p. 4].\n`;
  const r = await runDone(root, `# Intro\n\n${changed}`);
  assert.equal(r.exitCode, 2, r.stdout);
  assert.match(r.stdout, /quotation .*not word for word in \.paper\/DRAFT\.md|not in \.paper\/DRAFT\.md/i);
  assert.ok(!existsSync(join(root, '.paper', 'export')), 'the changed quotation must not be exported');
  assert.ok(!existsSync(final(root)));
});

test('done: a humanized citation whose locator changed is refused', async () => {
  const root = await compiledPaper();
  const r = await runDone(root, `# Intro\n\nAs Doe put it, "${QUOTE}" [@real2020, p. 9].\n`);
  assert.equal(r.exitCode, 2, r.stdout);
  assert.match(r.stdout, /\[@real2020, p\. 9\]/);
  assert.ok(!existsSync(join(root, '.paper', 'export')));
});

test('done: a humanized text that keeps every citation and quotation exports, and only then becomes FINAL.md', async () => {
  const root = await compiledPaper();
  const humanized = `# Intro\n\nDoe was blunt: "${QUOTE}" [@real2020, p. 4].\n`;
  const r = await runDone(root, humanized);
  assert.equal(r.exitCode, undefined, r.stdout);
  assert.match(r.stdout, /pensmith done: exported /);
  assert.equal(readFileSync(final(root), 'utf8'), humanized, 'FINAL.md is the exported humanized text');
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.staged.md')), 'the staged text is gone once it is FINAL.md');
  const record = JSON.parse(readFileSync(join(root, '.paper', 'EXPORT.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(record['draft_sha256'], sha256(readFileSync(join(root, '.paper', 'DRAFT.md'))));
  assert.equal(record['final_sha256'], sha256(Buffer.from(humanized, 'utf8')));
});

test('done without a humanizer: FINAL.md is the exported draft, recorded in EXPORT.json, even over an older FINAL.md', async () => {
  const root = await compiledPaper();
  writeFileSync(final(root), 'an older export\n');
  const r = await runDone(root);
  assert.equal(r.exitCode, undefined, r.stdout);
  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
  assert.equal(readFileSync(final(root), 'utf8'), draft);
  const record = JSON.parse(readFileSync(join(root, '.paper', 'EXPORT.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(record['final_sha256'], sha256(Buffer.from(draft, 'utf8')));
});

test('compile moves an earlier FINAL.md aside and records the bibliography it read', async () => {
  const root = await compiledPaper('Tidal barrages change estuary sediment over decades [@real2020].\n');
  writeFileSync(final(root), 'exported before the section was redone\n');
  writeFileSync(join(root, '.paper', 'FINAL.staged.md'), 'humanized from the old draft\n');
  const result = await runCompile({ paperRoot: root, onWarn: () => {} });
  assert.equal(result.refused, false, JSON.stringify(result.refuseReasons));
  assert.ok(!existsSync(final(root)), 'an earlier FINAL.md no longer marks the paper done');
  assert.equal(readFileSync(join(root, '.paper', 'FINAL.stale.md'), 'utf8'), 'exported before the section was redone\n');
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.staged.md')), 'text humanized from the old draft is dropped');
  const manifest = readCompileManifest(root);
  assert.ok(manifest.ok);
  assert.equal(manifest.manifest.bib_sha256, sha256(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8')));
});
