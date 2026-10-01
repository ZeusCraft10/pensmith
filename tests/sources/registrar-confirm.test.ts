// tests/sources/registrar-confirm.test.ts — research confirms an aggregator's
// DOI record at its registrar (Phase 20, VRFY-13; sources/registrar-confirm.ts),
// found by the live self-consistency lane (scripts/live-verify.mjs): Semantic
// Scholar paired the Clinical Psychological Science DOI of Ghai et al. (2023)
// with the PsyArXiv preprint's year (2021), and Pass 1 blocked the tool's own
// source on the year.
//
//   - an aggregator candidate whose Crossref record is the same work takes the
//     record's bibliographic fields (the year among them); its citekey,
//     identifiers and abstract stay;
//   - a DOI no registrar answers for, a failed lookup and an offline miss
//     leave the candidate as it was; another work under that DOI is named in
//     `mismatched` with the registrar's title (main-branch merge review,
//     round 2), and runResearchPass drops it from the kept sources — the
//     recorded case is a DataCite DOI OpenAlex pairs with another work's
//     title, asked where Pass 1 asks it (Crossref 404 → doi.org → DataCite);
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
import { pubmedToCandidate, pubmedVernacularTitle } from '../../bin/lib/sources/pubmed.js';
import { lookupFailed, lookupFound, lookupNotFound, type LookupResult } from '../../bin/lib/sources/lookup.js';
import { OfflineEgressError } from '../../bin/lib/http.js';
import type { SourceCandidate } from '../../bin/lib/schemas/source-candidate.js';
import { logExclusions, researchAdapterPlan, runResearchPass, unconfirmedNote } from '../../bin/lib/research-orchestrator.js';
import { registrarLookup } from '../../bin/lib/source-input.js';
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

test('VRFY-13: another work under the DOI, a DOI Crossref does not know, a failed lookup and an offline miss leave the candidate as it was (another work is named as mismatched)', async () => {
  const other = cand({ source: 'crossref', title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 });
  const cases: Array<[string, () => Promise<LookupResult>]> = [
    ['another work', async () => lookupFound(other)],
    ['not found', async () => lookupNotFound('HTTP 404')],
    ['failed', async () => lookupFailed('HTTP 503 after retries', { status: 503 })],
    ['offline', async () => { throw new OfflineEgressError('offline', 'test runner', 'GET https://api.crossref.org/works/x', 'offline: no recorded fixture'); }],
  ];
  for (const [why, lookup] of cases) {
    const input = cand({});
    const { candidates, confirmed, mismatched } = await confirmRegistrarRecords([input], lookup);
    assert.equal(candidates[0], input, why);
    assert.deepEqual(confirmed, [], why);
    assert.deepEqual(
      mismatched,
      why === 'another work'
        ? [{ index: 0, citekey: 'ghai2021', doi: VOR, reason: `DOI ${VOR} is "Deep learning" at Crossref, not "${TITLE}"` }]
        : [],
      why,
    );
  }
  await assert.rejects(() => confirmRegistrarRecords([cand({})], async () => { throw new TypeError('a bug'); }), /a bug/, 'an unexpected error is not swallowed');
});

