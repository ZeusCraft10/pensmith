// tests/known-bad-quotes.test.ts — VRFY-29 (D-20-19), SC-3: the Pass 3
// acceptance corpus runs the production path.
//
// tests/fixtures/known-bad-quotes.json holds drafts and one source text. Each
// draft's quote is found by the production extractor (extractQuotes) and
// checked by the production Pass 3 (runPass3) against that text, served as the
// source two ways:
//   - the user's own PDF, drawn from the text (a real PDF whose text layer
//     carries the artifacts), recorded with its sha256 and text sha256 in
//     LIBRARY.json and re-hashed by byo-text.ts — no socket is opened;
//   - the work's Europe PMC open-access full text (JATS built from the text,
//     naming the citation's DOI), answered by a local MockAgent, after
//     Unpaywall answers that it has no record of the DOI.
// Every fabricated or distorted quote (≥ 10) must be NOT_FOUND on both routes
// and every genuine quote must PASS on both — one or more per PDF artifact
// class (ligature, soft hyphen, smart quotes, ellipsis, diacritic), each class
// present in the source text and in claimed quotes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractQuotes } from '../bin/lib/quote-extractor.js';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { extractPdf } from '../bin/lib/pdf-text.js';
import { _resetSourceTextMemoForTest } from '../bin/lib/verify/source-text.js';
import { textPdf } from './helpers/text-pdf.js';
import { libraryEntry } from './helpers/section-fixture.js';
import { installDialRecorder } from './helpers/local-servers/dial-recorder.mjs';
import { liveLane } from './sources/three-way.js';

interface Row {
  readonly id: string;
  readonly distortion: string;
  readonly claimed_quote: string;
  readonly draft: string;
  readonly expected_verdict: 'NOT_FOUND' | 'PASS';
  readonly note: string;
}
interface Fixture {
  readonly citekey: string;
  readonly source: { readonly title: string; readonly doi: string; readonly pmcid: string; readonly text: string };
  readonly quotes: readonly Row[];
}

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/known-bad-quotes.json', import.meta.url)), 'utf8')) as Fixture;
const K = FIXTURE.citekey;
const SRC = FIXTURE.source;
const EMAIL = 'pensmith-dev@example.org';

/** The artifact each class leaves in text: its code points. */
const ARTIFACTS: Readonly<Record<string, RegExp>> = {
  ligature: /[ﬀ-ﬆ]/u,
  soft_hyphen: /­/u,
  smart_quotes: /[‘’“”]/u,
  ellipsis: /…/u,
  diacritic: /[À-ÿ]/u,
};

const sha256 = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex');

test('VRFY-29: the corpus — ≥ 10 NOT_FOUND rows; every artifact class in the source text, in claimed quotes, and with a genuine quote', () => {
  const bad = FIXTURE.quotes.filter((q) => q.expected_verdict === 'NOT_FOUND');
  assert.ok(bad.length >= 10, `${bad.length} NOT_FOUND rows`);
  for (const [cls, re] of Object.entries(ARTIFACTS)) {
    assert.match(SRC.text, re, `the source text carries the ${cls} artifact`);
    assert.ok(FIXTURE.quotes.some((q) => re.test(q.claimed_quote)), `a claimed quote carries the ${cls} artifact`);
    assert.ok(FIXTURE.quotes.some((q) => q.distortion === cls && q.expected_verdict === 'PASS'), `a genuine ${cls} quote`);
  }
  assert.ok(bad.filter((q) => Object.values(ARTIFACTS).some((re) => re.test(q.claimed_quote))).length >= 5, '≥ 5 bad quotes carry an artifact');
});

test('VRFY-18 / VRFY-29: the production extractor finds exactly each row\'s quote, attributed to the source', () => {
  for (const row of FIXTURE.quotes) {
    const found = extractQuotes(row.draft);
    assert.deepEqual(
      found.map((q) => [q.id, q.citekey, q.text]),
      [['q1', K, row.claimed_quote]],
      `${row.id}: ${row.draft}`,
    );
  }
});

/** A paper whose library holds the source with the given fields (and nothing else). */
function paper(entry: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-kbq-'));
  mkdirSync(join(root, '.paper', 'sources'), { recursive: true });
  writeFileSync(join(root, '.paper', 'LIBRARY.json'), `${JSON.stringify({ $schemaVersion: 2, entries: [entry] }, null, 2)}\n`);
  return root;
}

