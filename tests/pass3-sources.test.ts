// tests/pass3-sources.test.ts — VRFY-19 (D-20-18): where Pass 3 finds a cited
// work's real text, in order — the user's own hash-verified PDF (no network),
// every PDF Unpaywall lists (best first, de-duplicated, redirects followed),
// the Europe PMC full text of the PMCID (only when the article is the cited
// work), the arXiv PDF of the arXiv id (only when the id is the work's
// identity or the PDF shows its title) — and the verdicts PASS / FUZZY /
// NOT_FOUND / UNVERIFIABLE-QUOTE / UNVERIFIABLE-NETWORK / UNATTRIBUTED with
// their reasons. Pass 2's passage (sourceTextPassage) never reads the user's
// own PDF.
//
// Live lane with a MockAgent (PENSMITH_NETWORK_TESTS=1), or the dial recorder
// proving that no socket is opened.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { __setHttpTestSeams } from '../bin/lib/http.js';
import { _resetSourceTextMemoForTest, openAccessPdfText, sourceTextPassage } from '../bin/lib/verify/source-text.js';
import { extractPdf } from '../bin/lib/pdf-text.js';
import { textPdf } from './helpers/text-pdf.js';
import { libraryEntry } from './helpers/section-fixture.js';
import { installDialRecorder } from './helpers/local-servers/dial-recorder.mjs';
import { liveLane, uniq, withContactEmail } from './sources/three-way.js';

const EMAIL = 'pensmith-dev@example.org';
const TEXT = [
  'Attention Is All You Need',
  'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.',
  'The best performing models also connect the encoder and decoder through an attention mechanism.',
  'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
  'Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable.',
].join('\n');
const REAL = 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms';
/** 17 words, none of them in this order in the paper. */
const FAKE17 = 'Recurrent networks will always outperform attention because every sequence task needs memory that attention layers cannot provide';

type Agent = Parameters<Parameters<typeof liveLane>[0]>[0];
const JSON_HEADERS = { headers: { 'content-type': 'application/json' } } as const;
const PDF_HEADERS = { headers: { 'content-type': 'application/pdf' } } as const;

function unpaywall(agent: Agent, doi: string, body: Record<string, unknown> | null): void {
  agent
    .get('https://api.unpaywall.org')
    .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${doi}?`), method: 'GET' })
    .reply(body === null ? 404 : 200, JSON.stringify(body ?? { error: true, message: 'not found' }), JSON_HEADERS);
}

function oaRecord(doi: string, pdfUrls: readonly string[]): Record<string, unknown> {
  const locations = pdfUrls.map((u) => ({ url: u, url_for_pdf: u, host_type: 'repository' }));
  return { doi, title: 'Attention Is All You Need', is_oa: true, z_authors: [{ raw_author_name: 'Ashish Vaswani' }], best_oa_location: locations[0] ?? null, oa_locations: locations };
}

function jats(ids: { doi?: string; pmid?: string; pmcid: string }, text: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return [
    '<?xml version="1.0"?><article><front><article-meta>',
    `<article-id pub-id-type="pmcid">${ids.pmcid}</article-id>`,
    ids.doi ? `<article-id pub-id-type="doi">${ids.doi}</article-id>` : '',
    ids.pmid ? `<article-id pub-id-type="pmid">${ids.pmid}</article-id>` : '',
    '<title-group><article-title>Attention Is All You Need</article-title></title-group></article-meta></front>',
    `<body>${text.split('\n').map((p) => `<p>${esc(p)}</p>`).join('')}</body></article>`,
  ].join('');
}

/** One Pass 3 run over `draft` (a new verify run). */
async function pass3(draft: string, bib: Map<string, Record<string, unknown>>, root?: string): ReturnType<typeof runPass3> {
  _resetSourceTextMemoForTest();
  return runPass3(draft, bib, root !== undefined ? { root } : {});
}

test('VRFY-19: Unpaywall → a redirecting PDF link → a real PDF: a fabricated 17-word quote cited [@k, p. 3] is NOT_FOUND, a verbatim one PASS, a one-letter slip FUZZY', async () => {
  const pdf = await textPdf(TEXT);
  let pdfRequests = 0;
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('redirect')}`;
    const link = `/pdf/${uniq('x')}`;
    unpaywall(agent, doi, oaRecord(doi, [`https://doi-link.example${link}`]));
    agent.get('https://doi-link.example').intercept({ path: link, method: 'GET' }).reply(302, '', { headers: { location: `https://cdn.example/files${link}.pdf` } }).persist();
    agent
      .get('https://cdn.example')
      .intercept({ path: `/files${link}.pdf`, method: 'GET' })
      .reply(() => {
        pdfRequests += 1;
        return { statusCode: 200, data: pdf, responseOptions: PDF_HEADERS };
      })
      .persist();
    const bib = new Map([['k', { DOI: doi }]]);
    assert.equal(FAKE17.split(' ').length, 17);
    const [fake] = await pass3(`Some say "${FAKE17}" [@k, p. 3].`, bib);
    assert.deepEqual([fake?.verdict, fake?.locator, fake?.line], ['NOT_FOUND', 'p. 3', 1], fake?.reason);
    assert.match(fake?.reason ?? '', /^quote not found in the open-access PDF at doi-link\.example \(best lev=0\.\d{3} < 0\.95\)$/);
    const [real] = await runPass3(`They write, "${REAL}" [@k, p. 3].`, bib);
    assert.deepEqual([real?.verdict, real?.levRatio, real?.reason], ['PASS', 1, 'verbatim in the open-access PDF at doi-link.example']);
    const [slip] = await runPass3(`They write, "${REAL.replace('architecture', 'architecure')}" [@k].`, bib);
    assert.equal(slip?.verdict, 'FUZZY', slip?.reason);
    assert.match(slip?.reason ?? '', /^found in the open-access PDF at doi-link\.example at lev=0\.9\d{2} \(not verbatim\)$/);
  }, { contactEmail: EMAIL });
  assert.equal(pdfRequests, 1, 'one fetch of the PDF serves every quote of the run');
});

