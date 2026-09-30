#!/usr/bin/env node
// scripts/live-verify-quotes.mjs — the live lane for Pass 3's sources (Phase
// 20, VRFY-19; D-20-18).
//
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org node scripts/live-verify-quotes.mjs
//
// Runs Pass 3 (bin/lib/verify/pass3.ts runPass3 and the source-text module it
// reads through) against the REAL services — the default `npm test` never
// does (it replays recorded fixtures and local mocks):
//   - the NumPy paper (10.1038/s41586-020-2649-2): a genuine sentence of its
//     abstract is PASS, found in an open-access copy Unpaywall lists, and
//     "NumPy was invented on the moon by a committee of forty seven penguins"
//     is NOT_FOUND in that real text;
//   - the PLOS ONE PDF of 10.1371/journal.pone.0000001 (the one Unpaywall
//     lists) extracts more than 10,000 characters;
//   - arXiv 1706.03762: its `.pdf` URL is fetched through arXiv's redirect,
//     and a sentence of its abstract is PASS through the arXiv route of Pass 3;
//   - a second Pass 3 over the NumPy quotes is served from the extracted-text
//     cache (no request: the network is denied for that run).
// One line per check (PASS / FAIL <why>); any FAIL exits 1.
//
// How it runs: the parent (plain node) checks the contact email, then runs
// one CHILD under `node --import tsx` with every mode variable removed (live,
// not a test context) and a fresh, empty data dir — so no cache answers for
// the network on the first run and the user's data dir is never touched. The
// contact email must be the project address (never a personal one): it goes
// to Unpaywall only.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

const NUMPY_DOI = '10.1038/s41586-020-2649-2';
const NUMPY_GENUINE =
  'Array programming provides a powerful, compact and expressive syntax for accessing, manipulating and operating on data in vectors, matrices and higher-dimensional arrays';
const NUMPY_PENGUINS = 'NumPy was invented on the moon by a committee of forty seven penguins';
const PLOS_DOI = '10.1371/journal.pone.0000001';
const ARXIV_ID = '1706.03762';
const ARXIV_GENUINE = 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks';

// ---------------------------------------------------------------------------
// Child: the checks (runs under `node --import tsx`)
// ---------------------------------------------------------------------------

