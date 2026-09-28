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

// ---------------------------------------------------------------------------
// Phase 19 review round 1: the user's own sources never end the research stage.
// ---------------------------------------------------------------------------

import { renderSourcesBlock, upsertSourcesBlock, SOURCES_START, SOURCES_END, RESEARCH_LOG_END } from '../bin/lib/research-md.js';
import { isSourcesViewOnly } from '../bin/lib/research-sentinel.js';

function lib(entries: Array<{ citekey: string; provenance: string[] }>): string {
  return `${JSON.stringify({ $schemaVersion: 3, entries: entries.map((e) => ({ ...e, title: 'T' })) })}\n`;
}

/** What `new --pdfs` / `add` / a Zotero ingest leave: the sources view only. */
function sourcesView(notes = ''): string {
  return upsertSourcesBlock(null, renderSourcesBlock([])) + notes;
}

test('SRC-15: after `new --pdfs` (bring-your-own entries, the sources view only) the next step is research, not outline', async () => {
  const root = await seed({ 'LIBRARY.json': lib([{ citekey: 'vaswani2017', provenance: ['byo:arxiv'] }]), 'RESEARCH.md': sourcesView() });
  assert.equal((await resolveNextAction(root)).verb, 'research');
  assert.equal(isResearchDone(join(root, '.paper')), false);
  assert.equal(deriveLibraryStatus(root).status, 'intake', 'list/status agree: not past research');
});

test('SRC-16 / SRC-13: Zotero-ingested or `add`-ed sources alone do not end research either (notes below the log end are the user\'s)', async () => {
  for (const provenance of [['zotero:zotero'], ['add:crossref'], ['byo:crossref', 'add:crossref', 'zotero:zotero']]) {
    const root = await seed({ 'LIBRARY.json': lib([{ citekey: 'k2020', provenance }]), 'RESEARCH.md': sourcesView('\nMy notes.\n') });
    assert.equal(isResearchDone(join(root, '.paper')), false, provenance.join(','));
  }
});

test('research done: a successful research log, a research-provenance entry, a curated RESEARCH.md, or an outline', async () => {
  const withRun = await seed({ 'RESEARCH.md': '# Research log\n\nResult: 12 peer-reviewed\n' });
  assert.equal(isResearchDone(join(withRun, '.paper')), true);
  const researched = await seed({ 'LIBRARY.json': lib([{ citekey: 'a2020', provenance: ['byo:arxiv'] }, { citekey: 'b2021', provenance: ['research:crossref'] }]), 'RESEARCH.md': sourcesView() });
  assert.equal(isResearchDone(join(researched, '.paper')), true);
  const planResearch = await seed({ 'LIBRARY.json': lib([{ citekey: 'c2022', provenance: ['plan-research:§2:crossref'] }]) });
  assert.equal(isResearchDone(join(planResearch, '.paper')), true);
  const curated = await seed({ 'RESEARCH.md': '# Research\n\n### Smith 2020\n\nsupports: claim 1\n' });
  assert.equal(isResearchDone(join(curated, '.paper')), true);
  const outlined = await seed({ 'LIBRARY.json': lib([{ citekey: 'v2017', provenance: ['byo:arxiv'] }]), 'RESEARCH.md': sourcesView(), 'OUTLINE.md': '# Outline\n' });
  assert.equal(isResearchDone(join(outlined, '.paper')), true);
});

test('research done: a FAILED run with the user\'s own sources in the library moves on (research ran; nothing more was found)', async () => {
  const root = await seed({
    'LIBRARY.json': lib([{ citekey: 'vaswani2017', provenance: ['byo:arxiv'] }]),
    'RESEARCH.md': '# Research log\n\nResult: no sources found — openalex 0 (offline)\n',
  });
  assert.equal(isResearchDone(join(root, '.paper')), true);
});

test('the sentinel\'s markers are research-md.ts\'s', () => {
  assert.ok(SOURCES_START.startsWith('<!-- pensmith:sources:start'));
  assert.equal(SOURCES_END, '<!-- pensmith:sources:end -->');
  assert.ok(RESEARCH_LOG_END.startsWith('<!-- end of the research log:'));
  assert.equal(isSourcesViewOnly(sourcesView()), true);
  assert.equal(isSourcesViewOnly(`${sourcesView()}\nnotes`), true, 'notes below the end line are the user\'s');
  assert.equal(isSourcesViewOnly('# Research\n\nMy own curated list.\n'), false);
});
