#!/usr/bin/env node
// scripts/refresh-cassettes.mjs — record REAL cassettes from the live endpoints
// (CI-07, D-17-14).
//
//   PENSMITH_CONTACT_EMAIL=you@example.org npm run cassettes:refresh
//   PENSMITH_CONTACT_EMAIL=you@example.org npm run cassettes:refresh -- --only crossref
//   npm run cassettes:refresh -- --list
//
// How it works:
//   - The parent (this file, plain node) checks the contact email, then runs one
//     CHILD per adapter: `node --import tsx scripts/refresh-cassettes.mjs
//     --child <adapter>` with PENSMITH_RECORD_CASSETTES=1, every mode variable
//     removed (live, NOT a test context) and a fresh, empty data dir (so the HTTP
//     cache can never answer instead of the network).
//   - The child drives the adapter's recorded query set (below) through the REAL
//     adapter code, so the recorded URL is exactly what the adapter requests.
//     bin/lib/http.ts's record hook buffers one exact-match entry per request;
//     the child drains it (takeRecordedFixtures) after each call.
//   - Scrubbing: only the content-type response header is kept (never
//     Authorization, Cookie, Set-Cookie, X-Api-Key — tests/cassette-no-leak);
//     the mailto / email / api_key / key / tool / _ query params are removed from
//     the stored path (bin/lib/http-mock.ts SCRUBBED_QUERY_PARAMS); the contact
//     email is redacted anywhere else it appears.
//   - Size: every cassette file must be ≤ 51200 bytes (tests/cassette-size). A
//     search that is too large is re-recorded with a LOWER result count (never
//     by truncating JSON) down to its floor; the lowered count is reported so
//     the test that replays it can be updated.
//   - A response the adapter swallowed (429 after retries, 5xx, a transport
//     error) is NOT recorded: that adapter fails and its committed cassettes are
//     left untouched — "record it on a later run". Hand-writing a response the
//     real API does not return is never an option.
//   - On success the adapter's recorded directory (tests/fixtures/cassettes/
//     <adapter>/) is replaced wholesale. tests/fixtures/cassettes/synthetic/ is
//     never touched (hand-written negative-test fixtures live there).
//
// Every entry carries provenance {recordedAt, recorder, adapter};
// tests/cassette-provenance.test.ts requires it outside synthetic/.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const CASSETTES_ROOT = path.join(REPO_ROOT, 'tests', 'fixtures', 'cassettes');
const MAX_CASSETTE_BYTES = 51200;

/** The query every research-path test replays (tests/research-discovery, tests/sources/*). */
export const RECORDED_QUERY = 'attention mechanisms in neural networks';
/** A DOI with a small, stable Crossref record (add / verify OK-path tests). */
export const RECORDED_DOI = '10.1038/nphys1170';
/** A DataCite DOI Crossref answers 404 for (a real "did not resolve" fixture). */
export const RECORDED_CROSSREF_404_DOI = '10.48550/arXiv.1706.03762';
/** An arXiv id recorded for fetchById. */
export const RECORDED_ARXIV_ID = '1706.03762';
/** The title add.ts extracts from tests/fixtures/pdf/byo-text.pdf. */
export const BYO_PDF_TITLE = 'Attention Is All You Need';

/**
 * The recorded query sets. Each cassette file is a list of calls; `limit` calls
 * may be lowered (down to `minLimit`) to meet the 51200-byte cap.
 * Keep in sync with the tests that replay them (they import nothing from here —
 * they name the same queries and DOIs).
 */
const QUERY_SETS = {
  crossref: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
    // `add <tests/fixtures/pdf/byo-text.pdf>`: the PDF's title heuristic, limit 1,
    // then the verifyDoi re-fetch of the hit.
    { file: 'search-byo-pdf-title', calls: [{ fn: 'search', arg: BYO_PDF_TITLE, limit: 1, thenFetchFirst: true }] },
    { file: 'works-nphys1170', calls: [{ fn: 'fetchById', arg: RECORDED_DOI }] },
    { file: 'works-arxiv-doi-404', calls: [{ fn: 'fetchById', arg: RECORDED_CROSSREF_404_DOI }] },
  ],
  openalex: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
  ],
  arxiv: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
    { file: 'id-1706.03762', calls: [{ fn: 'fetchById', arg: RECORDED_ARXIV_ID }] },
  ],
  pubmed: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
  ],
  semanticscholar: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
  ],
  unpaywall: [
    { file: 'doi-nphys1170', calls: [{ fn: 'fetchById', arg: RECORDED_DOI }] },
  ],
  'retraction-watch': [
    { file: 'record-nphys1170', calls: [{ fn: 'fetchById', arg: RECORDED_DOI }] },
  ],
};

