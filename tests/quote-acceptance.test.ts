// tests/quote-acceptance.test.ts — VRFY-20 (D-20-22): the per-quote acceptance
// record (sections/<NN>-<slug>/QUOTE-ACCEPTANCES.json, schema v1) and its one
// module. An acceptance is recorded only for an UNVERIFIABLE-QUOTE row; any
// other id is refused (EXIT_USAGE) naming its verdict, and nothing is written;
// it is bound to the quote's text hash and the draft hash; a record that does
// not parse accepts nothing. The lift itself is the gate core's
// (tests/gate-core.test.ts); verify's use of it is below (in-process, with the
// gate's Pass-3 seam standing in for the quotes stream's UNVERIFIABLE-QUOTE).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptableRows,
  excerptOf,
  loadQuoteAcceptances,
  quoteAcceptancesPath,
  readQuoteAcceptances,
  recordQuoteAcceptances,
  QuoteAcceptanceError,
  type AcceptableQuoteRow,
} from '../bin/lib/quote-acceptance.js';
import { QuoteAcceptancesSchema, QUOTE_ACCEPTANCES_SCHEMA_VERSION } from '../bin/lib/schemas/quote-acceptances.js';
import { quoteTextSha256 } from '../bin/lib/verify/verdicts.js';
import { EXIT_USAGE } from '../bin/lib/exit-codes.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { writeState, sectionDirOf } from './helpers/paper-cli-harness.js';
import type { Pass3Result } from '../bin/lib/verify/pass3.js';

const QUOTE = 'attention mechanisms are nothing more than lookup tables for bananas';
const ROWS: AcceptableQuoteRow[] = [
  { id: 'q1', citekey: 'aggarwal2022', quoteSha256: quoteTextSha256(QUOTE), verdict: 'UNVERIFIABLE-QUOTE', snippet: QUOTE.slice(0, 40) },
  { id: 'q2', citekey: 'vaswani2017', quoteSha256: quoteTextSha256('the dominant sequence transduction models'), verdict: 'NOT_FOUND', snippet: 'the dominant sequence transduction models' },
  { id: 'q3', citekey: 'smith2020', quoteSha256: quoteTextSha256('another'), verdict: 'PASS', snippet: 'another' },
];

function dir(): string {
  const d = mkdtempSync(join(tmpdir(), 'pensmith-qa-'));
  mkdirSync(d, { recursive: true });
  return d;
}

