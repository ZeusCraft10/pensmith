// tests/query-expansion.test.ts — the deterministic research query expansion
// (SRC-08, D-19-15; bin/lib/query-expansion.ts).
//
// It is the topic-disambiguator's model-free counterpart: the stub under
// PENSMITH_NO_LLM, the padding of a short scope, and the normaliser/clamp of
// every scope. Properties (fast-check): deterministic, bounded (at most
// MAX_QUERIES queries of at most MAX_QUERY_WORDS words), non-empty for any
// topic with a keyword (and then at least MIN_QUERIES), no duplicate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  expandTopicQueries,
  clampQueries,
  normalizeQuery,
  topicKeywords,
  keywordGroups,
  topicPhrase,
  topicLabel,
  disciplineTerm,
  MIN_QUERIES,
  MAX_QUERIES,
  MAX_QUERY_WORDS,
} from '../bin/lib/query-expansion.js';
import { disciplineSlugs } from '../bin/lib/disciplines.js';

const words = (q: string): number => q.split(' ').filter(Boolean).length;

test('expandTopicQueries: the topic phrase first, then keywords with the discipline name, groups, framings', () => {
  const q = expandTopicQueries('attention mechanisms in neural networks', 'computer-science');
  assert.equal(q[0], 'attention mechanisms in neural networks', 'the brief\'s own words are the first query (the recorded cassette query)');
  assert.equal(q[1], 'attention mechanisms neural networks computer science');
  assert.ok(q.includes('attention mechanisms computer science'));
  assert.ok(q.includes('neural networks computer science'));
  assert.equal(q.length, MAX_QUERIES);
  for (const x of q) assert.ok(words(x) <= MAX_QUERY_WORDS, x);
});

test('expandTopicQueries: assignment boilerplate is stripped before the keywords are taken', () => {
  assert.equal(topicPhrase('Write a 1500-word literature review on attention mechanisms in transformers, APA style'), 'attention mechanisms in transformers');
  assert.equal(topicPhrase('A 10 page essay about the French Revolution in MLA format'), 'the French Revolution');
  assert.equal(topicPhrase('review of randomized trials'), 'randomized trials');
  assert.equal(topicPhrase('History of Chicago'), 'History of Chicago', 'a subject word is never mistaken for a style');
  const q = expandTopicQueries('1500-word literature review on attention mechanisms in transformers', 'other');
  assert.equal(q[0], 'attention mechanisms in transformers');
  assert.ok(q.every((x) => !/\b1500\b|literature review/.test(x)), q.join(' | '));
  assert.equal(topicLabel('1500-word literature review on attention mechanisms in transformers'), 'attention-mechanisms-transformers');
  assert.equal(topicLabel(''), 'research-topic');
});

test('expandTopicQueries: a leading course code is boilerplate; the discipline name is never doubled ("history history")', () => {
  const t = 'History 210: Write a 2500-word research paper on the causes of the French Revolution (1789), drawing on economic, social and intellectual history';
  assert.equal(topicPhrase(t), 'the causes of the French Revolution (1789), drawing on economic, social and intellectual history');
  assert.equal(topicPhrase('PSYC 101 - Write an essay on adolescent sleep'), 'adolescent sleep');
  assert.equal(topicPhrase('CS 4820A – attention mechanisms in transformers'), 'attention mechanisms in transformers');
  assert.equal(topicPhrase('World War 2: causes and consequences'), 'World War 2: causes and consequences', 'a topic that merely contains a number is kept');
  const q = expandTopicQueries(t, 'history');
  assert.ok(q.every((x) => !/\bhistory history\b/.test(x)), q.join(' | '));
  assert.ok(q.includes('intellectual history'), q.join(' | '));
  assert.ok(q.includes('french revolution history'), q.join(' | '));
  assert.ok(!q.includes('history'), 'the discipline name alone is not a query');
  assert.ok(q.every((x) => !/\b210\b/.test(x)), 'the course number never reaches a query');
});

test('expandTopicQueries: a one-word topic still yields MIN_QUERIES..MAX_QUERIES; no keyword → []', () => {
  const q = expandTopicQueries('Keynes', 'history');
  assert.ok(q.length >= MIN_QUERIES && q.length <= MAX_QUERIES, q.join(' | '));
  assert.ok(q.includes('keynes history'));
  assert.deepEqual(expandTopicQueries('', 'history'), []);
  assert.deepEqual(expandTopicQueries('the of and 1500', 'history'), []);
});

test('disciplineTerm: the preset name, no term for the fallback preset, free text normalised', () => {
  assert.equal(disciplineTerm('computer-science'), 'computer science');
  assert.equal(disciplineTerm('biology'), 'biology', 'the name before "/"');
  assert.equal(disciplineTerm('other'), '');
  assert.equal(disciplineTerm('CS'), 'computer science');
  for (const slug of disciplineSlugs()) assert.doesNotThrow(() => disciplineTerm(slug));
});

