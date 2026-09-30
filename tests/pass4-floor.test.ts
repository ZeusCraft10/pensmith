// tests/pass4-floor.test.ts — Pass 4's deterministic floor, its sentence-level
// citation check, the per-paragraph audit that can only ADD orphans, and the
// per-paragraph render (VRFY-23, D-20-29).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftSentences, proseParagraphs, renderPass4Section, runPass4, type Pass4Result } from '../bin/lib/verify/pass4.js';
import { withLlmSandbox } from './helpers/llm-sandbox.js';

const KEY = 'sk-ant-test-pass4-floor-0001';
const REGISTER = 'Social media use clearly causes depression in every adolescent. Studies show that 73% of American cities saw street trees lower asthma hospitalizations by 40 percent.';

async function offline<T>(fn: () => Promise<T>): Promise<T> {
  const before = process.env['PENSMITH_NO_LLM'];
  process.env['PENSMITH_NO_LLM'] = '1';
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env['PENSMITH_NO_LLM'];
    else process.env['PENSMITH_NO_LLM'] = before;
  }
}

const total = (rs: readonly Pass4Result[]): number => rs.reduce((a, r) => a + r.orphanCount, 0);

// ---- Paragraphs and sentences ------------------------------------------------------

test('D-20-29: prose paragraphs skip headings, fenced code, tables, rules and comment lines; LF and CRLF agree', () => {
  const md = [
    '<!-- a comment line -->',
    '# Title',
    '',
    'First paragraph line one',
    'and line two.',
    '',
    '```',
    'Code that always causes every build to fail.',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '',
    'Setext heading',
    '--------------',
    'Second paragraph.',
    '',
    '---',
    '',
    '- A list item that stays prose.',
  ].join('\n');
  const lf = proseParagraphs(md).map((p) => p.text);
  assert.deepEqual(lf, ['First paragraph line one\nand line two.', 'Second paragraph.', '- A list item that stays prose.']);
  const crlf = proseParagraphs(md.replace(/\n/g, '\r\n')).map((p) => p.text.replace(/\r\n/g, '\n'));
  assert.deepEqual(crlf, lf);
  assert.deepEqual(proseParagraphs(md).map((p) => p.index), [1, 2, 3], 'paragraphs are numbered from 1');
});

test('D-20-29: sentences never split inside a citation, and a citation alone after the full stop joins its sentence', () => {
  const s = draftSentences('Trees cool cities [see @a, p. 5. Also @b]. They lower asthma. [@c]\n\nNext paragraph here.');
  assert.deepEqual(s.map((x) => x.text), ['Trees cool cities [see @a, p. 5. Also @b].', 'They lower asthma. [@c]', 'Next paragraph here.']);
  assert.deepEqual(s.map((x) => x.citations.flatMap((c) => c.keys)), [['a', 'b'], ['c'], []]);
  assert.deepEqual(s.map((x) => x.paragraph), [1, 1, 2]);
});

// ---- The floor ---------------------------------------------------------------------

test('VRFY-23: the two register sentences, uncited, are 2 orphans; cited in any Pandoc form, 0', async () => {
  await offline(async () => {
    assert.equal(total(await runPass4(REGISTER, { n: 1 })), 2);
    for (const [a, b] of [
      ['[@smith2020]', '[@lee2021]'],
      ['[@smith2020, p. 4]', '[see @lee2021; @park2019]'],
      ['[-@Smith2020]', '[@{lee2021}]'],
    ] as const) {
      const cited = REGISTER.replace('adolescent.', `adolescent ${a}.`).replace('40 percent.', `40 percent ${b}.`);
      assert.equal(total(await runPass4(cited, { n: 1 })), 0, cited);
    }
    const narrative = 'As @smith2020 argues, social media use clearly causes depression in every adolescent.';
    assert.equal(total(await runPass4(narrative, { n: 1 })), 0, 'a narrative citation cites its sentence');
  });
});

test('VRFY-23: each strong-marker class alone makes an uncited sentence an orphan', async () => {
  await offline(async () => {
    const sentences = {
      causal: 'Urban tree planting programs reduced summer heat in the downtown districts.',
      universal: 'None of the surveyed municipalities kept records of their street trees.',
      evidential: 'The municipal survey found a clear pattern across the northern districts.',
      statistic: 'Roughly 40 per cent of the municipal budget went to the street tree program.',
      comparative: 'Tree cover in the northern districts is greater than in the southern districts.',
    };
    for (const [cls, s] of Object.entries(sentences)) {
      const r = await runPass4(s, { n: 1 });
      assert.equal(total(r), 1, `${cls}: ${s}`);
      assert.deepEqual(r[0]!.orphans, [s]);
    }
    // Inflections count: shown, demonstrating, indicated, established.
    for (const s of [
      'The effect has been shown in several large municipal surveys of tree cover.',
      'Several municipal surveys indicated a pattern in the distribution of tree cover.',
      'Municipal records established a link between tree cover and summer heat.',
    ]) assert.equal(total(await runPass4(s, { n: 1 })), 1, s);
  });
});

test('VRFY-23: short sentences, questions and definitions are never claims', async () => {
  await offline(async () => {
    for (const s of [
      'Trees always help.',
      'Do street trees always lower asthma rates in every city?',
      'Canopy cover refers to the share of ground that every tree crown shades.',
    ]) assert.equal(total(await runPass4(s, { n: 1 })), 0, s);
  });
});