const ADAPTERS = Object.keys(QUERY_SETS);

// ---------------------------------------------------------------------------
// Child: record one adapter (runs under `node --import tsx`)
// ---------------------------------------------------------------------------

async function runChild(adapter) {
  const spec = QUERY_SETS[adapter];
  if (!spec) throw new Error(`unknown adapter "${adapter}"`);
  const bin = (rel) => pathToFileURL(path.join(REPO_ROOT, 'bin', 'lib', rel)).href;
  const mod = await import(bin(path.join('sources', `${adapter}.js`)));
  const http = await import(bin('http.js'));
  const mock = await import(bin('http-mock.js'));
  const { atomicWriteFile } = await import(bin('atomic-write.js'));

  if (!mock.isRecordingEnabled()) {
    throw new Error('recording is not enabled (needs PENSMITH_RECORD_CASSETTES=1, live mode, outside a test context)');
  }
  const email = (process.env.PENSMITH_CONTACT_EMAIL ?? '').trim();
  const recordedAt = new Date().toISOString();

  const redactEmail = (text) => (email ? text.split(email).join('REDACTED_CONTACT_EMAIL') : text);

  const entryFor = (f) => {
    const headers = {};
    for (const [k, v] of Object.entries(f.responseHeaders ?? {})) {
      if (!mock.SENSITIVE_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
    }
    const entry = {
      scope: f.scope,
      method: f.method,
      path: f.path,
      status: f.status,
      response: f.response,
      responseHeaders: headers,
      ...(f.bodySha256 ? { bodySha256: f.bodySha256 } : {}),
      provenance: { recordedAt, recorder: 'scripts/refresh-cassettes.mjs', adapter },
    };
    return JSON.parse(redactEmail(JSON.stringify(entry)));
  };

  const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
  const outputs = [];
  for (const cassette of spec) {
    let entries = [];
    const notes = [];
    for (const call of cassette.calls) {
      let limit = call.limit;
      for (;;) {
        http.takeRecordedFixtures(); // drop anything stale
        const args = call.fn === 'search' ? [call.arg, { limit }] : [call.arg];
        const result = await mod[call.fn](...args);
        // `thenFetchFirst`: also record the re-fetch of the first hit's DOI (the
        // `add <pdf>` path: title search → verifyDoi on the hit).
        if (call.thenFetchFirst && Array.isArray(result) && result[0]?.doi) {
          await mod.fetchById(result[0].doi);
        }
        const recorded = http.takeRecordedFixtures();
        if (recorded.length === 0) {
          throw new Error(
            `${adapter}.${call.fn}(${JSON.stringify(call.arg)}): no response was recorded ` +
            '(rate-limited, unreachable or a transport error) — record this adapter on a later run',
          );
        }
        const bad = recorded.find((r) => RETRY_STATUSES.has(r.status));
        if (bad) {
          throw new Error(`${adapter}.${call.fn}: live endpoint answered HTTP ${bad.status} — not recorded`);
        }
        const candidate = recorded.map(entryFor);
        const size = Buffer.byteLength(JSON.stringify([...entries, ...candidate], null, 2) + '\n', 'utf8');
        if (size <= MAX_CASSETTE_BYTES) {
          entries = [...entries, ...candidate];
          if (limit !== undefined && limit !== call.limit) {
            notes.push(`${call.fn}(${JSON.stringify(call.arg)}) lowered to limit=${limit} to fit ${MAX_CASSETTE_BYTES} bytes`);
          }
          break;
        }
        if (limit === undefined || limit <= (call.minLimit ?? 1)) {
          throw new Error(
            `${adapter}/${cassette.file}.json would be ${size} bytes (> ${MAX_CASSETTE_BYTES}) and the ` +
            'result count cannot be lowered further — pick a smaller recorded query',
          );
        }
        limit = Math.max(call.minLimit ?? 1, Math.floor(limit / 2));
      }
    }
    outputs.push({ file: cassette.file, entries, notes });
  }

  // Replace the adapter's recorded directory wholesale (synthetic/ untouched).
  const dir = path.join(CASSETTES_ROOT, adapter);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json')) rmSync(path.join(dir, f));
  }
  for (const o of outputs) {
    const text = JSON.stringify(o.entries, null, 2) + '\n';
    await atomicWriteFile(path.join(dir, `${o.file}.json`), text);
    const kb = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1);
    process.stdout.write(`  recorded ${adapter}/${o.file}.json (${o.entries.length} entr${o.entries.length === 1 ? 'y' : 'ies'}, ${kb} KiB)\n`);
    for (const n of o.notes) process.stdout.write(`    note: ${n}\n`);
  }
}

