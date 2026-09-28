// tests/grobid.test.ts — bin/lib/grobid.ts against a loopback GROBID stand-in
// (tests/helpers/local-servers/grobid-server.ts): SRC-15 / D-19-21.
//
//   - with PENSMITH_GROBID_URL naming the loopback server, grobidHeader(pdf)
//     uploads the PDF as the multipart `input` part with consolidateHeader=0
//     and returns {title, authors, doi, arxiv} from the TEI;
//   - the TEI parser handles LF and CRLF, entities, several forenames, and a
//     header without a title (→ null);
//   - 204 → null; another status → GrobidError;
//   - not configured → null with no request; a non-loopback URL → null with a
//     one-time warning and no request; offline → the typed refusal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startGrobidServer } from './helpers/local-servers/grobid-server.js';
import { grobidHeader, grobidEndpoint, parseGrobidTei, GrobidError, _resetGrobidWarningForTest } from '../bin/lib/grobid.js';
import { isOfflineEgressError, _resetHostStateForTest } from '../bin/lib/http.js';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n%'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]), Buffer.from('\n1 0 obj\n<<>>\nendobj\n%%EOF\n')]);

const TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xml:space="preserve" xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader xml:lang="en">
    <fileDesc>
      <titleStmt>
        <title level="a" type="main">Attention Is All You Need</title>
      </titleStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author role="corresp">
              <persName><forename type="first">Ashish</forename><surname>Vaswani</surname></persName>
              <email>avaswani@example.com</email>
            </author>
            <author>
              <persName><forename type="first">Aidan</forename><forename type="middle">N</forename><surname>Gomez</surname></persName>
            </author>
            <author>
              <persName><forename type="first">&#321;ukasz</forename><surname>Kaiser</surname></persName>
            </author>
            <title level="a" type="main">Attention Is All You Need</title>
            <idno type="arXiv">arXiv:1706.03762v5</idno>
            <idno type="DOI">10.48550/arXiv.1706.03762</idno>
          </analytic>
          <monogr><imprint><date type="published" when="2017"/></imprint></monogr>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
</TEI>
`;

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _resetHostStateForTest();
  _resetGrobidWarningForTest();
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('D-19-21: parseGrobidTei reads title, `Family, Given` authors (entities, middle names), DOI and bare arXiv id', () => {
  const h = parseGrobidTei(TEI);
  assert.deepEqual(h, {
    title: 'Attention Is All You Need',
    authors: ['Vaswani, Ashish', 'Gomez, Aidan N', 'Kaiser, Łukasz'],
    doi: '10.48550/arxiv.1706.03762',
    arxiv: '1706.03762',
  });
});

test('D-19-21: parseGrobidTei is CRLF-tolerant and returns null without a title', () => {
  assert.deepEqual(parseGrobidTei(TEI.replace(/\n/g, '\r\n')), parseGrobidTei(TEI));
  const split = TEI.replace('<title level="a" type="main">Attention Is All You Need</title>\n      </titleStmt>', '<title level="a" type="main">Attention Is\r\n  All You Need</title>\r\n      </titleStmt>');
  assert.equal(parseGrobidTei(split)?.title, 'Attention Is All You Need');
  assert.equal(parseGrobidTei('<TEI><teiHeader><fileDesc><titleStmt><title/></titleStmt></fileDesc></teiHeader></TEI>'), null);
});

test('D-19-21: grobidHeader uploads the PDF to the loopback server (input part, consolidateHeader=0) and parses the TEI', async () => {
  const server = await startGrobidServer({ status: 200, tei: TEI });
  try {
    await withEnv({ PENSMITH_NETWORK_TESTS: '1', PENSMITH_OFFLINE: undefined, PENSMITH_GROBID_URL: `http://127.0.0.1:${server.port}` }, async () => {
      assert.equal(grobidEndpoint(), `http://127.0.0.1:${server.port}/api/processHeaderDocument`);
      const h = await grobidHeader(PDF);
      assert.equal(h?.title, 'Attention Is All You Need');
      assert.equal(h?.arxiv, '1706.03762');
      assert.equal(server.calls.length, 1);
      const call = server.calls[0]!;
      assert.equal(call.method, 'POST');
      assert.equal(call.path, '/api/processHeaderDocument');
      assert.match(call.contentType, /^multipart\/form-data; boundary=/);
      const input = call.parts.find((p) => p.name === 'input');
      assert.ok(input && input.data.equals(PDF), 'the PDF bytes arrive intact as `input`');
      assert.equal(input.contentType, 'application/pdf');
      assert.equal(call.parts.find((p) => p.name === 'consolidateHeader')?.data.toString(), '0', 'GROBID is asked not to call out');
    });
  } finally {
    await server.close();
  }
});

test('D-19-21: localhost works too, 204 → null, and an error status → GrobidError', async () => {
  const server = await startGrobidServer({ status: 204 });
  try {
    await withEnv({ PENSMITH_NETWORK_TESTS: '1', PENSMITH_OFFLINE: undefined, PENSMITH_GROBID_URL: `http://localhost:${server.port}/` }, async () => {
      assert.equal(await grobidHeader(PDF), null, 'no header found');
      server.reply({ status: 400, body: 'Bad Request: input is not a PDF' });
      await assert.rejects(() => grobidHeader(PDF), (e: unknown) => {
        assert.ok(e instanceof GrobidError);
        assert.equal(e.status, 400);
        assert.match(e.message, /HTTP 400 — Bad Request: input is not a PDF/);
        return true;
      });
    });
  } finally {
    await server.close();
  }
});

test('D-19-21: not configured → null and no request', async () => {
  const server = await startGrobidServer({ status: 200, tei: TEI });
  try {
    await withEnv({ PENSMITH_NETWORK_TESTS: '1', PENSMITH_GROBID_URL: undefined }, async () => {
      assert.equal(grobidEndpoint(), null);
      assert.equal(await grobidHeader(PDF), null);
      assert.equal(server.calls.length, 0);
    });
  } finally {
    await server.close();
  }
});

test('D-19-21: a non-loopback PENSMITH_GROBID_URL is ignored with one warning — the PDF never leaves the machine', async () => {
  await withEnv({ PENSMITH_NETWORK_TESTS: '1', PENSMITH_GROBID_URL: 'https://grobid.example.org' }, async () => {
    const original = process.stderr.write.bind(process.stderr);
    let err = '';
    process.stderr.write = ((c: string | Uint8Array): boolean => {
      err += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
      return true;
    }) as typeof process.stderr.write;
    try {
      assert.equal(await grobidHeader(PDF), null);
      assert.equal(await grobidHeader(PDF), null);
    } finally {
      process.stderr.write = original;
    }
    const lines = err.split('\n').filter((l) => l.includes('PENSMITH_GROBID_URL is ignored'));
    assert.equal(lines.length, 1, err);
  });
});

test('D-19-21: sources offline → the typed offline refusal, no socket (a local service is still a request)', async () => {
  const server = await startGrobidServer({ status: 200, tei: TEI });
  try {
    await withEnv({ PENSMITH_NETWORK_TESTS: undefined, PENSMITH_GROBID_URL: `http://127.0.0.1:${server.port}` }, async () => {
      await assert.rejects(() => grobidHeader(PDF), (e: unknown) => isOfflineEgressError(e));
      assert.equal(server.calls.length, 0);
    });
  } finally {
    await server.close();
  }
});
