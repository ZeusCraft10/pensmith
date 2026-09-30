// tests/source-context-verifiable.test.ts — GRND-18 / D-18-37: outline and plan
// are fed only the sources the citation verifier can check (source-context.ts
// verifierBlindSpot). Since Phase 19, Pass 1 re-fetches a Crossref DOI at
// Crossref, a DataCite arXiv DOI at arXiv, and an entry without a DOI by its
// arXiv id, PMID or ISBN at their own registrars — one predicate shared with
// Pass 1 (verify/pass1-identifiers.ts, review round 1 of the Phase 18/19
// merge). Withheld: retracted, synthetic outside a dry run, and no identifier
// at all. Since Phase 20 (VRFY-11) a Zenodo / figshare / Dryad DataCite DOI is
// checked at DataCite, so it is offered like any other DOI.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATACITE_DOI_PREFIXES,
  NO_IDENTIFIER_REASON,
  SYNTHETIC_REASON,
  describeExcluded,
  partitionCheckable,
  verifierBlindSpot,
} from '../bin/lib/source-context.js';
import { citationCheckRoute } from '../bin/lib/verify/pass1-identifiers.js';

test('GRND-18: verifierBlindSpot follows Pass 1 — a Crossref DOI, a DataCite DOI, an arXiv id, a PMID, an ISBN or a DataCite arXiv DOI is checkable', () => {
  assert.equal(verifierBlindSpot({ doi: '10.18653/v1/N19-1423' }, false), null, 'a Crossref DOI is checkable');
  assert.equal(verifierBlindSpot({ doi: null, isbn: '9780226458083' }, false), null, 'an ISBN-only book (Pass 1: the books registries)');
  assert.equal(verifierBlindSpot({ doi: null, arxiv: '1706.03762' }, false), null, 'an arXiv-only preprint (Pass 1: arXiv)');
  assert.equal(verifierBlindSpot({ doi: null, pmid: '31978945' }, false), null, 'a PMID-only record (Pass 1: PubMed)');
  assert.equal(verifierBlindSpot({ doi: '10.48550/arXiv.1706.03762' }, false), null, 'a DataCite arXiv DOI (Pass 1: arXiv, by its id)');
  assert.equal(verifierBlindSpot({ doi: '10.48550/ARXIV.1706.03762' }, false), null, 'case-insensitive');
  assert.equal(verifierBlindSpot({ doi: '10.3760/cma.j.cn441530-20260508-00189-1', pmid: '42706103' }, false), null, 'an ISTIC DOI with its PMID');
  // Withheld: nothing Pass 1 can resolve.
  assert.equal(verifierBlindSpot({ doi: null }, false), NO_IDENTIFIER_REASON);
  assert.equal(verifierBlindSpot({ doi: '  ' }, false), NO_IDENTIFIER_REASON);
  assert.equal(verifierBlindSpot({}, false), NO_IDENTIFIER_REASON);
  assert.deepEqual([...DATACITE_DOI_PREFIXES], ['10.5281', '10.6084', '10.5061'], 'Zenodo, figshare, Dryad');
  for (const prefix of DATACITE_DOI_PREFIXES) {
    assert.equal(verifierBlindSpot({ doi: `${prefix}/x.1` }, false), null, `${prefix}: VRFY-11 — Pass 1 checks it at DataCite`);
    assert.equal(verifierBlindSpot({ doi: `${prefix}/x.1`, arxiv: '2101.00001' }, false), null, `${prefix} with an arXiv id`);
  }
  assert.ok(!DATACITE_DOI_PREFIXES.includes('10.48550'), "arXiv's DataCite prefix is checked at arXiv");
  // Synthetic sources: only a dry run checks them.
  assert.equal(verifierBlindSpot({ doi: '10.0000/pensmith-dryrun.a', synthetic: true }, true), null, 'a dry run checks its synthetic sources');
  assert.equal(verifierBlindSpot({ doi: '10.0000/pensmith-dryrun.a', synthetic: true }, false), SYNTHETIC_REASON);
  assert.equal(verifierBlindSpot({ doi: '10.0000/pensmith-dryrun.a' }, false), SYNTHETIC_REASON, 'a reserved DOI is synthetic even unflagged');
});

