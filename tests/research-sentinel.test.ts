// tests/research-sentinel.test.ts — audit M1 regression.
//
// The research verb writes LIBRARY.json (+ CITATIONS.bib), its canonical output
// per workflows/research.md §Outputs — NOT RESEARCH.md. But the router and the
// list/status deriver gated "research done" on RESEARCH.md, so bare `pensmith`/
// next/resume looped on `research` after a real research run, and `pensmith list`
// mislabelled every post-research paper as 'intake'. The sentinel now accepts
// LIBRARY.json OR the legacy RESEARCH.md.
//
// Phase 19 (D-19-16, bin/lib/research-sentinel.ts): a research run that finds
// nothing usable writes its log to RESEARCH.md and leaves LIBRARY.json
// untouched, so when RESEARCH.md is a FAILED run's log, research is done only
// if LIBRARY.json holds an entry (or the paper is already outlined).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initState } from '../bin/lib/state.js';
import { resolveNextAction } from '../bin/lib/router.js';
import { deriveLibraryStatus } from '../bin/lib/global-library.js';
import { isResearchDone, isFailedResearchLog } from '../bin/lib/research-sentinel.js';

async function seed(files: Record<string, string>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-sentinel-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  await initState(root);
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(root, '.paper', name), body);
  }
  return root;
}

test('router (M1): LIBRARY.json present (no RESEARCH.md) advances PAST research', async () => {
  const root = await seed({ 'LIBRARY.json': '{"$schemaVersion":1,"entries":[]}\n' });
  const decision = await resolveNextAction(root);
  assert.notEqual(decision.verb, 'research', 'LIBRARY.json must satisfy the research-done sentinel');
  assert.equal(decision.verb, 'outline', `expected outline next; got ${JSON.stringify(decision)}`);
});

test('router (M1): with neither LIBRARY.json nor RESEARCH.md, next is research', async () => {
  const root = await seed({});
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'research');
});

test('router (M1): legacy RESEARCH.md still satisfies the sentinel', async () => {
  const root = await seed({ 'RESEARCH.md': '# Research\n' });
  const decision = await resolveNextAction(root);
  assert.notEqual(decision.verb, 'research');
});

test('deriveLibraryStatus (M1): LIBRARY.json (no OUTLINE.md) derives "research", not "intake"', async () => {
  const root = await seed({ 'LIBRARY.json': '{"$schemaVersion":1,"entries":[]}\n' });
  assert.equal(deriveLibraryStatus(root).status, 'research');
});

const ONE_ENTRY = '{"$schemaVersion":3,"entries":[{"citekey":"lecun2015","title":"Deep learning"}]}\n';

function failedLog(result: string): string {
  return `# Research log\n\nScope: x — y\nTopic: t\nDiscipline: d\nGenerated: 2026-09-28T00:00:00.000Z\nResult: ${result}\n\n## Queries\n\n1. q\n`;
}

test('router (D-19-16): a failed research run (its log in RESEARCH.md, no LIBRARY.json) routes back to research', async () => {
  for (const result of [
    'no sources found',
    'no usable sources: all 12 candidate(s) excluded by the [sources] policy',
    'no relevant sources',
    'no sources kept',
  ]) {
    const root = await seed({ 'RESEARCH.md': failedLog(result) });
    assert.ok(isFailedResearchLog(failedLog(result)));
    assert.equal((await resolveNextAction(root)).verb, 'research', result);
    assert.equal(deriveLibraryStatus(root).status, 'intake', result);
    assert.equal(isResearchDone(join(root, '.paper')), false, result);
  }
});

test('router (D-19-16): an empty LIBRARY.json beside a failed log is not a library — research again; alone it keeps the Phase 17 rule', async () => {
  const empty = '{"$schemaVersion":3,"entries":[]}\n';
  assert.equal((await resolveNextAction(await seed({ 'LIBRARY.json': empty, 'RESEARCH.md': failedLog('no relevant sources') }))).verb, 'research');
  // an empty library alone (a Phase 17 zero-result run) or beside a successful log still counts
  assert.equal((await resolveNextAction(await seed({ 'LIBRARY.json': empty }))).verb, 'outline');
  assert.equal((await resolveNextAction(await seed({ 'LIBRARY.json': empty, 'RESEARCH.md': failedLog('3 kept (peer-reviewed 3)') }))).verb, 'outline');
  // a paper already outlined is past research even when a later research run failed
  assert.notEqual((await resolveNextAction(await seed({ 'RESEARCH.md': failedLog('no sources found'), 'OUTLINE.md': '| # | slug |\n' }))).verb, 'research');
});

test('router (D-19-16): a library (from an earlier run, add or bring-your-own) wins over a later failed log; an unreadable LIBRARY.json is left to the next verb', async () => {
  assert.equal((await resolveNextAction(await seed({ 'LIBRARY.json': ONE_ENTRY, 'RESEARCH.md': failedLog('no sources found') }))).verb, 'outline');
  assert.equal((await resolveNextAction(await seed({ 'LIBRARY.json': '{not json', 'RESEARCH.md': failedLog('no sources found') }))).verb, 'outline');
  assert.equal(isFailedResearchLog('# Notes\nResult: no sources found\n'), false, 'only a research log counts as failed');
  assert.equal(isFailedResearchLog(failedLog('no sources found').replace(/\n/g, '\r\n')), true, 'CRLF');
});
