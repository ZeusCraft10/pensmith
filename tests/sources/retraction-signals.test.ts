// tests/sources/retraction-signals.test.ts — which registry answers make a
// citation RETRACTED, on the live request path, against an undici MockAgent
// that refuses every connection it was not told to answer.
//
//   - Crossref `updated-by` of type retraction, partial_retraction, withdrawal
//     or removal is a retraction; expression_of_concern only warns; a
//     correction is neither.
//   - A record whose own `update-to` names another DOI is the notice, not the
//     retracted work: citing a retraction notice is not citing retracted work.
//   - A "RETRACTED:" title from any registry is a retraction.
//   - OpenAlex is asked when the record says nothing; a work it lists as
//     retracted is RETRACTED, and no answer from it never blocks or accuses.
//   - An alias DOI is judged by the record the registry returns for it.
//   - A retraction recorded in CITATIONS.bib blocks even offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pass1Verdict } from '../lib/bib-fixture.js';
import { JSON_HEADERS, useMockRegistries } from '../lib/mock-registries.js';

const agent = useMockRegistries('pensmith-retraction-signals-');

const WORK = {
  title: ['Tidal Heating in Icy Moons'],
  author: [{ family: 'Roe', given: 'Jane' }],
  'container-title': ['Icarus'],
  issued: { 'date-parts': [[2019]] },
  type: 'journal-article',
};
const entry = (doi: string, extra = ''): string =>
  `@article{roe2019,\n  title = {Tidal Heating in Icy Moons},\n  author = {Roe, Jane},\n  journal = {Icarus},\n  year = {2019},\n  doi = {${doi}}${extra}\n}\n`;

const notice = (type: string, doi: string, label: string): Record<string, unknown> => ({
  DOI: doi, type, label, source: 'retraction-watch',
  updated: { 'date-parts': [[2021, 3, 4]], 'date-time': '2021-03-04T00:00:00Z', timestamp: 1614816000000 },
});

/** Crossref answers `message` for `doi` (any case). */
function crossrefHolds(doi: string, message: Record<string, unknown>): void {
  agent().get('https://api.crossref.org')
    .intercept({ path: (p) => p.toLowerCase().startsWith(`/works/${encodeURIComponent(doi).toLowerCase()}`), method: 'GET' })
    .reply(200, JSON.stringify({ status: 'ok', message }), { headers: JSON_HEADERS })
    .persist();
}

/** OpenAlex answers every DOI with `status` and `work`; each DOI asked goes into `asked`. */
function openAlexAnswers(asked: string[], status: number, work: Record<string, unknown> | string): void {
  agent().get('https://api.openalex.org')
    .intercept({ path: (p) => p.startsWith('/works/doi:'), method: 'GET' })
    .reply((opts) => {
      asked.push(decodeURIComponent(new URL(String(opts.path), 'https://api.openalex.org').pathname.slice('/works/doi:'.length)));
      return { statusCode: status, data: typeof work === 'string' ? work : JSON.stringify(work), responseOptions: { headers: JSON_HEADERS } };
    })
    .persist();
}
const notRetracted = { id: 'https://openalex.org/W1', title: 'Tidal Heating in Icy Moons', is_retracted: false };

for (const [type, label] of [
  ['retraction', 'Retraction'],
  ['partial_retraction', 'Partial retraction'],
  ['withdrawal', 'Withdrawal'],
  ['removal', 'Removal'],
] as const) {
  test(`Pass 1: Crossref updated-by of type ${type} is RETRACTED, naming the notice`, async () => {
    const asked: string[] = [];
    openAlexAnswers(asked, 200, notRetracted);
    crossrefHolds('10.5555/tidal.1', { ...WORK, DOI: '10.5555/tidal.1', 'updated-by': [notice(type, '10.5555/tidal.notice', label)] });
    const r = await pass1Verdict(entry('10.5555/tidal.1'));
    assert.equal(r.verdict, 'RETRACTED', r.reason);
    assert.match(r.reason, new RegExp(label, 'i'));
    assert.match(r.reason, /10\.5555\/tidal\.notice/);
    assert.match(r.reason, /2021-03-04/);
    assert.deepEqual(asked, [], 'Crossref already answered; OpenAlex is not asked');
  });
}

test('Pass 1: an expression of concern is EXPRESSION_OF_CONCERN, which does not block', async () => {
  const { isBlockingVerdict } = await import('../../bin/lib/verify/verdict-rows.js');
  openAlexAnswers([], 200, notRetracted);
  crossrefHolds('10.5555/tidal.2', { ...WORK, DOI: '10.5555/tidal.2', 'updated-by': [notice('expression_of_concern', '10.5555/tidal.eoc', 'Expression of concern')] });
  const r = await pass1Verdict(entry('10.5555/tidal.2'));
  assert.equal(r.verdict, 'EXPRESSION_OF_CONCERN', r.reason);
  assert.match(r.reason, /10\.5555\/tidal\.eoc/);
  assert.equal(isBlockingVerdict(r.verdict), false);
});

test('Pass 1: a correction alone is OK', async () => {
  openAlexAnswers([], 200, notRetracted);
  crossrefHolds('10.5555/tidal.3', { ...WORK, DOI: '10.5555/tidal.3', 'updated-by': [notice('correction', '10.5555/tidal.fix', 'Correction')] });
  const r = await pass1Verdict(entry('10.5555/tidal.3'));
  assert.equal(r.verdict, 'OK', r.reason);
});

