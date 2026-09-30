// tests/sources/datacite.test.ts — the DataCite adapter (Phase 20, VRFY-11,
// D-20-10) against RECORDED cassettes (scripts/refresh-cassettes.mjs) and the
// three-way lookup contract (D-19-05).
//
//   - a Zenodo DOI (10.5281/zenodo.1212303, spaCy) → found: its title, the
//     creators (a display name DataCite did not split kept as written), the year, the publisher, a CSL type, the
//     relations DataCite asserts (kebab-cased), retraction status `unknown`
//     (DataCite carries no retraction data — never `clear`, VRFY-15);
//   - the same DOI in upper case → the same record (case-insensitive DOIs);
//   - an unregistered Zenodo DOI → DataCite's HTTP 404 → not-found;
//   - the record → candidate parse: an Organizational creator braced, an
//     editor-only work attributed to its editors, a Subtitle title kept apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as datacite from '../../bin/lib/sources/datacite.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { normalizeDoi } from '../../bin/lib/doi.js';
import { recorded } from './recorded.js';
import { threeWayContract } from './three-way.js';
import { authorSimilarity } from '../../bin/lib/verify/name-match.js';
import { AUTHOR_JW_THRESHOLD } from '../../bin/lib/fuzzy.js';

const SPACY = '10.5281/zenodo.1212303';

test('VRFY-11: a Zenodo DOI is found at DataCite — the recorded record, parsed', async () => {
  const [entry] = recorded('datacite', 'doi-zenodo-1212303');
  assert.equal(`${entry!.scope}${entry!.path}`, datacite.lookupUrl(SPACY), 'the exact recorded request');
  const attrs = (entry!.response as { data: { attributes: { titles: Array<{ title: string }>; publicationYear: number } } }).data.attributes;
  const r = await datacite.lookupById(SPACY);
  assert.equal(r.kind, 'found', JSON.stringify(r));
  if (r.kind !== 'found') return;
  const c = r.candidate;
  assert.equal(c.source, 'datacite');
  assert.equal(c.doi, SPACY);
  assert.equal(c.title, attrs.titles[0]!.title);
  assert.equal(c.authors[0], 'Ines Montani', 'a display name DataCite did not split is kept as written');
  assert.ok(authorSimilarity(c.authors[0]!, 'Montani, Ines') >= AUTHOR_JW_THRESHOLD, 'Pass 1 matches it to a bibliography\'s "Family, Given" (VRFY-13)');
  assert.equal(c.year, attrs.publicationYear);
  assert.equal(c.publisher, 'Zenodo');
  assert.equal(c.type, 'other', 'Software → other');
  assert.equal(c.retraction_status, 'unknown', 'DataCite carries no retraction data (VRFY-15)');
  assert.equal(c.retracted, false);
  assert.ok((c.relations ?? []).some((rel) => rel.type === 'has-version' && rel.doi.startsWith('10.5281/zenodo.')), 'HasVersion → has-version');
  assert.ok((c.relations ?? []).every((rel) => normalizeDoi(rel.doi) === rel.doi), 'only DOI relations are kept (a URL relation is not)');
  assert.ok(typeof c.last_verified === 'string' && !Number.isNaN(Date.parse(c.last_verified)));
  assert.ok(SourceCandidateSchema.safeParse(c).success, 'validates');
});

test('VRFY-11: a DOI is case-insensitive — the upper-case spelling asks for the same record', async () => {
  assert.equal(datacite.lookupUrl('10.5281/zenodo.1212303'), 'https://api.datacite.org/dois/10.5281%2Fzenodo.1212303');
  const c = await datacite.fetchById('10.5281/ZENODO.1212303');
  assert.equal(c?.doi, SPACY);
});

test('VRFY-11: an unregistered Zenodo DOI is not-found at DataCite (the recorded 404) — fetchById → null', async () => {
  recorded('datacite', 'doi-zenodo-fake-404');
  const r = await datacite.lookupById('10.5281/zenodo.pensmith-fake-2099');
  assert.equal(r.kind, 'not-found', JSON.stringify(r));
  assert.match(r.kind === 'not-found' ? r.reason : '', /^HTTP 404 \(DataCite has no record of this DOI\)$/);
  assert.equal(await datacite.fetchById('10.5281/zenodo.pensmith-fake-2099'), null);
});

