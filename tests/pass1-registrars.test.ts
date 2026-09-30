// tests/pass1-registrars.test.ts — Pass 1 asks every identifier at its own
// registrar, accepts aliases and the user's own PDFs only on real evidence,
// and records when each answer was obtained (Phase 20: VRFY-11, VRFY-12,
// VRFY-14, VRFY-15, VRFY-28; D-20-10, D-20-12, D-20-13, D-20-15).
//
// Offline cases replay the live recordings (scripts/refresh-cassettes.mjs);
// the failure, alias and cache cases run the test-lane MockAgent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPass1, retractionWarningLine, type Pass1Result } from '../bin/lib/verify/pass1.js';
import { upsertSources } from '../bin/lib/library.js';
import { liveLane, uniq } from './sources/three-way.js';

function paper(bib: string): { root: string; bibPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-pass1-registrars-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, bib);
  return { root, bibPath };
}

async function one(bib: string, key: string, opts: { root?: string; refresh?: ReadonlySet<string> } = {}): Promise<Pass1Result> {
  const p = paper(bib);
  const rows = await runPass1(`A claim [@${key}].\n`, p.bibPath, { root: opts.root ?? p.root, ...(opts.refresh ? { refresh: opts.refresh } : {}) });
  const r = rows.find((x) => x.citekey === key);
  assert.ok(r, `a row for ${key}`);
  return r;
}

/** The VRFY-11 acceptance list, as a user's bibliography cites each work. */
const VRFY11 = String.raw`
@article{lecun2015, author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey}, title = {Deep learning}, journal = {Nature}, year = {2015}, doi = {10.1038/nature14539}}
@book{boyd2004, author = {Boyd, Stephen and Vandenberghe, Lieven}, title = {Convex Optimization}, publisher = {Cambridge University Press}, year = {2004}, doi = {10.1017/CBO9780511804441}}
@misc{vaswani2017, author = {Vaswani, Ashish and Shazeer, Noam}, title = {Attention Is All You Need}, year = {2017}, doi = {10.48550/arXiv.1706.03762}}
@misc{devlin2018, author = {Devlin, Jacob and Chang, Ming-Wei}, title = {BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding}, year = {2018}, eprint = {1810.04805}, archivePrefix = {arXiv}}
@book{kuhn1996, author = {Kuhn, Thomas S.}, title = {The Structure of Scientific Revolutions}, year = {1996}, isbn = {9780226458083}}
@misc{montani2023, author = {Montani, Ines and Honnibal, Matthew}, title = {explosion/spaCy: v3.7.2: Fixes for APIs and requirements}, publisher = {Zenodo}, year = {2023}, doi = {10.5281/zenodo.1212303}}
@article{mcmurray2019, author = {McMurray JJV and Solomon SD}, title = {Dapagliflozin in Patients with Heart Failure and Reduced Ejection Fraction}, journal = {N Engl J Med}, year = {2019}, pmid = {31535829}}
@book{navab2015, editor = {Navab, Nassir and Hornegger, Joachim and Wells, William M.}, title = {Medical Image Computing and Computer-Assisted Intervention -- MICCAI 2015}, publisher = {Springer}, year = {2015}, doi = {10.1007/978-3-319-24574-4}}
@article{encode2012, author = {{The ENCODE Project Consortium}}, title = {An integrated encyclopedia of DNA elements in the human genome}, journal = {Nature}, year = {2012}, doi = {10.1038/nature11247}}
@article{fake2024, author = {Smith, A.B.}, title = {Attention Mechanisms in Modern Transformer Architectures}, year = {2024}, doi = {10.99999/fake.001}}
@article{lecun2015upper, author = {LeCun, Yann}, title = {Deep learning}, year = {2015}, doi = {10.1038/NATURE14539}}
`;