test('VRFY-19: every PDF Unpaywall lists, best first and de-duplicated, until one holds the quote', async () => {
  const pdf = await textPdf(TEXT);
  const seen: string[] = [];
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('many')}`;
    const a = `/${uniq('a')}.pdf`;
    const b = `/${uniq('b')}.pdf`;
    unpaywall(agent, doi, oaRecord(doi, [`https://a.example${a}`, `https://a.example${a}`, `https://b.example${b}`]));
    agent.get('https://a.example').intercept({ path: a, method: 'GET' }).reply(() => {
      seen.push('a');
      return { statusCode: 403, data: '<html>no</html>', responseOptions: { headers: { 'content-type': 'text/html' } } };
    }).persist();
    agent.get('https://b.example').intercept({ path: b, method: 'GET' }).reply(() => {
      seen.push('b');
      return { statusCode: 200, data: pdf, responseOptions: PDF_HEADERS };
    }).persist();
    const [r] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi }]]));
    assert.deepEqual([r?.verdict, r?.reason], ['PASS', 'verbatim in the open-access PDF at b.example']);
  }, { contactEmail: EMAIL });
  assert.deepEqual(seen, ['a', 'b'], 'the duplicate link is asked once, in order');
});

test('VRFY-19: the Europe PMC full text of the PMCID — used only when the article names the cited DOI or PMID', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('epmc')}`;
    const pmcid = `PMC${Math.floor(Math.random() * 1e8) + 1e7}`;
    const root = mkdtempSync(join(tmpdir(), 'pensmith-epmc-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 2, entries: [{ ...libraryEntry({ citekey: 'k', title: 'Attention Is All You Need', author: 'Vaswani, Ashish', year: 2017, doi }), pmcid }] }));
    unpaywall(agent, doi, null);
    unpaywall(agent, doi, null);
    const path = `/europepmc/webservices/rest/${pmcid}/fullTextXML`;
    agent.get('https://www.ebi.ac.uk').intercept({ path, method: 'GET' }).reply(200, jats({ pmcid, doi: '10.5555/another-article' }, TEXT), { headers: { 'content-type': 'application/xml' } });
    const [other] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi }]]), root);
    assert.equal(other?.verdict, 'UNVERIFIABLE-QUOTE');
    assert.match(other?.reason ?? '', new RegExp(`no open-access copy: Unpaywall has no record of DOI ${doi.replace(/[.]/g, '\\.')}; the Europe PMC full text of ${pmcid} is another article \\(DOI 10\\.5555/another-article, PMID none\\), so it is not used`));

    // Another PMCID whose article names the cited DOI (in another case): its text is the work's.
    const pmcid2 = `PMC${Number(pmcid.slice(3)) + 1}`;
    writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 2, entries: [{ ...libraryEntry({ citekey: 'k', title: 'Attention Is All You Need', author: 'Vaswani, Ashish', year: 2017, doi }), pmcid: pmcid2 }] }));
    agent
      .get('https://www.ebi.ac.uk')
      .intercept({ path: `/europepmc/webservices/rest/${pmcid2}/fullTextXML`, method: 'GET' })
      .reply(200, jats({ pmcid: pmcid2, doi: doi.toUpperCase() }, TEXT), { headers: { 'content-type': 'application/xml' } });
    const [same] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi }]]), root);
    assert.deepEqual([same?.verdict, same?.reason], ['PASS', `verbatim in the Europe PMC full text of ${pmcid2}`]);
  }, { contactEmail: EMAIL });
});

test('VRFY-19: the arXiv PDF — its id derived, never a stored URL; beside another DOI it counts only when it shows the entry\'s title', async () => {
  const pdf = await textPdf(TEXT);
  await liveLane(async (agent) => {
    // A DataCite arXiv DOI: the id IS the verified identity (no Unpaywall lookup: Unpaywall does not index them).
    const id1 = '2101.00001';
    agent.get('https://arxiv.org').intercept({ path: `/pdf/${id1}`, method: 'GET' }).reply(301, '', { headers: { location: `https://arxiv.org/pdf/${id1}v2` } });
    agent.get('https://arxiv.org').intercept({ path: `/pdf/${id1}v2`, method: 'GET' }).reply(200, pdf, PDF_HEADERS);
    const [viaDoi] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: `10.48550/arXiv.${id1}` }]]));
    assert.deepEqual([viaDoi?.verdict, viaDoi?.reason], ['PASS', `verbatim in the arXiv PDF of ${id1}`]);

    // An eprint beside a Crossref DOI (Unpaywall has no copy): the PDF must show the entry's title.
    const doi = `10.5555/${uniq('eprint')}`;
    const id2 = '2101.00002';
    unpaywall(agent, doi, null);
    unpaywall(agent, doi, null);
    agent.get('https://arxiv.org').intercept({ path: `/pdf/${id2}`, method: 'GET' }).reply(200, pdf, PDF_HEADERS).times(2);
    const [wrong] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi, eprint: id2, archivePrefix: 'arXiv', title: 'A Completely Different Paper About Penguins' }]]));
    assert.equal(wrong?.verdict, 'UNVERIFIABLE-QUOTE', wrong?.reason);
    assert.match(wrong?.reason ?? '', new RegExp(`the arXiv PDF of ${id2.replace('.', '\\.')} does not show this work's title, so it is not used`));
    const [right] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi, eprint: id2, archivePrefix: 'arXiv', title: 'Attention is all you need' }]]));
    assert.deepEqual([right?.verdict, right?.reason], ['PASS', `verbatim in the arXiv PDF of ${id2}`]);
  }, { contactEmail: EMAIL });
});

