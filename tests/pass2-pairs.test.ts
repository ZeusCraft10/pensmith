// tests/pass2-pairs.test.ts — Pass 2 on real source text (VRFY-21, VRFY-22, D-20-28).
//
// Every (citing sentence, citekey) pair is judged once, on the LIBRARY.json
// abstract (else the bib abstract) plus an optional open-access passage, with at
// most 5 requests in flight; a source with no text is UNCLEAR "no source text"
// with no request; evidence survives only as a verbatim substring of the text
// sent; the Evidence column round-trips through done's Pass-2 reader.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { upsertSources, type LibraryCandidate } from '../bin/lib/library.js';
import { NO_SOURCE_TEXT_RATIONALE, pass2NotRun, renderPass2Section, runPass2, type Pass2BibEntry, type Pass2Result } from '../bin/lib/verify/pass2.js';
import { PASS2_TABLE_HEADER } from '../bin/lib/verify/verdicts.js';
import { readSectionUnsupported } from '../bin/cli/done.js';
import { FENCE_CLOSE, FENCE_OPEN } from '../bin/lib/untrusted-fence.js';
import { GateRefusedError } from '../bin/lib/gates.js';
import { currentSessionId } from '../bin/lib/session-log.js';

const KEY = 'sk-ant-test-pass2-pairs-0001';

const LIB_A = 'Street trees lowered summer surface temperatures by four degrees in the twelve cities measured.';
const LIB_B = 'Urban canopy loss was mapped from satellite imagery between 2001 and 2019.';

async function seedLibrary(root: string, withAbstract = true): Promise<void> {
  const base = { authors: ['Lee, Kim'], year: 2021, retracted: false, last_verified: '2026-01-01T00:00:00.000Z', source: 'crossref' as const, type: 'article-journal' };
  const candidates: LibraryCandidate[] = [
    { ...base, citekey: 'lee2021', doi: '10.1000/pass2.a', title: 'Street trees and heat', ...(withAbstract ? { abstract: LIB_A } : {}) },
    { ...base, citekey: 'park2019', doi: '10.1000/pass2.b', title: 'Canopy loss', ...(withAbstract ? { abstract: LIB_B } : {}) },
  ];
  await upsertSources(root, candidates, { provenance: 'research' });
}

/** The user message the mock received for request `i` of claim-support. */
function sent(sb: { mock: { bodiesFor(s: string): Array<Record<string, unknown>> } | null }, i: number): string {
  const msgs = sb.mock!.bodiesFor('claim-support')[i]!['messages'] as Array<{ content: string }>;
  return msgs[msgs.length - 1]!.content;
}

/** The fenced payload of the `source_text` block of a claim-support message. */
function sourceText(content: string): string {
  const m = /<source_text>\n([\s\S]*?)\n<\/source_text>/.exec(content);
  assert.ok(m, 'a source_text block');
  const payload = m[1] as string;
  assert.ok(payload.startsWith(`${FENCE_OPEN}\n`) && payload.endsWith(`\n${FENCE_CLOSE}`), 'the source text is fenced');
  return payload.slice(FENCE_OPEN.length + 1, payload.length - FENCE_CLOSE.length - 1);
}

