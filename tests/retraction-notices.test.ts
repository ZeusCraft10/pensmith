// tests/retraction-notices.test.ts — which notices a Crossref record's
// RETRACTED / EXPRESSION_OF_CONCERN reason lists, when the record names one
// notice more than once.
//
// Crossref often lists one notice twice (from the publisher and from
// Retraction Watch). The reason says it once. Two notices are the same when
// their kind, their update type and their DOI as given, case-folded, are the
// same. The verdict does not depend on this, only the reason text written to
// VERIFICATION.md does. Folding doi.org URL and trailing-punctuation spellings
// into one notice would be a separate behaviour change, not a cleanup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSignal, recordRetraction } from '../bin/lib/verify/retraction.js';

/** The reasons recordRetraction gives for a Crossref work whose `updated-by` lists `notices`. */
function reasons(...notices: Array<{ DOI?: unknown; type: string }>): string[] {
  return recordRetraction({
    registry: 'Crossref',
    title: 'A study',
    raw: { DOI: '10.5555/work', 'updated-by': notices },
  }).map(describeSignal);
}

test('a notice listed twice under the same DOI, in another case, is listed once', () => {
  assert.deepEqual(reasons({ DOI: '10.5555/N', type: 'retraction' }, { DOI: '10.5555/n', type: 'retraction' }),
    ['retraction, notice 10.5555/N (per Crossref)']);
  assert.deepEqual(reasons({ DOI: '10.5555/É', type: 'retraction' }, { DOI: '10.5555/é', type: 'retraction' }),
    ['retraction, notice 10.5555/É (per Crossref)'], 'the case of a non-ASCII letter is folded too');
});

test('notices are told apart by their DOI as given: another spelling of it, or another non-string DOI, is another notice', () => {
  assert.deepEqual(reasons({ DOI: '10.5555/N', type: 'retraction' }, { DOI: 'https://doi.org/10.5555/n', type: 'retraction' }),
    ['retraction, notice 10.5555/N (per Crossref)', 'retraction, notice https://doi.org/10.5555/n (per Crossref)']);
  assert.deepEqual(reasons({ DOI: '10.5555/n', type: 'retraction' }, { DOI: '10.5555/n.', type: 'retraction' }),
    ['retraction, notice 10.5555/n (per Crossref)', 'retraction, notice 10.5555/n. (per Crossref)']);
  assert.equal(reasons({ DOI: 1, type: 'retraction' }, { DOI: 2, type: 'retraction' }).length, 2);
});

test('a retraction and an expression of concern under one DOI are both listed', () => {
  const signals = recordRetraction({
    registry: 'Crossref',
    title: 'A study',
    raw: {
      DOI: '10.5555/work',
      'updated-by': [{ DOI: '10.5555/n', type: 'retraction' }, { DOI: '10.5555/n', type: 'expression_of_concern' }],
    },
  });
  assert.deepEqual(signals.map((s) => s.kind), ['retracted', 'concern']);
});