test('D-20-03: no text and no answer (a refused connection) is UNVERIFIABLE-NETWORK — never "no open-access copy"', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('down')}`;
    agent
      .get('https://api.unpaywall.org')
      .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${doi}?`), method: 'GET' })
      .replyWithError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
      .persist();
    const [down] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi }]]));
    assert.equal(down?.verdict, 'UNVERIFIABLE-NETWORK', down?.reason);
    assert.match(down?.reason ?? '', /^no answer from Unpaywall for DOI .+ — retry verification when online$/);
  }, { contactEmail: EMAIL });
});

test('D-20-03 / VRFY-19: Unpaywall answers but the PDF host name does not resolve (offline, the resolver down) — UNVERIFIABLE-NETWORK, never an acceptable "fetch failed"', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('dns')}`;
    for (const code of ['EAI_AGAIN', 'ENOTFOUND']) {
      __setHttpTestSeams({
        resolve: async (host: string) => {
          if (host === 'pdf-host.example') throw Object.assign(new Error(`getaddrinfo ${code} ${host}`), { code });
          return [{ address: '192.0.2.1', family: 4 }];
        },
      });
      try {
        unpaywall(agent, doi, oaRecord(doi, ['https://pdf-host.example/paper.pdf']));
        const [row] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi }]]));
        assert.equal(row?.verdict, 'UNVERIFIABLE-NETWORK', `${code}: ${row?.reason}`);
        assert.match(row?.reason ?? '', new RegExp(`host name did not resolve \\(${code}\\) — retry verification when online`));
        assert.doesNotMatch(row?.reason ?? '', /fetch failed|SSRF guard/);
        if (code === 'ENOTFOUND') assert.match(row?.reason ?? '', /the link is dead: add the source's PDF/);
      } finally {
        __setHttpTestSeams(null);
      }
    }
  }, { contactEmail: EMAIL });
});

test('VRFY-19: a policy refusal of the PDF link (a private address) stays an answer without text — UNVERIFIABLE-QUOTE naming it', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('private')}`;
    unpaywall(agent, doi, oaRecord(doi, ['https://10.0.0.7/paper.pdf']));
    const [row] = await pass3(`"${REAL}" [@k].`, new Map([['k', { DOI: doi }]]));
    assert.equal(row?.verdict, 'UNVERIFIABLE-QUOTE', row?.reason);
    assert.match(row?.reason ?? '', /fetch failed: SSRF guard/);
  }, { contactEmail: EMAIL });
});

