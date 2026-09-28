// tests/source-policy.test.ts — the `[sources]` policy (SRC-09, SRC-10,
// D-19-16; PRD §10; bin/lib/source-policy.ts): PRD §10 defaults, each rule,
// require_doi meaning a registrar identifier, and the two-phase tier rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SOURCE_POLICY,
  sourcePolicyFrom,
  policyExclusion,
  applySourcePolicy,
  hasRegistrarIdentifier,
} from '../bin/lib/source-policy.js';
import { SourcesSchema } from '../bin/lib/schemas/config.js';

const pre = { tierFinal: false } as const;
const post = { tierFinal: true } as const;

test('PRD §10 defaults: no year filter, preprints/books/gov reports allowed, news excluded, a registrar identifier required', () => {
  assert.deepEqual({ ...DEFAULT_SOURCE_POLICY }, {
    minYear: null,
    allowPreprints: true,
    allowBooks: true,
    allowGovReports: true,
    allowNews: false,
    peerReviewedOnly: false,
    requireIdentifier: true,
  });
  assert.deepEqual(sourcePolicyFrom(undefined), DEFAULT_SOURCE_POLICY);
  assert.deepEqual(sourcePolicyFrom({}), DEFAULT_SOURCE_POLICY);
  const p = sourcePolicyFrom({ min_year: 2015, allow_preprints: false, peer_reviewed_only: true, require_doi: false, allow_news: true });
  assert.equal(p.minYear, 2015);
  assert.equal(p.allowPreprints, false);
  assert.equal(p.peerReviewedOnly, true);
  assert.equal(p.requireIdentifier, false);
  assert.equal(p.allowNews, true);
});

test('require_doi means a registrar identifier: a DOI, an ISBN, an arXiv id or a PMID', () => {
  assert.equal(hasRegistrarIdentifier({ doi: '10.1038/nature14539' }), true);
  assert.equal(hasRegistrarIdentifier({ isbn: '9780226458083' }), true, 'a book by its ISBN');
  assert.equal(hasRegistrarIdentifier({ arxiv: '1706.03762' }), true);
  assert.equal(hasRegistrarIdentifier({ pmid: '31978945' }), true);
  assert.equal(hasRegistrarIdentifier({ source: 'arxiv', id: '1706.03762v5' }), true, 'an arXiv record\'s own id');
  assert.equal(hasRegistrarIdentifier({ source: 'pubmed', id: '31978945' }), true);
  assert.equal(hasRegistrarIdentifier({ source: 'semanticscholar', id: 'abc123def' }), false, 'an S2 paper id is not a registrar identifier');
  assert.equal(hasRegistrarIdentifier({ isbn: '9780226458084' }), false, 'a bad ISBN check digit');
  const ex = policyExclusion({ source: 'openalex', id: 'W123' }, null, DEFAULT_SOURCE_POLICY, pre);
  assert.equal(ex?.rule, 'require_doi');
  assert.match(ex!.reason, /no DOI, ISBN, arXiv id or PMID/);
  assert.equal(policyExclusion({ isbn: '9780226458083' }, 'book', DEFAULT_SOURCE_POLICY, post), null, 'a book with an ISBN passes the default policy');
});

test('min_year excludes older works (unknown years are kept); allow_news excludes newspaper and magazine articles', () => {
  const p = sourcePolicyFrom({ min_year: 2015 });
  assert.deepEqual(policyExclusion({ doi: '10.1000/x1', year: 2009 }, null, p, pre), { rule: 'min_year', reason: 'min_year = 2015 (published 2009)' });
  assert.equal(policyExclusion({ doi: '10.1000/x1', year: 2015 }, null, p, pre), null);
  assert.equal(policyExclusion({ doi: '10.1000/x1', year: null }, null, p, pre), null, 'an unknown year is not excluded');
  assert.equal(policyExclusion({ doi: '10.1000/x1', type: 'article-newspaper' }, null, DEFAULT_SOURCE_POLICY, pre)?.rule, 'allow_news');
  assert.equal(policyExclusion({ doi: '10.1000/x1', type: 'article-magazine' }, null, DEFAULT_SOURCE_POLICY, pre)?.rule, 'allow_news');
  assert.equal(policyExclusion({ doi: '10.1000/x1', type: 'article-newspaper' }, null, sourcePolicyFrom({ allow_news: true }), pre), null);
});

test('tier rules: preprints, books, government reports, peer_reviewed_only — an unknown tier waits for the evaluator', () => {
  const noPre = sourcePolicyFrom({ allow_preprints: false });
  assert.equal(policyExclusion({ arxiv: '1706.03762' }, 'preprint', noPre, pre)?.rule, 'allow_preprints');
  assert.equal(policyExclusion({ isbn: '9780226458083' }, 'book', sourcePolicyFrom({ allow_books: false }), pre)?.rule, 'allow_books');
  assert.equal(policyExclusion({ doi: '10.1000/x1' }, 'gov-report', sourcePolicyFrom({ allow_gov_reports: false }), pre)?.rule, 'allow_gov_reports');
  const pr = sourcePolicyFrom({ peer_reviewed_only: true });
  assert.equal(policyExclusion({ doi: '10.1000/x1' }, 'preprint', pr, pre)?.rule, 'peer_reviewed_only');
  assert.equal(policyExclusion({ doi: '10.1000/x1' }, 'peer-reviewed', pr, post), null);
  assert.equal(policyExclusion({ doi: '10.1000/x1' }, null, pr, pre), null, 'before the evaluator an unknown tier is not excluded');
  const ex = policyExclusion({ doi: '10.1000/x1' }, null, pr, post);
  assert.equal(ex?.rule, 'peer_reviewed_only', 'after it, an unknown tier cannot be shown to be peer-reviewed');
  assert.match(ex!.reason, /tier unknown/);
});

test('applySourcePolicy splits allowed and excluded, first rule wins in a fixed order', () => {
  const p = sourcePolicyFrom({ min_year: 2015, allow_preprints: false });
  const items = [
    { key: 'old', doi: '10.1000/a1', year: 2001, tier: 'preprint' as const },
    { key: 'pre', arxiv: '2001.00001', year: 2020, tier: 'preprint' as const },
    { key: 'ok', doi: '10.1000/b1', year: 2020, tier: 'peer-reviewed' as const },
  ];
  const r = applySourcePolicy(items, (c) => c.tier, p, post);
  assert.deepEqual(r.allowed.map((c) => c.key), ['ok']);
  assert.deepEqual(r.excluded.map((e) => [e.candidate.key, e.exclusion.rule]), [['old', 'min_year'], ['pre', 'allow_preprints']]);
});

test('the policy keys are the config schema\'s [sources] keys', () => {
  const keys = Object.keys(SourcesSchema.shape);
  for (const k of ['require_doi', 'allow_preprints', 'allow_books', 'allow_gov_reports', 'allow_news', 'min_year', 'peer_reviewed_only']) {
    assert.ok(keys.includes(k), k);
  }
});