test('Pass 1: citing the retraction notice itself (update-to another DOI) is not RETRACTED', async () => {
  openAlexAnswers([], 200, notRetracted);
  crossrefHolds('10.5555/tidal.notice', {
    ...WORK,
    DOI: '10.5555/tidal.notice',
    title: ['Retraction: Tidal Heating in Icy Moons'],
    'update-to': [notice('retraction', '10.5555/tidal.1', 'Retraction')],
  });
  const r = await pass1Verdict(entry('10.5555/tidal.notice').replace('title = {Tidal', 'title = {Retraction: Tidal'));
  assert.equal(r.verdict, 'OK', r.reason);
});

test('Pass 1: a work retracted in place (update-to its own DOI) is RETRACTED', async () => {
  openAlexAnswers([], 200, notRetracted);
  crossrefHolds('10.5555/tidal.4', { ...WORK, DOI: '10.5555/tidal.4', 'update-to': [notice('retraction', '10.5555/TIDAL.4', 'Retraction')] });
  const r = await pass1Verdict(entry('10.5555/tidal.4'));
  assert.equal(r.verdict, 'RETRACTED', r.reason);
});

test('Pass 1: a DataCite record titled "RETRACTED: …" is RETRACTED, and the label does not make the title a mismatch', async () => {
  openAlexAnswers([], 404, '{"error":"Not Found"}');
  agent().get('https://api.crossref.org')
    .intercept({ path: (p) => p.startsWith('/works/10.5555%2Fdata.1'), method: 'GET' })
    .reply(404, 'Resource not found.')
    .persist();
  agent().get('https://api.datacite.org')
    .intercept({ path: (p) => p.startsWith('/dois/10.5555%2Fdata.1'), method: 'GET' })
    .reply(200, JSON.stringify({
      data: {
        id: '10.5555/data.1',
        attributes: {
          doi: '10.5555/data.1',
          titles: [{ title: 'RETRACTED: Tidal Heating in Icy Moons' }],
          creators: [{ nameType: 'Personal', givenName: 'Jane', familyName: 'Roe', name: 'Roe, Jane' }],
          publicationYear: 2019,
          types: { resourceTypeGeneral: 'Dataset' },
        },
      },
    }), { headers: { 'content-type': 'application/vnd.api+json' } })
    .persist();
  const r = await pass1Verdict(entry('10.5555/data.1'));
  assert.equal(r.verdict, 'RETRACTED', r.reason);
  assert.match(r.reason, /title/i);
});

test('Pass 1: OpenAlex listing a work as retracted that Crossref does not is RETRACTED, naming OpenAlex', async () => {
  const asked: string[] = [];
  openAlexAnswers(asked, 200, { ...notRetracted, is_retracted: true });
  crossrefHolds('10.5555/tidal.5', { ...WORK, DOI: '10.5555/tidal.5' });
  const r = await pass1Verdict(entry('10.5555/tidal.5'));
  assert.equal(r.verdict, 'RETRACTED', r.reason);
  assert.match(r.reason, /OpenAlex/);
  assert.deepEqual(asked, ['10.5555/tidal.5']);
});

test('Pass 1: no answer from OpenAlex does not block; the verdict says it could not be asked', { timeout: 60_000 }, async () => {
  openAlexAnswers([], 503, 'Service Unavailable');
  crossrefHolds('10.5555/tidal.6', { ...WORK, DOI: '10.5555/tidal.6' });
  const r = await pass1Verdict(entry('10.5555/tidal.6'));
  assert.equal(r.verdict, 'OK', r.reason);
  assert.match(r.reason, /OpenAlex could not be asked/);
});

test('Pass 1: an alias DOI whose canonical record carries the retraction is RETRACTED', async () => {
  openAlexAnswers([], 200, notRetracted);
  // Crossref answers the alias with the canonical work's record.
  crossrefHolds('10.5555/alias.7', { ...WORK, DOI: '10.5555/canonical.7', 'updated-by': [notice('retraction', '10.5555/notice.7', 'Retraction')] });
  const r = await pass1Verdict(entry('10.5555/alias.7'));
  assert.equal(r.verdict, 'RETRACTED', r.reason);
});

test('Pass 1: a retraction recorded in CITATIONS.bib (note = {RETRACTED}) is RETRACTED even offline, without a request', async () => {
  process.env['PENSMITH_OFFLINE'] = '1';
  const r = await pass1Verdict(entry('10.5555/tidal.8', ',\n  note = {RETRACTED}'));
  assert.equal(r.verdict, 'RETRACTED', r.reason);
  assert.match(r.reason, /CITATIONS\.bib|when it was added/);
});

test('Pass 1: a mismatched entry whose DOI names a retracted work is MIS-CITED, and says the work is retracted', async () => {
  openAlexAnswers([], 200, notRetracted);
  crossrefHolds('10.5555/tidal.9', { ...WORK, DOI: '10.5555/tidal.9', title: ['Ocean Worlds Beneath the Ice'], 'updated-by': [notice('retraction', '10.5555/notice.9', 'Retraction')] });
  const r = await pass1Verdict(entry('10.5555/tidal.9'));
  assert.equal(r.verdict, 'MIS-CITED', r.reason);
  assert.match(r.reason, /retract/i);
});
