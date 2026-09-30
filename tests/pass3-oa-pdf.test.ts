// tests/pass3-oa-pdf.test.ts — Pass 3 on the three-way Unpaywall lookup and the
// checked open-access PDF fetch (D-19-05, SRC-03, SRC-01; Phase 20 VRFY-19,
// VRFY-20: the D-20-03 split). Live lane with a MockAgent:
//
//   - no contact email → UNVERIFIABLE-QUOTE "Unpaywall needs a contact email —
//     set PENSMITH_CONTACT_EMAIL", and no request is made;
//   - an Unpaywall lookup with no answer (503 after retries) → UNVERIFIABLE-
//     NETWORK (retry online), never "no open-access copy";
//   - a record without an open-access PDF → UNVERIFIABLE-QUOTE: "paywalled
//     (abstract only)" / "no open-access copy";
//   - the OA PDF is fetched as a plain `generic` request: no contact email in
//     its User-Agent, no Unpaywall label;
//   - a landing page served as text/html (`not a PDF (got text/html)`) or a 404
//     is "fetch failed" — never fed to the PDF extractor;
//   - a real PDF's text is checked (PASS / NOT_FOUND); a PDF whose extraction
//     fails is a "fetch failed" UNVERIFIABLE-QUOTE, never an unhandled rejection;
//   - a PDF location that resolves to a private address is refused by the SSRF
//     guard and reported;
//   - GRND-14: a source the drafter's full-text flag marks is one whose text
//     Pass 3 fetched (flag ⇒ text; Pass 3 may check more than the flag says).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { _resetContactEmailForTest } from '../bin/lib/contact-email.js';
import { _resetUnpaywallNoticeForTest } from '../bin/lib/sources/unpaywall.js';
import { _resetSourceTextMemoForTest } from '../bin/lib/verify/source-text.js';
import { liveLane, uniq } from './sources/three-way.js';
import { startHttpServer } from './helpers/local-servers/transport.js';
import { enrichOpenAccess } from '../bin/lib/open-access.js';
import { upsertSources, loadLibrary, type LibraryCandidate } from '../bin/lib/library.js';
import { parseBibFileAt } from '../bin/lib/citations.js';
import { fullTextAvailable } from '../bin/lib/full-text.js';

const PDF = readFileSync(fileURLToPath(new URL('./fixtures/pdf/byo-text.pdf', import.meta.url)));
const EMAIL = 'pensmith-dev@example.org';

/** A block quote of the fixture PDF's text, attributed to `ck`. */
const QUOTED = (ck: string): string =>
  `Background.\n\n> The dominant sequence transduction models are based on complex recurrent or convolutional neural networks\n\n[@${ck}]\n`;
const MISQUOTED = (ck: string): string =>
  `Background.\n\n> Recurrent networks remain the undisputed state of the art for every sequence transduction task in the field\n\n[@${ck}]\n`;

type Agent = Parameters<Parameters<typeof liveLane>[0]>[0];