test('GRND-18: the route Pass 1 takes is the one shared predicate', () => {
  assert.deepEqual(citationCheckRoute({ doi: '10.48550/arXiv.1706.03762' }), { kind: 'arxiv-doi', arxiv: '1706.03762' });
  assert.deepEqual(citationCheckRoute({ doi: null, arxiv: '1706.03762', pmid: '1', isbn: '9780226458083' }), {
    kind: 'no-doi',
    ids: [
      { registrar: 'arxiv', id: '1706.03762', label: 'arXiv:1706.03762' },
      { registrar: 'pubmed', id: '1', label: 'PMID 1' },
      { registrar: 'books', id: 'isbn:9780226458083', label: 'ISBN 9780226458083' },
    ],
  });
  assert.deepEqual(citationCheckRoute({ doi: '10.1038/nphys1170' }), { kind: 'crossref', fallback: [] });
  assert.equal(citationCheckRoute({ doi: '10.0000/pensmith-dryrun.a' }).kind, 'dry-run-doi');
});

test('GRND-18: partitionCheckable keeps library order and names every excluded source', () => {
  const entries = [
    { citekey: 'a', doi: '10.1000/a' },
    { citekey: 'b', doi: null },
    { citekey: 'c', doi: null, isbn: '9780226458083' },
    { citekey: 'd', doi: '10.5281/zenodo.1' },
  ];
  const { checkable, excluded } = partitionCheckable(entries, false);
  assert.deepEqual(checkable.map((e) => e.citekey), ['a', 'c', 'd'], 'a Zenodo DOI is checked at DataCite (VRFY-11)');
  assert.deepEqual(excluded.map((e) => e.citekey), ['b']);
  assert.equal(describeExcluded(excluded), 'b (no DOI, arXiv id, PMID or ISBN)');
  const many = Array.from({ length: 10 }, (_, i) => ({ citekey: `k${i}`, reason: 'no DOI' }));
  assert.match(describeExcluded(many, 3), /^k0 \(no DOI\), k1 \(no DOI\), k2 \(no DOI\), and 7 more$/);
});

test('review round 1: an ISBN-only History library, an arXiv-only CS library and a PMID-only record are all offered (partitionCheckable)', () => {
  const library = [
    { citekey: 'hobsbawm1962', doi: null, isbn: '9780679772538', title: 'The Age of Revolution' },
    { citekey: 'vaswani2017', doi: '10.48550/arxiv.1706.03762', arxiv: '1706.03762', title: 'Attention Is All You Need' },
    { citekey: 'devlin2018', doi: null, arxiv: '1810.04805', title: 'BERT' },
    { citekey: 'zhu2020', doi: null, pmid: '31978945', title: 'A Novel Coronavirus' },
  ];
  const { checkable, excluded } = partitionCheckable(library, false);
  assert.deepEqual(checkable.map((e) => e.citekey), ['hobsbawm1962', 'vaswani2017', 'devlin2018', 'zhu2020']);
  assert.deepEqual(excluded, []);
});

test('review round 3: a source flagged retracted is withheld from outline and plan (Pass 1 always blocks it), and the remedy says it is never cited', async () => {
  const { excludedRemedy, RETRACTED_REASON, buildOutlineSources } = await import('../bin/lib/source-context.js');
  assert.equal(verifierBlindSpot({ doi: '10.1016/s0140-6736(97)11096-0', retracted: true }, false), RETRACTED_REASON);
  assert.equal(verifierBlindSpot({ doi: '10.1016/s0140-6736(97)11096-0', retracted: false }, false), null);
  assert.equal(verifierBlindSpot({ doi: null, isbn: '9780226458083', retracted: true }, false), RETRACTED_REASON, 'retracted wins over a checkable identifier');
  const library = [
    { citekey: 'wakefield1998', doi: '10.1016/s0140-6736(97)11096-0', retracted: true, title: 'Ileal-lymphoid-nodular hyperplasia' },
    { citekey: 'good2020', doi: '10.1000/good', title: 'A sound study' },
    { citekey: 'dataset2021', doi: '10.5281/zenodo.2101', title: 'A dataset' },
    { citekey: 'notes2021', doi: null, title: 'Lecture notes' },
  ];
  const { checkable, excluded } = partitionCheckable(library, false);
  assert.deepEqual(checkable.map((e) => e.citekey), ['good2020', 'dataset2021']);
  assert.deepEqual(excluded, [
    { citekey: 'wakefield1998', reason: 'retracted (Retraction Watch)' },
    { citekey: 'notes2021', reason: NO_IDENTIFIER_REASON },
  ]);
  assert.ok(!JSON.stringify(buildOutlineSources(checkable)).includes('wakefield1998'), 'the outline is never offered the retracted source');
  assert.equal(
    excludedRemedy(excluded),
    'to use one the verifier cannot check, `pensmith add` its DOI, arXiv id, PMID or ISBN; ' +
      'a retracted source is never cited',
  );
  assert.equal(excludedRemedy(excluded.slice(0, 1)), 'a retracted source is never cited');
  assert.equal(excludedRemedy([{ citekey: 's', reason: SYNTHETIC_REASON }]), 'a synthetic --dry-run source is never cited outside a dry run');
});