test('VRFY-21: 3 sentences citing A and 1 citing B give 4 judgments, each on the LIBRARY abstract, fenced', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedLibrary(sb.root);
    const draft = [
      '# Heat',
      '',
      'Street trees cool the air around them [@lee2021]. Shade lowers surface temperature [@lee2021, p. 5].',
      'Cities with more trees report fewer heat deaths [see @lee2021].',
      '',
      'Canopy has been shrinking for two decades [@park2019].',
    ].join('\n');
    // The bib abstract differs: the LIBRARY abstract is read first.
    const bib = new Map<string, Pass2BibEntry>([
      ['lee2021', { title: 'Street trees and heat', abstract: 'A different bib abstract.' }],
      ['park2019', { title: 'Canopy loss' }],
    ]);
    const rows = await runPass2(draft, bib, { n: 1, root: sb.root });
    assert.deepEqual(rows.map((r) => r.citekey), ['lee2021', 'lee2021', 'lee2021', 'park2019']);
    assert.deepEqual(rows.map((r) => r.claimSentence), [
      'Street trees cool the air around them [@lee2021].',
      'Shade lowers surface temperature [@lee2021, p. 5].',
      'Cities with more trees report fewer heat deaths [see @lee2021].',
      'Canopy has been shrinking for two decades [@park2019].',
    ]);
    assert.equal(sb.mock!.callCount('claim-support'), 4);
    const texts = [0, 1, 2, 3].map((i) => sourceText(sent(sb, i)));
    for (const t of texts.slice(0, 3)) assert.equal(t, `Abstract:\n${LIB_A}`);
    assert.equal(texts[3], `Abstract:\n${LIB_B}`);
    // The claim and the citation travel in their own fenced blocks.
    assert.ok(sent(sb, 1).includes('Shade lowers surface temperature [@lee2021, p. 5].'));
  });
});

test('VRFY-21: every citation form yields its keys; a sentence citing two keys is two pairs; a repeated pair is judged once', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const bib = new Map<string, Pass2BibEntry>(
      ['smith2020', 'a', 'b', 'Vaswani2017', 'k'].map((k) => [k, { title: k, abstract: `An abstract about ${k}.` }]),
    );
    const draft = [
      'A locator claim [@smith2020, p. 5].',
      'A cluster claim [@a; @b].',
      'As @Vaswani2017 shows, attention helps.',
      'Author suppressed [-@k].',
      'A cluster claim [@a; @b].',
    ].join(' ');
    const rows = await runPass2(draft, bib, { n: 1 });
    assert.deepEqual(rows.map((r) => r.citekey), ['smith2020', 'a', 'b', 'Vaswani2017', 'k']);
    assert.equal(sb.mock!.callCount('claim-support'), 5, 'the repeated (sentence, key) pairs are not judged twice');
  });
});

test('VRFY-21: a source with no abstract and no full text is UNCLEAR "no source text" with no request; the table keeps every row', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedLibrary(sb.root, false);
    const draft = 'Street trees cool the air [@lee2021]. Canopy has been shrinking [@park2019].';
    const bib = new Map<string, Pass2BibEntry>([['park2019', { title: 'Canopy loss', abstract: LIB_B }]]);
    const rows = await runPass2(draft, bib, { n: 1, root: sb.root });
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0]!.verdict, rows[0]!.rationale], ['UNCLEAR', NO_SOURCE_TEXT_RATIONALE]);
    assert.match(rows[0]!.rationale, /no source text/);
    assert.equal(sb.mock!.callCount('claim-support'), 1, 'only the source with text (the bib abstract) is judged');
    assert.equal(sourceText(sent(sb, 0)), `Abstract:\n${LIB_B}`);
    const table = renderPass2Section(rows);
    assert.equal(table.split('\n').filter((l) => l.startsWith('| lee2021') || l.startsWith('| park2019')).length, 2);
  });
});

test('VRFY-21: at most 5 claim-support requests are in flight, and more than 1 when there are 5 or more pairs', async () => {
  let inFlight = 0;
  let peak = 0;
  await withLlmSandbox(
    {
      mock: 'anthropic',
      env: { ANTHROPIC_API_KEY: KEY },
      mockOptions: {
        // Longer than http.ts's per-host request interval (one token, 5/s for
        // a model endpoint), so requests overlap as they would against a real
        // provider that takes seconds to answer.
        delayMs: 800,
        onRequest: (r) => {
          if (r.slug !== 'claim-support') return;
          inFlight += 1;
          peak = Math.max(peak, inFlight);
        },
        onResponse: (r) => {
          if (r.slug === 'claim-support') inFlight -= 1;
        },
      },
    },
    async (sb) => {
      const keys = Array.from({ length: 9 }, (_, i) => `src${i}`);
      const bib = new Map<string, Pass2BibEntry>(keys.map((k) => [k, { title: k, abstract: `Abstract of ${k}.` }]));
      const draft = keys.map((k) => `Claim number ${k} holds [@${k}].`).join(' ');
      const rows = await runPass2(draft, bib, { n: 1 });
      assert.equal(rows.length, 9);
      assert.equal(sb.mock!.callCount('claim-support'), 9);
      assert.deepEqual(rows.map((r) => r.citekey), keys, 'results keep document order');
    },
  );
  assert.ok(peak <= 5, `peak ${peak} ≤ 5`);
  assert.ok(peak > 1, `peak ${peak} > 1 (concurrent)`);
});