function unpaywallAnswer(agent: Agent, doi: string, pdfUrl: string | null, isOa = pdfUrl !== null): void {
  agent
    .get('https://api.unpaywall.org')
    .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${doi}?`), method: 'GET' })
    .reply(200, JSON.stringify({
      doi,
      title: 'Attention Is All You Need',
      year: 2017,
      is_oa: isOa,
      z_authors: [{ raw_author_name: 'Ashish Vaswani' }],
      best_oa_location: pdfUrl ? { url: pdfUrl, url_for_pdf: pdfUrl, host_type: 'repository', version: 'submittedVersion' } : null,
      oa_locations: pdfUrl ? [{ url: pdfUrl, url_for_pdf: pdfUrl, host_type: 'repository', version: 'submittedVersion' }] : [],
    }), { headers: { 'content-type': 'application/json' } });
}

/** One run of Pass 3 (a new verify run: the in-process memo is forgotten). */
async function pass3(draft: string, bib: Map<string, Record<string, unknown>>): ReturnType<typeof runPass3> {
  _resetSourceTextMemoForTest();
  return runPass3(draft, bib);
}

test('SRC-03 / D-20-03: without a contact email Pass 3 says "Unpaywall needs a contact email" — UNVERIFIABLE-QUOTE, no request', async () => {
  _resetContactEmailForTest();
  _resetUnpaywallNoticeForTest();
  const saved = process.env['PENSMITH_CONTACT_EMAIL'];
  delete process.env['PENSMITH_CONTACT_EMAIL'];
  const stderr: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    stderr.push(String(s));
    return true;
  };
  try {
    await liveLane(async () => {
      // No interceptor: a request would be refused by the MockAgent (net connect disabled).
      const [r] = await pass3(QUOTED('vaswani2017'), new Map([['vaswani2017', { DOI: `10.5555/${uniq('no-email')}` }]]));
      assert.equal(r?.verdict, 'UNVERIFIABLE-QUOTE');
      assert.match(r?.reason ?? '', /^Unpaywall needs a contact email — set PENSMITH_CONTACT_EMAIL \(the open-access copy of DOI 10\.5555\/no-email-/);
    });
  } finally {
    (process.stderr as unknown as { write: typeof orig }).write = orig;
    if (saved !== undefined) process.env['PENSMITH_CONTACT_EMAIL'] = saved;
  }
  assert.equal(stderr.join('').split('\n').filter((l) => l.includes('Unpaywall skipped: set PENSMITH_CONTACT_EMAIL')).length, 1, 'one notice on stderr');
});

test('D-20-03: an Unpaywall lookup with no answer (503 after retries) is UNVERIFIABLE-NETWORK — retry online', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('up-503')}`;
    agent
      .get('https://api.unpaywall.org')
      .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${doi}?`), method: 'GET' })
      .reply(503, 'unavailable', { headers: { 'content-type': 'text/plain' } })
      .persist();
    const [r] = await pass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
    assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK');
    assert.match(r?.reason ?? '', /^no answer from Unpaywall for DOI 10\.5555\/up-503-[^:]+: [^\n]*HTTP 503[^\n]*— retry verification when online$/);
  }, { contactEmail: EMAIL });
});

test('D-20-03: a record without an open-access PDF is UNVERIFIABLE-QUOTE — "paywalled (abstract only)" or "no open-access copy"', async () => {
  await liveLane(async (agent) => {
    const closed = `10.5555/${uniq('closed')}`;
    unpaywallAnswer(agent, closed, null, false);
    const [r1] = await pass3(QUOTED('k'), new Map([['k', { DOI: closed }]]));
    assert.equal(r1?.verdict, 'UNVERIFIABLE-QUOTE');
    assert.equal(r1?.reason, `paywalled (abstract only): Unpaywall lists no open-access copy of DOI ${closed}`);

    const landing = `10.5555/${uniq('landing')}`;
    agent
      .get('https://api.unpaywall.org')
      .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${landing}?`), method: 'GET' })
      .reply(200, JSON.stringify({ doi: landing, is_oa: true, best_oa_location: { url: 'https://repo.example/landing', url_for_landing_page: 'https://repo.example/landing' }, oa_locations: [] }), {
        headers: { 'content-type': 'application/json' },
      });
    const [r2] = await pass3(QUOTED('k'), new Map([['k', { DOI: landing }]]));
    assert.equal(r2?.verdict, 'UNVERIFIABLE-QUOTE');
    assert.equal(r2?.reason, `no open-access copy: Unpaywall lists no PDF of DOI ${landing}, only landing pages`);

    const unknown = `10.5555/${uniq('unknown')}`;
    agent
      .get('https://api.unpaywall.org')
      .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${unknown}?`), method: 'GET' })
      .reply(404, JSON.stringify({ error: true, message: 'not found' }), { headers: { 'content-type': 'application/json' } });
    const [r3] = await pass3(QUOTED('k'), new Map([['k', { DOI: unknown }]]));
    assert.equal(r3?.verdict, 'UNVERIFIABLE-QUOTE');
    assert.equal(r3?.reason, `no open-access copy: Unpaywall has no record of DOI ${unknown}`);
  }, { contactEmail: EMAIL });
});

test('SRC-01 consumer: a text/html landing page and a 404 are "fetch failed" UNVERIFIABLE-QUOTE rows', async () => {
  await liveLane(async (agent) => {
    const html = `10.5555/${uniq('html')}`;
    const htmlPath = `/${uniq('landing')}`;
    unpaywallAnswer(agent, html, `https://repo.example${htmlPath}`);
    agent.get('https://repo.example').intercept({ path: htmlPath, method: 'GET' })
      .reply(200, '<!doctype html><html><body>Sign in</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const [r1] = await pass3(QUOTED('k'), new Map([['k', { DOI: html }]]));
    assert.equal(r1?.verdict, 'UNVERIFIABLE-QUOTE');
    assert.equal(r1?.reason, 'fetch failed: not a PDF (got text/html) (the open-access PDF at repo.example)');

    const gone = `10.5555/${uniq('gone')}`;
    const gonePath = `/${uniq('gone')}.pdf`;
    unpaywallAnswer(agent, gone, `https://repo.example${gonePath}`);
    agent.get('https://repo.example').intercept({ path: gonePath, method: 'GET' }).reply(404, 'Not Found');
    const [r2] = await pass3(QUOTED('k'), new Map([['k', { DOI: gone }]]));
    assert.equal(r2?.verdict, 'UNVERIFIABLE-QUOTE');
    assert.equal(r2?.reason, 'fetch failed: HTTP 404 (the open-access PDF at repo.example)');
  }, { contactEmail: EMAIL });
});

