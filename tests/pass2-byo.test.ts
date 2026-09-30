// tests/pass2-byo.test.ts — Pass 2 (claim support, advisory) and the user's
// own PDFs. By default (PRD §9: a bring-your-own PDF's contents stay local)
// the judge gets the abstract alone and no PDF text reaches the model
// provider. With `[verification] send_byo_passages = true` a source with a
// hash-verified bring-your-own PDF is judged on its abstract plus the passages
// of its own text nearest the claim (SRC-15; read only through byo-text.ts,
// which re-hashes the PDF), and `evidence` may quote that text. Once the PDF
// is edited, the judge gets the abstract alone. (Review round 2 made the
// sending opt-in; the first test was the round-1 default.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withLlmSandbox } from './helpers/llm-sandbox.js';
import { REPO } from './helpers/paper-cli-harness.js';
import { ingestByoPdf } from '../bin/lib/byo-ingest.js';
import { runPass2 } from '../bin/lib/verify/pass2.js';
import { byoPassages } from '../bin/lib/byo-text.js';

const BYO = path.join(REPO, 'tests', 'fixtures', 'byo');
const KEY = 'sk-test-pass2-byo-0001';
const CLAIM = 'Deep learning lets models with many processing layers learn representations of data [@lecun2015].';

function userContent(body: Record<string, unknown>): string {
  const msgs = body['messages'] as Array<{ content: string | Array<{ text?: string }> }>;
  const last = msgs[msgs.length - 1]!.content;
  return typeof last === 'string' ? last : last.map((b) => b.text ?? '').join('');
}

test('PRD §9 (review round 2): by default Pass 2 sends no text of the user\'s own PDF to the model provider — the abstract alone', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    const o = await ingestByoPdf(sb.root, path.join(BYO, 'metadata-doi.pdf'));
    assert.equal(o.status, 'added', JSON.stringify(o));
    const bib = new Map([['lecun2015', { title: 'Deep learning', author: ['LeCun, Yann'], abstract: 'A review of deep learning.' }]]);
    const evidence = 'Deep learning allows computational models that are composed of multiple processing layers';
    sb.mock!.script('claim-support', { data: { verdict: 'SUPPORTED', rationale: 'The text says so.', evidence } });
    const [r] = await runPass2(`# Background\n\n${CLAIM}\n`, bib, { n: 1, root: sb.root });
    assert.equal(r!.evidence, '', 'evidence from text the judge never received is dropped');
    const sent = userContent(sb.mock!.bodiesFor('claim-support')[0]!);
    assert.match(sent, /A review of deep learning\./, 'the abstract');
    assert.doesNotMatch(sent, /Passages from the full text/);
    assert.doesNotMatch(sent, /composed of multiple processing layers/, 'no PDF text left the machine');
  });
});

test('SRC-15: with send_byo_passages Pass 2 sends the BYO passages nearest the claim; evidence may quote them; an edited PDF falls back to the abstract', async () => {
  await withLlmSandbox({ mock: 'anthropic', env: { ANTHROPIC_API_KEY: KEY, PENSMITH_NO_LLM: undefined } }, async (sb) => {
    const o = await ingestByoPdf(sb.root, path.join(BYO, 'metadata-doi.pdf'));
    assert.equal(o.status, 'added', JSON.stringify(o));
    const bib = new Map([['lecun2015', { title: 'Deep learning', author: ['LeCun, Yann'], abstract: 'A review of deep learning.' }]]);
    const evidence = 'Deep learning allows computational models that are composed of multiple processing layers';
    sb.mock!.script('claim-support', { data: { verdict: 'SUPPORTED', rationale: 'The text says so.', evidence } });

    const [r] = await runPass2(`# Background\n\n${CLAIM}\n`, bib, { n: 1, root: sb.root, shareByoPassages: true });
    assert.equal(r!.verdict, 'SUPPORTED');
    assert.equal(r!.evidence, evidence, 'evidence quoting the BYO text is kept (a verbatim substring of what was sent)');
    const sent = userContent(sb.mock!.bodiesFor('claim-support')[0]!);
    assert.match(sent, /A review of deep learning\./, 'the abstract');
    assert.match(sent, /Passages from the full text of the user's own copy \(sources\/lecun2015\.pdf\):/);
    assert.match(sent, /Deep learning allows computational models that are composed of multiple processing layers/);

    // Edited after ingest: the text is not used; the judge gets the abstract alone.
    fs.appendFileSync(path.join(sb.paper, 'sources', 'lecun2015.pdf'), '\n% edited\n');
    sb.mock!.script('claim-support', { data: { verdict: 'SUPPORTED', rationale: 'The text says so.', evidence } });
    const [again] = await runPass2(`# Background\n\n${CLAIM}\n`, bib, { n: 1, root: sb.root, shareByoPassages: true });
    assert.equal(again!.evidence, '', 'evidence not in the abstract is dropped (anti-fabrication)');
    const sent2 = userContent(sb.mock!.bodiesFor('claim-support')[1]!);
    assert.doesNotMatch(sent2, /Passages from the full text/);
  });
});

test('SRC-15: byoPassages picks the windows sharing the claim\'s words, in document order, within the cap', () => {
  const filler = (n: number): string => Array.from({ length: n }, (_, i) => `filler${i} sentence about nothing relevant.`).join(' ');
  const text = `${filler(80)} Photosynthesis converts light energy into chemical energy in chloroplasts. ${filler(80)} Chlorophyll absorbs red and blue light most strongly. ${filler(80)}`;
  const out = byoPassages(text, 'Chloroplasts convert light energy through photosynthesis, and chlorophyll absorbs blue light [@x].', 1300);
  assert.ok(out.length <= 1300 + 10, `capped (${out.length})`);
  assert.match(out, /Photosynthesis converts light energy/);
  assert.match(out, /Chlorophyll absorbs red and blue light/);
  assert.ok(out.indexOf('Photosynthesis') < out.indexOf('Chlorophyll'), 'document order');
  assert.equal(byoPassages('Short text.', 'anything'), 'Short text.', 'a short text is sent whole');
});