test('VRFY-20: acceptableRows takes only UNVERIFIABLE-QUOTE ids; any other id is EXIT_USAGE naming its verdict', () => {
  assert.deepEqual(acceptableRows(ROWS, ['q1'], '1').map((r) => r.id), ['q1']);
  for (const [ids, re] of [
    [['q2'], /--accept-quote q2: its verdict is NOT_FOUND \(\[@vaswani2017\]\) — only an UNVERIFIABLE-QUOTE quote .* can be accepted; nothing was recorded/],
    [['q3'], /--accept-quote q3: it already passes for every source it cites \(\[@smith2020\] PASS\) — nothing to accept; nothing was recorded/],
    [['q9'], /section 1's draft has no quote q9 — nothing was recorded/],
    [['Q1'], /a quote id is q1, q2, …/],
    [['q1', 'q2'], /q2: its verdict is NOT_FOUND/],
  ] as const) {
    assert.throws(() => acceptableRows(ROWS, ids, '1'), (e: unknown) => e instanceof QuoteAcceptanceError && e.exitCode === EXIT_USAGE && re.test(e.message));
  }
});

test('VRFY-20 (review round 2): a quote cited to several sources — one holds it (PASS), one shows no text (UNVERIFIABLE-QUOTE) — is accepted for the open source only, as the refusal tells the user to', () => {
  const multi: AcceptableQuoteRow[] = [
    { id: 'q1', citekey: 'a', quoteSha256: quoteTextSha256(QUOTE), verdict: 'PASS', snippet: QUOTE.slice(0, 40) },
    { id: 'q1', citekey: 'b', quoteSha256: quoteTextSha256(QUOTE), verdict: 'UNVERIFIABLE-QUOTE', snippet: QUOTE.slice(0, 40) },
    { id: 'q2', citekey: 'a', quoteSha256: quoteTextSha256('x'), verdict: 'FUZZY', snippet: 'x' },
    { id: 'q2', citekey: 'c', quoteSha256: quoteTextSha256('x'), verdict: 'NOT_FOUND', snippet: 'x' },
  ];
  assert.deepEqual(acceptableRows(multi, ['q1'], '1').map((r) => [r.id, r.citekey]), [['q1', 'b']]);
  // A NOT_FOUND source is never covered, whatever the other source says.
  assert.throws(() => acceptableRows(multi, ['q2'], '1'), (e: unknown) => e instanceof QuoteAcceptanceError && /q2: its verdict is NOT_FOUND \(\[@c\]\)/.test(e.message));
});

test('VRFY-20: recordQuoteAcceptances writes schema v1, bound to the quote and draft hashes; a re-accept replaces, a changed draft drops the void ones', async () => {
  const d = dir();
  const at = new Date('2026-09-30T10:00:00.000Z');
  const recorded = await recordQuoteAcceptances(d, [ROWS[0]!, ROWS[1]!], 'a'.repeat(64), 'flag', at);
  assert.deepEqual(recorded.map((a) => a.quote_id), ['q1'], 'a non-UNVERIFIABLE-QUOTE row is never recorded');
  const file = JSON.parse(readFileSync(quoteAcceptancesPath(d), 'utf8'));
  assert.equal(file.$schemaVersion, QUOTE_ACCEPTANCES_SCHEMA_VERSION);
  assert.ok(QuoteAcceptancesSchema.safeParse(file).success);
  assert.deepEqual(file.acceptances[0], {
    quote_id: 'q1',
    citekey: 'aggarwal2022',
    quote_sha256: quoteTextSha256(QUOTE),
    excerpt: QUOTE.slice(0, 40),
    draft_sha256: 'a'.repeat(64),
    accepted_at: '2026-09-30T10:00:00.000Z',
    via: 'flag',
  });
  await recordQuoteAcceptances(d, [ROWS[0]!], 'a'.repeat(64), 'prompt', new Date('2026-09-30T11:00:00.000Z'));
  assert.deepEqual(readQuoteAcceptances(d).map((a) => [a.quote_id, a.via, a.accepted_at]), [['q1', 'prompt', '2026-09-30T11:00:00.000Z']], 'replaced, never duplicated');
  await recordQuoteAcceptances(d, [{ ...ROWS[0]!, id: 'q2', quoteSha256: quoteTextSha256('a different quote') }], 'b'.repeat(64), 'flag');
  assert.deepEqual(readQuoteAcceptances(d).map((a) => a.draft_sha256), ['b'.repeat(64)], 'acceptances of another draft are void and dropped');
  assert.equal(excerptOf('x'.repeat(200)).length, 80);
});

test('VRFY-20: a record that does not parse or match the schema accepts nothing, and says why', () => {
  const d = dir();
  assert.deepEqual(loadQuoteAcceptances(d), { acceptances: [], problem: null });
  writeFileSync(quoteAcceptancesPath(d), '{ nope');
  assert.match(loadQuoteAcceptances(d).problem ?? '', /not readable JSON/);
  writeFileSync(quoteAcceptancesPath(d), JSON.stringify({ $schemaVersion: 1, acceptances: [{ quote_id: 'q1', citekey: 'k' }] }));
  assert.match(loadQuoteAcceptances(d).problem ?? '', /does not match its schema/);
  assert.deepEqual(readQuoteAcceptances(d), []);
});

test('VRFY-20 (verify, in-process): --accept-quote on an UNVERIFIABLE-QUOTE row records it and the section verifies; one changed draft byte voids it; a NOT_FOUND id exits 2 with nothing recorded', async () => {
  await withLlmSandbox({ mock: false, env: { PENSMITH_NO_LLM: '1' } }, async (sb) => {
    writeState(sb.root, [{ n: 1, slug: 'intro' }]);
    writeFileSync(join(sb.paper, 'OUTLINE.md'), '# O\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | intro |  | 300 | aggarwal2022 |\n');
    writeFileSync(join(sb.paper, 'CITATIONS.bib'), '@article{aggarwal2022, title={Attention Everywhere}, author={Aggarwal, Anu}, year={2022}}\n');
    const d = sectionDirOf(sb.root, 1, 'intro');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'PLAN.md'), "---\nschema_version: 2\nsection: 1\nslug: intro\ntitle: intro\ndepends_on: []\nassigned_sources: ['aggarwal2022']\nverified_against_draft_hash: null\nstatus: written\n---\n\n## Brief\n");
    writeFileSync(join(d, 'DRAFT.md'), `# Intro\n\nAs they put it, "${QUOTE}" [@aggarwal2022].\n`);
    // The gate's seams: a registrar that confirms the source, and the quotes stream's
    // Pass-3 answer for a paywalled source (UNVERIFIABLE-QUOTE).
    const gateDeps = {
      runPass1: async () => [{ citekey: 'aggarwal2022', verdict: 'OK' as const, titleJW: 1, authorJW: 1, reason: 'stand-in' }],
      runPass3: async (text: string): Promise<Pass3Result[]> =>
        text.includes(QUOTE)
          ? [{ citekey: 'aggarwal2022', id: 'q1', quoteSha256: quoteTextSha256(QUOTE), quoteSnippet: QUOTE.slice(0, 40), verdict: 'UNVERIFIABLE-QUOTE' as Pass3Result['verdict'], levRatio: 0, reason: 'no open-access copy' }]
          : [],
    };
    const { verifySection } = await import('../bin/cli/verify.js');
    const before = await verifySection(1, 'intro', null, { gateDeps });
    assert.deepEqual([before.status, before.blocked], ['unverifiable', true]);
    assert.match(readFileSync(join(d, 'VERIFICATION.md'), 'utf8'), /^- aggarwal2022 \[q1\] \("attention mechanisms are nothing more th…"\): \*\*UNVERIFIABLE-QUOTE\*\* — lev=n\/a — no open-access copy$/m);
    assert.ok(!existsSync(quoteAcceptancesPath(d)), 'without a terminal the quote-accept gate is skipped: nothing recorded');

    const accepted = await verifySection(1, 'intro', null, { gateDeps, acceptQuotes: ['q1'] });
    assert.deepEqual([accepted.status, accepted.blocked], ['verified', false]);
    const md = readFileSync(join(d, 'VERIFICATION.md'), 'utf8');
    assert.match(md, /^Status: verified$/m);
    assert.match(md, /\*\*UNVERIFIABLE-QUOTE\*\* — lev=n\/a — no open-access copy — accepted by you \S+ \(--accept-quote\)$/m);
    assert.match(md, /^## Accepted quotes$/m);
    assert.match(md, /^\| UNVERIFIABLE-QUOTE \(accepted\)|^\| Pass-3 \| UNVERIFIABLE-QUOTE \(accepted\) \| 1 \|$/m);
    assert.equal(readQuoteAcceptances(d).length, 1);

    // A later plain verify still honours it (same draft).
    assert.equal((await verifySection(1, 'intro', null, { gateDeps })).status, 'verified');
    // One changed byte of the draft voids it.
    writeFileSync(join(d, 'DRAFT.md'), `# Intro\n\nAs they put it, "${QUOTE}" [@aggarwal2022]!\n`);
    assert.equal((await verifySection(1, 'intro', null, { gateDeps })).status, 'unverifiable');

    // An id whose verdict is not UNVERIFIABLE-QUOTE: EXIT_USAGE after the verification is written; nothing recorded.
    const notFound = { ...gateDeps, runPass3: async (): Promise<Pass3Result[]> => [{ citekey: 'aggarwal2022', id: 'q1', quoteSha256: quoteTextSha256(QUOTE), quoteSnippet: QUOTE.slice(0, 40), verdict: 'NOT_FOUND', levRatio: 0.2, reason: 'not in the source' }] };
    const recordBefore = readFileSync(quoteAcceptancesPath(d), 'utf8');
    await assert.rejects(verifySection(1, 'intro', null, { gateDeps: notFound, acceptQuotes: ['q1'] }), (e: unknown) => e instanceof QuoteAcceptanceError && e.exitCode === EXIT_USAGE && /its verdict is NOT_FOUND/.test(e.message));
    assert.equal(readFileSync(quoteAcceptancesPath(d), 'utf8'), recordBefore, 'nothing recorded');
    assert.match(readFileSync(join(d, 'VERIFICATION.md'), 'utf8'), /^Status: failed$/m);
  });
});