test('VRFY-11: every identifier of the acceptance list verifies OK at its own registrar (offline, from the live recordings); 10.99999/fake.001 is FABRICATED', async () => {
  const { root, bibPath } = paper(VRFY11);
  const keys = [...VRFY11.matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1]!);
  const rows = await runPass1(keys.map((k) => `A claim [@${k}].`).join('\n'), bibPath, { root });
  const verdict = Object.fromEntries(rows.map((r) => [r.citekey, r.verdict]));
  for (const k of keys.filter((k) => k !== 'fake2024')) assert.equal(verdict[k], 'OK', `${k}: ${rows.find((r) => r.citekey === k)?.reason}`);
  assert.equal(verdict['fake2024'], 'FABRICATED');
  const reason = (k: string): string => rows.find((r) => r.citekey === k)!.reason;
  assert.match(reason('montani2023'), /^DOI 10\.5281\/zenodo\.1212303 is registered with DataCite, not Crossref; re-fetched from DataCite; D-11 AND-gate passed \(year 2023\); retraction status unknown \(no retraction data for DataCite DOIs\)$/);
  assert.match(reason('devlin2018'), /^arXiv:1810\.04805 re-fetched from arXiv; D-11 AND-gate passed \(year 2018\); retraction status unknown \(no retraction data for arXiv preprints\)$/);
  assert.match(reason('mcmurray2019'), /^PMID 31535829 re-fetched from PubMed; D-11 AND-gate passed \(year 2019\)$/, 'PubMed has retraction data: no "unknown" note');
  assert.match(reason('navab2015'), /^D-11 AND-gate passed \(year 2015\)$/, 'an edited volume compared by its first editor');
  // VRFY-28: every row a registrar answered carries when it answered.
  for (const r of rows.filter((x) => x.verdict === 'OK')) assert.ok(typeof r.checkedAt === 'string' && !Number.isNaN(Date.parse(r.checkedAt)), r.citekey);
});

test('D-20-10: mEDRA and JaLC DOIs verify through doi.org content negotiation (their CSL records), with the retraction status unknown', async () => {
  const medra = await one('@article{navajas2005, author = {Navajas, Gonzalo}, title = {La historia y la literatura española postnacional}, journal = {Studi ispanici}, year = {2005}, doi = {10.1400/19806}}\n', 'navajas2005');
  assert.equal(medra.verdict, 'OK', medra.reason);
  assert.match(medra.reason, /registered with mEDRA, not Crossref; re-fetched through doi\.org content negotiation; .*no retraction data for mEDRA DOIs/);
  const jalc = await one('@thesis{kitamoto1997, author = {北本, 朝展}, title = {領域・空間情報を表現するグラフ構造を用いた類似画像検索}, school = {東京大学}, year = {1997}, doi = {10.11501/3140078}}\n', 'kitamoto1997');
  assert.equal(jalc.verdict, 'OK', `a Japanese thesis compared in its own script: ${jalc.reason}`);
});

test('VRFY-14: a DOI Crossref and DataCite definitively do not know is FABRICATED — even with the user\'s own PDF attached', async () => {
  const { root, bibPath } = paper('');
  const pdf = Buffer.from('%PDF-1.4\n% a local copy the user attached\n');
  mkdirSync(join(root, '.paper', 'sources'), { recursive: true });
  writeFileSync(join(root, '.paper', 'sources', 'doe2020.pdf'), pdf);
  await upsertSources(
    root,
    [{
      source: 'byo',
      id: 'byo:doe2020',
      doi: '10.5281/zenodo.pensmith-fake-2099',
      title: 'Nothing At All',
      authors: ['Doe, Jane'],
      year: 2020,
      byo: { file: 'sources/doe2020.pdf', sha256: createHash('sha256').update(pdf).digest('hex'), text_sha256: null },
      last_verified: new Date().toISOString(),
      citekey: 'doe2020',
      raw: {},
    }],
    { provenance: 'byo' },
  );
  const [r] = await runPass1('A claim [@doe2020].\n', bibPath, { root });
  assert.equal(r?.verdict, 'FABRICATED', r?.reason);
  assert.match(r?.reason ?? '', /registered with DataCite, not Crossref, and DataCite has no record of it/);
});

