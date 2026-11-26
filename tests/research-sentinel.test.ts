// tests/research-sentinel.test.ts — audit M1 regression.
//
// The research verb writes LIBRARY.json (+ CITATIONS.bib), its canonical output
// per workflows/research.md §Outputs — NOT RESEARCH.md. But the router and the
// list/status deriver gated "research done" on RESEARCH.md, so bare `pensmith`/
// next/resume looped on `research` after a real research run, and `pensmith list`
// mislabelled every post-research paper as 'intake'. The sentinel now accepts
// a research run recorded in LIBRARY.json OR the legacy RESEARCH.md.
//
// `pensmith add` writes LIBRARY.json as well, so the file being there says
// nothing: a key paper added right after intake made the router skip research
// and outline the paper on that one source. Research records its run in the
// library (`researched_at`), a run that found nothing included; a v1 library
// was written only by research.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initState } from '../bin/lib/state.js';
import { resolveNextAction } from '../bin/lib/router.js';
import { deriveLibraryStatus } from '../bin/lib/global-library.js';
import { cli } from './lib/export-fixture.js';

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

test('router: a source added with `pensmith add` before research does not count as research', async () => {
  const root = await seed({ 'INTAKE.md': '# Intake\n\nTopic: measurement in quantum optomechanics\n' });
  assert.equal((await resolveNextAction(root)).verb, 'research');
  const r = cli(root, ['add', '10.1038/nphys1170', '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(join(root, '.paper', 'LIBRARY.json')), 'add writes the library');
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'research', `research has not run; got ${JSON.stringify(decision)}`);
  assert.equal(deriveLibraryStatus(root).status, 'intake');
});

test('router: a research run that finds nothing counts as research, and a later add keeps it so', async () => {
  // No recorded registry answers this topic, so every source returns nothing.
  const root = await seed({ 'INTAKE.md': '# Intake\n\nTopic: a topic no recorded registry answers\nDiscipline: other\n' });
  const run = cli(root, ['research', '--yolo']);
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /0 new/, run.out);
  assert.equal((await resolveNextAction(root)).verb, 'outline');
  const r = cli(root, ['add', '10.1038/nphys1170', '--yolo']);
  assert.equal(r.status, 0, r.out);
  assert.equal((await resolveNextAction(root)).verb, 'outline');
  assert.equal(deriveLibraryStatus(root).status, 'research');
});

test('router: a v1 library research wrote still counts as research after a later add upgrades it to v2', async () => {
  // A v0.2.0 research run wrote a v1 LIBRARY.json, which carries no run
  // marker. The first write through the library migrates it to v2, which must
  // record that research ran, or the router sends the user back to research.
  const v1 = {
    $schemaVersion: 1,
    entries: [{
      source: 'arxiv', id: '1706.03762', doi: '10.48550/arXiv.1706.03762', title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani'], year: 2017, citekey: 'vaswani2017', retracted: false, last_verified: '2025-01-01T00:00:00.000Z',
    }],
  };
  const root = await seed({
    'INTAKE.md': '# Intake\n\nTopic: measurement in quantum optomechanics\n',
    'LIBRARY.json': `${JSON.stringify(v1)}\n`,
  });
  assert.equal((await resolveNextAction(root)).verb, 'outline');
  const r = cli(root, ['add', '10.1038/nphys1170', '--yolo']);
  assert.equal(r.status, 0, r.out);
  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(lib['$schemaVersion'], 2, 'add upgraded the library');
  assert.equal(typeof lib['researched_at'], 'string', 'the migration recorded that research ran');
  const decision = await resolveNextAction(root);
  assert.equal(decision.verb, 'outline', `research ran before the upgrade; got ${JSON.stringify(decision)}`);
  assert.equal(deriveLibraryStatus(root).status, 'research');
});

test('router: a LIBRARY.json that cannot be read is surfaced, not taken for research done', async () => {
  const root = await seed({ 'LIBRARY.json': '{"$schemaVersion":2,"entries":[' });
  const decision = await resolveNextAction(root);
  assert.deepEqual(decision, { verb: 'status', reason: 'attention' });
});
