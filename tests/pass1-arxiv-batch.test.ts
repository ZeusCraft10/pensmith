// tests/pass1-arxiv-batch.test.ts — Pass 1 asks arXiv once for a draft's
// arXiv-only citations (SRC-17; merge review round 2).
//
// arXiv's documented floor is one request per 3 s. With one `id_list=<id>`
// request per citation, a section of arXiv preprints tripped the transport's
// breaker after three throttled requests and every remaining citation went
// UNVERIFIABLE without being asked. Pass 1 now asks for them together:
//   - arxiv.lookupByIds sends one `id_list=a,b,c&max_results=3` request and
//     answers each id: found, or not-found when the feed has no entry for it;
//   - runPass1 over three arXiv-only citations (an eprint, a DataCite arXiv
//     DOI) makes ONE arXiv request and gives each its verdict;
//   - a batch that failed (503 after the transport's retries) is UNVERIFIABLE-NETWORK
//     for each citation with that reason — never one request per citation
//     after it;
//   - a batch arXiv rejects as a whole (an error entry) and a lone id are
//     asked one id at a time (lookupById's own request).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as arxiv from '../bin/lib/sources/arxiv.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { liveLane } from './sources/three-way.js';

let counter = 0;
/** A modern arXiv id no other case (or cache entry) uses. */
function freshId(): string {
  counter += 1;
  const yymm = String(1000 + ((process.pid * 7 + counter) % 9000));
  const seq = String(10000 + ((Date.now() + counter * 7919) % 90000));
  return `${yymm}.${seq}`;
}

function atomEntry(id: string, title: string, author: string): string {
  return [
    '  <entry>',
    `    <id>http://arxiv.org/abs/${id}v1</id>`,
    `    <title>${title}</title>`,
    '    <published>2023-03-01T00:00:00Z</published>',
    `    <summary>An abstract of ${title}.</summary>`,
    `    <author><name>${author}</name></author>`,
    '  </entry>',
  ].join('\n');
}

