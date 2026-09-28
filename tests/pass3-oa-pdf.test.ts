// tests/pass3-oa-pdf.test.ts — Pass 3 on the three-way Unpaywall lookup and the
// checked OA-PDF fetch (D-19-05, SRC-03, SRC-01 consumer; Phase 19 stream
// adapters). Live lane only (offline, Pass 3 makes no request, RUN-04):
//
//   - no contact email → `Unpaywall skipped: set PENSMITH_CONTACT_EMAIL`, not
//     "No OA PDF available", and no request is made;
//   - an Unpaywall lookup that failed (503 after retries) says so;
//   - the OA PDF is fetched as a plain `generic` request: no contact email in
//     its User-Agent, no Unpaywall label;
//   - a landing page served as text/html is `not a PDF (got text/html)`, a 404
//     is `HTTP 404` — never fed to the PDF extractor;
//   - a real PDF's text is checked (OK / NOT_FOUND); a PDF whose extraction
//     fails is reported, never an unhandled rejection;
//   - a PDF location that resolves to a private address is refused by the SSRF
//     guard and reported.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { _resetContactEmailForTest } from '../bin/lib/contact-email.js';
import { _resetUnpaywallNoticeForTest } from '../bin/lib/sources/unpaywall.js';
import { liveLane, uniq } from './sources/three-way.js';
import { startHttpServer } from './helpers/local-servers/transport.js';

const PDF = readFileSync(fileURLToPath(new URL('./fixtures/pdf/byo-text.pdf', import.meta.url)));
const EMAIL = 'pensmith-dev@example.org';

/** A block quote of the fixture PDF's text, attributed to `ck`. */
const QUOTED = (ck: string): string =>
  `Background.\n\n> The dominant sequence transduction models are based on complex recurrent or convolutional neural networks\n\n[@${ck}]\n`;
const MISQUOTED = (ck: string): string =>
  `Background.\n\n> Recurrent networks remain the undisputed state of the art for every sequence transduction task in the field\n\n[@${ck}]\n`;

type Agent = Parameters<Parameters<typeof liveLane>[0]>[0];

function unpaywallAnswer(agent: Agent, doi: string, pdfUrl: string | null): void {
  agent
    .get('https://api.unpaywall.org')
    .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${doi}?`), method: 'GET' })
    .reply(200, JSON.stringify({
      doi,
      title: 'Attention Is All You Need',
      year: 2017,
      z_authors: [{ raw_author_name: 'Ashish Vaswani' }],
      best_oa_location: pdfUrl ? { url: pdfUrl, url_for_pdf: pdfUrl, host_type: 'repository', version: 'submittedVersion' } : null,
      oa_locations: pdfUrl ? [{ url: pdfUrl, url_for_pdf: pdfUrl, host_type: 'repository', version: 'submittedVersion' }] : [],
    }), { headers: { 'content-type': 'application/json' } });
}

test('SRC-03: without a contact email Pass 3 says "Unpaywall skipped: set PENSMITH_CONTACT_EMAIL" — no request is made', async () => {
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
      const [r] = await runPass3(QUOTED('vaswani2017'), new Map([['vaswani2017', { DOI: `10.5555/${uniq('no-email')}` }]]));
      assert.equal(r?.verdict, 'PDF_UNAVAILABLE');
      assert.match(r?.reason ?? '', /^Unpaywall skipped: set PENSMITH_CONTACT_EMAIL — /);
      assert.doesNotMatch(r?.reason ?? '', /No OA PDF available/);
    });
  } finally {
    (process.stderr as unknown as { write: typeof orig }).write = orig;
    if (saved !== undefined) process.env['PENSMITH_CONTACT_EMAIL'] = saved;
  }
  assert.equal(stderr.join('').split('\n').filter((l) => l.includes('Unpaywall skipped: set PENSMITH_CONTACT_EMAIL')).length, 1, 'one notice on stderr');
});

test('D-19-05: a failed Unpaywall lookup (503 after retries) is reported as such', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('up-503')}`;
    agent
      .get('https://api.unpaywall.org')
      .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${doi}?`), method: 'GET' })
      .reply(503, 'unavailable', { headers: { 'content-type': 'text/plain' } })
      .persist();
    const [r] = await runPass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
    assert.equal(r?.verdict, 'PDF_UNAVAILABLE');
    assert.match(r?.reason ?? '', /503/);
  }, { contactEmail: EMAIL });
});

test('a found record without an OA PDF is "No OA PDF available"', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('closed')}`;
    unpaywallAnswer(agent, doi, null);
    const [r] = await runPass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
    assert.equal(r?.verdict, 'PDF_UNAVAILABLE');
    assert.equal(r?.reason, `No OA PDF available for DOI ${doi}`);
  }, { contactEmail: EMAIL });
});

