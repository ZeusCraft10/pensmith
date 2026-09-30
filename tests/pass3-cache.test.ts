// tests/pass3-cache.test.ts — VRFY-19 (D-20-18): the extracted-text cache.
//
// A second verify / compile / done over the same paper makes no PDF request:
// the text of every open-access copy Pass 3 read is kept in the pensmith data
// dir (source-text/<sha256(url)>.json: url, final_url, content_sha256,
// text_sha256, text, saved_at, source), for the TTL of the source that fetched
// it. An entry whose text no longer hashes to text_sha256 is ignored; a copy
// fetched again whose bytes hash to content_sha256 is not extracted again; a
// re-check (`refresh`) fetches anew; a text over 4 MiB is never kept. Sources
// offline, the cache is neither read nor written: recorded fixtures replay
// exactly, and a miss is UNVERIFIABLE-NETWORK.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { _resetSourceTextMemoForTest, sourceTextCacheFile, SOURCE_TEXT_MAX_CHARS } from '../bin/lib/verify/source-text.js';
import { pensmithSourceTextCacheDir } from '../bin/lib/paths.js';
import { sourceTtlMs } from '../bin/lib/http.js';
import { textPdf } from './helpers/text-pdf.js';
import { libraryEntry } from './helpers/section-fixture.js';
import { liveLane, uniq, withContactEmail } from './sources/three-way.js';

const EMAIL = 'pensmith-dev@example.org';
const TEXT = 'Attention Is All You Need\nWe propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.';
const REAL = 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms';
const sha256 = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex');

type Agent = Parameters<Parameters<typeof liveLane>[0]>[0];