function feed(entries: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n${entries.join('\n')}\n</feed>\n`;
}

const ATOM = { headers: { 'content-type': 'application/atom+xml; charset=utf-8' } } as const;

type Agent = Parameters<Parameters<typeof liveLane>[0]>[0];

/** Answer every arXiv request with `answer(path)`, recording each path asked. */
function arxivAnswers(agent: Agent, answer: (path: string) => { status: number; body: string }): string[] {
  const seen: string[] = [];
  agent.get('https://export.arxiv.org').intercept({ path: /.*/, method: 'GET' }).reply((opts) => {
    const p = decodeURIComponent(String(opts.path));
    seen.push(p);
    const a = answer(p);
    return { statusCode: a.status, data: a.body, responseOptions: ATOM };
  }).persist();
  return seen;
}

test('arxiv.lookupByIds: one id_list request for several ids — found, and not-found for an id the feed lacks', async () => {
  const [a, b, missing] = [freshId(), freshId(), freshId()];
  await liveLane(async (agent) => {
    const seen = arxivAnswers(agent, () => ({
      status: 200,
      body: feed([atomEntry(a, 'Attention in tables', 'Ada Lovelace'), atomEntry(b, 'Attention in graphs', 'Grace Hopper')]),
    }));
    const answers = await arxiv.lookupByIds([`arXiv:${a}`, b, `${missing}v2`, 'not an id']);
    assert.deepEqual(seen, [`/api/query?id_list=${a},${b},${missing}&max_results=3`]);
    const found = answers.get(`arXiv:${a}`);
    assert.equal(found?.kind, 'found');
    if (found?.kind === 'found') assert.equal(found.candidate.title, 'Attention in tables');
    assert.equal(answers.get(b)?.kind, 'found');
    assert.deepEqual(answers.get(`${missing}v2`), { kind: 'not-found', reason: `arXiv has no paper ${missing}` });
    assert.equal(answers.get('not an id')?.kind, 'not-found');
  });
});

test('arxiv.lookupByIds: a lone id and a batch arXiv rejects as a whole get no answer (each is asked on its own)', async () => {
  await liveLane(async (agent) => {
    const seen = arxivAnswers(agent, () => ({
      status: 200,
      body: feed(['  <entry>\n    <id>http://arxiv.org/api/errors#incorrect_id_format_for_x</id>\n    <title>Error</title>\n  </entry>']),
    }));
    const lone = await arxiv.lookupByIds([freshId()]);
    assert.equal(lone.size, 0, 'a lone id is left to lookupById');
    assert.equal(seen.length, 0, 'and not asked here');
    const rejected = await arxiv.lookupByIds([freshId(), freshId()]);
    assert.equal(rejected.size, 0, 'an error entry names no id: each is asked on its own');
    assert.equal(seen.length, 1);
  });
});

function bibFile(entries: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-pass1-arxiv-batch-'));
  mkdirSync(join(dir, '.paper'), { recursive: true });
  const p = join(dir, '.paper', 'CITATIONS.bib');
  writeFileSync(p, entries.join('\n'));
  return p;
}

function eprintEntry(key: string, id: string, title: string, author: string): string {
  return `@misc{${key},\n  author = {${author}},\n  title = {${title}},\n  year = {2023},\n  eprint = {${id}},\n  archivePrefix = {arXiv},\n}\n`;
}

test('Pass 1: three arXiv-only citations (eprints and a DataCite arXiv DOI) are re-fetched in ONE arXiv request', async () => {
  const [a, b, c] = [freshId(), freshId(), freshId()];
  const bib = bibFile([
    eprintEntry('lovelace2023', a, 'Attention in tables', 'Lovelace, Ada'),
    eprintEntry('hopper2023', b, 'Attention in graphs', 'Hopper, Grace'),
    `@misc{noether2023,\n  author = {Noether, Emmy},\n  title = {Attention in rings},\n  year = {2023},\n  doi = {10.48550/arXiv.${c}},\n}\n`,
  ]);
  await liveLane(async (agent) => {
    const seen = arxivAnswers(agent, () => ({
      status: 200,
      body: feed([
        atomEntry(a, 'Attention in tables', 'Ada Lovelace'),
        atomEntry(b, 'Attention in graphs', 'Grace Hopper'),
        atomEntry(c, 'Attention in rings', 'Emmy Noether'),
      ]),
    }));
    const rows = await runPass1('One [@lovelace2023]. Two [@hopper2023]. Three [@noether2023].\n', bib);
    assert.deepEqual(rows.map((r) => [r.citekey, r.verdict]), [['lovelace2023', 'OK'], ['hopper2023', 'OK'], ['noether2023', 'OK']], JSON.stringify(rows));
    assert.equal(seen.length, 1, `one arXiv request, not one per citation: ${JSON.stringify(seen)}`);
    assert.match(seen[0]!, /^\/api\/query\?id_list=[\d.,]+&max_results=3$/);
  });
});

test('Pass 1: a failed batch (503 after retries) is UNVERIFIABLE-NETWORK for every citation, with the reason — and no request per citation after it', async () => {
  const [a, b, c] = [freshId(), freshId(), freshId()];
  const bib = bibFile([
    eprintEntry('lovelace2023', a, 'Attention in tables', 'Lovelace, Ada'),
    eprintEntry('hopper2023', b, 'Attention in graphs', 'Hopper, Grace'),
    eprintEntry('noether2023', c, 'Attention in rings', 'Noether, Emmy'),
  ]);
  await liveLane(async (agent) => {
    const seen = arxivAnswers(agent, () => ({ status: 503, body: 'unavailable' }));
    const rows = await runPass1('One [@lovelace2023]. Two [@hopper2023]. Three [@noether2023].\n', bib);
    assert.deepEqual(rows.map((r) => r.verdict), ['UNVERIFIABLE-NETWORK', 'UNVERIFIABLE-NETWORK', 'UNVERIFIABLE-NETWORK'], JSON.stringify(rows));
    for (const r of rows) assert.match(r.reason, /arXiv lookup of arXiv:[\d.]+ failed: .*503.* — re-run verify once the lookup answers/, r.reason);
    assert.ok(seen.every((p) => p.includes(',')), `only the batched request (and its retries) was sent: ${JSON.stringify(seen)}`);
  });
});
