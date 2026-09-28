#!/usr/bin/env node
// scripts/refresh-cassettes.mjs — record REAL cassettes from the live endpoints
// (CI-07, D-17-14, D-19-26).
//
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run cassettes:refresh
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run cassettes:refresh -- --only crossref
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
//     email is redacted anywhere else it appears, and so is every other email
//     address a response carries (e.g. an author's address in an Unpaywall
//     affiliation string). Use the project address pensmith-dev@example.org —
//     never a personal one.
//   - Size: every cassette file must be ≤ 51200 bytes (tests/cassette-size). A
//     search that is too large is re-recorded with a LOWER result count (never
//     by truncating JSON) down to its floor; the lowered count is reported so
//     the test that replays it can be updated. A single-record answer that
//     only fits without indentation (Crossref's /works/{doi} route returns the
//     whole record, reference list included, and accepts no `select`) is
//     written with that one response on a single line — the same JSON, only
//     the whitespace differs.
//   - A call that fails (429 or 5xx after retries, an exhausted host, a
//     transport error, a body the adapter's shape check rejects — which the
//     transport never records) records nothing: that FILE keeps its committed
//     copy (if any) and is reported as not recorded — "record it on a later
//     run". Hand-writing a response the real API does not return is never an
//     option; the tests list such files as open recordings.
//   - Files of the adapter's recorded directory that are no longer in its
//     query set are removed (their requests are no longer made).
//     tests/fixtures/cassettes/synthetic/ is never touched (hand-written
//     negative-test fixtures live there).
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
/** A retracted work with a Retraction Watch record in Crossref (Wakefield et al. 1998). */
export const RECORDED_RETRACTED_DOI = '10.1016/S0140-6736(97)11096-0';
/** An arXiv id recorded for lookups. */
export const RECORDED_ARXIV_ID = '1706.03762';
/** An old-style arXiv id (archive/number) recorded for lookups. */
export const RECORDED_OLD_ARXIV_ID = 'hep-th/9901001';
/** The title add.ts extracts from tests/fixtures/pdf/byo-text.pdf. */
export const BYO_PDF_TITLE = 'Attention Is All You Need';

/**
 * The recorded query sets. Each cassette file is a list of calls; `limit` calls
 * may be lowered (down to `minLimit`) to meet the 51200-byte cap. `fn` is an
 * adapter export: `search`, `lookupById` (the three-way lookup; a `failed`
 * answer is not recorded) or `fetchById` (retraction-watch). `pauseMs` waits
 * before the call (arXiv asks for one request per three seconds).
 * Keep in sync with the tests that replay them (they import nothing from here —
 * they name the same queries and identifiers).
 */