test('the OA PDF is fetched as a generic request (no contact email) and its text is checked: PASS and NOT_FOUND', async () => {
  await liveLane(async (agent) => {
    const agents: string[] = [];
    const doi = `10.5555/${uniq('pdf')}`;
    const pdfPath = `/${uniq('attention')}.pdf`;
    unpaywallAnswer(agent, doi, `https://repo.example${pdfPath}`);
    agent.get('https://repo.example')
      .intercept({
        path: pdfPath,
        method: 'GET',
        headers: (h: Record<string, string>) => {
          agents.push(h['user-agent'] ?? '');
          return true;
        },
      })
      .reply(200, PDF, { headers: { 'content-type': 'application/pdf' } });
    const map = new Map([['vaswani2017', { DOI: doi }]]);
    _resetSourceTextMemoForTest();
    const [ok] = await runPass3(QUOTED('vaswani2017'), map);
    assert.equal(ok?.verdict, 'PASS', ok?.reason);
    assert.equal(ok?.reason, 'verbatim in the open-access PDF at repo.example');
    // The same run checks a second quote of the source against the text it already has.
    const [bad] = await runPass3(MISQUOTED('vaswani2017'), map);
    assert.equal(bad?.verdict, 'NOT_FOUND', bad?.reason);
    assert.match(bad?.reason ?? '', /^quote not found in the open-access PDF at repo\.example \(best lev=0\.\d{3} < 0\.95\)$/);
    assert.ok(agents.length >= 1, 'the PDF request was seen');
    for (const ua of agents) {
      assert.match(ua, /^pensmith\/\S+$/, 'a plain User-Agent');
      assert.ok(!ua.includes('@'), 'the contact email never reaches a PDF host');
    }
  }, { contactEmail: EMAIL });
});

