// tests/sources/doi-cn.test.ts — a DOI's record through doi.org content
// negotiation (Phase 20, VRFY-11, D-20-10) against RECORDED cassettes and the
// three-way lookup contract (D-19-05).
//
//   - mEDRA (10.1400/19806) and JaLC (10.11501/3140078): doi.org redirects the
//     CSL-JSON request to the agency, which answers with the record (recorded,
//     both hops) → found, retraction status `unknown` (no retraction data);
//   - a JaLC name sent as one given-only "北本, 朝展" is read as written;
//   - which agencies serve content negotiation (mEDRA, JaLC, KISTI) — ISTIC
//     and the others do not;
//   - an agency that answers with a landing page (a 200 that is not CSL) is a
//     PERMANENT failure (nothing to compare; asking again gives the same
//     answer), a 406 too — never not-found.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cn from '../../bin/lib/sources/doi-cn.js';
import { SourceCandidateSchema } from '../../bin/lib/schemas/source-candidate.js';
import { recorded } from './recorded.js';
import { liveLane, threeWayContract, uniq } from './three-way.js';

test('VRFY-11: an mEDRA DOI is found through doi.org content negotiation (recorded: the redirect and the agency answer)', async () => {
  const hops = recorded('generic', 'cn-medra-19806');
  assert.equal(`${hops[0]!.scope}${hops[0]!.path}`, cn.contentNegotiationUrl('10.1400/19806'));
  const r = await cn.lookupById('10.1400/19806');
  assert.equal(r.kind, 'found', JSON.stringify(r));
  if (r.kind !== 'found') return;
  const c = r.candidate;
  assert.equal(c.source, 'doi.org');
  assert.equal(c.doi, '10.1400/19806');
  assert.equal(c.title, 'La historia y la literatura española postnacional');
  assert.deepEqual(c.authors, ['Navajas, Gonzalo']);
  assert.equal(c.year, 2005);
  assert.equal(c.venue, 'Studi ispanici');
  assert.equal(c.type, 'article-journal');
  assert.equal(c.retraction_status, 'unknown', 'a CSL record carries no retraction data (VRFY-15)');
  assert.ok(SourceCandidateSchema.safeParse(c).success);
});

test('VRFY-11 / VRFY-13: a JaLC DOI is found; its given-only Japanese name is read as written', async () => {
  recorded('generic', 'cn-jalc-3140078');
  const c = await cn.fetchById('10.11501/3140078');
  assert.ok(c);
  assert.equal(c.year, 1997);
  assert.equal(c.publisher, '東京大学');
  assert.deepEqual(c.authors, ['北本, 朝展']);
});

test('VRFY-11: the agencies whose records content negotiation serves', () => {
  assert.deepEqual([...cn.CONTENT_NEGOTIATION_AGENCIES], ['mEDRA', 'JaLC', 'KISTI']);
  for (const a of ['mEDRA', 'medra', ' JaLC ', 'KISTI']) assert.equal(cn.servesContentNegotiation(a), true, a);
  for (const a of ['ISTIC', 'Crossref', 'DataCite', 'CNKI', 'Airiti', '']) assert.equal(cn.servesContentNegotiation(a), false, a);
  assert.equal(cn.contentNegotiationUrl('10.1000/a b#c'), 'https://doi.org/10.1000/a%20b%23c', 'the suffix is encoded, the prefix kept');
});

test('cslPersonName / cslToCandidate: "Family, Given", a braced literal, editors for an edited volume; no title → null', () => {
  assert.equal(cn.cslPersonName({ family: 'Doe', given: 'Jane' }), 'Doe, Jane');
  assert.equal(cn.cslPersonName({ family: 'Doe' }), 'Doe');
  assert.equal(cn.cslPersonName({ literal: 'World Health Organization' }), '{World Health Organization}');
  assert.equal(cn.cslPersonName({}), '');
  const edited = cn.cslToCandidate({ title: ['Proceedings'], subtitle: ['Part III'], editor: [{ family: 'Navab', given: 'Nassir' }], issued: { 'date-parts': [[2015]] }, type: 'book' }, '10.5555/ED.1', '2026-01-02T03:04:05.000Z');
  assert.ok(edited);
  assert.equal(edited.doi, '10.5555/ed.1', 'the requested DOI when the record carries none');
  assert.deepEqual(edited.authors, ['Navab, Nassir']);
  assert.deepEqual(edited.editors, ['Navab, Nassir']);
  assert.equal(edited.subtitle, 'Part III');
  assert.equal(edited.last_verified, '2026-01-02T03:04:05.000Z');
  assert.equal(cn.cslToCandidate({ title: '', author: [{ family: 'X' }] }, '10.5555/x'), null);
  assert.equal(cn.cslToCandidate({ title: 'T' }, '10.5555/x'), null, 'nobody to attribute it to');
});

test('VRFY-11 (MockAgent): an agency that serves a landing page (200, text/html) or 406 is a permanent failure — never not-found', async () => {
  await liveLane(async (agent) => {
    const html = uniq('landing');
    agent
      .get('https://doi.org')
      .intercept({ path: `/10.5555/${html}`, method: 'GET' })
      .reply(200, '<html><body>A landing page</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const r = await cn.lookupById(`10.5555/${html}`);
    assert.equal(r.kind, 'failed', JSON.stringify(r));
    if (r.kind === 'failed') {
      assert.equal(r.permanent, true, 'asking again gives the same answer');
      assert.match(r.reason, /not a CSL record \(text\/html\)/);
    }
    const na = uniq('not-acceptable');
    agent
      .get('https://doi.org')
      .intercept({ path: `/10.5555/${na}`, method: 'GET' })
      .reply(406, 'Not Acceptable', { headers: { 'content-type': 'text/plain' } });
    const r406 = await cn.lookupById(`10.5555/${na}`);
    assert.equal(r406.kind, 'failed', JSON.stringify(r406));
    assert.equal(r406.kind === 'failed' ? r406.permanent : undefined, true);
  });
});

threeWayContract({
  adapter: 'doi.org',
  lookupById: (id) => cn.lookupById(id),
  fetchById: (id) => cn.fetchById(id),
  origin: 'https://doi.org',
  idFor: (token) => `10.5555/${token}`,
  pathPrefixFor: (token) => `/10.5555/${token}`,
  found: (token) => ({
    body: { DOI: `10.5555/${token}`, type: 'article-journal', title: `A CSL record ${token}`, author: [{ family: 'Doe', given: 'Jane' }], issued: { 'date-parts': [[2019]] } },
    contentType: 'application/vnd.citationstyles.csl+json',
  }),
  checkFound: (c, token) => {
    assert.equal(c.source, 'doi.org');
    assert.equal(c.doi, `10.5555/${token}`);
    assert.deepEqual(c.authors, ['Doe, Jane']);
    assert.equal(c.retraction_status, 'unknown');
  },
  invalid: (marker) => ({ body: { status: 'error', message: marker }, contentType: 'application/json' }),
  offlineMissId: '10.5555/pensmith-doi-cn-offline-miss',
});