const QUERY_SETS = {
  crossref: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
    // `add <tests/fixtures/pdf/byo-text.pdf>`: the PDF's title heuristic, limit 1,
    // then the verifyDoi re-fetch of the hit.
    { file: 'search-byo-pdf-title', calls: [{ fn: 'search', arg: BYO_PDF_TITLE, limit: 1, thenLookupFirst: true }] },
    // The `nber` source preference: Crossref search restricted to NBER's DOI prefix (D-19-14).
    { file: 'search-nber-minimum-wage', calls: [{ fn: 'search', arg: 'minimum wage employment', limit: 3, minLimit: 1, opts: { doiPrefix: '10.3386' } }] },
    { file: 'works-nphys1170', calls: [{ fn: 'lookupById', arg: RECORDED_DOI }] },
    { file: 'works-arxiv-doi-404', calls: [{ fn: 'lookupById', arg: RECORDED_CROSSREF_404_DOI }] },
    // SRC-05: a complete journal record (Nature 521(7553), 436-444).
    { file: 'works-nature14539', calls: [{ fn: 'lookupById', arg: '10.1038/nature14539' }] },
    // SRC-05: a consortium author (name only).
    { file: 'works-nature11247-encode', calls: [{ fn: 'lookupById', arg: '10.1038/nature11247' }] },
    // SRC-04: a retracted work whose record carries its Retraction Watch notice (updated-by).
    { file: 'works-wakefield-1998', calls: [{ fn: 'lookupById', arg: RECORDED_RETRACTED_DOI }] },
    // SRC-12: a particle surname (van der Maaten).
    { file: 'works-foreco-2013', calls: [{ fn: 'lookupById', arg: '10.1016/j.foreco.2013.06.030' }] },
  ],
  openalex: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
    // SRC-05: a lookup by DOI and by W-id (venue, biblio, abstract, PMID).
    { file: 'works-doi-nature14539', calls: [{ fn: 'lookupById', arg: '10.1038/nature14539' }] },
    { file: 'works-W2919115771', calls: [{ fn: 'lookupById', arg: 'W2919115771' }] },
    // A W-id OpenAlex does not know: a real 404 (not-found).
    { file: 'works-W2963403868-404', calls: [{ fn: 'lookupById', arg: 'W2963403868' }] },
  ],
  arxiv: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3, pauseMs: 3500 }] },
    { file: 'id-1706.03762', calls: [{ fn: 'lookupById', arg: RECORDED_ARXIV_ID, pauseMs: 3500 }] },
    { file: 'id-hep-th-9901001', calls: [{ fn: 'lookupById', arg: RECORDED_OLD_ARXIV_ID, pauseMs: 3500 }] },
  ],
  pubmed: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
    { file: 'esummary-31978945', calls: [{ fn: 'lookupById', arg: '31978945' }] },
  ],
  semanticscholar: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
  ],
  unpaywall: [
    { file: 'doi-nphys1170', calls: [{ fn: 'lookupById', arg: RECORDED_DOI }] },
    // SRC-03: the current shape (raw_author_name), several OA locations.
    { file: 'doi-s41586-020-2649-2', calls: [{ fn: 'lookupById', arg: '10.1038/s41586-020-2649-2' }] },
    { file: 'doi-pone-0000001', calls: [{ fn: 'lookupById', arg: '10.1371/journal.pone.0000001' }] },
  ],
  'retraction-watch': [
    // No retraction notice: a live "not retracted" answer.
    { file: 'updates-nphys1170', calls: [{ fn: 'fetchById', arg: RECORDED_DOI }] },
    // A real retracted work (Wakefield et al. 1998, retracted 2010).
    { file: 'updates-wakefield-1998', calls: [{ fn: 'fetchById', arg: RECORDED_RETRACTED_DOI }] },
    // The retraction re-query Pass 1 makes for the recorded Crossref works (offline verify).
    { file: 'updates-nature14539', calls: [{ fn: 'fetchById', arg: '10.1038/nature14539' }] },
    { file: 'updates-nature11247-encode', calls: [{ fn: 'fetchById', arg: '10.1038/nature11247' }] },
    { file: 'updates-foreco-2013', calls: [{ fn: 'fetchById', arg: '10.1016/j.foreco.2013.06.030' }] },
  ],
  books: [
    // SRC-11: Kuhn, The Structure of Scientific Revolutions (3rd ed., 1996).
    { file: 'isbn-9780226458083', calls: [{ fn: 'lookupById', arg: 'isbn:9780226458083' }] },
    { file: 'search-economic-consequences-of-the-peace', calls: [{ fn: 'search', arg: 'The Economic Consequences of the Peace', limit: 5, minLimit: 2 }] },
  ],
};

const ADAPTERS = Object.keys(QUERY_SETS);

// ---------------------------------------------------------------------------
// Cassette text
// ---------------------------------------------------------------------------

/** The cassette file text: indented JSON, or — when `compact` — each entry's response on one line. */
export function renderCassette(entries, compact = false) {
  if (!compact) return JSON.stringify(entries, null, 2) + '\n';
  const parts = entries.map((e) => {
    const fields = Object.entries(e).map(([k, v]) => {
      const value = k === 'response' ? JSON.stringify(v) : JSON.stringify(v, null, 2).replace(/\n/g, '\n    ');
      return `    ${JSON.stringify(k)}: ${value}`;
    });
    return `  {\n${fields.join(',\n')}\n  }`;
  });
  return `[\n${parts.join(',\n')}\n]\n`;
}