test('VRFY-14: an identifier-less entry backed by the user\'s own PDF that still re-hashes is OK-BYO, naming the file and hash; an altered PDF is not', async () => {
  const { root, bibPath } = paper('');
  const pdf = Buffer.from('%PDF-1.4\n% field notes the user wrote down\n');
  const sha = createHash('sha256').update(pdf).digest('hex');
  mkdirSync(join(root, '.paper', 'sources'), { recursive: true });
  writeFileSync(join(root, '.paper', 'sources', 'moss2019.pdf'), pdf);
  await upsertSources(
    root,
    [{
      source: 'byo',
      id: 'byo:moss2019',
      title: 'Field Notes on Moss Growth Beside the Old Mill Stream',
      authors: ['Moss, Mary'],
      year: 2019,
      hydrated: false,
      byo: { file: 'sources/moss2019.pdf', sha256: sha, text_sha256: null },
      last_verified: new Date().toISOString(),
      citekey: 'moss2019',
      raw: {},
    }],
    { provenance: 'byo' },
  );
  const [ok] = await runPass1('A claim [@moss2019].\n', bibPath, { root });
  assert.equal(ok?.verdict, 'OK-BYO', ok?.reason);
  assert.equal(ok?.reason, `your own PDF sources/moss2019.pdf (sha256 ${sha.slice(0, 12)}) still matches what you ingested; the entry has no DOI, arXiv id, PMID or ISBN`);
  // Edit the local copy: the hash no longer matches — never OK-BYO (S-17).
  writeFileSync(join(root, '.paper', 'sources', 'moss2019.pdf'), Buffer.concat([pdf, Buffer.from('% edited\n')]));
  const [altered] = await runPass1('A claim [@moss2019].\n', bibPath, { root });
  assert.notEqual(altered?.verdict, 'OK-BYO');
  assert.equal(altered?.verdict, 'UNVERIFIABLE', altered?.reason);
  assert.match(altered?.reason ?? '', /your own PDF can no longer stand in for this entry \(PDF changed since ingest/);
});

test('VRFY-14: OK-BYO also covers a lookup that got no answer (offline), and only then', async () => {
  const { root, bibPath } = paper('');
  const pdf = Buffer.from('%PDF-1.4\n% a paper whose DOI has no recorded answer\n');
  const sha = createHash('sha256').update(pdf).digest('hex');
  mkdirSync(join(root, '.paper', 'sources'), { recursive: true });
  writeFileSync(join(root, '.paper', 'sources', 'offline2021.pdf'), pdf);
  await upsertSources(
    root,
    [{
      source: 'byo',
      id: 'byo:offline2021',
      doi: '10.5555/pensmith-byo-unrecorded',
      title: 'A Paper Whose Lookup Gets No Answer',
      authors: ['Offline, Olga'],
      year: 2021,
      byo: { file: 'sources/offline2021.pdf', sha256: sha, text_sha256: null },
      last_verified: new Date().toISOString(),
      citekey: 'offline2021',
      raw: {},
    }],
    { provenance: 'byo' },
  );
  const [r] = await runPass1('A claim [@offline2021].\n', bibPath, { root });
  assert.equal(r?.verdict, 'OK-BYO', r?.reason);
  assert.match(r?.reason ?? '', /^your own PDF sources\/offline2021\.pdf \(sha256 [0-9a-f]{12}\) still matches what you ingested; the registrar lookup got no answer \(offline: no recorded fixture/);
});

test('VRFY-14: a forged alternate DOI in LIBRARY.json pointing at a real work never makes a fabricated primary DOI pass', async () => {
  const { root, bibPath } = paper('');
  await upsertSources(
    root,
    [{
      source: 'crossref',
      id: '10.99999/fake.001',
      doi: '10.99999/fake.001',
      alternate_dois: ['10.1038/nature14539'],
      title: 'Deep learning',
      authors: ['LeCun, Yann'],
      year: 2015,
      last_verified: new Date().toISOString(),
      citekey: 'forged2015',
      raw: {},
    }],
    { provenance: 'add' },
  );
  const [r] = await runPass1('A claim [@forged2015].\n', bibPath, { root });
  assert.equal(r?.verdict, 'FABRICATED', r?.reason);
});

const JSON_HEADERS = { headers: { 'content-type': 'application/json' } } as const;
const NO_RETRACTION = { status: 'ok', 'message-type': 'work-list', message: { items: [], 'total-results': 0 } };

function workBody(doi: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'ok',
    'message-type': 'work',
    message: { DOI: doi, title: ['Aliased Work On Something'], author: [{ family: 'Alias', given: 'Ann' }], issued: { 'date-parts': [[2021]] }, type: 'journal-article', ...extra },
  };
}

const aliasBib = (doi: string): string => `@article{alias2021,\n  author = {Alias, Ann},\n  title = {Aliased Work On Something},\n  year = {2021},\n  doi = {${doi}},\n}\n`;

test('VRFY-14 (MockAgent): an answer under another DOI passes only when the registrar asserts the relation — record relation, doi.org redirect, or neither', async () => {
  await liveLane(async (agent) => {
    const crossref = agent.get('https://api.crossref.org');
    crossref.intercept({ path: /^\/works\?filter=updates/, method: 'GET' }).reply(200, NO_RETRACTION, JSON_HEADERS).persist();
    const doiOrg = agent.get('https://doi.org');

    // (a) the returned record asserts has-preprint the claimed (preprint) DOI.
    const pre = `10.5555/${uniq('preprint')}`;
    const vor = `10.5555/${uniq('vor')}`;
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${pre}`, method: 'GET' })
      .reply(200, workBody(vor, { relation: { 'has-preprint': [{ 'id-type': 'doi', id: pre, 'asserted-by': 'subject' }] } }), JSON_HEADERS);
    const a = await one(aliasBib(pre), 'alias2021');
    assert.equal(a.verdict, 'OK', a.reason);
    assert.match(a.reason, new RegExp(`${pre.replace(/\./g, '\\.')} → ${vor.replace(/\./g, '\\.')} \\(the record asserts has-preprint`));

    // (b) no relation, but doi.org's handle of the claimed DOI redirects to the returned DOI.
    const alias = `10.5555/${uniq('alias')}`;
    const primary = `10.5555/${uniq('primary')}`;
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${alias}`, method: 'GET' }).reply(200, workBody(primary), JSON_HEADERS);
    doiOrg.intercept({ path: `/${alias}`, method: 'HEAD' }).reply(302, '', { headers: { location: `https://doi.org/${primary}` } });
    const b = await one(aliasBib(alias), 'alias2021');
    assert.equal(b.verdict, 'OK', b.reason);
    assert.match(b.reason, /doi\.org redirects/);

    // (c) neither: a strict title / author match is NOT enough (the old redirect branch) — MIS-CITED.
    const claimed = `10.5555/${uniq('claimed')}`;
    const other = `10.5555/${uniq('other')}`;
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${claimed}`, method: 'GET' }).reply(200, workBody(other), JSON_HEADERS);
    doiOrg.intercept({ path: `/${claimed}`, method: 'HEAD' }).reply(302, '', { headers: { location: 'https://publisher.example/landing' } });
    const c = await one(aliasBib(claimed), 'alias2021');
    assert.equal(c.verdict, 'MIS-CITED', c.reason);
    assert.match(c.reason, /answers with another work's record .* an alias passes only when the registrar asserts it/);
    assert.equal(c.titleJW, 1, 'the metadata matched strictly — and still did not pass');

    // (d) the handle question got no answer: UNVERIFIABLE-NETWORK, never OK.
    const silent = `10.5555/${uniq('silent')}`;
    crossref.intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${silent}`, method: 'GET' }).reply(200, workBody(`10.5555/${uniq('elsewhere')}`), JSON_HEADERS);
    const d = await one(aliasBib(silent), 'alias2021');
    assert.equal(d.verdict, 'UNVERIFIABLE-NETWORK', d.reason);
  });
});