async function assertVerdicts(root: string, bib: Map<string, Record<string, unknown>>, route: RegExp, localFile?: string): Promise<void> {
  const verdicts: string[] = [];
  for (const row of FIXTURE.quotes) {
    const rows = await runPass3(row.draft, bib, { root });
    assert.equal(rows.length, 1, `${row.id}: one row`);
    const r = rows[0]!;
    assert.equal(r.verdict, row.expected_verdict, `${row.id} (${row.note}): ${r.verdict} — ${r.reason}`);
    assert.equal(r.id, 'q1');
    if (r.verdict === 'PASS') {
      assert.match(r.reason, route, row.id);
      assert.equal(r.localFile, localFile, row.id);
    } else {
      // Below the threshold, or close by characters but refused: a whole word
      // differs (a negator, a number, another word), elided parts lie far apart,
      // or a bracket or an elision changes what the source says (review round 3).
      assert.ok(
        r.levRatio < 0.95 || /differs by a whole word|elided parts|the editorial bracket|its elision drops/.test(r.reason),
        `${row.id}: lev ${r.levRatio} — ${r.reason}`,
      );
      assert.match(r.reason, /^quote not found in /, row.id);
    }
    verdicts.push(r.verdict);
  }
  const bad = FIXTURE.quotes.filter((q) => q.expected_verdict === 'NOT_FOUND').length;
  assert.equal(verdicts.filter((v) => v === 'NOT_FOUND').length, bad, `${bad}/${bad} NOT_FOUND`);
}

test('VRFY-29 (the user\'s own hash-verified PDF, no network): every bad quote is NOT_FOUND, every genuine quote PASSes', async () => {
  const pdf = await textPdf(SRC.text);
  const text = (await extractPdf(pdf)).text;
  assert.match(text, /­/u, 'the PDF text layer keeps the soft hyphen');
  const byo = { file: `sources/${K}.pdf`, sha256: sha256(pdf), text_sha256: sha256(text), asserted: false };
  const root = paper({ ...libraryEntry({ citekey: K, title: SRC.title, author: 'Vaswani, Ashish', year: 2017, doi: null }), byo });
  writeFileSync(join(root, '.paper', 'sources', `${K}.pdf`), pdf);
  const dials = installDialRecorder();
  try {
    _resetSourceTextMemoForTest();
    await assertVerdicts(root, new Map([[K, { title: SRC.title }]]), /^verified against your local file sources\/vaswani2017\.pdf \(sha256 [0-9a-f]{12}…\)$/, `sources/${K}.pdf`);
  } finally {
    dials.restore();
    rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual(dials.dials(), [], 'the local PDF needs no network');
});

/** The source as a Europe PMC JATS article naming the citation's DOI. */
function jats(): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const [title, ...paras] = SRC.text.split('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<article article-type="research-article"><front><article-meta>',
    `<article-id pub-id-type="pmcid">${SRC.pmcid}</article-id><article-id pub-id-type="doi">${SRC.doi}</article-id>`,
    `<title-group><article-title>${esc(title ?? '')}</article-title></title-group>`,
    '<contrib-group><contrib contrib-type="author"><name><surname>Vaswani</surname><given-names>Ashish</given-names></name></contrib></contrib-group>',
    '<pub-date><year>2017</year></pub-date></article-meta></front>',
    `<body><sec><title>Introduction</title>${paras.map((p) => `<p>${esc(p)}</p>`).join('')}</sec></body>`,
    '<back><ref-list><ref><mixed-citation>A reference the text never quotes.</mixed-citation></ref></ref-list></back>',
    '</article>',
  ].join('\n');
}

test('VRFY-29 (the Europe PMC open-access full text, answered by a local mock): the same verdicts', async () => {
  const root = paper({ ...libraryEntry({ citekey: K, title: SRC.title, author: 'Vaswani, Ashish', year: 2017, doi: SRC.doi }), pmcid: SRC.pmcid });
  let epmc = 0;
  try {
    await liveLane(async (agent) => {
      _resetSourceTextMemoForTest();
      agent
        .get('https://api.unpaywall.org')
        .intercept({ path: (p: string) => decodeURIComponent(p).startsWith(`/v2/${SRC.doi}?`), method: 'GET' })
        .reply(404, JSON.stringify({ HTTP_status_code: 404, error: true, message: `'${SRC.doi}' is an invalid doi.` }), { headers: { 'content-type': 'application/json' } })
        .persist();
      agent
        .get('https://www.ebi.ac.uk')
        .intercept({ path: `/europepmc/webservices/rest/${SRC.pmcid}/fullTextXML`, method: 'GET' })
        .reply(() => {
          epmc += 1;
          return { statusCode: 200, data: jats(), responseOptions: { headers: { 'content-type': 'application/xml' } } };
        })
        .persist();
      await assertVerdicts(root, new Map([[K, { DOI: SRC.doi, title: SRC.title }]]), new RegExp(`^verbatim in the Europe PMC full text of ${SRC.pmcid}$`));
    }, { contactEmail: EMAIL });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.ok(epmc >= 1 && epmc <= FIXTURE.quotes.length, `Europe PMC asked ${epmc} time(s)`);
});