/** The smallest acceptable rendering of `entries`, or null when neither fits the cap. */
function fitting(entries) {
  const pretty = renderCassette(entries, false);
  if (Buffer.byteLength(pretty, 'utf8') <= MAX_CASSETTE_BYTES) return pretty;
  const compact = renderCassette(entries, true);
  return Buffer.byteLength(compact, 'utf8') <= MAX_CASSETTE_BYTES ? compact : null;
}

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

  // The contact email, then every other email address a response carries (an
  // author's address inside an affiliation string, say): fixtures commit no
  // email address at all (tests/cassette-no-leak).
  const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const redactEmail = (text) =>
    (email ? text.split(email).join('REDACTED_CONTACT_EMAIL') : text).replace(EMAIL_ADDRESS, 'REDACTED_EMAIL');

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

  /** Run one call; throws with the reason when the service did not answer. */
  const runCall = async (call, limit) => {
    if (call.pauseMs) await new Promise((r) => setTimeout(r, call.pauseMs));
    if (call.fn === 'search') {
      let failure = null;
      const result = await mod.search(call.arg, { ...(call.opts ?? {}), limit, onFailure: (r) => { failure ??= r; } });
      if (failure !== null) throw new Error(`search failed: ${failure}`);
      // `thenLookupFirst`: also record the lookup of the first hit's DOI (the
      // `add <pdf>` path: title search → re-fetch of the hit).
      if (call.thenLookupFirst && result[0]?.doi) {
        const r = await mod.lookupById(result[0].doi);
        if (r.kind === 'failed') throw new Error(`lookup of ${result[0].doi} failed: ${r.reason}`);
      }
      return;
    }
    if (call.fn === 'lookupById') {
      const r = await mod.lookupById(call.arg);
      if (r.kind === 'failed') throw new Error(`lookup failed: ${r.reason}`);
      return;
    }
    await mod[call.fn](call.arg);
  };

  const outcomes = [];
  for (const cassette of spec) {
    let entries = [];
    const notes = [];
    try {
      for (const call of cassette.calls) {
        let limit = call.limit;
        for (;;) {
          http.takeRecordedFixtures(); // drop anything stale
          await runCall(call, limit);
          const recorded = http.takeRecordedFixtures();
          if (recorded.length === 0) {
            throw new Error('no response was recorded (rate-limited, unreachable or a transport error)');
          }
          const bad = recorded.find((r) => RETRY_STATUSES.has(r.status));
          if (bad) throw new Error(`live endpoint answered HTTP ${bad.status}`);
          // An error document inside an HTTP 200 (e.g. Crossref Labs' "not-polite")
          // is not a recording of the API's answer — refuse it.
          for (const r of recorded) {
            const why = mock.recordedErrorBody(r.status, r.response);
            if (why !== null) throw new Error(`live endpoint answered HTTP ${r.status} with an error body (${why})`);
          }
          const candidate = [...entries, ...recorded.map(entryFor)];
          if (fitting(candidate) !== null) {
            entries = candidate;
            if (limit !== undefined && limit !== call.limit) {
              notes.push(`${call.fn}(${JSON.stringify(call.arg)}) lowered to limit=${limit} to fit ${MAX_CASSETTE_BYTES} bytes`);
            }
            break;
          }
          if (limit === undefined || limit <= (call.minLimit ?? 1)) {
            throw new Error(
              `${cassette.file}.json would exceed ${MAX_CASSETTE_BYTES} bytes and the result count cannot be ` +
                'lowered further — pick a smaller recorded query',
            );
          }
          limit = Math.max(call.minLimit ?? 1, Math.floor(limit / 2));
        }
      }
      outcomes.push({ file: cassette.file, entries, notes, error: null });
    } catch (e) {
      outcomes.push({ file: cassette.file, entries: [], notes, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Write what was recorded; keep a failed file's committed copy; drop files
  // whose requests the adapter no longer makes (synthetic/ untouched).
  const dir = path.join(CASSETTES_ROOT, adapter);
  mkdirSync(dir, { recursive: true });
  const wanted = new Set(spec.map((c) => `${c.file}.json`));
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.json') && !wanted.has(f)) {
      rmSync(path.join(dir, f));
      process.stdout.write(`  removed ${adapter}/${f} (no longer in the recorded query set)\n`);
    }
  }
  let failed = 0;
  for (const o of outcomes) {
    const target = path.join(dir, `${o.file}.json`);
    if (o.error !== null) {
      failed += 1;
      const kept = existsSync(target) ? 'its committed copy is kept' : 'there is no committed copy';
      process.stderr.write(`  NOT recorded ${adapter}/${o.file}.json: ${o.error} — ${kept}\n`);
      continue;
    }
    const text = fitting(o.entries);
    await atomicWriteFile(target, text);
    const kb = (Buffer.byteLength(text, 'utf8') / 1024).toFixed(1);
    process.stdout.write(`  recorded ${adapter}/${o.file}.json (${o.entries.length} entr${o.entries.length === 1 ? 'y' : 'ies'}, ${kb} KiB)\n`);
    for (const n of o.notes) process.stdout.write(`    note: ${n}\n`);
  }
  if (failed > 0) throw new Error(`${failed} of ${outcomes.length} cassette file(s) not recorded`);
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
      'Unpaywall) need a contact address, and Unpaywall refuses requests without one. Use the project ' +
      'address (PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org), never a personal one.\n',
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
      `refresh-cassettes: NOT everything was recorded for ${failed.join(', ')} — the files reported above ` +
      'keep their committed copies; record them on a later run (or list them as open recordings).\n',
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
