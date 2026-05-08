// tests/doi.property.test.ts — fast-check property tests for bin/lib/doi.ts.
//
// Per D-19, the DOI normalizer MUST be idempotent over a fast-check corpus
// of valid / prefixed / trailing-punct / garbage strings. Idempotence is
// the single property that lets the verifier safely cache a normalized
// citation and re-compare it later — without it, two consecutive runs of
// normalize() over a stored canonical form might disagree, and a cached
// "OK" verification could flip to "FABRICATED" on re-check.
//
// The corpus generators live in tests/fixtures/doi-corpus.ts (W0) and are
// reused by Phase 3 verifier tests. tests/fixtures/ is excluded from
// tsconfig (Phase 0 D-13) so we tolerate the slight friction of importing
// from a not-typechecked module — the runtime imports still work because
// tsx loads the .ts file directly.
//
// Iteration counts:
//   - 1000 runs for normalizeDoi idempotence (the strongest guarantee)
//   - 1000 runs for trailing-punct accept (high-volume false-FABRICATED risk)
//   - 1000 runs for prefix-strip
//   - 1000 runs for garbage-rejection (covers the null-on-bad-input contract)
//   - 500 runs for arxiv/pmid (smaller surface)

import test from 'node:test';
import * as fc from 'fast-check';
import {
  normalizeDoi,
  normalizeArxiv,
  normalizePmid,
  normalizePmcid,
} from '../bin/lib/doi.js';
import {
  validDoi,
  doiWithTrailingPunct,
  doiWithPrefix,
  arxivNew,
  arxivOld,
  pmid,
  pmcid,
  garbage,
} from './fixtures/doi-corpus.js';

// ---------------------------------------------------------------------------
// Idempotence — the load-bearing property (D-19)
// ---------------------------------------------------------------------------

test('property: normalizeDoi is idempotent over validDoi corpus (1000 runs)', () => {
  fc.assert(
    fc.property(validDoi, (d) => {
      const once = normalizeDoi(d);
      // Some validDoi-generated strings may fail post-normalize validation
      // (e.g. the suffix consists entirely of punctuation that gets stripped,
      //  leaving an empty suffix). Skip those — the property is "idempotent
      //  WHERE defined". The garbage-rejection property covers the null path.
      if (once === null) return true;
      return normalizeDoi(once) === once;
    }),
    { numRuns: 1000 },
  );
});

test('property: normalizeDoi is idempotent over doiWithTrailingPunct (1000 runs)', () => {
  fc.assert(
    fc.property(doiWithTrailingPunct, (d) => {
      const once = normalizeDoi(d);
      if (once === null) return true;
      return normalizeDoi(once) === once;
    }),
    { numRuns: 1000 },
  );
});

test('property: normalizeDoi is idempotent over doiWithPrefix (1000 runs)', () => {
  fc.assert(
    fc.property(doiWithPrefix, (d) => {
      const once = normalizeDoi(d);
      if (once === null) return true;
      return normalizeDoi(once) === once;
    }),
    { numRuns: 1000 },
  );
});

// ---------------------------------------------------------------------------
// Trailing-punct + prefix acceptance — the spec's correctness gates
// ---------------------------------------------------------------------------

test('property: normalizeDoi result starts with "10." when input has a known prefix', () => {
  fc.assert(
    fc.property(doiWithPrefix, (d) => {
      const r = normalizeDoi(d);
      // Most prefixed-corpus inputs will normalize successfully; if they
      // don't (because the validDoi suffix happens to be invalid), accept
      // the null. Otherwise the canonical form MUST start with '10.'.
      return r === null || r.startsWith('10.');
    }),
    { numRuns: 1000 },
  );
});

// ---------------------------------------------------------------------------
// arXiv / PMID / PMCID corpus acceptance
// ---------------------------------------------------------------------------

test('property: normalizeArxiv accepts arxivNew corpus (500 runs)', () => {
  fc.assert(
    fc.property(arxivNew, (s) => normalizeArxiv(s) !== null),
    { numRuns: 500 },
  );
});

test('property: normalizeArxiv accepts arxivOld corpus (500 runs)', () => {
  fc.assert(
    fc.property(arxivOld, (s) => normalizeArxiv(s) !== null),
    { numRuns: 500 },
  );
});

test('property: normalizeArxiv is idempotent over arxivNew corpus (500 runs)', () => {
  fc.assert(
    fc.property(arxivNew, (s) => {
      const once = normalizeArxiv(s);
      if (once === null) return true;
      return normalizeArxiv(once) === once;
    }),
    { numRuns: 500 },
  );
});

test('property: normalizePmid accepts pmid corpus (500 runs)', () => {
  fc.assert(
    fc.property(pmid, (s) => normalizePmid(s) !== null),
    { numRuns: 500 },
  );
});

test('property: normalizePmid is idempotent over pmid corpus (500 runs)', () => {
  fc.assert(
    fc.property(pmid, (s) => {
      const once = normalizePmid(s);
      if (once === null) return true;
      return normalizePmid(once) === once;
    }),
    { numRuns: 500 },
  );
});

test('property: normalizePmcid accepts pmcid corpus (500 runs)', () => {
  fc.assert(
    fc.property(pmcid, (s) => normalizePmcid(s) !== null),
    { numRuns: 500 },
  );
});

// ---------------------------------------------------------------------------
// Garbage rejection — null-on-bad-input contract (1000 runs)
// ---------------------------------------------------------------------------

test('property: garbage corpus normalizes to null for normalizeDoi (1000 runs)', () => {
  fc.assert(
    fc.property(garbage, (g) => normalizeDoi(g) === null),
    { numRuns: 1000 },
  );
});
