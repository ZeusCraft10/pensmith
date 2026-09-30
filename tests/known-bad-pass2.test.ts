// tests/known-bad-pass2.test.ts — Pass 2 (claim support, advisory) on the
// adversarial fixture (VRFY-03, VRFY-21, VRFY-22).
//
//   - VRFY-03: the fixture calibrates the UNCLEAR bias (>= 5 of its cases are
//     UNCLEAR: topic overlap is not support);
//   - under PENSMITH_NO_LLM=1 every row is a conservative UNCLEAR and no
//     request is sent;
//   - VRFY-22 (mock LLM): a judge answering each case's expected verdict with
//     evidence quoted from the source abstract keeps that evidence (a verbatim
//     substring of the text sent) in the Evidence column; evidence the source
//     never wrote is dropped;
//   - ARCH-10 → RUN-18: Pass 2 reaches the model only through complete(),
//     whose transport checks the SESSION cap before any byte is sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPass2Section, runPass2, type Pass2BibEntry } from '../bin/lib/verify/pass2.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';

interface Pass2Fixture {
  citekey: string;
  claim_sentence: string;
  source_title: string;
  source_abstract: string;
  expected_verdict: 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNCLEAR';
  adversarial_reason: string;
}

const FIXTURES = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/pass2-adversarial.json', import.meta.url)), 'utf8')) as Pass2Fixture[];
const VALID_VERDICTS = new Set(['SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'UNCLEAR']);
const KEY = 'sk-ant-test-known-bad-pass2-0001';

/** A one-sentence draft citing the case's key, and its bib entry with the source abstract. */
function caseInput(e: Pass2Fixture): { draft: string; bib: Map<string, Pass2BibEntry> } {
  const claim = e.claim_sentence.replace(/[.!?]\s*$/, '');
  return {
    draft: `${claim} [@${e.citekey}].`,
    bib: new Map([[e.citekey, { title: e.source_title, author: ['Author, A.'], abstract: e.source_abstract }]]),
  };
}

test('known-bad-pass2: the fixture has >= 10 cases, >= 5 UNCLEAR, and every other verdict at least once (VRFY-03)', () => {
  assert.ok(FIXTURES.length >= 10, `${FIXTURES.length} cases`);
  for (const e of FIXTURES) {
    for (const k of ['citekey', 'claim_sentence', 'source_title', 'source_abstract', 'adversarial_reason'] as const) {
      assert.equal(typeof e[k], 'string', `${k} is a string`);
    }
    assert.ok(VALID_VERDICTS.has(e.expected_verdict), e.expected_verdict);
  }
  assert.ok(FIXTURES.filter((e) => e.expected_verdict === 'UNCLEAR').length >= 5, 'UNCLEAR-bias calibration');
  for (const v of ['SUPPORTED', 'PARTIAL', 'UNSUPPORTED']) assert.ok(FIXTURES.some((e) => e.expected_verdict === v), v);
});

test('known-bad-pass2: under PENSMITH_NO_LLM=1 every row is UNCLEAR and no request is sent (VRFY-03)', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: '1' } }, async (sb) => {
    for (const e of FIXTURES) {
      const { draft, bib } = caseInput(e);
      const rows = await runPass2(draft, bib, { n: 1 });
      assert.equal(rows.length, 1, e.citekey);
      assert.equal(rows[0]!.verdict, 'UNCLEAR');
      assert.equal(rows[0]!.evidence, '');
      for (const k of ['citekey', 'claimSentence', 'verdict', 'rationale', 'evidence']) assert.ok(k in rows[0]!, k);
    }
    assert.equal(sb.mock!.callCount(), 0);
  });
});

test('known-bad-pass2 (VRFY-22, mock LLM): each judgment keeps evidence quoted from the source abstract; invented evidence is dropped', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    for (const e of FIXTURES) {
      const { draft, bib } = caseInput(e);
      // The judge quotes the abstract's first sentence for a decided verdict, nothing for UNCLEAR.
      const quote = e.expected_verdict === 'UNCLEAR' ? '' : (/^.*?[.!?](?=\s|$)/.exec(e.source_abstract)?.[0] ?? e.source_abstract);
      sb.mock!.script('claim-support', { data: { verdict: e.expected_verdict, rationale: e.adversarial_reason.slice(0, 200), evidence: quote } });
      const [row] = await runPass2(draft, bib, { n: 1 });
      assert.equal(row!.verdict, e.expected_verdict, e.citekey);
      assert.equal(row!.evidence, quote, `${e.citekey}: evidence kept`);
      if (quote !== '') {
        assert.ok(e.source_abstract.replace(/\s+/g, ' ').includes(row!.evidence), 'the evidence is a substring of the source abstract');
        const line = renderPass2Section([row!]).split('\n').find((l) => l.startsWith(`| ${e.citekey} `))!;
        const cells = line.split('|').slice(1, -1).map((c) => c.trim());
        assert.equal(cells[2], `**${e.expected_verdict}**`);
        assert.equal(cells[4], quote.replace(/\s+/g, ' ').slice(0, 160), 'a non-empty Evidence cell');
      }
    }
    const e = FIXTURES.find((x) => x.expected_verdict === 'UNSUPPORTED')!;
    const { draft, bib } = caseInput(e);
    sb.mock!.script('claim-support', { data: { verdict: 'UNSUPPORTED', rationale: 'contradicted', evidence: 'Words the source never wrote.' } });
    const [row] = await runPass2(draft, bib, { n: 1 });
    assert.equal(row!.verdict, 'UNSUPPORTED');
    assert.equal(row!.evidence, '', 'evidence that is not in the text sent is dropped (T-05-02-01)');
  });
});

test('known-bad-pass2: Pass 2 calls the model only via complete(), which checks the session cap before sending (ARCH-10 → RUN-18)', () => {
  const src = readFileSync(fileURLToPath(new URL('../bin/lib/verify/pass2.ts', import.meta.url)), 'utf-8');
  assert.ok(/\bcomplete(<[^>]*>)?\(\{/.test(src), 'pass2.ts calls complete()');
  assert.ok(!/from '\.\.\/http\.js'|from 'undici'/.test(src), 'pass2.ts never talks to the network directly');
  const transport = readFileSync(fileURLToPath(new URL('../bin/lib/anthropic.ts', import.meta.url)), 'utf-8');
  const gate = transport.indexOf('await reserveSessionBudget(');
  const send = transport.indexOf('await sendAttempt(');
  assert.ok(gate >= 0 && send > gate, 'the session cap is checked BEFORE the attempt is sent');
});
