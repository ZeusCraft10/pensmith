// tests/sources/registrar-confirm.test.ts — research confirms an aggregator's
// DOI record at Crossref (Phase 20, VRFY-13; sources/registrar-confirm.ts),
// found by the live self-consistency lane (scripts/live-verify.mjs): Semantic
// Scholar paired the Clinical Psychological Science DOI of Ghai et al. (2023)
// with the PsyArXiv preprint's year (2021), and Pass 1 blocked the tool's own
// source on the year.
//
//   - an aggregator candidate whose Crossref record is the same work takes the
//     record's bibliographic fields (the year among them); its citekey,
//     identifiers and abstract stay;
//   - another work under that DOI, a DOI Crossref does not know, a failed
//     lookup and an offline miss leave the candidate as it was;
//   - a Crossref candidate and an arXiv DataCite DOI are never asked; one DOI
//     is asked once;
//   - runResearchPass applies it to the kept candidates of a registry whose
//     crossref adapter can look a DOI up;
//   - review round 3: an aggregator listing the authors in another order is
//     confirmed on a strict title when its first author is one of the
//     record's, and takes the record's order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmRegistrarRecords, AGGREGATOR_SOURCES } from '../../bin/lib/sources/registrar-confirm.js';
import { lookupFailed, lookupFound, lookupNotFound, type LookupResult } from '../../bin/lib/sources/lookup.js';
import { OfflineEgressError } from '../../bin/lib/http.js';
import type { SourceCandidate } from '../../bin/lib/schemas/source-candidate.js';
import { researchAdapterPlan, runResearchPass } from '../../bin/lib/research-orchestrator.js';
import { sourcePolicyFrom } from '../../bin/lib/source-policy.js';
import { sources } from '../../bin/lib/sources/index.js';
import { matchWork } from '../../bin/lib/verify/name-match.js';

const VOR = '10.1177/21677026221114859';
const TITLE = 'Lack of Sample Diversity in Research on Adolescent Depression and Social Media Use: A Scoping Review and Meta-Analysis';

function cand(over: Partial<SourceCandidate>): SourceCandidate {
  return {
    source: 'semanticscholar',
    id: 'S2-1',
    doi: VOR,
    title: TITLE,
    authors: ['Ghai, Amy', 'Fassi, Luisa'],
    year: 2021,
    abstract: 'An abstract from the aggregator.',
    retracted: false,
    last_verified: '2026-09-30T00:00:00.000Z',
    citekey: 'ghai2021',
    raw: {},
    ...over,
  };
}

const CROSSREF_RECORD = cand({
  source: 'crossref',
  id: VOR,
  title: 'Lack of Sample Diversity in Research on Adolescent Depression and Social Media Use: A Scoping Review and Meta-Analysis',
  authors: ['Ghai, Amy', 'Fassi, Luisa', 'Awadh, Faisal'],
  year: 2023,
  venue: 'Clinical Psychological Science',
  volume: '11',
  issue: '5',
  pages: '759-772',
  publisher: 'SAGE Publications',
  type: 'article-journal',
  citekey: 'ghai2023',
});
delete (CROSSREF_RECORD as { abstract?: string }).abstract;

test('VRFY-13: an aggregator record pairing the journal DOI with the preprint year takes the DOI\'s own Crossref fields — citekey, identifiers and abstract kept', async () => {
  const asked: string[] = [];
  const { candidates, confirmed } = await confirmRegistrarRecords([cand({})], async (doi) => {
    asked.push(doi);
    return lookupFound(CROSSREF_RECORD);
  });
  const [c] = candidates;
  assert.deepEqual(asked, [VOR]);
  assert.deepEqual(confirmed, ['ghai2021']);
  assert.equal(c?.year, 2023, "the article's year, not the preprint's");
  assert.equal(c?.venue, 'Clinical Psychological Science');
  assert.equal(c?.pages, '759-772');
  assert.deepEqual(c?.authors, ['Ghai, Amy', 'Fassi, Luisa', 'Awadh, Faisal']);
  assert.equal(c?.citekey, 'ghai2021', 'the citekey never changes');
  assert.equal(c?.source, 'semanticscholar', 'provenance stays');
  assert.equal(c?.doi, VOR);
  assert.equal(c?.abstract, 'An abstract from the aggregator.');
});

test('VRFY-13: another work under the DOI, a DOI Crossref does not know, a failed lookup and an offline miss leave the candidate as it was', async () => {
  const other = cand({ source: 'crossref', title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 });
  const cases: Array<[string, () => Promise<LookupResult>]> = [
    ['another work', async () => lookupFound(other)],
    ['not found', async () => lookupNotFound('HTTP 404')],
    ['failed', async () => lookupFailed('HTTP 503 after retries', { status: 503 })],
    ['offline', async () => { throw new OfflineEgressError('offline', 'test runner', 'GET https://api.crossref.org/works/x', 'offline: no recorded fixture'); }],
  ];
  for (const [why, lookup] of cases) {
    const input = cand({});
    const { candidates, confirmed } = await confirmRegistrarRecords([input], lookup);
    assert.equal(candidates[0], input, why);
    assert.deepEqual(confirmed, [], why);
  }
  await assert.rejects(() => confirmRegistrarRecords([cand({})], async () => { throw new TypeError('a bug'); }), /a bug/, 'an unexpected error is not swallowed');
});