test('Pass 3: a quote cited after a short "quoted" phrase is checked against the OA PDF — a misquote is NOT_FOUND, never skipped', async () => {
  const lead = 'The authors call recurrence "the old way" in a long remark that runs on for quite a while without any quote marks at all';
  const draft = (quote: string): string => `Background.\n\n${lead} "${quote}" [@vaswani2017].\n`;
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('scare')}`;
    const pdfPath = `/${uniq('scare')}.pdf`;
    unpaywallAnswer(agent, doi, `https://repo.example${pdfPath}`);
    agent.get('https://repo.example').intercept({ path: pdfPath, method: 'GET' })
      .reply(200, PDF, { headers: { 'content-type': 'application/pdf' } });
    const map = new Map([['vaswani2017', { DOI: doi }]]);
    const bad = await pass3(draft('Recurrent networks remain the undisputed state of the art for every sequence transduction task in the field'), map);
    assert.deepEqual(bad.map((r) => [r.citekey, r.verdict]), [['vaswani2017', 'NOT_FOUND']], JSON.stringify(bad));
    const ok = await runPass3(draft('The dominant sequence transduction models are based on complex recurrent or convolutional neural networks'), map);
    assert.deepEqual(ok.map((r) => [r.citekey, r.verdict]), [['vaswani2017', 'PASS']], JSON.stringify(ok));
  }, { contactEmail: EMAIL });
});

test('VRFY-19: a PDF whose text cannot be extracted is a "fetch failed" UNVERIFIABLE-QUOTE (no unhandled rejection)', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown): void => {
    unhandled.push(e);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await liveLane(async (agent) => {
      const doi = `10.5555/${uniq('broken')}`;
      const pdfPath = `/${uniq('broken')}.pdf`;
      unpaywallAnswer(agent, doi, `https://repo.example${pdfPath}`);
      agent.get('https://repo.example').intercept({ path: pdfPath, method: 'GET' })
        .reply(200, Buffer.from('%PDF-1.7\n%garbage that is not a PDF body\n'), { headers: { 'content-type': 'application/pdf' } });
      const [r] = await pass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
      assert.equal(r?.verdict, 'UNVERIFIABLE-QUOTE', JSON.stringify(r));
      assert.match(r?.reason ?? '', /^(?:fetch failed: the PDF answered but it could not be read \(.+\)|image-only PDF: no extractable text) \(the open-access PDF at repo\.example\)$/);
    }, { contactEmail: EMAIL });
    await new Promise((res) => setTimeout(res, 50));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('an OA PDF location on a private address is refused by the SSRF guard and reported ("fetch failed")', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('ssrf')}`;
    unpaywallAnswer(agent, doi, 'http://127.0.0.1:9/x.pdf');
    const [r] = await pass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
    assert.equal(r?.verdict, 'UNVERIFIABLE-QUOTE');
    assert.match(r?.reason ?? '', /^fetch failed: SSRF guard: /);
  }, { contactEmail: EMAIL });
});

test('SRC-01: an OA PDF location on a loopback listener that WOULD answer is refused before any socket — the listener receives 0 requests', async () => {
  let hits = 0;
  const server = await startHttpServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'application/pdf' });
    res.end(PDF);
  });
  try {
    await liveLane(async (agent) => {
      // Let a request through to the listener if the SSRF guard ever let one go.
      agent.enableNetConnect(`127.0.0.1:${server.port}`);
      const doi = `10.5555/${uniq('ssrf-listener')}`;
      unpaywallAnswer(agent, doi, `http://127.0.0.1:${server.port}/x.pdf`);
      const [r] = await pass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
      assert.equal(r?.verdict, 'UNVERIFIABLE-QUOTE');
      assert.match(r?.reason ?? '', /^fetch failed: SSRF guard: .*127\.0\.0\.1/);
    }, { contactEmail: EMAIL });
    assert.equal(hits, 0, 'the loopback listener was never asked');
  } finally {
    await server.close();
  }
});

