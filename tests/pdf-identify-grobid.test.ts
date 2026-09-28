// tests/pdf-identify-grobid.test.ts — PDF identification asks the user's local
// GROBID server first (19-PLAN §7.2 "library ← net"; SRC-15, D-19-21).
//
// With PENSMITH_GROBID_URL naming a loopback GROBID (here the stand-in in
// tests/helpers/local-servers/grobid-server.ts) and the PDF's bytes passed in:
//   - the DOI / arXiv id GROBID reads from the header is looked up first
//     (via `grobid-doi` / `grobid-arxiv`), still subject to the title-on-page
//     check;
//   - GROBID's title and authors replace the layout heuristic's for the title
//     search;
//   - a GROBID failure is a failure line and the heuristic still runs;
//   - without the bytes (or without GROBID configured) nothing is uploaded.
// The registrar lookups are injected (no network): only the loopback GROBID
// request is live, which is why the lane is switched on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGrobidServer } from './helpers/local-servers/grobid-server.js';
import { grobidHeader, _resetGrobidWarningForTest } from '../bin/lib/grobid.js';
import { _resetHostStateForTest } from '../bin/lib/http.js';
import { extractPdf } from '../bin/lib/pdf-text.js';
import { identifyPdf, type IdentifyDeps } from '../bin/lib/pdf-identify.js';
import { lookupFound, lookupNotFound, type LookupResult } from '../bin/lib/sources/lookup.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

const BYO = fileURLToPath(new URL('./fixtures/byo/', import.meta.url));
const pdfBytes = (name: string): Buffer => fs.readFileSync(path.join(BYO, name));

const TEI = (title: string, extra = ''): string => `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>
  <titleStmt><title level="a" type="main">${title}</title></titleStmt>
  <sourceDesc><biblStruct><analytic>
    <author><persName><forename type="first">Ashish</forename><surname>Vaswani</surname></persName></author>
    <author><persName><forename type="first">Noam</forename><surname>Shazeer</surname></persName></author>
    <title level="a" type="main">${title}</title>
    ${extra}
  </analytic><monogr><imprint><date type="published" when="2017"/></imprint></monogr></biblStruct></sourceDesc>
</fileDesc></teiHeader></TEI>
`;

const VASWANI = {
  source: 'arxiv',
  id: 'http://arxiv.org/abs/1706.03762v7',
  arxiv: '1706.03762',
  title: 'Attention Is All You Need',
  authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
  year: 2017,
  retracted: false,
  citekey: 'vaswani2017',
  last_verified: '2026-09-28T00:00:00.000Z',
  raw: {},
} as SourceCandidate;

interface Calls {
  doi: string[];
  arxiv: string[];
  title: string[];
}

function deps(over: { doi?: (d: string) => LookupResult; arxiv?: (a: string) => LookupResult; title?: (t: string) => SourceCandidate[] } = {}): { deps: IdentifyDeps; calls: Calls } {
  const calls: Calls = { doi: [], arxiv: [], title: [] };
  return {
    calls,
    deps: {
      lookupDoi: async (d) => {
        calls.doi.push(d);
        return over.doi ? over.doi(d) : lookupNotFound('HTTP 404');
      },
      lookupArxiv: async (a) => {
        calls.arxiv.push(a);
        return over.arxiv ? over.arxiv(a) : lookupNotFound('empty feed');
      },
      searchTitle: async (t) => {
        calls.title.push(t);
        return { candidates: over.title ? over.title(t) : [], failures: [] };
      },
      grobidHeader: (pdf) => grobidHeader(pdf),
    },
  };
}

async function withGrobid<T>(reply: Parameters<typeof startGrobidServer>[0], fn: (server: Awaited<ReturnType<typeof startGrobidServer>>) => Promise<T>): Promise<T> {
  const server = await startGrobidServer(reply);
  const saved = { lane: process.env['PENSMITH_NETWORK_TESTS'], url: process.env['PENSMITH_GROBID_URL'], offline: process.env['PENSMITH_OFFLINE'] };
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  process.env['PENSMITH_GROBID_URL'] = `http://127.0.0.1:${server.port}`;
  delete process.env['PENSMITH_OFFLINE'];
  _resetHostStateForTest();
  _resetGrobidWarningForTest();
  try {
    return await fn(server);
  } finally {
    const restore = (k: string, v: string | undefined): void => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    };
    restore('PENSMITH_NETWORK_TESTS', saved.lane);
    restore('PENSMITH_GROBID_URL', saved.url);
    restore('PENSMITH_OFFLINE', saved.offline);
    await server.close();
  }
}