/** Unpaywall lists `url` for `doi` (answered once: the HTTP cache serves it after). */
function listed(agent: Agent, doi: string, url: string, count: { n: number } = { n: 0 }, times = 1): void {
  agent
    .get('https://api.unpaywall.org')
    .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${doi}?`), method: 'GET' })
    .reply(() => {
      count.n += 1;
      return {
        statusCode: 200,
        data: JSON.stringify({ doi, is_oa: true, best_oa_location: { url, url_for_pdf: url }, oa_locations: [{ url, url_for_pdf: url }] }),
        responseOptions: { headers: { 'content-type': 'application/json' } },
      };
    })
    .times(times);
}

/** Serve `bytes` at `https://repo.example<path>`, counting requests. */
function served(agent: Agent, path: string, bytes: Buffer, count: { n: number }, times = 1): void {
  agent
    .get('https://repo.example')
    .intercept({ path, method: 'GET' })
    .reply(() => {
      count.n += 1;
      return { statusCode: 200, data: bytes, responseOptions: { headers: { 'content-type': 'application/pdf' } } };
    })
    .times(times);
}

async function run(draft: string, doi: string, opts: { refresh?: ReadonlySet<string> } = {}): ReturnType<typeof runPass3> {
  _resetSourceTextMemoForTest(); // a new process: verify, then compile, then done
  return runPass3(draft, new Map([['k', { DOI: doi }]]), opts);
}

test('VRFY-19: a second run over the same draft, with the network denied, makes 0 PDF requests — the text comes from the cache', async () => {
  const pdf = await textPdf(TEXT);
  const pdfs = { n: 0 };
  const doi = `10.5555/${uniq('second')}`;
  const path = `/${uniq('second')}.pdf`;
  const url = `https://repo.example${path}`;
  await liveLane(async (agent) => {
    listed(agent, doi, url);
    served(agent, path, pdf, pdfs);
    const [first] = await run(`"${REAL}" [@k].`, doi);
    assert.deepEqual([first?.verdict, first?.reason], ['PASS', 'verbatim in the open-access PDF at repo.example']);
  }, { contactEmail: EMAIL });
  assert.equal(pdfs.n, 1);

  const entry = JSON.parse(readFileSync(sourceTextCacheFile(url), 'utf8')) as Record<string, unknown>;
  assert.equal(dirname(sourceTextCacheFile(url)), pensmithSourceTextCacheDir());
  assert.equal(sourceTextCacheFile(url), join(pensmithSourceTextCacheDir(), `${sha256(url)}.json`));
  assert.deepEqual(Object.keys(entry).sort(), ['content_sha256', 'final_url', 'saved_at', 'source', 'text', 'text_sha256', 'url']);
  assert.equal(entry['url'], url);
  assert.equal(entry['final_url'], url);
  assert.equal(entry['source'], 'generic');
  assert.equal(entry['content_sha256'], sha256(pdf));
  assert.equal(entry['text_sha256'], sha256(entry['text'] as string));
  assert.match(entry['text'] as string, /based solely on attention\s+mechanisms/);

  // A new MockAgent with no interceptors: any request fails.
  await liveLane(async () => {
    const [again] = await run(`"${REAL}" [@k].`, doi);
    assert.deepEqual([again?.verdict, again?.reason], ['PASS', 'verbatim in the open-access PDF at repo.example']);
    const [misquote] = await runPass3(`"Recurrent networks remain the undisputed state of the art" [@k].`, new Map([['k', { DOI: doi }]]));
    assert.equal(misquote?.verdict, 'NOT_FOUND', 'recomputed from the cached text, never a pass');
  }, { contactEmail: EMAIL });
  assert.equal(pdfs.n, 1, 'no PDF request on the second run');
});

test('VRFY-19: an entry past the fetching source\'s TTL is fetched again; the same bytes reuse the cached text (no second extraction); a changed text hash is ignored', async () => {
  const pdf = await textPdf(TEXT);
  const pdfs = { n: 0 };
  const doi = `10.5555/${uniq('ttl')}`;
  const path = `/${uniq('ttl')}.pdf`;
  const url = `https://repo.example${path}`;
  const file = sourceTextCacheFile(url);
  mkdirSync(dirname(file), { recursive: true });
  // An expired entry for the same bytes whose text holds a sentence the PDF does not:
  // served again unextracted, it proves the bytes were matched by their hash.
  const marker = `${TEXT}\nA marker sentence that only the cached text contains, word for word.`;
  const old = new Date(Date.now() - sourceTtlMs('generic') - 60_000).toISOString();
  writeFileSync(file, JSON.stringify({ url, final_url: url, content_sha256: sha256(pdf), text_sha256: sha256(marker), text: marker, saved_at: old, source: 'generic' }));
  await liveLane(async (agent) => {
    listed(agent, doi, url);
    served(agent, path, pdf, pdfs, 3);
    const [r] = await run('"A marker sentence that only the cached text contains, word for word" [@k].', doi);
    assert.equal(r?.verdict, 'PASS', r?.reason);
    assert.equal(pdfs.n, 1, 'expired: fetched again');
    const refreshed = JSON.parse(readFileSync(file, 'utf8')) as { saved_at: string; text: string };
    assert.ok(Date.parse(refreshed.saved_at) > Date.parse(old), 'saved_at renewed');
    assert.equal(refreshed.text, marker, 'the same bytes: the text was not extracted again');

    // Tampered text: the entry no longer hashes to its text_sha256 and is ignored.
    writeFileSync(file, JSON.stringify({ ...refreshed, url, final_url: url, content_sha256: 'x'.repeat(64), text_sha256: sha256(marker), text: `${marker} tampered`, source: 'generic' }));
    const [t] = await run('"A marker sentence that only the cached text contains, word for word" [@k].', doi);
    assert.equal(t?.verdict, 'NOT_FOUND', 'the PDF itself was read again');
    assert.equal(pdfs.n, 2);
    const rewritten = JSON.parse(readFileSync(file, 'utf8')) as { text: string };
    assert.doesNotMatch(rewritten.text, /marker/);
  }, { contactEmail: EMAIL });
});

test('VRFY-28 (Pass-3 side): a citation due for a re-check fetches its copies again and caches the fresh text', async () => {
  const pdf = await textPdf(TEXT);
  const pdfs = { n: 0 };
  const doi = `10.5555/${uniq('refresh')}`;
  const path = `/${uniq('refresh')}.pdf`;
  const lookups = { n: 0 };
  await liveLane(async (agent) => {
    listed(agent, doi, `https://repo.example${path}`, lookups, 2);
    served(agent, path, pdf, pdfs, 2);
    assert.equal((await run(`"${REAL}" [@k].`, doi))[0]?.verdict, 'PASS');
    assert.equal((await run(`"${REAL}" [@k].`, doi))[0]?.verdict, 'PASS');
    assert.equal(pdfs.n, 1, 'fresh: served from the cache');
    assert.equal(lookups.n, 1, 'fresh: Unpaywall\'s answer served from the HTTP cache');
    assert.equal((await run(`"${REAL}" [@k].`, doi, { refresh: new Set(['k']) }))[0]?.verdict, 'PASS');
    assert.equal(pdfs.n, 2, 'refresh: fetched again');
    assert.equal(lookups.n, 2, 'refresh: Unpaywall is asked again too (its HTTP-cache read is skipped)');
  }, { contactEmail: EMAIL });
});

test('VRFY-19: sources offline, the cache is never read or written — a recorded answer replays, a miss is UNVERIFIABLE-NETWORK', async () => {
  // The recorded Unpaywall answer for the NumPy paper lists its Nature PDF; no PDF is recorded.
  const doi = '10.1038/s41586-020-2649-2';
  const url = 'https://www.nature.com/articles/s41586-020-2649-2.pdf';
  const file = sourceTextCacheFile(url);
  mkdirSync(dirname(file), { recursive: true });
  const text = 'Array programming provides a powerful, compact and expressive syntax for accessing, manipulating and operating on data.';
  writeFileSync(file, JSON.stringify({ url, final_url: url, content_sha256: 'a'.repeat(64), text_sha256: sha256(text), text, saved_at: new Date().toISOString(), source: 'generic' }));
  const before = readFileSync(file, 'utf8');
  const [r] = await withContactEmail(EMAIL, () => run(`"${text}" [@k].`, doi));
  assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK', r?.reason);
  assert.match(r?.reason ?? '', /^the open-access PDF at www\.nature\.com: offline: no recorded fixture for GET https:\/\/www\.nature\.com\/articles\/s41586-020-2649-2\.pdf — re-run online/);
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing written');
  const arxiv = sourceTextCacheFile('https://arxiv.org/pdf/2006.10256');
  assert.equal(existsSync(arxiv), false, 'no entry created offline');
});

test('VRFY-19: a text over 4 MiB is used for the run but never cached (Europe PMC)', async () => {
  const doi = `10.5555/${uniq('huge')}`;
  const pmcid = `PMC${Math.floor(Math.random() * 1e8) + 2e8}`;
  const root = mkdtempSync(join(tmpdir(), 'pensmith-p3cache-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 2, entries: [{ ...libraryEntry({ citekey: 'k', title: 'T', author: 'A, B', year: 2020, doi }), pmcid }] }));
  const filler = 'The quick brown fox jumps over the lazy dog near the river bank today. '.repeat(Math.ceil((SOURCE_TEXT_MAX_CHARS + 1000) / 70));
  const xml = `<?xml version="1.0"?><article><front><article-meta><article-id pub-id-type="doi">${doi}</article-id></article-meta></front><body><p>${REAL}.</p><p>${filler}</p></body></article>`;
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`;
  await liveLane(async (agent) => {
    agent.get('https://api.unpaywall.org').intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${doi}?`), method: 'GET' }).reply(404, '{"error":true}', { headers: { 'content-type': 'application/json' } });
    agent.get('https://www.ebi.ac.uk').intercept({ path: `/europepmc/webservices/rest/${pmcid}/fullTextXML`, method: 'GET' }).reply(200, xml, { headers: { 'content-type': 'application/xml' } });
    _resetSourceTextMemoForTest();
    const [r] = await runPass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi }]]), { root });
    assert.deepEqual([r?.verdict, r?.reason], ['PASS', `verbatim in the Europe PMC full text of ${pmcid}`]);
  }, { contactEmail: EMAIL });
  assert.equal(existsSync(sourceTextCacheFile(url)), false);
});