test('VRFY-11: not a DOI → not-found without a request', async () => {
  const r = await datacite.lookupById('zenodo.1212303');
  assert.equal(r.kind, 'not-found');
});

test('dataCiteToCandidate: an organisation braced, a split name "Family, Given", editors, a subtitle, relations; no title or nobody → null', () => {
  const base = { doi: '10.5555/DC.1', titles: [{ title: 'A Data Set' }, { title: 'With Notes', titleType: 'Subtitle' }], publicationYear: '2020' };
  const c = datacite.dataCiteToCandidate(
    {
      ...base,
      creators: [
        { name: 'CERN', nameType: 'Organizational' },
        { name: 'Doe, Jane', nameType: 'Personal', givenName: 'Jane', familyName: 'Doe' },
      ],
      contributors: [{ name: 'Roe, Richard', contributorType: 'Editor', givenName: 'Richard', familyName: 'Roe' }, { name: 'Someone', contributorType: 'DataCurator' }],
      types: { resourceTypeGeneral: 'Dataset' },
      relatedIdentifiers: [
        { relationType: 'IsIdenticalTo', relatedIdentifier: 'https://doi.org/10.5555/OTHER', relatedIdentifierType: 'DOI' },
        { relationType: 'IsSupplementTo', relatedIdentifier: 'https://example.org/x', relatedIdentifierType: 'URL' },
      ],
    },
    '2026-01-02T03:04:05.000Z',
  );
  assert.ok(c);
  assert.equal(c.doi, '10.5555/dc.1');
  assert.equal(c.title, 'A Data Set');
  assert.equal(c.subtitle, 'With Notes');
  assert.deepEqual(c.authors, ['{CERN}', 'Doe, Jane']);
  assert.deepEqual(c.editors, ['Roe, Richard']);
  assert.equal(c.year, 2020);
  assert.equal(c.type, 'dataset');
  assert.deepEqual(c.relations, [{ type: 'is-identical-to', doi: '10.5555/other' }]);
  assert.equal(c.last_verified, '2026-01-02T03:04:05.000Z', 'the answer time is the candidate\'s last_verified (VRFY-28)');

  const edited = datacite.dataCiteToCandidate({ ...base, creators: [], contributors: [{ name: 'Navab, Nassir', contributorType: 'Editor', givenName: 'Nassir', familyName: 'Navab' }] });
  assert.deepEqual(edited?.authors, ['Navab, Nassir'], 'an editor-only work is attributed to its editors (D-20-10)');
  assert.deepEqual(edited?.editors, ['Navab, Nassir']);

  assert.equal(datacite.dataCiteToCandidate({ ...base, titles: [], creators: [{ name: 'X' }] }), null, 'no title');
  assert.equal(datacite.dataCiteToCandidate({ ...base, creators: [] }), null, 'nobody to attribute it to');
});

threeWayContract({
  adapter: 'datacite',
  lookupById: (id) => datacite.lookupById(id),
  fetchById: (id) => datacite.fetchById(id),
  origin: 'https://api.datacite.org',
  idFor: (token) => `10.5555/${token}`,
  pathPrefixFor: (token) => `/dois/10.5555/${token}`,
  found: (token) => ({
    body: {
      data: {
        id: `10.5555/${token}`,
        type: 'dois',
        attributes: {
          doi: `10.5555/${token}`,
          titles: [{ title: `A DataCite record ${token}` }],
          creators: [{ name: 'Doe, Jane', nameType: 'Personal', givenName: 'Jane', familyName: 'Doe' }],
          publicationYear: 2021,
          publisher: 'Zenodo',
          types: { resourceTypeGeneral: 'Dataset' },
        },
      },
    },
    contentType: 'application/vnd.api+json',
  }),
  checkFound: (c, token) => {
    assert.equal(c.source, 'datacite');
    assert.equal(c.doi, `10.5555/${token}`);
    assert.deepEqual(c.authors, ['Doe, Jane']);
    assert.equal(c.retraction_status, 'unknown');
  },
  invalid: (marker) => ({ body: { data: { type: 'error', detail: marker } }, contentType: 'application/vnd.api+json' }),
  offlineMissId: '10.5555/pensmith-datacite-offline-miss',
});
