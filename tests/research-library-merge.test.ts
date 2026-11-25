// tests/research-library-merge.test.ts — research merges into the library.
//
// research wrote LIBRARY.json and CITATIONS.bib afresh on every run, giving
// each citekey to whichever same-author-same-year work the sources returned
// first. A second run whose results came back in another order gave `wu2017`
// to a different paper, so a draft's [@wu2017] silently named another work
// (and Pass 1, comparing the entry with its own DOI, still said OK); and a
// source added with `pensmith add` between runs was deleted. Every case runs
// the real CLI on recorded registry answers (synthetic works under the
// 10.0000 test prefix, tests/fixtures/cassettes/crossref/synthetic-research-rerun.json),
// with no model: the topic is the search query.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli } from './lib/export-fixture.js';
import { parseBibForPass1 } from '../bin/lib/verify/pass1.js';

function project(topic: string, discipline = 'other'): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-research-merge-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeIntake(root, topic, discipline);
  return root;
}

function writeIntake(root: string, topic: string, discipline = 'other'): void {
  writeFileSync(join(root, '.paper', 'INTAKE.md'), `# Intake\n\nTopic: ${topic}\nDiscipline: ${discipline}\n`);
}

/** The DOI each citekey of CITATIONS.bib names. */
async function keysToDois(root: string): Promise<Record<string, string>> {
  const bib = await parseBibForPass1(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'));
  return Object.fromEntries([...bib.entries].map(([k, e]) => [k, String(e.DOI ?? '').toLowerCase()]));
}

test('a second research run keeps every citekey on the work it named, and keeps a source added by hand', async () => {
  const root = project('citekey stability first run');
  const first = cli(root, ['research', '--yolo']);
  assert.equal(first.status, 0, first.out);
  const before = await keysToDois(root);
  assert.equal(before['wu2017'], '10.0000/rerun-a', JSON.stringify(before));

  const added = cli(root, ['add', '10.1109/MCSE.2011.37', '--yolo']);
  assert.equal(added.status, 0, added.out);

  // The second run's results come back in another order: work B first, then A.
  writeIntake(root, 'citekey stability second run');
  const second = cli(root, ['research', '--yolo']);
  assert.equal(second.status, 0, second.out);
  const after = await keysToDois(root);

  for (const [key, doi] of Object.entries(before)) {
    assert.equal(after[key], doi, `[@${key}] must still name ${doi}; the bibliography now maps it to ${after[key]}`);
  }
  assert.equal(after['wu2017a'], '10.0000/rerun-b', 'the new work gets a key no work has had');
  assert.ok(Object.values(after).includes('10.1109/mcse.2011.37'), 'the source added with `pensmith add` is still in the bibliography');

  const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { $schemaVersion: number; entries: Array<{ id: string; DOI?: string }> };
  assert.equal(lib.$schemaVersion, 2);
  assert.deepEqual(
    lib.entries.map((e) => `${e.id}=${e.DOI}`).sort(),
    Object.entries(after).map(([k, d]) => `${k}=${d}`).sort(),
    'LIBRARY.json and CITATIONS.bib hold the same works under the same keys',
  );
  assert.match(second.out, /1 new, 1 already in the library/, second.out);
});

test('research marks a work its own record shows as retracted before it reaches the bibliography', async () => {
  const root = project('citekey stability first run');
  const r = cli(root, ['research', '--yolo']);
  assert.equal(r.status, 0, r.out);
  const bib = await parseBibForPass1(readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8'));
  const retracted = [...bib.entries].filter(([, e]) => e.note === 'RETRACTED').map(([, e]) => String(e.DOI));
  assert.deepEqual(retracted, ['10.0000/rerun-c']);
});

test('the discipline\'s source preference decides whose record of a work the library keeps', () => {
  // Crossref, OpenAlex and Semantic Scholar all return "Attention Is All You
  // Need" for this search. computer-science prefers Semantic Scholar to
  // OpenAlex and lists no Crossref; other prefers Crossref.
  const keptFrom = (discipline: string): string[] => {
    const root = project('attention mechanisms', discipline);
    const r = cli(root, ['research', '--yolo']);
    assert.equal(r.status, 0, r.out);
    const lib = JSON.parse(readFileSync(join(root, '.paper', 'LIBRARY.json'), 'utf8')) as {
      entries: Array<{ id: string; custom: { provenance: Array<{ source: string }> } }>;
    };
    const item = lib.entries.find((e) => e.id === 'vaswani2017');
    assert.ok(item, JSON.stringify(lib.entries.map((e) => e.id)));
    return item.custom.provenance.map((p) => p.source);
  };
  assert.deepEqual(keptFrom('computer-science'), ['semanticscholar', 'openalex', 'crossref']);
  assert.deepEqual(keptFrom('other'), ['crossref', 'openalex', 'semanticscholar']);
});
