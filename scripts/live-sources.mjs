#!/usr/bin/env node
// scripts/live-sources.mjs — the live lane for the source adapters (D-19-25;
// SRC-02, SRC-03, SRC-04, SRC-05, SRC-06, SRC-11).
//
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run live:sources
//   (optional) OPENALEX_API_KEY=… PENSMITH_S2_API_KEY=… npm run live:sources
//
// Runs the adapter-level assertions against the REAL services — the default
// `npm test` never does (it replays recorded fixtures). One line per check:
//   PASS  <check>
//   FAIL  <check>: <why>          → the script exits 1
//   SKIP  <check>: <why>          → a keyed check without its key (visible, never silent)
//
// How it runs: the parent (plain node) checks the contact email, then runs one
// CHILD under `node --import tsx` with every mode variable removed (live, not a
// test context) and a fresh, empty data dir — so the HTTP cache cannot answer
// for the network and the user's data dir is never touched. The contact email
// must be the project address (never a personal one): it is sent to Crossref,
// OpenAlex and Unpaywall only.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

// ---------------------------------------------------------------------------
// Child: the checks (runs under `node --import tsx`)
// ---------------------------------------------------------------------------

async function runChild() {
  const lib = (rel) => pathToFileURL(path.join(REPO_ROOT, 'bin', 'lib', ...rel.split('/'))).href;
  const mock = await import(lib('http-mock.js'));
  if (mock.networkMode().sourcesOffline) {
    process.stderr.write('live-sources: sources are offline in this process — run it through `npm run live:sources`\n');
    return 2;
  }
  const crossref = await import(lib('sources/crossref.js'));
  const openalex = await import(lib('sources/openalex.js'));
  const arxiv = await import(lib('sources/arxiv.js'));
  const pubmed = await import(lib('sources/pubmed.js'));
  const s2 = await import(lib('sources/semanticscholar.js'));
  const unpaywall = await import(lib('sources/unpaywall.js'));
  const books = await import(lib('sources/books.js'));
  const rw = await import(lib('sources/retraction-watch.js'));
  const { crossCheckRetractions } = await import(lib('sources/retraction-cross-check.js'));

  const results = { pass: 0, fail: 0, skip: 0 };
  const line = (tag, name, why) => process.stdout.write(`${tag.padEnd(5)} ${name}${why ? `: ${why}` : ''}\n`);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Run one check: `fn` throws (or returns a string reason) to fail. */
  const check = async (name, fn) => {
    try {
      const why = await fn();
      if (typeof why === 'string') {
        results.fail += 1;
        line('FAIL', name, why);
      } else {
        results.pass += 1;
        line('PASS', name);
      }
    } catch (e) {
      results.fail += 1;
      line('FAIL', name, e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  };
  const skip = (name, why) => {
    results.skip += 1;
    line('SKIP', name, why);
  };
  const expect = (cond, what) => {
    if (!cond) throw new Error(what);
  };
  const found = async (adapter, id) => {
    const r = await adapter.lookupById(id);
    if (r.kind !== 'found') throw new Error(`${id}: ${r.kind}${r.reason ? ` (${r.reason})` : ''}`);
    return r.candidate;
  };

  // --- Crossref (SRC-04, SRC-05) ---
  await check('crossref: 10.1038/nature11247 is the ENCODE consortium record (corporate author)', async () => {
    const c = await found(crossref, '10.1038/nature11247');
    expect(c.authors.length === 1 && /^\{.*ENCODE Project Consortium\}$/.test(c.authors[0]), `authors ${JSON.stringify(c.authors)}`);
    expect(c.venue === 'Nature' && c.volume === '489', `venue ${c.venue} ${c.volume}`);
  });
  await check('crossref: 10.1038/nature14539 is Nature, 521(7553), 436-444', async () => {
    const c = await found(crossref, '10.1038/nature14539');
    expect(c.venue === 'Nature', `venue ${c.venue}`);
    expect(c.volume === '521' && c.issue === '7553' && c.pages === '436-444', `volume/issue/pages ${c.volume}/${c.issue}/${c.pages}`);
    expect(c.authors[0] === 'LeCun, Yann', `first author ${c.authors[0]}`);
    expect(c.type === 'article-journal', `type ${c.type}`);
  });
  await check('crossref: Wakefield 1998 (10.1016/S0140-6736(97)11096-0) is retracted: true', async () => {
    const c = await found(crossref, '10.1016/S0140-6736(97)11096-0');
    expect(c.retracted === true && c.retraction_status === 'retracted', `retracted ${c.retracted} / ${c.retraction_status}`);
    expect(/Retraction/.test(c.retraction_details ?? ''), `details ${c.retraction_details}`);
  });
  await check('crossref: a search returns complete records (updated-by selected, clear status)', async () => {
    const hits = await crossref.search('attention is all you need', { limit: 5 });
    expect(hits.length > 0, 'no hits');
    expect(hits.every((h) => h.retraction_status === 'clear' || h.retraction_status === 'retracted'), 'undecided retraction status');
  });
  await check('crossref: doiPrefix 10.3386 (the nber preference) returns NBER working papers', async () => {
    const hits = await crossref.search('minimum wage employment', { limit: 3, doiPrefix: '10.3386' });
    expect(hits.length > 0 && hits.every((h) => (h.doi ?? '').startsWith('10.3386/')), JSON.stringify(hits.map((h) => h.doi)));
  });

  // --- Retraction lookups (SRC-04) ---
  await check('retraction lookup: Wakefield 1998 has a Retraction Watch notice', async () => {
    const hit = await rw.fetchById('10.1016/S0140-6736(97)11096-0');
    expect(hit?.retracted === true, 'no retraction notice');
  });
  await check('retraction cross-check: retracted | clear per candidate, never swallowed', async () => {
    const cands = [
      { source: 'pubmed', id: '9500898', doi: '10.1016/S0140-6736(97)11096-0', title: 'W', authors: ['Wakefield AJ'], retracted: false, last_verified: new Date().toISOString(), citekey: 'wakefield1998', raw: {} },
      { source: 'openalex', id: 'W1', doi: '10.1038/nphys1170', title: 'Measured measurement', authors: ['Markus Aspelmeyer'], retracted: false, last_verified: new Date().toISOString(), citekey: 'aspelmeyer2009', raw: {} },
    ];
    await crossCheckRetractions(cands);
    expect(cands[0].retraction_status === 'retracted' && cands[1].retraction_status === 'clear', JSON.stringify(cands.map((c) => c.retraction_status)));
  });

  // --- arXiv (SRC-02) ---
  await check('arxiv: search "attention mechanisms in transformers" returns results', async () => {
    const hits = await arxiv.search('attention mechanisms in transformers', { limit: 5 });
    expect(hits.length >= 1, 'no results');
    expect(hits.every((h) => h.type === 'preprint' && typeof h.arxiv === 'string'), 'incomplete preprints');
  });
  await pause(3500);
  await check('arxiv: 1706.03762 is "Attention Is All You Need" with arxiv = 1706.03762', async () => {
    const c = await found(arxiv, '1706.03762');
    expect(c.title === 'Attention Is All You Need', `title ${c.title}`);
    expect(c.arxiv === '1706.03762', `arxiv ${c.arxiv}`);
    expect((c.abstract ?? '').length > 100, 'no abstract');
  });
  await pause(3500);
  await check('arxiv: an old-style id (hep-th/9901001v2) resolves without its version', async () => {
    const c = await found(arxiv, 'hep-th/9901001v2');
    expect(c.arxiv === 'hep-th/9901001', `arxiv ${c.arxiv}`);
  });

  // --- PubMed (SRC-05) ---
  await check('pubmed: PMID 31978945 has journal, volume, issue, pages, DOI and PMCID', async () => {
    const c = await found(pubmed, 'PMID:31978945');
    expect(c.volume === '382' && c.issue === '8' && c.pages === '727-733', `${c.volume}/${c.issue}/${c.pages}`);
    expect(c.doi === '10.1056/NEJMoa2001017' && c.pmcid === 'PMC7092803', `${c.doi} ${c.pmcid}`);
  });

  // --- Unpaywall (SRC-03) ---
  for (const doi of ['10.1038/s41586-020-2649-2', '10.1371/journal.pone.0000001']) {
    await check(`unpaywall: ${doi} has authors and an OA PDF URL`, async () => {
      const c = await found(unpaywall, doi);
      expect(c.authors.length > 0, 'no authors');
      expect(typeof c.oa_pdf_url === 'string' && /^https?:\/\//.test(c.oa_pdf_url), `oa_pdf_url ${c.oa_pdf_url}`);
    });
  }

  // --- OpenAlex (SRC-06) ---
  const oaKeyName = 'OPENALEX_API_KEY';
  if ((process.env[oaKeyName] ?? '').trim()) {
    await check('openalex (keyed): a search and a lookup round trip with api_key', async () => {
      const reasons = [];
      const hits = await openalex.search('deep learning', { limit: 3, onFailure: (r) => reasons.push(r) });
      expect(reasons.length === 0, `search failed: ${reasons[0]}`);
      expect(hits.length > 0, 'no hits');
      const c = await found(openalex, '10.1038/nature14539');
      expect(c.venue === 'Nature' && c.pages === '436-444', `${c.venue} ${c.pages}`);
    });
  } else {
    skip('openalex (keyed): search + lookup with api_key', `skipped: ${oaKeyName} not set (keyed round trip is an open maintainer item)`);
    await check('openalex (keyless): a single-work lookup (no budget cost) has venue and biblio', async () => {
      const c = await found(openalex, '10.1038/nature14539');
      expect(c.venue === 'Nature' && c.volume === '521' && c.pages === '436-444', `${c.venue} ${c.volume} ${c.pages}`);
    });
  }

  // --- Semantic Scholar (SRC-06, SRC-17) ---
  const s2Keyed = (process.env.PENSMITH_S2_API_KEY ?? '').trim().length > 0;
  await check(`semanticscholar (${s2Keyed ? 'keyed' : 'keyless'}): results, or ${s2Keyed ? 'none' : 'the keyless 429 reason'}`, async () => {
    const reasons = [];
    const hits = await s2.search('attention is all you need', { limit: 3, onFailure: (r) => reasons.push(r) });
    if (hits.length > 0) return undefined;
    if (!s2Keyed && reasons[0] === s2.S2_KEYLESS_429_REASON) {
      line('INFO', 'semanticscholar', `keyless pool answered 429 — reported as "${reasons[0]}"`);
      return undefined;
    }
    return `no results (${reasons[0] ?? 'empty answer'})`;
  });
  if (!s2Keyed) skip('semanticscholar (keyed): x-api-key round trip', 'skipped: PENSMITH_S2_API_KEY not set');

  // --- Books (SRC-11) ---
  await check('books: isbn:9780226458083 is Kuhn, The Structure of Scientific Revolutions (@book, publisher, year)', async () => {
    const c = await found(books, 'isbn:9780226458083');
    expect(/^The Structure of Scientific Revolutions/i.test(c.title), `title ${c.title}`);
    expect(/Kuhn/.test(c.authors[0] ?? ''), `authors ${JSON.stringify(c.authors)}`);
    expect(c.type === 'book' && typeof c.publisher === 'string' && typeof c.year === 'number', `${c.type} ${c.publisher} ${c.year}`);
    expect(c.isbn === '9780226458083', `isbn ${c.isbn}`);
  });
  await check('books: a title search finds "The Economic Consequences of the Peace"', async () => {
    const hits = await books.search('The Economic Consequences of the Peace', { limit: 5 });
    expect(hits.some((h) => /economic consequences of the peace/i.test(h.title) && h.authors.some((a) => /Keynes/.test(a))), JSON.stringify(hits.map((h) => h.title)));
  });

  process.stdout.write(`live-sources: ${results.pass} passed, ${results.fail} failed, ${results.skip} skipped\n`);
  return results.fail > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------

function runParent() {
  const email = (process.env.PENSMITH_CONTACT_EMAIL ?? '').trim();
  if (!email) {
    process.stderr.write(
      'live-sources: set PENSMITH_CONTACT_EMAIL to the project address (PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org) — ' +
        'Crossref, OpenAlex and Unpaywall ask for a contact, and Unpaywall refuses requests without one.\n',
    );
    return 2;
  }
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pensmith-live-sources-'));
  const env = { ...process.env };
  for (const k of [
    'NODE_TEST_CONTEXT', 'PENSMITH_TEST', 'PENSMITH_OFFLINE', 'PENSMITH_DRY_RUN', 'PENSMITH_NETWORK_TESTS',
    'PENSMITH_NO_LLM', 'PENSMITH_PAPER_ROOT', 'PENSMITH_RECORD_CASSETTES', 'PENSMITH_TEST_DATA_DIR',
  ]) delete env[k];
  // A fresh, empty data dir: the HTTP cache cannot answer for the network.
  env.XDG_DATA_HOME = dataDir;
  env.LOCALAPPDATA = dataDir;
  env.HOME = dataDir;
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), __filename, '--child'], {
    cwd: dataDir,
    env,
    stdio: 'inherit',
  });
  rmSync(dataDir, { recursive: true, force: true });
  return r.status ?? 1;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  if (process.argv.includes('--child')) {
    runChild().then(
      (code) => process.exit(code),
      (e) => {
        process.stderr.write(`live-sources: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
        process.exit(1);
      },
    );
  } else {
    process.exit(runParent());
  }
}
