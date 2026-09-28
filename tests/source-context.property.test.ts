// tests/source-context.property.test.ts — FEED-01 / D-18-21: property — the
// source-context builders never emit a citekey or a title that is not in their
// input, and a section's records never include a citekey it was not asked for.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { buildOutlineSources, buildSourceContext, type SourceContextInput } from '../bin/lib/source-context.js';

const citekey = fc.stringMatching(/^[a-z][a-z0-9_-]{0,11}$/);
const entry: fc.Arbitrary<SourceContextInput> = fc.record({
  citekey,
  title: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
  authors: fc.array(fc.string({ maxLength: 12 }), { maxLength: 8 }),
  year: fc.option(fc.integer({ min: 1000, max: 2200 }), { nil: null }),
  venue: fc.option(fc.string({ maxLength: 12 }), { nil: null }),
  abstract: fc.option(fc.string({ maxLength: 1200 }), { nil: null }),
  oa_url: fc.option(fc.constant('https://example.org/x.pdf'), { nil: null }),
  byo: fc.constant(null),
});

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

test('FEED-01 property: output citekeys ⊆ requested ∩ library, titles come from the input', () => {
  fc.assert(
    fc.property(fc.array(entry, { maxLength: 12 }), fc.array(citekey, { maxLength: 12 }), (lib, wanted) => {
      const recs = buildSourceContext(lib, wanted);
      const libKeys = new Set(lib.map((e) => e.citekey));
      const titles = new Set(lib.map((e) => (typeof e.title === 'string' ? norm(e.title) : '')));
      titles.add('(untitled)');
      for (const r of recs) {
        assert.ok(wanted.includes(r.citekey), `${r.citekey} was not requested`);
        assert.ok(libKeys.has(r.citekey), `${r.citekey} is not in the library`);
        assert.ok(r.title === '(untitled)' || titles.has(r.title), `title "${r.title}" is not from the input`);
        assert.ok(r.authors.length <= 5);
        assert.ok(r.abstract === null || r.abstract.length <= 800);
      }
      assert.equal(new Set(recs.map((r) => r.citekey)).size, recs.length, 'no duplicates');
    }),
    { numRuns: 300 },
  );
});

test('FEED-03 property: the outline projection only holds library citekeys and titles', () => {
  fc.assert(
    fc.property(fc.array(entry, { maxLength: 12 }), (lib) => {
      const libKeys = new Set(lib.map((e) => e.citekey));
      const titles = new Set(lib.map((e) => (typeof e.title === 'string' ? norm(e.title) : '')));
      for (const r of buildOutlineSources(lib)) {
        assert.ok(libKeys.has(r.citekey));
        assert.ok(r.title === '(untitled)' || titles.has(r.title));
        assert.ok(r.abstract === null || r.abstract.length <= 300);
      }
    }),
    { numRuns: 300 },
  );
});