test('VRFY-13: a Crossref candidate and an arXiv DataCite DOI are never asked; one DOI is asked once', async () => {
  assert.deepEqual([...AGGREGATOR_SOURCES].sort(), ['openalex', 'semanticscholar']);
  const asked: string[] = [];
  const lookup = async (doi: string): Promise<LookupResult> => {
    asked.push(doi);
    return lookupFound(CROSSREF_RECORD);
  };
  const { candidates } = await confirmRegistrarRecords(
    [
      cand({ source: 'crossref' }),
      cand({ doi: '10.48550/arXiv.1706.03762', citekey: 'vaswani2017' }),
      cand({ doi: undefined, citekey: 'nodoi2021' }),
      cand({ citekey: 'ghai2021' }),
      cand({ source: 'openalex', id: 'W1', doi: VOR.toUpperCase(), citekey: 'ghai2021b' }),
    ],
    lookup,
  );
  assert.deepEqual(asked, [VOR], 'one lookup for the one aggregator DOI');
  assert.deepEqual(candidates.map((c) => c.year), [2021, 2021, 2021, 2023, 2023]);
});

test('VRFY-13: runResearchPass confirms the kept aggregator candidates through the registry\'s crossref lookup', async () => {
  const saved = process.env['PENSMITH_NO_LLM'];
  process.env['PENSMITH_NO_LLM'] = '1'; // the evaluator's contract stub keeps every candidate
  try {
    const asked: string[] = [];
    const registry = {
      semanticscholar: { search: async (): Promise<SourceCandidate[]> => [cand({})] },
      crossref: {
        search: async (): Promise<SourceCandidate[]> => [],
        lookupById: async (doi: string): Promise<LookupResult> => {
          asked.push(doi);
          return lookupFound(CROSSREF_RECORD);
        },
      },
    };
    const plan = researchAdapterPlan({ registry, byPreference: false, discipline: 'other' });
    const r = await runResearchPass({ queries: ['adolescent depression social media'], plan, registry, policy: sourcePolicyFrom(undefined), topic: 't', discipline: 'other', scope: 's' });
    const k = r.kept.find((i) => i.candidate.citekey === 'ghai2021');
    assert.ok(k, JSON.stringify(r.kept.map((i) => i.candidate.citekey)));
    assert.equal(k.candidate.year, 2023);
    assert.equal(k.view.year, 2023, 'the library view follows the confirmed record');
    assert.deepEqual(asked, [VOR]);
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = saved;
  }
});

test('VRFY-13 (review round 3): an aggregator that lists the authors in another order takes the registrar\'s record and its author order (the recorded Crossref answer for 10.30574/ijsra.2025.15.1.0980)', async () => {
  const doi = '10.30574/ijsra.2025.15.1.0980';
  const title = 'A comprehensive review of advances in transformer, GAN, and attention mechanisms: Their role in multimodal learning and applications across NLP';
  // Semantic Scholar's order (the live self-consistency lane's limon2025).
  const s2 = cand({ doi, title, authors: ['Limon, Golam Qibria', 'Khan, Md Fokrul Islam', 'Begum, Mst Halema'], year: 2025, citekey: 'limon2025' });
  const { candidates, confirmed } = await confirmRegistrarRecords([s2], (d) => sources.crossref.lookupById(d));
  assert.deepEqual(confirmed, ['limon2025']);
  const [c] = candidates;
  assert.match(c?.authors[0] ?? '', /Khan/, `Crossref's first author: ${JSON.stringify(c?.authors)}`);
  assert.equal(c?.citekey, 'limon2025', 'the citekey never changes');
  // Pass 1 then compares the registrar's own order: the first author matches.
  const m = matchWork({ title: c!.title, authors: c!.authors, year: c!.year ?? null }, { title, authors: c!.authors, year: 2025 });
  assert.equal(m.ok, true, m.detail);

  // Still left as it was: the aggregator's first author is not among the record's authors, or the title is only close.
  const stranger = cand({ doi, title, authors: ['Nobody, Nora'], year: 2025, citekey: 'nobody2025' });
  const loose = cand({ doi, title: 'A review of transformer, GAN and attention mechanisms', authors: ['Limon, Golam Qibria'], year: 2025, citekey: 'loose2025' });
  const other = await confirmRegistrarRecords([stranger, loose], (d) => sources.crossref.lookupById(d));
  assert.deepEqual(other.confirmed, []);
  assert.equal(other.candidates[0], stranger);
  assert.equal(other.candidates[1], loose);
});