test('SRC-01 consumer: a text/html landing page is "not a PDF (got text/html)"; a 404 is "HTTP 404"', async () => {
  await liveLane(async (agent) => {
    const html = `10.5555/${uniq('html')}`;
    unpaywallAnswer(agent, html, 'https://repo.example/landing');
    agent.get('https://repo.example').intercept({ path: '/landing', method: 'GET' })
      .reply(200, '<!doctype html><html><body>Sign in</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    const [r1] = await runPass3(QUOTED('k'), new Map([['k', { DOI: html }]]));
    assert.equal(r1?.verdict, 'PDF_UNAVAILABLE');
    assert.equal(r1?.reason, 'OA PDF fetch returned not a PDF (got text/html)');

    const gone = `10.5555/${uniq('gone')}`;
    unpaywallAnswer(agent, gone, 'https://repo.example/gone.pdf');
    agent.get('https://repo.example').intercept({ path: '/gone.pdf', method: 'GET' }).reply(404, 'Not Found');
    const [r2] = await runPass3(QUOTED('k'), new Map([['k', { DOI: gone }]]));
    assert.equal(r2?.reason, 'OA PDF fetch returned HTTP 404');
  }, { contactEmail: EMAIL });
});

test('the OA PDF is fetched as a generic request (no contact email) and its text is checked: OK and NOT_FOUND', async () => {
  await liveLane(async (agent) => {
    const agents: string[] = [];
    const doi = `10.5555/${uniq('pdf')}`;
    unpaywallAnswer(agent, doi, 'https://repo.example/attention.pdf');
    agent.get('https://repo.example')
      .intercept({
        path: '/attention.pdf',
        method: 'GET',
        headers: (h: Record<string, string>) => {
          agents.push(h['user-agent'] ?? '');
          return true;
        },
      })
      .reply(200, PDF, { headers: { 'content-type': 'application/pdf' } })
      .times(2);
    const map = new Map([['vaswani2017', { DOI: doi }]]);
    const [ok] = await runPass3(QUOTED('vaswani2017'), map);
    assert.equal(ok?.verdict, 'OK', ok?.reason);
    const [bad] = await runPass3(MISQUOTED('vaswani2017'), map);
    assert.equal(bad?.verdict, 'NOT_FOUND', bad?.reason);
    // (MockAgent may consult a header matcher more than once per request.)
    assert.ok(agents.length >= 2, 'both PDF requests were seen');
    for (const ua of agents) {
      assert.match(ua, /^pensmith\/\S+$/, 'a plain User-Agent');
      assert.ok(!ua.includes('@'), 'the contact email never reaches a PDF host');
    }
  }, { contactEmail: EMAIL });
});

test('a PDF whose text cannot be extracted is reported (no unhandled rejection)', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown): void => {
    unhandled.push(e);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await liveLane(async (agent) => {
      const doi = `10.5555/${uniq('broken')}`;
      unpaywallAnswer(agent, doi, 'https://repo.example/broken.pdf');
      agent.get('https://repo.example').intercept({ path: '/broken.pdf', method: 'GET' })
        .reply(200, Buffer.from('%PDF-1.7\n%garbage that is not a PDF body\n'), { headers: { 'content-type': 'application/pdf' } });
      const [r] = await runPass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
      assert.ok(r?.verdict === 'PDF_UNAVAILABLE' || r?.verdict === 'TEXT_UNAVAILABLE', JSON.stringify(r));
      if (r?.verdict === 'PDF_UNAVAILABLE') assert.match(r.reason, /^OA PDF text extraction failed: /);
    }, { contactEmail: EMAIL });
    await new Promise((res) => setTimeout(res, 50));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('an OA PDF location on a private address is refused by the SSRF guard and reported', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('ssrf')}`;
    unpaywallAnswer(agent, doi, 'http://127.0.0.1:9/x.pdf');
    const [r] = await runPass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
    assert.equal(r?.verdict, 'PDF_UNAVAILABLE');
    assert.match(r?.reason ?? '', /^OA PDF fetch failed: SSRF guard: /);
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
      const [r] = await runPass3(QUOTED('k'), new Map([['k', { DOI: doi }]]));
      assert.equal(r?.verdict, 'PDF_UNAVAILABLE');
      assert.match(r?.reason ?? '', /^OA PDF fetch failed: SSRF guard: .*127\.0\.0\.1/);
    }, { contactEmail: EMAIL });
    assert.equal(hits, 0, 'the loopback listener was never asked');
  } finally {
    await server.close();
  }
});