test('VRFY-13: a Crossref candidate and an arXiv DataCite DOI are never asked; one DOI is asked once', async () => {
  assert.deepEqual([...AGGREGATOR_SOURCES].sort(), ['openalex', 'pubmed', 'semanticscholar']);
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

/**
 * The live chain's case (review round 1 of the Phase 20 + 23a merge): PubMed
 * 40121571 is a Hungarian article. esummary gives its English translation in
 * brackets as `title` and the printed title as `vernaculartitle`; Crossref,
 * which holds its DOI, has only the Hungarian title (and a subtitle).
 */
const CSABA_DOI = '10.1556/650.2025.33246';
const CSABA_ESUMMARY = {
  uid: '40121571',
  title: '[How much do medical students forget?].',
  vernaculartitle: 'Mennyit felejtenek az orvostanhallgatók?',
  lang: ['hun'],
  authors: [{ name: 'Csaba GJ', authtype: 'Author' }, { name: 'Füzesi Z', authtype: 'Author' }, { name: 'Csathó Á', authtype: 'Author' }],
  pubdate: '2025 Mar 23',
  fulljournalname: 'Orvosi hetilap',
  articleids: [{ idtype: 'pubmed', value: '40121571' }, { idtype: 'doi', value: CSABA_DOI }],
  pubtype: ['Journal Article'],
};
const CSABA_CROSSREF = cand({
  source: 'crossref',
  id: CSABA_DOI,
  doi: CSABA_DOI,
  title: 'Mennyit felejtenek az orvostanhallgatók?',
  subtitle: 'Stabil tudás kiépítése az orvosképzésben',
  authors: ['Csaba, Gergely József', 'Füzesi, Zsuzsanna', 'Csathó, Árpád'],
  year: 2025,
  venue: 'Orvosi Hetilap',
  citekey: 'csaba2025',
});

test('review round 1: a PubMed hit whose title is the English translation of a non-English title takes Crossref\'s record — matched on PubMed\'s original-language title', async () => {
  const pubmed = pubmedToCandidate(CSABA_ESUMMARY);
  assert.ok(pubmed);
  assert.equal(pubmed.title, '[How much do medical students forget?]', "PubMed's title is the bracketed translation");
  assert.equal(pubmedVernacularTitle(pubmed.raw), 'Mennyit felejtenek az orvostanhallgatók?');
  const asked: string[] = [];
  const { candidates, confirmed } = await confirmRegistrarRecords([pubmed], async (doi) => {
    asked.push(doi);
    return lookupFound(CSABA_CROSSREF);
  });
  const [c] = candidates;
  assert.deepEqual(asked, [CSABA_DOI]);
  assert.deepEqual(confirmed, [pubmed.citekey]);
  assert.equal(c?.title, 'Mennyit felejtenek az orvostanhallgatók?', 'the title Pass 1 finds at the DOI\'s registrar');
  assert.equal(c?.subtitle, 'Stabil tudás kiépítése az orvosképzésben');
  assert.equal(c?.pmid, '40121571', 'identifiers stay');
  assert.equal(c?.source, 'pubmed', 'provenance stays');
  assert.equal(c?.citekey, pubmed.citekey, 'the citekey never changes');

  // Crossref holding the English title instead: the PubMed title itself matches.
  const english = cand({ ...CSABA_CROSSREF, title: 'How much do medical students forget?', subtitle: undefined });
  delete (english as { subtitle?: string }).subtitle;
  const again = await confirmRegistrarRecords([pubmed], async () => lookupFound(english));
  assert.equal(again.candidates[0]?.title, 'How much do medical students forget?');

  // Another work under the DOI is still refused, whichever title is compared.
  const other = await confirmRegistrarRecords([pubmed], async () => lookupFound(cand({ source: 'crossref', title: 'Deep learning', authors: ['LeCun, Yann'], year: 2015 })));
  assert.equal(other.candidates[0], pubmed);
  assert.deepEqual(other.confirmed, []);

  // A PubMed record without a vernacular title has one title to compare.
  assert.equal(pubmedVernacularTitle({ ...CSABA_ESUMMARY, vernaculartitle: '' }), null);
  assert.equal(pubmedVernacularTitle(null), null);
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
  // Neither is the work Crossref records under the DOI: Pass 1 would block both (main-branch merge review, round 2).
  assert.deepEqual(other.mismatched.map((m) => m.citekey), ['nobody2025', 'loose2025']);
});

/**
 * Main-branch merge review, round 2 (the live chain's jakubuv2023): OpenAlex
 * W4385245566 pairs the DataCite DOI 10.4230/lipics.itp.2023.19 with the
 * title "Exploiting Generative AI to Scale up Intelligent Tutoring Systems";
 * DataCite records "MizAR 60 for Mizar 50" under it. Crossref answers 404,
 * so the confirmation used to keep the candidate as OpenAlex gave it, the
 * outline assigned it and `verify` blocked the tool's own source as
 * MIS-CITED. Recorded answers: openalex/works-doi-lipics-itp-2023-19,
 * crossref/works-lipics-itp-2023-19-404, generic/doi-ra-prefixes (10.4230 →
 * DataCite) and datacite/doi-lipics-itp-2023-19.
 */
const MISPAIRED_DOI = '10.4230/lipics.itp.2023.19';

test('review round 2: an aggregator DOI the registrar (DataCite, asked as Pass 1 asks it) records as another work is dropped by research — never kept, so never in LIBRARY.json, an outline or a plan', async () => {
  const found = await sources.openalex.lookupById(MISPAIRED_DOI);
  assert.equal(found.kind, 'found');
  const openalex = (found as { candidate: SourceCandidate }).candidate;
  assert.equal(openalex.title, 'Exploiting Generative AI to Scale up Intelligent Tutoring Systems');
  assert.equal(openalex.source, 'openalex');

  // The DOI is asked where Pass 1 asks it: Crossref's 404, then the agency doi.org names.
  const crossref = await sources.crossref.lookupById(MISPAIRED_DOI);
  assert.equal(crossref.kind, 'not-found', 'Crossref does not register it');
  const routed = await registrarLookup(MISPAIRED_DOI);
  assert.equal(routed.kind, 'found');
  assert.equal((routed as { candidate: SourceCandidate }).candidate.title, 'MizAR 60 for Mizar 50');

  const { candidates, confirmed, mismatched } = await confirmRegistrarRecords([openalex], (d) => registrarLookup(d));
  assert.equal(candidates[0], openalex);
  assert.deepEqual(confirmed, []);
  assert.equal(mismatched.length, 1);
  assert.equal(
    mismatched[0]?.reason,
    `DOI ${MISPAIRED_DOI} is "MizAR 60 for Mizar 50" at DataCite, not "Exploiting Generative AI to Scale up Intelligent Tutoring Systems"`,
  );

  // The research pass: OpenAlex finds it, the evaluator (its contract stub) keeps it, the registrar drops it.
  const saved = process.env['PENSMITH_NO_LLM'];
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    const registry = {
      openalex: { search: async (): Promise<SourceCandidate[]> => [openalex] },
      crossref: { search: async (): Promise<SourceCandidate[]> => [], lookupById: (doi: string): Promise<LookupResult> => sources.crossref.lookupById(doi) },
    };
    const plan = researchAdapterPlan({ registry, byPreference: false, discipline: 'computer-science' });
    const r = await runResearchPass({ queries: ['generative AI intelligent tutoring systems'], plan, registry, policy: sourcePolicyFrom(undefined), topic: 't', discipline: 'computer-science', scope: 's' });
    assert.deepEqual(r.kept.map((i) => i.candidate.doi), [], 'never kept');
    assert.deepEqual(r.rejected.map((i) => i.candidate.doi), [], 'never offered at the prune question either');
    assert.equal(r.unconfirmed.length, 1);
    assert.equal(r.unconfirmed[0]?.candidate.doi, MISPAIRED_DOI);
    const log = logExclusions(r.excluded, r.rejected, r.unconfirmed);
    assert.equal(log.length, 1);
    assert.match(log[0]?.why ?? '', /^registrar: DOI 10\.4230\/lipics\.itp\.2023\.19 is "MizAR 60 for Mizar 50" at DataCite, not "Exploiting Generative AI/);
    assert.match(unconfirmedNote(1), /^1 dropped: the DOI's registrar records another work/);
  } finally {
    if (saved === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = saved;
  }
});