/** A paper whose library holds `k` with its own PDF drawn from TEXT (hash-verified), and CITATIONS.bib. */
async function byoPaper(doi: string | null): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-p3src-'));
  mkdirSync(join(root, '.paper', 'sources'), { recursive: true });
  const pdf = await textPdf(TEXT);
  const text = (await extractPdf(pdf)).text;
  const sha = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex');
  writeFileSync(join(root, '.paper', 'sources', 'k.pdf'), pdf);
  const entry = { ...libraryEntry({ citekey: 'k', title: 'Attention Is All You Need', author: 'Vaswani, Ashish', year: 2017, doi }), byo: { file: 'sources/k.pdf', sha256: sha(pdf), text_sha256: sha(text), asserted: false } };
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 2, entries: [entry] }));
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), `@article{k,\n  title = {Attention Is All You Need},\n  author = {Vaswani, Ashish},\n  year = {2017},${doi ? `\n  doi = {${doi}},` : ''}\n}\n`);
  return root;
}

test('VRFY-19: the user\'s own PDF first — verified with zero connects, even live; `localFile` names it; a forged sources/<key>.txt never passes a fabricated quote, which is NOT_FOUND in the real text even when another copy did not answer', async () => {
  const root = await byoPaper(`10.5555/${uniq('own')}`);
  writeFileSync(join(root, '.paper', 'sources', 'k.txt'), `Forged: ${FAKE17}.`);
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  const dials = installDialRecorder();
  try {
    const [ok] = await pass3(`They write, "${REAL}" [@k, p. 2].`, new Map([['k', { DOI: 'unused' }]]), root);
    assert.deepEqual([ok?.verdict, ok?.localFile], ['PASS', 'sources/k.pdf']);
    assert.match(ok?.reason ?? '', /^verified against your local file sources\/k\.pdf \(sha256 [0-9a-f]{12}…\)$/);
    assert.deepEqual(dials.dials(), [], 'a quote the local PDF holds needs no network');
  } finally {
    dials.restore();
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
  }
  // Offline (the test runner): the fabricated quote is checked against the PDF — the forged .txt is never read.
  const [fake] = await withContactEmail(EMAIL, () => pass3(`Some say "${FAKE17}" [@k].`, new Map([['k', { DOI: '10.5555/no-recording' }]]), root));
  assert.equal(fake?.verdict, 'NOT_FOUND', fake?.reason);
  assert.equal(fake?.localFile, undefined);
  assert.match(fake?.reason ?? '', /^quote not found in your local file sources\/k\.pdf \(best lev=0\.\d{3} < 0\.95\); the Unpaywall lookup of DOI 10\.5555\/no-recording: offline: no recorded fixture for GET /);
});