test('SRC-15 (GROBID): the arXiv id GROBID reads from the header identifies the PDF first — the PDF bytes are uploaded, no title search', async () => {
  await withGrobid({ status: 200, tei: TEI('Attention Is All You Need', '<idno type="arXiv">arXiv:1706.03762v5</idno>') }, async (server) => {
    const bytes = pdfBytes('attention-title-only.pdf');
    const ex = await extractPdf(bytes);
    const { deps: d, calls } = deps({ arxiv: (a) => (a === '1706.03762' ? lookupFound(VASWANI) : lookupNotFound('none')) });
    const r = await identifyPdf(ex, d, { pdf: bytes });
    assert.equal(r.kind, 'identified');
    assert.equal(r.kind === 'identified' && r.via, 'grobid-arxiv');
    assert.equal(r.kind === 'identified' && r.candidate.title, 'Attention Is All You Need');
    assert.deepEqual(calls, { doi: [], arxiv: ['1706.03762'], title: [] });
    assert.equal(server.calls.length, 1, 'one upload to the local GROBID');
    assert.ok(server.calls[0]!.parts.find((p) => p.name === 'input')?.data.equals(bytes), 'the PDF itself, byte for byte');
  });
});

test('SRC-15 (GROBID): GROBID\'s title and authors drive the title search when the header names no identifier', async () => {
  await withGrobid({ status: 200, tei: TEI('Attention Is All You Need') }, async () => {
    const bytes = pdfBytes('attention-title-only.pdf');
    const ex = await extractPdf(bytes);
    const { deps: d, calls } = deps({ title: () => [VASWANI] });
    const r = await identifyPdf(ex, d, { pdf: bytes });
    assert.equal(r.kind === 'identified' && r.via, 'title-search');
    assert.equal(r.local.titleSource, 'grobid');
    assert.deepEqual(r.local.authors, ['Vaswani, Ashish', 'Shazeer, Noam']);
    assert.deepEqual(calls.title, ['Attention Is All You Need']);
  });
});

test('SRC-15 (GROBID): a GROBID error is reported as a failure line and the heuristic still identifies the PDF', async () => {
  await withGrobid({ status: 500, body: 'GROBID crashed' }, async (server) => {
    const bytes = pdfBytes('attention-arxiv-layout.pdf');
    const ex = await extractPdf(bytes);
    const { deps: d } = deps({ arxiv: (a) => (a === '1706.03762' ? lookupFound(VASWANI) : lookupNotFound('none')) });
    const r = await identifyPdf(ex, d, { pdf: bytes });
    assert.equal(r.kind === 'identified' && r.via, 'text-arxiv-stamp', 'the arXiv stamp on page 1 still decides');
    // the transport retried the 5xx (3 attempts), then its breaker opened for the host
    assert.equal(server.calls.length, 3);
    // an unidentified PDF carries the GROBID failure among its reasons — here
    // the open breaker's one line; no further upload
    const none = await identifyPdf(await extractPdf(pdfBytes('no-match.pdf')), deps().deps, { pdf: pdfBytes('no-match.pdf') });
    assert.equal(none.kind, 'unidentified');
    assert.ok(none.kind === 'unidentified' && none.failures.some((f) => /^GROBID: .*HTTP 500/.test(f)), JSON.stringify(none));
    assert.equal(server.calls.length, 3, 'no request to a host whose breaker is open');
  });
});

test('SRC-15 (GROBID): without the PDF bytes, or with no GROBID configured, nothing is uploaded', async () => {
  await withGrobid({ status: 200, tei: TEI('Attention Is All You Need', '<idno type="arXiv">arXiv:1706.03762</idno>') }, async (server) => {
    const ex = await extractPdf(pdfBytes('attention-title-only.pdf'));
    const { deps: d } = deps({ title: () => [VASWANI] });
    const r = await identifyPdf(ex, d);
    assert.equal(r.kind === 'identified' && r.via, 'title-search');
    assert.equal(server.calls.length, 0, 'no bytes → no GROBID request');
  });
  // GROBID not configured: grobidHeader answers null without a request.
  const saved = process.env['PENSMITH_GROBID_URL'];
  delete process.env['PENSMITH_GROBID_URL'];
  try {
    const bytes = pdfBytes('attention-title-only.pdf');
    const { deps: d, calls } = deps({ title: () => [VASWANI] });
    const r = await identifyPdf(await extractPdf(bytes), d, { pdf: bytes });
    assert.equal(r.kind === 'identified' && r.via, 'title-search');
    assert.deepEqual(calls.arxiv, []);
  } finally {
    if (saved !== undefined) process.env['PENSMITH_GROBID_URL'] = saved;
  }
});
