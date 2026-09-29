// tests/source-context-verifiable.test.ts — GRND-18: outline and plan are fed
// only the sources the citation verifier can check (source-context.ts
// verifierBlindSpot). Pass 1 re-fetches every cited source by its DOI through
// Crossref, so a source with no DOI or a DataCite DOI always fails verify.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DATACITE_DOI_PREFIXES, describeExcluded, partitionCheckable, verifierBlindSpot } from '../bin/lib/source-context.js';

test('GRND-18: verifierBlindSpot — no DOI, a DataCite DOI, or a synthetic source outside a dry run', () => {
  assert.equal(verifierBlindSpot({ doi: '10.18653/v1/N19-1423' }, false), null, 'a Crossref DOI is checkable');
  assert.equal(verifierBlindSpot({ doi: null }, false), 'no DOI');
  assert.equal(verifierBlindSpot({ doi: '  ' }, false), 'no DOI');
  assert.equal(verifierBlindSpot({}, false), 'no DOI');
  for (const prefix of DATACITE_DOI_PREFIXES) {
    assert.match(verifierBlindSpot({ doi: `${prefix}/x.1` }, false) ?? '', /DataCite DOI/, prefix);
  }
  assert.match(verifierBlindSpot({ doi: '10.48550/ARXIV.1706.03762' }, false) ?? '', /DataCite/, 'case-insensitive');
  assert.equal(verifierBlindSpot({ doi: '10.0000/pensmith-dryrun.a', synthetic: true }, true), null, 'a dry run checks its synthetic sources');
  assert.equal(verifierBlindSpot({ doi: '10.0000/pensmith-dryrun.a', synthetic: true }, false), 'a synthetic --dry-run source');
});

test('GRND-18: partitionCheckable keeps library order and names every excluded source', () => {
  const entries = [
    { citekey: 'a', doi: '10.1000/a' },
    { citekey: 'b', doi: null },
    { citekey: 'c', doi: '10.1000/c' },
    { citekey: 'd', doi: '10.5281/zenodo.1' },
  ];
  const { checkable, excluded } = partitionCheckable(entries, false);
  assert.deepEqual(checkable.map((e) => e.citekey), ['a', 'c']);
  assert.deepEqual(excluded.map((e) => e.citekey), ['b', 'd']);
  assert.equal(describeExcluded(excluded), 'b (no DOI), d (a DataCite DOI (10.5281) Crossref does not resolve)');
  const many = Array.from({ length: 10 }, (_, i) => ({ citekey: `k${i}`, reason: 'no DOI' }));
  assert.match(describeExcluded(many, 3), /^k0 \(no DOI\), k1 \(no DOI\), k2 \(no DOI\), and 7 more$/);
});

test('review round 3: a source flagged retracted is withheld from outline and plan (Pass 1 always blocks it), and the remedy says it is never cited', async () => {
  const { excludedRemedy, RETRACTED_REASON, buildOutlineSources } = await import('../bin/lib/source-context.js');
  assert.equal(verifierBlindSpot({ doi: '10.1016/s0140-6736(97)11096-0', retracted: true }, false), RETRACTED_REASON);
  assert.equal(verifierBlindSpot({ doi: '10.1016/s0140-6736(97)11096-0', retracted: false }, false), null);
  const library = [
    { citekey: 'wakefield1998', doi: '10.1016/s0140-6736(97)11096-0', retracted: true, title: 'Ileal-lymphoid-nodular hyperplasia' },
    { citekey: 'good2020', doi: '10.1000/good', title: 'A sound study' },
    { citekey: 'preprint2021', doi: '10.48550/arXiv.2101.00001', title: 'A preprint' },
  ];
  const { checkable, excluded } = partitionCheckable(library, false);
  assert.deepEqual(checkable.map((e) => e.citekey), ['good2020']);
  assert.deepEqual(excluded, [
    { citekey: 'wakefield1998', reason: 'retracted (Retraction Watch)' },
    { citekey: 'preprint2021', reason: 'a DataCite DOI (10.48550) Crossref does not resolve' },
  ]);
  assert.ok(!JSON.stringify(buildOutlineSources(checkable)).includes('wakefield1998'), 'the outline is never offered the retracted source');
  assert.equal(
    excludedRemedy(excluded),
    'to use one the verifier cannot check, `pensmith add` the DOI of its published (Crossref-registered) version; a retracted source is never cited',
  );
  assert.equal(excludedRemedy(excluded.slice(0, 1)), 'a retracted source is never cited');
});