test('VRFY-21: the full-text provider adds the passage nearest the claim unless [verification] fetch_full_text = false', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const calls: Array<[string, string]> = [];
    const fullText = async (key: string, claim: string): Promise<string | null> => {
      calls.push([key, claim]);
      return key === 'lee2021' ? 'Across the twelve cities,  shaded streets were four degrees cooler.' : null;
    };
    const bib = new Map<string, Pass2BibEntry>([['lee2021', { title: 'Trees' }], ['park2019', { title: 'Canopy' }]]);
    const draft = 'Shaded streets are cooler [@lee2021]. Canopy shrank [@park2019].';
    const rows = await runPass2(draft, bib, { n: 1, root: sb.root, fullText });
    assert.deepEqual(calls, [['lee2021', 'Shaded streets are cooler [@lee2021].'], ['park2019', 'Canopy shrank [@park2019].']]);
    assert.equal(sb.mock!.callCount('claim-support'), 1, 'the full-text passage alone is source text; park2019 has none');
    assert.equal(sourceText(sent(sb, 0)), 'Passage from the open-access full text nearest the claim:\nAcross the twelve cities, shaded streets were four degrees cooler.');
    assert.equal(rows[1]!.rationale, NO_SOURCE_TEXT_RATIONALE);

    calls.length = 0;
    await runPass2(draft, bib, { n: 1, root: sb.root, fullText, fetchFullText: false });
    assert.deepEqual(calls, [], 'fetchFullText: false → the provider is not asked');
    sb.writePaperConfig('schema_version = 2\n[verification]\nfetch_full_text = false\n');
    await runPass2(draft, bib, { n: 1, root: sb.root, fullText });
    assert.deepEqual(calls, [], '[verification] fetch_full_text = false → the provider is not asked');

    // A provider that fails leaves the abstract.
    const throwing = async (): Promise<string | null> => {
      throw new Error('offline');
    };
    fs.rmSync(path.join(sb.paper, 'config.toml'));
    const withAbstract = new Map<string, Pass2BibEntry>([['lee2021', { title: 'Trees', abstract: 'The bib abstract.' }]]);
    const [r] = await runPass2('Shaded streets are cooler [@lee2021].', withAbstract, { n: 1, root: sb.root, fullText: throwing });
    assert.notEqual(r!.rationale, NO_SOURCE_TEXT_RATIONALE);
    assert.equal(sourceText(sent(sb, sb.mock!.callCount('claim-support') - 1)), 'Abstract:\nThe bib abstract.');
  });
});

test('VRFY-22: an UNSUPPORTED judgment keeps evidence only as a verbatim substring of the source text, in the Evidence column done reads', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    await seedLibrary(sb.root);
    const evidence = 'four degrees in the twelve cities measured';
    sb.mock!.script(
      'claim-support',
      { data: { verdict: 'UNSUPPORTED', rationale: 'The source reports four degrees, not ten.', evidence } },
      { data: { verdict: 'UNSUPPORTED', rationale: 'Contradicted.', evidence: 'a sentence the source never wrote' } },
    );
    const draft = 'Street trees cool cities by ten degrees [@lee2021]. Canopy doubled [@park2019].';
    const rows = await runPass2(draft, new Map(), { n: 1, root: sb.root });
    assert.equal(rows[0]!.verdict, 'UNSUPPORTED');
    assert.equal(rows[0]!.evidence, evidence);
    assert.ok(LIB_A.includes(rows[0]!.evidence), 'the evidence is a substring of the LIBRARY abstract');
    assert.equal(rows[1]!.evidence, '', 'fabricated evidence is dropped');

    // The Evidence column: header, clamped cells, and done's reader gets it back.
    const table = renderPass2Section(rows);
    assert.ok(table.split('\n').includes(PASS2_TABLE_HEADER));
    const sec = path.join(sb.paper, 'sections', '01-heat');
    fs.mkdirSync(sec, { recursive: true });
    fs.writeFileSync(path.join(sec, 'VERIFICATION.md'), `# VERIFICATION (Section 1, heat)\n\nStatus: verified\n\n${table}`);
    const read = readSectionUnsupported(sb.root);
    assert.deepEqual(read.map((r) => [r.citekey, r.evidence]), [['lee2021', evidence], ['park2019', '']]);
  });
});