test('keywordGroups / topicKeywords: stop words split the groups; numbers and boilerplate are not keywords', () => {
  assert.deepEqual(keywordGroups('social media use and adolescent depression'), [['social', 'media'], ['adolescent', 'depression']]);
  assert.deepEqual(topicKeywords('The Economic Consequences of the Peace'), ['economic', 'consequences', 'peace']);
  assert.deepEqual(topicKeywords('王小明 的 研究'), ['王小明', '研究'], 'a one-character token is not a keyword');
});

test('normalizeQuery / clampQueries: whitespace, quotes, the word cap, dedup, clamp and pad', () => {
  assert.equal(normalizeQuery('  "attention   heads"  '), 'attention heads');
  assert.equal(normalizeQuery('one two three four five six seven eight nine ten'), 'one two three four five six seven eight');
  const twelve = Array.from({ length: 12 }, (_, i) => `query number ${i + 1}`);
  const c12 = clampQueries(twelve, 'attention mechanisms in neural networks', 'computer-science');
  assert.equal(c12.queries.length, MAX_QUERIES, 'a 12-query scope is clamped to 10');
  assert.deepEqual(c12.queries, twelve.slice(0, 10), 'the first 10, in order');
  assert.equal(c12.dropped, 2);
  const seven = Array.from({ length: 7 }, (_, i) => `seven ${i}`);
  assert.deepEqual(clampQueries(seven, 'x y', 'other').queries, seven, 'a 7-query scope runs 7');
  const c3 = clampQueries(['a b', 'A  B', 'c d', 'e f'], 'attention mechanisms in neural networks', 'computer-science');
  assert.equal(c3.proposed, 3, 'case/whitespace duplicates collapse');
  assert.equal(c3.queries.length, MIN_QUERIES, 'a short scope is padded to 5');
  assert.equal(c3.padded, 2);
  assert.deepEqual(c3.queries.slice(0, 3), ['a b', 'c d', 'e f']);
  assert.equal(c3.queries[3], 'attention mechanisms in neural networks', 'padding comes from the topic expansion');
  assert.equal(clampQueries(seven, 'x y', 'other', 5).queries.length, 5, '--queries lowers the cap');
  assert.equal(clampQueries(twelve, 'x y', 'other', 99).queries.length, MAX_QUERIES, 'the cap never exceeds MAX_QUERIES');
});

test('property: expandTopicQueries is deterministic, bounded, non-empty and duplicate-free (fast-check, 1000 runs)', () => {
  const topicArb = fc.oneof(
    fc.string({ maxLength: 80 }),
    fc.array(fc.constantFrom('attention', 'of', 'the', 'neural', 'Keynes', 'économie', '研究', 'and', '1500-word', 'APA', 'review', 'transformer'), { maxLength: 12 }).map((w) => w.join(' ')),
  );
  const disciplineArb = fc.constantFrom(...disciplineSlugs(), 'CS', 'unknown field', '');
  fc.assert(
    fc.property(topicArb, disciplineArb, (topic, discipline) => {
      const a = expandTopicQueries(topic, discipline);
      const b = expandTopicQueries(topic, discipline);
      assert.deepEqual(a, b, 'deterministic');
      assert.ok(a.length <= MAX_QUERIES, 'bounded count');
      for (const q of a) {
        assert.ok(q.length > 0, 'non-empty query');
        assert.ok(words(q) <= MAX_QUERY_WORDS, `≤ ${MAX_QUERY_WORDS} words: ${q}`);
      }
      assert.equal(new Set(a.map((q) => q.toLowerCase())).size, a.length, 'no duplicate');
      if (topicKeywords(topicPhrase(topic)).length > 0) assert.ok(a.length >= MIN_QUERIES, `≥ ${MIN_QUERIES} for a topic with a keyword: ${JSON.stringify(topic)} → ${a.length}`);
      else assert.equal(a.length, 0);
    }),
    { numRuns: 1000 },
  );
});

test('property: clampQueries keeps 5..cap distinct normalised queries whenever the topic can pad (fast-check, 500 runs)', () => {
  fc.assert(
    fc.property(fc.array(fc.string({ maxLength: 40 }), { maxLength: 25 }), fc.integer({ min: 5, max: 10 }), (proposed, cap) => {
      const r = clampQueries(proposed, 'attention mechanisms in neural networks', 'computer-science', cap);
      assert.ok(r.queries.length >= MIN_QUERIES && r.queries.length <= cap, `${r.queries.length} in 5..${cap}`);
      assert.equal(new Set(r.queries.map((q) => q.toLowerCase())).size, r.queries.length);
      for (const q of r.queries) assert.equal(q, normalizeQuery(q), 'already normalised');
    }),
    { numRuns: 500 },
  );
});