test('GRND-14 (review rounds 2 and 3; VRFY-19): a source the full-text flag marks is one whose text Pass 3 fetches — Unpaywall\'s PDF, the arXiv PDF of an arXiv id; never an adapter\'s own link, nor a listed link that answers HTML', async () => {
  await liveLane(async (agent) => {
    _resetSourceTextMemoForTest();
    const root = mkdtempSync(join(tmpdir(), 'pensmith-fulltext-agree-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const open = `10.5555/${uniq('ft-open')}`;
    const adapterOnly = `10.5555/${uniq('ft-adapter')}`;
    const walled = `10.5555/${uniq('ft-walled')}`;
    const arxivId = '2102.05095';
    const openPath = `/${uniq('open')}.pdf`;
    const walledPath = `/doi/pdf/${uniq('walled')}`;
    // Unpaywall: a PDF for `open`, none for `adapterOnly` (OpenAlex had reported one),
    // and for `walled` a publisher link that answers an HTML bot wall (review round 3).
    // Each answer is asked twice: by the ingest check and by Pass 3 (the HTTP cache serves the second).
    unpaywallAnswer(agent, open, `https://repo.example${openPath}`);
    unpaywallAnswer(agent, adapterOnly, null);
    unpaywallAnswer(agent, walled, `https://publisher.example${walledPath}`);
    // Twice: the ingest check (its first bytes) and Pass 3's fetch.
    agent.get('https://repo.example').intercept({ path: openPath, method: 'GET' }).reply(200, PDF, { headers: { 'content-type': 'application/pdf' } }).times(2);
    agent.get('https://publisher.example').intercept({ path: walledPath, method: 'GET' }).reply(403, '<html>Are you a robot?</html>', { headers: { 'content-type': 'text/html' } }).times(2);
    // The arXiv PDF, derived from the id (never a stored URL).
    agent.get('https://arxiv.org').intercept({ path: `/pdf/${arxivId}`, method: 'GET' }).reply(200, PDF, { headers: { 'content-type': 'application/pdf' } });

    const base = { authors: ['Vaswani, Ashish'], year: 2021, retracted: false, last_verified: '2026-01-01T00:00:00.000Z' };
    const candidates: LibraryCandidate[] = [
      { ...base, citekey: 'open2021', source: 'crossref', doi: open, title: 'Open work', type: 'article-journal' },
      { ...base, citekey: 'adapter2021', source: 'openalex', doi: adapterOnly, title: 'Adapter-linked work', type: 'article-journal', oa_pdf_url: 'https://publisher.example/adapter.pdf' },
      { ...base, citekey: 'walled2021', source: 'crossref', doi: walled, title: 'Walled work', type: 'article-journal' },
      { ...base, citekey: 'arxiv2021', source: 'openalex', doi: `10.48550/arXiv.${arxivId}`, title: 'Space-time attention', oa_pdf_url: `https://arxiv.org/pdf/${arxivId}` },
    ];
    const oa = await enrichOpenAccess(candidates);
    assert.equal(oa.unconfirmed, 1);
    assert.match(oa.problem ?? '', /1 link\(s\) Unpaywall lists did not answer with a PDF \(publisher\.example: HTTP 403\), so they count as abstract-only/);
    await upsertSources(root, candidates, { provenance: 'research' });
    const lib = await loadLibrary(root);
    const bibPath = join(root, '.paper', 'CITATIONS.bib');
    const bib = new Map((await parseBibFileAt(readFileSync(bibPath, 'utf8'), bibPath)).map((e) => [String((e as { id?: string }).id), e as Record<string, unknown>]));

    const flags = new Map(lib.entries.map((e) => [e.citekey, fullTextAvailable(e)]));
    assert.deepEqual(Object.fromEntries(flags), { open2021: true, adapter2021: false, walled2021: false, arxiv2021: true });
    for (const e of lib.entries) {
      const [r] = await runPass3(QUOTED(e.citekey), bib);
      const fetched = r !== undefined && (r.verdict === 'PASS' || r.verdict === 'FUZZY' || r.verdict === 'NOT_FOUND');
      if (flags.get(e.citekey) === true) {
        assert.ok(fetched, `${e.citekey}: flagged, so Pass 3 read its text — got ${r?.verdict} (${r?.reason})`);
        assert.equal(r!.verdict, 'PASS', r!.reason);
      } else {
        assert.equal(r?.verdict, 'UNVERIFIABLE-QUOTE', `${e.citekey}: ${r?.reason}`);
      }
    }
  }, { contactEmail: EMAIL });
});