test('VRFY-22: the Pass-2 table is table-safe — pipes, newlines and tags never break a row; evidence is clamped to 160 characters', () => {
  const row: Pass2Result = {
    citekey: 'k|x',
    claimSentence: 'A claim | with a pipe\nand a newline <script>x</script>.',
    verdict: 'UNSUPPORTED',
    rationale: 'Because | reasons.',
    evidence: `${'e'.repeat(200)}|tail`,
  };
  const table = renderPass2Section([row]);
  const line = table.split('\n').find((l) => l.startsWith('| k'))!;
  assert.equal(line.split('|').length - 2, 5, line);
  assert.ok(!line.includes('<script>'));
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  assert.equal(cells[4]!.length, 160);
  assert.equal(renderPass2Section([]), '## Pass-2 (claim support, advisory)\n\n_(no citations to judge)_\n');
});

test('VRFY-21: LLM stubbed — no request; a source with text is the placeholder, one without is "no source text"; pass2NotRun keeps the pairs', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: '1' } }, async (sb) => {
    let asked = 0;
    const bib = new Map<string, Pass2BibEntry>([['a', { title: 'A', abstract: 'Abstract A.' }], ['b', { title: 'B' }]]);
    const rows = await runPass2('One [@a]. Two [@b]. Three [@a; @b].', bib, {
      n: 1,
      fullText: async () => {
        asked += 1;
        return 'x';
      },
      fetchFullText: false,
    });
    assert.equal(sb.mock!.callCount(), 0);
    assert.equal(asked, 0);
    assert.deepEqual(rows.map((r) => [r.citekey, r.verdict, r.rationale.startsWith('LLM stubbed') ? 'stub' : r.rationale]), [
      ['a', 'UNCLEAR', 'stub'],
      ['b', 'UNCLEAR', NO_SOURCE_TEXT_RATIONALE],
      ['a', 'UNCLEAR', 'stub'],
      ['b', 'UNCLEAR', NO_SOURCE_TEXT_RATIONALE],
    ]);
  });
  const notRun = pass2NotRun('One [@a]. Two [@b; @c].', 'cost cap');
  assert.deepEqual(notRun.map((r) => r.citekey), ['a', 'b', 'c']);
  assert.ok(notRun.every((r) => r.verdict === 'UNCLEAR' && r.rationale.startsWith('not run (cost cap)')));
});

test('RUN-18: the session cost cap stops Pass 2 before any request and is rethrown', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_COST_CAP_USD: '1' } }, async (sb) => {
    fs.writeFileSync(path.join(sb.paper, 'COSTS.jsonl'), `${JSON.stringify({
      ts: new Date().toISOString(), scope: 'task', scopeId: 'pass2-cap', provider: 'anthropic', model: 'claude-haiku-4-5',
      inputTokens: 100000, outputTokens: 10000, costUsd: 1.0, session: currentSessionId(),
    })}\n`);
    const bib = new Map<string, Pass2BibEntry>([['a', { title: 'A', abstract: 'Abstract A.' }]]);
    await assert.rejects(runPass2('One [@a]. Two [@a, p. 2].', bib, { n: 1 }), (e: unknown) => e instanceof GateRefusedError && e.exitCode === 5);
    assert.equal(sb.mock!.callCount(), 0);
  });
});