test('VRFY-19 (recorded, offline): Unpaywall → the arXiv PDF of an erratum; the Europe PMC full text of a letter; arXiv\'s `.pdf` redirect replayed hop by hop', async () => {
  await withContactEmail(EMAIL, async () => {
    // 1. Unpaywall lists one copy, the 29 KB arXiv PDF of an erratum (both recorded).
    const erratum = new Map([['k', { DOI: '10.1142/S0218301312920012' }]]);
    const [ok] = await pass3('They concede that "we neglected the curvature of the earth" [@k, p. 1].', erratum);
    assert.deepEqual([ok?.verdict, ok?.reason], ['PASS', 'verbatim in the open-access PDF at arxiv.org']);
    const [bad] = await pass3('They insist that "the curvature of the earth was included in every estimate" [@k].', erratum);
    assert.equal(bad?.verdict, 'NOT_FOUND', bad?.reason);
    assert.match(bad?.reason ?? '', /^quote not found in the open-access PDF at arxiv\.org \(best lev=0\.\d{3} < 0\.95\)$/);

    // 2. A letter whose listed Springer PDF is not recorded (larger than a cassette) — no answer
    // offline — and whose Europe PMC full text is: the PMCID comes from the library.
    const root = mkdtempSync(join(tmpdir(), 'pensmith-p3rec-'));
    mkdirSync(join(root, '.paper'), { recursive: true });
    const doi = '10.1186/s43044-026-00785-w';
    const entry = { ...libraryEntry({ citekey: 'k', title: 'Sex disparities in STEMI care', author: 'Dziewierz, Artur', year: 2026, doi }), pmid: '42771069', pmcid: 'PMC13598034' };
    writeFileSync(join(root, '.paper', 'LIBRARY.json'), JSON.stringify({ $schemaVersion: 2, entries: [entry] }));
    const letter = new Map([['k', { DOI: doi }]]);
    const [real] = await pass3('The authors note that "One of the most clinically actionable findings is the longer pre-hospital delay among women" [@k].', letter, root);
    assert.deepEqual([real?.verdict, real?.reason], ['PASS', 'verbatim in the Europe PMC full text of PMC13598034']);
    const [fake] = await pass3('The authors claim that "women reached first medical contact faster than men in every registry" [@k].', letter, root);
    assert.equal(fake?.verdict, 'NOT_FOUND', fake?.reason);
    assert.match(
      fake?.reason ?? '',
      /^quote not found in the Europe PMC full text of PMC13598034 \(best lev=0\.\d{3} < 0\.95\); the open-access PDF at link\.springer\.com: offline: no recorded fixture for GET https:\/\/link\.springer\.com\/content\/pdf\/10\.1186\/s43044-026-00785-w\.pdf — re-run online$/,
    );
  });
  // 3. The production fetch follows a recorded redirect hop by hop.
  const viaRedirect = await openAccessPdfText('https://arxiv.org/pdf/1205.6430.pdf', { source: 'arxiv' });
  assert.equal(viaRedirect.kind, 'text');
  if (viaRedirect.kind !== 'text') return;
  assert.equal(viaRedirect.source.finalUrl, 'https://arxiv.org/pdf/1205.6430');
  assert.match(viaRedirect.source.text.replace(/\s+/g, ' '), /we neglected the curvature of the earth/);
});

test('VRFY-18 / VRFY-20: an unattributed quote is one UNATTRIBUTED row; every row carries the quote id, hash, line and locator', async () => {
  const draft = `# S\n\nCritics say "${FAKE17}" often.\n\nThey write, "${REAL}" [@a; @b, p. 9].\n`;
  const rows = await pass3(draft, new Map());
  assert.deepEqual(
    rows.map((r) => [r.citekey, r.id, r.verdict, r.line, r.locator]),
    [
      ['(unattributed)', 'q1', 'UNATTRIBUTED', 3, undefined],
      ['a', 'q2', 'UNVERIFIABLE-QUOTE', 5, undefined],
      ['b', 'q2', 'UNVERIFIABLE-QUOTE', 5, 'p. 9'],
    ],
  );
  assert.match(rows[0]!.reason, /^a direct quote with no citation to attribute it to — cite its source right after the quote/);
  assert.equal(rows[1]!.reason, 'the source is not in CITATIONS.bib (see its Pass-1 row)');
  assert.equal(rows[1]!.quoteSha256, rows[2]!.quoteSha256);
});

test('VRFY-21 hand-off: sourceTextPassage gives Pass 2 the open-access text nearest the claim — never the user\'s own PDF', async () => {
  const own = await byoPaper(null);
  assert.equal(await sourceTextPassage(own, 'k', 'attention mechanisms replace recurrence'), null, 'a BYO-only source gives Pass 2 nothing here');
  assert.equal(await sourceTextPassage(own, 'missing', 'x'), null);
  const pdf = await textPdf(TEXT);
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('passage')}`;
    const root = await byoPaper(doi);
    const p = `/${uniq('p')}.pdf`;
    unpaywall(agent, doi, oaRecord(doi, [`https://repo.example${p}`]));
    agent.get('https://repo.example').intercept({ path: p, method: 'GET' }).reply(200, pdf, PDF_HEADERS);
    _resetSourceTextMemoForTest();
    const passage = await sourceTextPassage(root, 'k', 'The Transformer relies on attention mechanisms instead of recurrence');
    assert.ok(passage !== null && passage.includes('based solely on attention mechanisms'), String(passage));
  }, { contactEmail: EMAIL });
});