test('VRFY-12 (MockAgent): Crossref 429, 500 and a transport failure are UNVERIFIABLE-NETWORK with the reason — never FABRICATED', async () => {
  for (const [label, arm] of [
    ['429', (i: { reply: (s: number, b: string, o: object) => { persist: () => void } }) => i.reply(429, 'Too Many Requests', { headers: { 'content-type': 'text/plain', 'retry-after': '0' } }).persist()],
    ['500', (i: { reply: (s: number, b: string, o: object) => { persist: () => void } }) => i.reply(500, 'Internal Server Error', { headers: { 'content-type': 'text/plain' } }).persist()],
  ] as const) {
    await liveLane(async (agent) => {
      const doi = `10.5555/${uniq(`p1-${label}`)}`;
      arm(agent.get('https://api.crossref.org').intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${doi}`, method: 'GET' }) as never);
      const r = await one(`@article{down2020,\n  author = {Doe, Jane},\n  title = {Some Work},\n  year = {2020},\n  doi = {${doi}},\n}\n`, 'down2020');
      assert.equal(r.verdict, 'UNVERIFIABLE-NETWORK', `${label}: ${r.reason}`);
      assert.match(r.reason, new RegExp(`^Crossref re-fetch of ${doi.replace(/\./g, '\\.')} failed: .*${label === '429' ? '(429|rate)' : '500'}.* — re-run verify once the lookup answers$`));
    });
  }
  await liveLane(async () => {
    // No interceptor: the MockAgent refuses the connection (a transport error / DNS failure).
    const doi = `10.5555/${uniq('p1-transport')}`;
    const r = await one(`@article{gone2020,\n  author = {Doe, Jane},\n  title = {Some Work},\n  year = {2020},\n  doi = {${doi}},\n}\n`, 'gone2020');
    assert.equal(r.verdict, 'UNVERIFIABLE-NETWORK', r.reason);
    assert.match(r.reason, /failed: .* — re-run verify once the lookup answers$/);
  });
});

test('VRFY-28 (MockAgent): checkedAt is when the registrar answered — a cached answer\'s time; `refresh` skips the cache read and writes the fresh answer back', async () => {
  await liveLane(async (agent) => {
    const doi = `10.5555/${uniq('fresh')}`;
    let asks = 0;
    const crossref = agent.get('https://api.crossref.org');
    crossref
      .intercept({ path: (p: string) => decodeURIComponent(p) === `/works/${doi}`, method: 'GET' })
      .reply(() => {
        asks += 1;
        return { statusCode: 200, data: workBody(doi), responseOptions: JSON_HEADERS };
      })
      .persist();
    crossref.intercept({ path: /^\/works\?filter=updates/, method: 'GET' }).reply(200, NO_RETRACTION, JSON_HEADERS).persist();
    const bib = `@article{fresh2021,\n  author = {Alias, Ann},\n  title = {Aliased Work On Something},\n  year = {2021},\n  doi = {${doi}},\n}\n`;
    const before = Date.now();
    const first = await one(bib, 'fresh2021');
    assert.equal(first.verdict, 'OK', first.reason);
    assert.equal(asks, 1);
    assert.ok(Date.parse(first.checkedAt!) >= before - 1000);
    await new Promise((r) => setTimeout(r, 20));
    const cached = await one(bib, 'fresh2021');
    assert.equal(asks, 1, 'served from the HTTP cache');
    assert.equal(cached.checkedAt, first.checkedAt, 'a cached answer is dated when it was obtained, not now');
    const refreshed = await one(bib, 'fresh2021', { refresh: new Set(['fresh2021']) });
    assert.equal(asks, 2, 'refresh skipped the cache read');
    assert.ok(Date.parse(refreshed.checkedAt!) > Date.parse(first.checkedAt!));
    const again = await one(bib, 'fresh2021');
    assert.equal(asks, 2, 'the refreshed answer was written back');
    assert.equal(again.checkedAt, refreshed.checkedAt);
  });
});

test('VRFY-15: a RETRACTED row is echoed on stderr as a hard warning naming the key and the notice', async () => {
  const { root, bibPath } = paper('@article{wakefield1998,\n  author = {Wakefield, AJ},\n  title = {Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children},\n  year = {1998},\n  doi = {10.1016/S0140-6736(97)11096-0},\n}\n');
  const lines: string[] = [];
  const write = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    lines.push(String(s));
    return true;
  };
  let rows: Pass1Result[];
  try {
    rows = await runPass1('A claim [@wakefield1998].\n', bibPath, { root });
  } finally {
    (process.stderr as unknown as { write: typeof write }).write = write;
  }
  assert.equal(rows[0]?.verdict, 'RETRACTED');
  assert.deepEqual(lines, [
    "pensmith verify: RETRACTED — wakefield1998: Crossref's record of 10.1016/S0140-6736(97)11096-0 at verify time: 2010-02-06: Retraction (notice 10.1016/s0140-6736(10)60175-4; Retraction Watch record 4036)\n",
  ]);
  assert.equal(retractionWarningLine({ citekey: 'k', reason: 'cited work is retracted (notice X) — the metadata matches the registrar record' }), 'pensmith verify: RETRACTED — k: notice X');
});
