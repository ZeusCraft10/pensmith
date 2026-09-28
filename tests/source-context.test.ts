// tests/source-context.test.ts — FEED-01 / D-18-21: the ONE pure source-context
// builder. A section's records are exactly the citekeys asked for (in order,
// library misses dropped), abstracts and author lists are bounded, `full_text`
// has one derivation, and the builder is pure (no fs / network imports).

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  MAX_ABSTRACT_CHARS,
  MAX_AUTHORS,
  OUTLINE_ABSTRACT_CHARS,
  buildOutlineSources,
  buildSourceContext,
  clip,
  fullTextAvailable,
  libraryCitekeys,
  type SourceContextInput,
} from '../bin/lib/source-context.js';

const LIB: SourceContextInput[] = [
  { citekey: 'a2020', title: 'Alpha', authors: ['A, One', 'B, Two', 'C, Three', 'D, Four', 'E, Five', 'F, Six'], year: 2020, venue: 'J', abstract: 'x'.repeat(2000), oa_url: 'https://example.org/a.pdf', byo: null },
  { citekey: 'b2019', title: '  Beta   study ', authors: [], year: null, venue: null, abstract: null, oa_url: null, byo: null },
  { citekey: 'c2018', title: 'Gamma', authors: ['G, H'], year: 2018, venue: null, abstract: 'short', oa_url: null, byo: { file: 'c.pdf', sha256: 'f'.repeat(64), text_sha256: null } },
  { citekey: 'd2017', title: null, authors: ['Z, Z'], year: 2017, abstract: '   ', tier: 'peer-reviewed' },
];

test('FEED-01: records are exactly the requested citekeys, in order, once each; unknown keys dropped', () => {
  const recs = buildSourceContext(LIB, ['c2018', 'a2020', 'ghost2099', 'a2020']);
  assert.deepEqual(recs.map((r) => r.citekey), ['c2018', 'a2020']);
  assert.deepEqual(buildSourceContext(LIB, []), []);
});

test('FEED-01: the record shape — ≤5 authors, ≤800-char abstract, nulls for unknowns, tier read when present', () => {
  const [a, b, d] = buildSourceContext(LIB, ['a2020', 'b2019', 'd2017']);
  assert.equal(a!.authors.length, MAX_AUTHORS);
  assert.equal(a!.abstract!.length, MAX_ABSTRACT_CHARS);
  assert.equal(a!.year, 2020);
  assert.equal(a!.venue, 'J');
  assert.equal(b!.title, 'Beta study', 'whitespace collapsed');
  assert.equal(b!.abstract, null);
  assert.equal(b!.year, null);
  assert.equal(b!.tier, null);
  assert.equal(d!.title, '(untitled)');
  assert.equal(d!.abstract, null, 'a blank abstract is null');
  assert.equal(d!.tier, 'peer-reviewed');
  assert.deepEqual(Object.keys(a!).sort(), ['abstract', 'authors', 'citekey', 'full_text', 'tier', 'title', 'venue', 'year']);
});

test('FEED-01: full_text has one derivation — a BYO record or an open-access URL', () => {
  assert.equal(fullTextAvailable({ byo: null, oa_url: 'https://x.org/p.pdf' }), true);
  assert.equal(fullTextAvailable({ byo: { file: 'p.pdf' }, oa_url: null }), true);
  assert.equal(fullTextAvailable({ byo: true, oa_url: null }), true);
  assert.equal(fullTextAvailable({ byo: null, oa_url: null }), false);
  assert.equal(fullTextAvailable({ byo: null, oa_url: '  ' }), false);
  const recs = buildSourceContext(LIB, ['a2020', 'b2019', 'c2018']);
  assert.deepEqual(recs.map((r) => r.full_text), [true, false, true]);
});

test('FEED-03: the outline projection covers every entry with the first author and a ≤300-char abstract', () => {
  const recs = buildOutlineSources(LIB);
  assert.deepEqual(recs.map((r) => r.citekey), ['a2020', 'b2019', 'c2018', 'd2017']);
  assert.equal(recs[0]!.first_author, 'A, One');
  assert.equal(recs[0]!.abstract!.length, OUTLINE_ABSTRACT_CHARS);
  assert.equal(recs[1]!.first_author, null);
  assert.deepEqual(Object.keys(recs[0]!).sort(), ['abstract', 'citekey', 'first_author', 'tier', 'title', 'year']);
  assert.deepEqual([...libraryCitekeys(LIB)].sort(), ['a2020', 'b2019', 'c2018', 'd2017']);
});

test('clip never splits a surrogate pair', () => {
  const s = 'ab\u{1F600}cd'; // the emoji is two UTF-16 units at index 2..3
  assert.equal(clip(s, 3), 'ab');
  assert.equal(clip(s, 4), 'ab\u{1F600}');
  assert.equal(clip('abc', 10), 'abc');
});

test('FEED-01: source-context.ts is pure (no fs, network or process imports)', () => {
  const src = fs.readFileSync(new URL('../bin/lib/source-context.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from ['"](?:node:)?(?:fs|fs\/promises|http|https|net|child_process|process)['"]/);
  assert.doesNotMatch(src, /from ['"]\.\/(?:http|library|paths|state)\.js['"]/);
});

test('FEED-01: the Phase-12 placeholder "(no sources loaded yet" is gone from bin/', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let hits = '';
  try {
    hits = execFileSync('git', ['grep', '-n', '(no sources loaded yet', '--', 'bin'], { cwd: root, encoding: 'utf8' });
  } catch (e) {
    // git grep exits 1 when nothing matches.
    if ((e as { status?: number }).status !== 1) throw e;
  }
  assert.equal(hits, '');
});