async function runChild() {
  const lib = (rel) => pathToFileURL(path.join(REPO_ROOT, 'bin', 'lib', ...rel.split('/'))).href;
  const mock = await import(lib('http-mock.js'));
  if (mock.networkMode().sourcesOffline) {
    process.stderr.write('live-verify-quotes: sources are offline in this process — run it as `node scripts/live-verify-quotes.mjs`\n');
    return 2;
  }
  const { runPass3 } = await import(lib('verify/pass3.js'));
  const sourceText = await import(lib('verify/source-text.js'));
  const unpaywall = await import(lib('sources/unpaywall.js'));

  let failed = 0;
  const line = (tag, name, why) => process.stdout.write(`${tag.padEnd(5)} ${name}${why ? `: ${why}` : ''}\n`);
  const check = async (name, fn) => {
    try {
      const why = await fn();
      if (typeof why === 'string') {
        failed += 1;
        line('FAIL', name, why);
      } else {
        line('PASS', name, why && why.note ? why.note : undefined);
      }
    } catch (e) {
      failed += 1;
      line('FAIL', name, e instanceof Error ? e.message.split('\n')[0] : String(e));
    }
  };
  const one = async (draft, bib) => {
    const rows = await runPass3(draft, bib);
    if (rows.length !== 1) throw new Error(`expected one Pass-3 row, got ${rows.length}`);
    return rows[0];
  };

  const numpy = new Map([['harris2020', { DOI: NUMPY_DOI, title: 'Array programming with NumPy' }]]);
  const genuineDraft = `The authors write that "${NUMPY_GENUINE}" [@harris2020, p. 357].\n`;
  const penguinDraft = `The authors claim that "${NUMPY_PENGUINS}" [@harris2020].\n`;

  await check('VRFY-19 live: the NumPy paper — a genuine sentence of its abstract is PASS in an open-access copy', async () => {
    const r = await one(genuineDraft, numpy);
    if (r.verdict !== 'PASS' && r.verdict !== 'FUZZY') return `${r.verdict}: ${r.reason}`;
    return { note: `${r.verdict} — ${r.reason}` };
  });
  await check('VRFY-19 live: "NumPy was invented on the moon by a committee of forty seven penguins" is NOT_FOUND in the real text', async () => {
    const r = await one(penguinDraft, numpy);
    if (r.verdict !== 'NOT_FOUND') return `${r.verdict}: ${r.reason}`;
    return { note: r.reason };
  });

  await check('VRFY-19 live: the PLOS ONE PDF Unpaywall lists for 10.1371/journal.pone.0000001 extracts more than 10,000 characters', async () => {
    const up = await unpaywall.lookupOaPdfUrls(PLOS_DOI);
    if (up.kind !== 'found' || up.pdfUrls.length === 0) return `Unpaywall: ${up.kind}${up.reason ? ` (${up.reason})` : ''}`;
    const a = await sourceText.openAccessPdfText(up.pdfUrls[0]);
    if (a.kind !== 'text') return `${a.kind}: ${a.reason}`;
    const n = a.source.text.length;
    return n > 10_000 ? { note: `${n} characters from ${a.source.finalUrl}` } : `only ${n} characters`;
  });

  await check('VRFY-19 live: arXiv 1706.03762 is fetched through its redirect, and its abstract is PASS through the arXiv route', async () => {
    const via = await sourceText.openAccessPdfText(`https://arxiv.org/pdf/${ARXIV_ID}.pdf`, { source: 'arxiv' });
    if (via.kind !== 'text') return `${via.kind}: ${via.reason}`;
    if (via.source.finalUrl === via.source.url) return `no redirect was followed (${via.source.url} answered itself)`;
    if (via.source.text.length <= 10_000) return `only ${via.source.text.length} characters`;
    const r = await one(`As the authors put it, "${ARXIV_GENUINE}" [@vaswani2017].\n`, new Map([['vaswani2017', { DOI: `10.48550/arXiv.${ARXIV_ID}` }]]));
    if (r.verdict !== 'PASS' && r.verdict !== 'FUZZY') return `${r.verdict}: ${r.reason}`;
    return { note: `${via.source.url} → ${via.source.finalUrl} (${via.source.text.length} characters); ${r.reason}` };
  });

  await check('VRFY-19 live: a second Pass 3 over the NumPy quotes is served from the caches — the network denied, the same verdicts', async () => {
    sourceText._resetSourceTextMemoForTest(); // a new run: nothing remembered in memory
    // Every socket refused and recorded (the dial recorder the socket-proof tests use):
    // only the HTTP cache and the extracted-text cache can answer.
    const { installDialRecorder } = await import(pathToFileURL(path.join(REPO_ROOT, 'tests', 'helpers', 'local-servers', 'dial-recorder.mjs')).href);
    const dials = installDialRecorder();
    try {
      const again = await one(genuineDraft, numpy);
      const penguins = await one(penguinDraft, numpy);
      if ((again.verdict !== 'PASS' && again.verdict !== 'FUZZY') || penguins.verdict !== 'NOT_FOUND') {
        return `${again.verdict} / ${penguins.verdict}: ${again.reason} | ${penguins.reason}`;
      }
      const tried = dials.dials();
      if (tried.length > 0) return `${tried.length} connection(s) attempted: ${tried.map((d) => d.servername ?? d.host).join(', ')}`;
      return { note: `${again.verdict} / ${penguins.verdict} with 0 connections` };
    } finally {
      dials.restore();
    }
  });

  process.stdout.write(`live-verify-quotes: ${failed === 0 ? 'all checks passed' : `${failed} check(s) failed`}\n`);
  return failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------

function runParent() {
  const email = (process.env.PENSMITH_CONTACT_EMAIL ?? '').trim();
  if (!email) {
    process.stderr.write(
      'live-verify-quotes: set PENSMITH_CONTACT_EMAIL to the project address (PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org) — ' +
        'Unpaywall refuses requests without a contact.\n',
    );
    return 2;
  }
  const dataDir = mkdtempSync(path.join(tmpdir(), 'pensmith-live-quotes-'));
  const env = { ...process.env };
  for (const k of [
    'NODE_TEST_CONTEXT', 'PENSMITH_TEST', 'PENSMITH_OFFLINE', 'PENSMITH_DRY_RUN', 'PENSMITH_NETWORK_TESTS',
    'PENSMITH_NO_LLM', 'PENSMITH_PAPER_ROOT', 'PENSMITH_RECORD_CASSETTES', 'PENSMITH_TEST_DATA_DIR',
  ]) delete env[k];
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
        process.stderr.write(`live-verify-quotes: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
        process.exit(1);
      },
    );
  } else {
    process.exit(runParent());
  }
}
