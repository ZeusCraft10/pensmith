// tests/doi-normalizers-src13.test.ts — SRC-13 / SWP-16 (ARCH-15): the
// identifier normalizers accept every spelling `add` is given, keep their
// idempotence, and find identifiers in running PDF text.

import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  normalizeDoi,
  normalizeArxiv,
  normalizePmid,
  findDoisInText,
  findArxivIdsInText,
} from '../bin/lib/doi.js';

test('SRC-13: DOI spellings — "DOI: 10…", "DOI 10…", %2F-encoded doi.org URLs, www./scheme-less resolvers', () => {
  const want = '10.1038/nature14539';
  for (const v of [
    'DOI: 10.1038/nature14539',
    'doi:  10.1038/nature14539',
    'DOI 10.1038/nature14539',
    'https://doi.org/10.1038%2Fnature14539',
    'https://doi.org/10.1038%2fnature14539',
    'http://dx.doi.org/10.1038%2FNATURE14539',
    'https://www.doi.org/10.1038/nature14539',
    'doi.org/10.1038/nature14539',
    'dx.doi.org/10.1038/nature14539.',
    '  https://doi.org/10.1038/nature14539)  ',
  ]) {
    assert.equal(normalizeDoi(v), want, v);
  }
  // a literal % in a bare DOI is kept (never decoded)
  assert.equal(normalizeDoi('10.1234/a%2Fb'), '10.1234/a%2fb');
  // a malformed escape in a URL form is not a DOI
  assert.equal(normalizeDoi('https://doi.org/10.1234/%zz'), null);
});

test('SRC-13: arXiv spellings — old style with version, subject classes, upper-case archives, trailing period', () => {
  assert.equal(normalizeArxiv('hep-th/9901001v2'), 'hep-th/9901001v2');
  assert.equal(normalizeArxiv('arXiv:hep-th/9901001'), 'hep-th/9901001');
  assert.equal(normalizeArxiv('HEP-TH/9901001'), 'hep-th/9901001');
  assert.equal(normalizeArxiv('math.GT/0309136'), 'math.GT/0309136');
  assert.equal(normalizeArxiv('math.gt/0309136'), 'math.GT/0309136');
  assert.equal(normalizeArxiv('cond-mat.str-el/0301012'), 'cond-mat.str-el/0301012');
  assert.equal(normalizeArxiv('alg-geom/9202001'), 'alg-geom/9202001');
  assert.equal(normalizeArxiv('arXiv:1706.03762.'), 'arxiv:1706.03762');
  assert.equal(normalizeArxiv('arXiv: 1706.03762v7'), 'arxiv:1706.03762v7');
  assert.equal(normalizeArxiv('1706.03762,'), 'arxiv:1706.03762');
  // unknown archives and subjects still return null
  assert.equal(normalizeArxiv('foo-bar/9901001'), null);
  assert.equal(normalizeArxiv('cs.UNKNOWN/0301012'), null);
  assert.equal(normalizeArxiv('cond-mat.nope/0301012'), null);
});

test('SRC-13: PMID spellings — PMID:, pmid:, "PMID: n", "PMID n"', () => {
  for (const v of ['PMID:31978945', 'pmid:31978945', 'PMID: 31978945', 'PMID 31978945', ' 31978945 ']) {
    assert.equal(normalizePmid(v), '31978945', v);
  }
  assert.equal(normalizePmid('PMID:'), null);
});

test('SRC-13 property: normalizeDoi stays idempotent over resolver URLs, percent-encoding and label prefixes (1000 runs)', () => {
  const suffix = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !/\s/.test(s));
  const doi = fc.tuple(fc.integer({ min: 1000, max: 999999999 }), suffix).map(([r, s]) => `10.${r}/${s}`);
  const spelled = fc.tuple(
    doi,
    fc.constantFrom('', 'DOI: ', 'doi ', 'https://doi.org/', 'https://www.doi.org/', 'doi.org/', 'http://dx.doi.org/'),
    fc.boolean(),
  ).map(([d, p, encode]) => (encode && p.includes('doi.org') ? p + d.replace('/', '%2F') : p + d));
  fc.assert(
    fc.property(spelled, (s) => {
      const once = normalizeDoi(s);
      return once === null || normalizeDoi(once) === once;
    }),
    { numRuns: 1000 },
  );
});

test('SRC-13 property: normalizeArxiv stays idempotent over old-style ids with versions and case (500 runs)', () => {
  const archive = fc.constantFrom('hep-th', 'HEP-TH', 'math.GT', 'math.gt', 'cs.CL', 'astro-ph', 'cond-mat.str-el', 'quant-ph');
  const id = fc.tuple(archive, fc.integer({ min: 0, max: 9999999 }), fc.option(fc.integer({ min: 1, max: 12 })), fc.constantFrom('', '.', ',', 'arXiv:'))
    .map(([a, n, v, extra]) => {
      const body = `${a}/${String(n).padStart(7, '0')}${v === null ? '' : `v${v}`}`;
      return extra === 'arXiv:' ? `arXiv:${body}` : `${body}${extra}`;
    });
  fc.assert(
    fc.property(id, (s) => {
      const once = normalizeArxiv(s);
      return once !== null && normalizeArxiv(once) === once;
    }),
    { numRuns: 500 },
  );
});

test('SRC-13: findDoisInText finds a footer DOI and normalizes it; distinct, in order', () => {
  const text = 'NATURE PHYSICS | VOL 5 | JANUARY 2009 | www.nature.com    doi:10.1038/nphys1170\nSee also https://doi.org/10.1038/NPHYS1170. And 10.1126/science.169.3946.635,';
  assert.deepEqual(findDoisInText(text), ['10.1038/nphys1170', '10.1126/science.169.3946.635']);
  assert.deepEqual(findDoisInText('no identifiers here 10.12 or 10.1/x'), []);
});

test('SRC-13: findArxivIdsInText separates the arXiv margin stamp from other mentions', () => {
  const text = 'arXiv:1706.03762v7  [cs.CL]  2 Aug 2023\nWe build on arXiv:1409.0473 and arXiv:hep-th/9901001v2 [hep-th].';
  assert.deepEqual(findArxivIdsInText(text), { stamped: ['1706.03762', 'hep-th/9901001'], mentioned: ['1409.0473'] });
  assert.deepEqual(findArxivIdsInText('nothing here'), { stamped: [], mentioned: [] });
});