// ---------------------------------------------------------------------------
// Parent: argument handling + one isolated child per adapter
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { only: [], child: null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') {
      const v = argv[++i];
      if (!v) throw new Error('--only needs an adapter name');
      out.only.push(...v.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a.startsWith('--only=')) {
      out.only.push(...a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--child') {
      out.child = argv[++i] ?? null;
    } else if (a === '--list') {
      out.list = true;
    } else {
      throw new Error(`unknown argument "${a}" (usage: npm run cassettes:refresh -- [--only <adapter>[,<adapter>]] [--list])`);
    }
  }
  return out;
}

function runParent(args) {
  if (args.list) {
    for (const a of ADAPTERS) {
      process.stdout.write(`${a}: ${QUERY_SETS[a].map((c) => `${c.file}.json`).join(', ')}\n`);
    }
    return 0;
  }
  const email = (process.env.PENSMITH_CONTACT_EMAIL ?? '').trim();
  if (!email) {
    process.stderr.write(
      'refresh-cassettes: PENSMITH_CONTACT_EMAIL is required — the polite pools (Crossref, OpenAlex, ' +
      'Unpaywall) need a contact address. Set it and re-run.\n',
    );
    return 2;
  }
  const unknown = args.only.filter((a) => !ADAPTERS.includes(a));
  if (unknown.length > 0) {
    process.stderr.write(`refresh-cassettes: unknown adapter(s): ${unknown.join(', ')} (known: ${ADAPTERS.join(', ')})\n`);
    return 2;
  }
  const targets = args.only.length > 0 ? args.only : ADAPTERS;
  const failed = [];
  for (const adapter of targets) {
    process.stdout.write(`refresh-cassettes: recording ${adapter} …\n`);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'pensmith-cassettes-'));
    const env = { ...process.env };
    for (const k of [
      'NODE_TEST_CONTEXT', 'PENSMITH_TEST', 'PENSMITH_OFFLINE', 'PENSMITH_DRY_RUN',
      'PENSMITH_NETWORK_TESTS', 'PENSMITH_NO_LLM', 'PENSMITH_PAPER_ROOT',
    ]) delete env[k];
    env.PENSMITH_RECORD_CASSETTES = '1';
    // A fresh, empty data dir: the HTTP cache can never answer for the network.
    env.XDG_DATA_HOME = dataDir;
    env.LOCALAPPDATA = dataDir;
    env.HOME = dataDir;
    // tsx resolved to an absolute URL: the child's cwd is the temp data dir.
    const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), __filename, '--child', adapter], {
      cwd: dataDir,
      env,
      stdio: 'inherit',
    });
    rmSync(dataDir, { recursive: true, force: true });
    if (r.status !== 0) failed.push(adapter);
  }
  if (failed.length > 0) {
    process.stderr.write(
      `refresh-cassettes: FAILED for ${failed.join(', ')} — their committed cassettes were left untouched.\n`,
    );
    return 1;
  }
  process.stdout.write('refresh-cassettes: done. Run `npm test` (cassette-size, cassette-no-leak, cassette-provenance).\n');
  return 0;
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`refresh-cassettes: ${e.message}\n`);
    process.exit(2);
  }
  if (args.child) {
    if (!existsSync(CASSETTES_ROOT)) mkdirSync(CASSETTES_ROOT, { recursive: true });
    runChild(args.child).then(
      () => process.exit(0),
      (e) => {
        process.stderr.write(`refresh-cassettes: ${args.child}: ${e.message}\n`);
        process.exit(1);
      },
    );
  } else {
    process.exit(runParent(args));
  }
}