// ---- The per-paragraph audit (mock LLM) --------------------------------------------

const AMBIGUOUS = 'Ice sheets are retreating globally according to recent satellite measurements.';

test('VRFY-23: the audit runs once per paragraph with a claim and can add an uncited claim it marks', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const md = `${AMBIGUOUS} The data cover ten years [@nsidc2020].\n\nA short one.\n\nThe committee met in the spring.`;
    sb.mock!.script('orphan-label', {
      data: {
        claims: [
          { sentence: AMBIGUOUS, needs_citation: true, supported_by: [] },
          // Invented sentences and supported claims are never added.
          { sentence: 'Sea levels will rise ten metres by 2050.', needs_citation: true, supported_by: [] },
          { sentence: 'The data cover ten years [@nsidc2020].', needs_citation: true, supported_by: [] },
        ],
      },
    });
    const r = await runPass4(md, { n: 1 });
    assert.equal(sb.mock!.callCount('orphan-label'), 1, 'only the paragraph with a claim is audited');
    const first = r[0]!;
    assert.equal(first.orphanCount, 1);
    assert.deepEqual(first.orphans, [AMBIGUOUS]);
    assert.equal(first.claims.find((c) => c.sentence === AMBIGUOUS)?.by, 'llm');
    // The request carries the paragraph, fenced.
    const sent = (sb.mock!.bodiesFor('orphan-label')[0]!['messages'] as Array<{ content: string }>)[0]!.content;
    assert.ok(sent.includes('<paragraph>') && sent.includes(AMBIGUOUS));
    assert.match(renderPass4Section(r), /\(audit\)/);
  });
});

test('VRFY-23: an audit answering no orphans, or naming a key the paragraph cites, never lowers the floor', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    const md = `${REGISTER} Trees shade streets [@lee2021].`;
    sb.mock!.script(
      'orphan-label',
      { data: { claims: [] } },
      {
        data: {
          claims: [
            { sentence: 'Social media use clearly causes depression in every adolescent.', needs_citation: false, supported_by: [] },
            { sentence: 'Studies show that 73% of American cities saw street trees lower asthma hospitalizations by 40 percent.', needs_citation: true, supported_by: ['lee2021'] },
          ],
        },
      },
    );
    assert.equal(total(await runPass4(md, { n: 1 })), 2, 'an empty audit leaves the floor');
    assert.equal(total(await runPass4(md, { n: 1 })), 2, 'a "no citation needed" or a cited-key answer leaves the floor');
  });
});

test('VRFY-23: no audit under PENSMITH_NO_LLM or without a provider key; a failed audit leaves the floor with one WARN', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: '1' } }, async (sb) => {
    assert.equal(total(await runPass4(REGISTER, { n: 1 })), 2);
    assert.equal(sb.mock!.callCount(), 0, 'LLM stubbed: zero calls');
  });
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: undefined } }, async (sb) => {
    assert.equal(total(await runPass4(`${REGISTER}\n\n${REGISTER}`, { n: 1 })), 4);
    assert.equal(sb.mock!.callCount(), 0, 'no key: skipped, no request');
  });
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY } }, async (sb) => {
    sb.mock!.fail({ kind: 'http', status: 500 }, { slug: 'orphan-label', times: 20 });
    const writes: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let r: Pass4Result[];
    try {
      r = await runPass4(REGISTER, { n: 1 });
    } finally {
      process.stderr.write = orig;
    }
    assert.equal(total(r), 2, 'the floor stands');
    assert.equal(writes.filter((w) => w.includes('WARN — Pass 4 (orphan audit)')).length, 1, writes.join(''));
  });
});

// ---- The render --------------------------------------------------------------------

test('VRFY-23: renderPass4Section lists each paragraph\'s counts and its orphan sentences, clamped and table-safe', async () => {
  const long = `Every city ${'with a long | piped <b>clause</b> '.repeat(8)}always lowers heat.`;
  const r = await offline(() => runPass4(`${REGISTER}\n\nA calm paragraph with nothing to report.\n\n${long}`, { n: 1 }));
  const out = renderPass4Section(r);
  assert.match(out, /^## Pass-4 \(orphan claims, advisory/);
  assert.match(out, /Orphan claims: 3 /);
  assert.ok(out.includes('| Paragraph | Sentences | Claims | Orphans | Orphan sentences |'));
  const rows = out.split('\n').filter((l) => /^\| \d/.test(l));
  assert.equal(rows.length, 3);
  assert.ok(rows[0]!.startsWith('| 1 | 2 | 2 | 2 | "Social media use clearly causes depression in every adolescent." · "Studies show'));
  assert.ok(rows[1]!.startsWith('| 2 | 1 | 0 | 0 | — |'));
  // The piped, tagged sentence stays in its cell: 5 cells, no raw tag, clamped.
  assert.equal(rows[2]!.split('|').length - 2, 5, rows[2]);
  assert.ok(!rows[2]!.includes('<b>'));
  assert.ok(rows[2]!.includes('…"'), 'a long sentence is clamped');
  assert.equal(renderPass4Section([]), '## Pass-4 (orphan claims, advisory)\n\n_(no paragraphs to audit)_\n');
});
