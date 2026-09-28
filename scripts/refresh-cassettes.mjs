#!/usr/bin/env node
// scripts/refresh-cassettes.mjs — record REAL cassettes from the live endpoints
// (CI-07, D-17-14).
//
//   PENSMITH_CONTACT_EMAIL=you@example.org npm run cassettes:refresh
//   PENSMITH_CONTACT_EMAIL=you@example.org npm run cassettes:refresh -- --only crossref
//   PENSMITH_CONTACT_EMAIL=you@example.org npm run cassettes:refresh -- --corpus e2e
//   npm run cassettes:refresh -- --list
//
// `--corpus e2e` records the end-to-end corpus the chain tests replay
// (tests/fixtures/cassettes/e2e/ + tests/fixtures/e2e-corpus/, D-18-31); see the
// e2e section below. Without it, the per-adapter query sets are recorded:
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
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, readdirSync, readFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
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
/** A retracted work with a Retraction Watch record in Crossref (retraction-watch hit). */
export const RECORDED_RETRACTED_DOI = '10.1016/S0140-6736(97)11096-0';
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
    // No retraction notice: a live "not retracted" answer.
    { file: 'updates-nphys1170', calls: [{ fn: 'fetchById', arg: RECORDED_DOI }] },
    // A real retracted work (Wakefield et al. 1998, retracted 2010).
    { file: 'updates-wakefield-1998', calls: [{ fn: 'fetchById', arg: RECORDED_RETRACTED_DOI }] },
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
        // An error document inside an HTTP 200 (e.g. Crossref Labs' "not-polite")
        // is not a recording of the API's answer — refuse it.
        for (const r of recorded) {
          const why = mock.recordedErrorBody(r.status, r.response);
          if (why !== null) {
            throw new Error(`${adapter}.${call.fn}: live endpoint answered HTTP ${r.status} with an error body (${why}) — not recorded`);
          }
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
// The recorded end-to-end corpus: `npm run cassettes:refresh -- --corpus e2e`
// (GRND-18, D-18-31)
// ---------------------------------------------------------------------------
//
// The corpus lets the whole chain — `pensmith new` from tests/fixtures/
// assignment.txt through research, outline, every section's plan → write →
// verify, compile and done — run OFFLINE under the test runner against the
// RUN-21 mock LLM (tests/helpers/e2e-chain.ts). It is three things:
//   - tests/fixtures/cassettes/e2e/<adapter>/*.json — real recordings of every
//     source request the chain makes: the research searches for the scripted
//     queries, the Retraction Watch cross-check of each kept source, and each
//     kept source's Pass-1 lookups (Crossref work, Retraction Watch re-query).
//     A separate root, so a per-adapter refresh never wipes it; the exact-match
//     store reads it with every other cassette (http-mock.ts).
//   - tests/fixtures/e2e-corpus/mock-script.json — the scripted model replies
//     the chain needs to reach the recorded requests: intake-clarifier (the
//     brief), topic-disambiguator (the queries) and source-evaluator (the
//     keep-list). Every other slug uses the contract stubs.
//   - tests/fixtures/e2e-corpus/MANIFEST.json — what was recorded, when, which
//     (adapter, query) searches miss offline and why, the kept sources, the
//     expected section count and the run bound (5 + N bare runs).
//
// Recording runs six isolated children (each with a fresh, empty data dir):
//   1. search   (live)    discoverSources for each scripted query, recorded;
//   2. stage    (no net)  write the search cassettes (≤ 51200 bytes each; a
//                         response over the cap, a 429/5xx or an error body is
//                         an expected miss, never truncated or hand-written);
//   3. select   (offline) replay the searches exactly as the chain will (dedup,
//                         citekeys) and preselect the DOI-bearing candidates;
//   4. lookups  (live)    record each preselected source's retraction
//                         cross-check and Pass-1 lookups, with its live verdict;
//   5. assemble (no net)  keep ≤ 6 sources whose live Pass 1 is OK, write their
//                         lookup cassettes, mock-script.json and MANIFEST.json;
//   6. verify   (offline) replay research and Pass 1 of every kept source.
// Any failure restores the previous corpus. Keys another committed cassette
// already answers are not duplicated (tests/cassette-provenance.test.ts keeps
// the store unambiguous).

/** The topic, discipline and queries the corpus is recorded for (the PRD §15 assignment). */
export const E2E_TOPIC = 'attention mechanisms in transformers';
export const E2E_DISCIPLINE = 'computer-science';
export const E2E_QUERIES = Object.freeze([
  'transformer self-attention mechanism',
  'attention mechanism neural machine translation',
]);
/** At most this many sources are kept (the evaluator keep-list, D-18-31). */
export const E2E_MAX_KEPT = 6;
/** DOI-bearing candidates whose Pass-1 lookups are recorded, to keep ≤ E2E_MAX_KEPT that verify. */
const E2E_PRESELECT = 12;
/** A 1500-word literature review in computer science: intro, discussion, conclusion (no counterargument). */
export const E2E_EXPECTED_SECTIONS = 3;
const E2E_ROOT = path.join(CASSETTES_ROOT, 'e2e');
const E2E_CORPUS_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'e2e-corpus');
const E2E_ASSIGNMENT = path.join(REPO_ROOT, 'tests', 'fixtures', 'assignment.txt');
const E2E_SEARCH_ADAPTERS = Object.freeze(['crossref', 'openalex', 'arxiv', 'pubmed', 'semanticscholar']);
const E2E_PHASES = Object.freeze([
  { name: 'search', mode: 'live' },
  { name: 'stage', mode: 'none' },
  { name: 'select', mode: 'offline' },
  { name: 'lookups', mode: 'live' },
  { name: 'assemble', mode: 'none' },
  { name: 'verify', mode: 'offline' },
]);
const RECORDER = 'scripts/refresh-cassettes.mjs';

function repoRel(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

function querySlug(q) {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The last recorded response per canonical key (a retried request records each attempt). */
function lastPerKey(fixtures) {
  const byKey = new Map();
  for (const f of fixtures) byKey.set(f.key, f);
  return [...byKey.values()];
}

async function e2eModules() {
  const bin = (rel) => pathToFileURL(path.join(REPO_ROOT, 'bin', 'lib', rel)).href;
  return {
    http: await import(bin('http.js')),
    mock: await import(bin('http-mock.js')),
    atomic: await import(bin('atomic-write.js')),
    research: await import(bin('research-orchestrator.js')),
    retraction: await import(bin('sources/retraction-cross-check.js')),
    library: await import(bin('library.js')),
    pass1: await import(bin('verify/pass1.js')),
  };
}

async function writeJson(m, file, value) {
  await m.atomic.atomicWriteFile(file, JSON.stringify(value, null, 2) + '\n');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** A cassette entry for a recorded fixture: scrubbed headers, redacted contact email, provenance. */
function cassetteEntry(m, f, adapter, recordedAt) {
  const email = (process.env.PENSMITH_CONTACT_EMAIL ?? '').trim();
  const headers = {};
  for (const [k, v] of Object.entries(f.responseHeaders ?? {})) {
    if (!m.mock.SENSITIVE_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  }
  const entry = {
    scope: f.scope,
    method: f.method,
    path: f.path,
    status: f.status,
    response: f.response,
    responseHeaders: headers,
    ...(f.bodySha256 ? { bodySha256: f.bodySha256 } : {}),
    provenance: { recordedAt, recorder: RECORDER, adapter },
  };
  const text = JSON.stringify(entry);
  return JSON.parse(email ? text.split(email).join('REDACTED_CONTACT_EMAIL') : text);
}

/** Why a set of recorded fixtures cannot be committed, or null. */
function unrecordable(m, fixtures) {
  for (const f of fixtures) {
    if (f.status !== 200) return `HTTP ${f.status}`;
    const why = m.mock.recordedErrorBody(f.status, f.response);
    if (why !== null) return `an error body (${why})`;
  }
  return null;
}

/** Canonical keys every committed cassette OUTSIDE e2e/ already answers. */
function committedKeysOutsideE2e(m) {
  const keys = new Set();
  for (const file of m.mock.listCassetteFiles()) {
    if (path.relative(CASSETTES_ROOT, file).split(path.sep)[0] === m.mock.E2E_CASSETTES_DIR) continue;
    for (const e of readJson(file)) {
      if (typeof e?.scope !== 'string' || typeof e?.path !== 'string') continue;
      try {
        keys.add(m.mock.cassetteKey(e));
      } catch {
        // not a replayable entry
      }
    }
  }
  return keys;
}

function assertRecording(m) {
  if (!m.mock.isRecordingEnabled()) {
    throw new Error('recording is not enabled (needs PENSMITH_RECORD_CASSETTES=1, live mode, outside a test context)');
  }
}

async function paperRoot(m, work, name) {
  const root = path.join(work, name);
  await m.atomic.atomicWriteFile(path.join(root, '.paper', '.keep'), '');
  return root;
}

const E2E_PHASE_RUNNERS = {
  /** 1. The research searches, live and recorded — one drain per query. */
  async search(m, work) {
    assertRecording(m);
    const root = await paperRoot(m, work, 'search-paper');
    const out = [];
    for (const query of E2E_QUERIES) {
      m.http.takeRecordedFixtures();
      await m.research.discoverSources([query], { topic: E2E_TOPIC, discipline: E2E_DISCIPLINE, paperRoot: root });
      out.push({ query, fixtures: m.http.takeRecordedFixtures() });
      process.stdout.write(`  searched "${query}"\n`);
    }
    await writeJson(m, path.join(work, 'search.json'), out);
  },

  /** 2. Write the search cassettes: one file per (adapter, query), or an expected miss. */
  async stage(m, work) {
    const recordedAt = new Date().toISOString();
    const committed = committedKeysOutsideE2e(m);
    const files = [];
    const misses = [];
    for (const { query, fixtures } of readJson(path.join(work, 'search.json'))) {
      for (const adapter of E2E_SEARCH_ADAPTERS) {
        const fx = lastPerKey(fixtures.filter((f) => f.source === adapter));
        if (fx.length === 0) {
          misses.push({ adapter, query, why: 'no response was recorded (rate-limited, unreachable or a transport error)' });
          continue;
        }
        const bad = unrecordable(m, fx);
        if (bad !== null) {
          misses.push({ adapter, query, why: `the live endpoint answered ${bad}` });
          continue;
        }
        const entries = fx.filter((f) => !committed.has(f.key)).map((f) => cassetteEntry(m, f, adapter, recordedAt));
        if (entries.length === 0) continue; // a committed per-adapter cassette answers it already
        const text = JSON.stringify(entries, null, 2) + '\n';
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > MAX_CASSETTE_BYTES) {
          misses.push({ adapter, query, why: `the recorded response is ${bytes} bytes, over the ${MAX_CASSETTE_BYTES}-byte cassette cap` });
          continue;
        }
        const file = path.join(E2E_ROOT, adapter, `search-${querySlug(query)}.json`);
        await m.atomic.atomicWriteFile(file, text);
        files.push(repoRel(file));
        process.stdout.write(`  recorded ${repoRel(file)} (${(bytes / 1024).toFixed(1)} KiB)\n`);
      }
    }
    for (const miss of misses) process.stdout.write(`  expected miss: ${miss.adapter} "${miss.query}" — ${miss.why}\n`);
    await writeJson(m, path.join(work, 'stage.json'), { files, misses });
  },

  /** 3. Replay the research offline, exactly as the chain will, and preselect DOI-bearing candidates. */
  async select(m, work) {
    const root = await paperRoot(m, work, 'select-paper');
    const { candidates } = await m.research.discoverSources([...E2E_QUERIES], { topic: E2E_TOPIC, discipline: E2E_DISCIPLINE, paperRoot: root });
    const preselected = candidates.filter((c) => typeof c.doi === 'string' && c.doi.length > 0 && c.retracted !== true).slice(0, E2E_PRESELECT);
    if (preselected.length === 0) throw new Error('the replayed research found no DOI-bearing source — nothing to keep');
    process.stdout.write(`  replayed research: ${candidates.length} candidate(s), ${preselected.length} preselected\n`);
    await writeJson(m, path.join(work, 'select.json'), {
      all: candidates.map((c) => ({ citekey: c.citekey, doi: c.doi ?? null, source: c.source })),
      preselected,
    });
  },

  /** 4. Each preselected source's retraction cross-check and Pass-1 lookups, live and recorded. */
  async lookups(m, work) {
    assertRecording(m);
    const { preselected } = readJson(path.join(work, 'select.json'));
    const root = await paperRoot(m, work, 'lookup-paper');
    const results = [];
    for (const c of preselected) {
      m.http.takeRecordedFixtures();
      await m.retraction.crossCheckRetractions([c]);
      results.push({ citekey: c.citekey, doi: c.doi, title: c.title, source: c.source, retracted: c.retracted === true, fixtures: m.http.takeRecordedFixtures() });
    }
    await m.library.upsertSources(root, preselected, { provenance: 'research' });
    const bib = path.join(root, '.paper', 'CITATIONS.bib');
    for (const r of results) {
      if (r.retracted) {
        r.verdict = 'RETRACTED';
        continue;
      }
      const draft = `# Section\n\nA claim the source supports [@${r.citekey}].\n`;
      m.http.takeRecordedFixtures();
      const [v] = await m.pass1.runPass1(draft, bib);
      await m.pass1.runFreshnessForDraft(draft, bib);
      r.fixtures.push(...m.http.takeRecordedFixtures());
      r.verdict = v?.verdict ?? 'MISSING';
      r.reason = v?.reason ?? '';
      process.stdout.write(`  ${r.citekey} (${r.doi}): live Pass 1 ${r.verdict}${r.reason ? ` — ${r.reason}` : ''}\n`);
    }
    await writeJson(m, path.join(work, 'lookups.json'), results);
  },

  /** 5. Keep ≤ E2E_MAX_KEPT verified sources; write their cassettes, mock-script.json and MANIFEST.json. */
  async assemble(m, work) {
    const recordedAt = new Date().toISOString();
    const stage = readJson(path.join(work, 'stage.json'));
    const select = readJson(path.join(work, 'select.json'));
    const committed = committedKeysOutsideE2e(m);
    const written = new Set();
    const files = [...stage.files];
    const kept = [];
    for (const r of readJson(path.join(work, 'lookups.json'))) {
      if (kept.length >= E2E_MAX_KEPT) break;
      if (r.verdict !== 'OK') {
        process.stdout.write(`  not kept: ${r.citekey} (live Pass 1 ${r.verdict})\n`);
        continue;
      }
      // doi.org HEAD probes are never made offline (freshness skips them): not recorded.
      const fx = lastPerKey(r.fixtures).filter((f) => f.scope !== 'https://doi.org');
      const bad = unrecordable(m, fx);
      if (bad !== null) {
        process.stdout.write(`  not kept: ${r.citekey} (a lookup answered ${bad})\n`);
        continue;
      }
      const groups = new Map();
      for (const f of fx) {
        if (committed.has(f.key) || written.has(f.key)) continue;
        const list = groups.get(f.source) ?? [];
        list.push(f);
        groups.set(f.source, list);
      }
      const out = [];
      let over = null;
      for (const [adapter, list] of groups) {
        const text = JSON.stringify(list.map((f) => cassetteEntry(m, f, adapter, recordedAt)), null, 2) + '\n';
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > MAX_CASSETTE_BYTES) over = `${adapter} lookups are ${bytes} bytes, over the cap`;
        out.push({ file: path.join(E2E_ROOT, adapter, `lookups-${r.citekey}.json`), text, keys: list.map((f) => f.key) });
      }
      if (over !== null) {
        process.stdout.write(`  not kept: ${r.citekey} (${over})\n`);
        continue;
      }
      for (const o of out) {
        await m.atomic.atomicWriteFile(o.file, o.text);
        for (const k of o.keys) written.add(k);
        files.push(repoRel(o.file));
      }
      kept.push({ citekey: r.citekey, doi: r.doi, title: r.title, adapter: r.source });
    }
    if (kept.length === 0) throw new Error('no preselected source passed Pass 1 live — nothing to keep; re-record later');
    const keptKeys = new Set(kept.map((k) => k.citekey));

    const script = {
      'intake-clarifier': [{
        data: {
          topic: E2E_TOPIC,
          discipline: E2E_DISCIPLINE,
          paper_type: 'literature-review',
          thesis: '',
          length_target_words: 1500,
          citation_style: 'APA',
          sectioning_notes: [],
          follow_ups: [],
          // The pre-Phase-18 contract field (intake-clarifier v1); the Phase 18
          // contract ignores it. Kept so the corpus also drives a checkout from
          // before the intake stream merged.
          questions: [{ id: 'length', question: 'How long should the paper be?', suggested_answer: '1500 words' }],
        },
      }],
      'topic-disambiguator': [{ data: { scopes: [{ label: 'transformer-attention', queries: [...E2E_QUERIES] }] } }],
      'source-evaluator': [{
        data: {
          verdicts: select.all.map((c) => ({
            citekey: c.citekey,
            keep: keptKeys.has(c.citekey),
            reason: keptKeys.has(c.citekey) ? 'recorded e2e corpus: kept' : 'recorded e2e corpus: not in the keep-list',
          })),
        },
      }],
    };
    await writeJson(m, path.join(E2E_CORPUS_DIR, 'mock-script.json'), script);

    const recorded = [...new Set(files.map((f) => f.split('/')[4]).filter((a) => typeof a === 'string'))].sort();
    const manifest = {
      $schemaVersion: 1,
      description:
        'The recorded end-to-end corpus (GRND-18, D-18-31): real recordings of every source request the chain from ' +
        'tests/fixtures/assignment.txt makes, the scripted model replies that lead to them, and what to expect. ' +
        'Re-record with `npm run cassettes:refresh -- --corpus e2e` (CONTRIBUTING.md).',
      assignment: repoRel(E2E_ASSIGNMENT),
      assignmentSha256: createHash('sha256').update(readFileSync(E2E_ASSIGNMENT)).digest('hex'),
      mockScript: repoRel(path.join(E2E_CORPUS_DIR, 'mock-script.json')),
      cassetteRoot: repoRel(E2E_ROOT),
      topic: E2E_TOPIC,
      discipline: E2E_DISCIPLINE,
      queries: [...E2E_QUERIES],
      adapters: { recorded, expectedMiss: stage.misses },
      keptSources: kept,
      expectedSections: E2E_EXPECTED_SECTIONS,
      runBound: 5 + E2E_EXPECTED_SECTIONS,
      recordedAt,
      recorder: `${RECORDER} --corpus e2e`,
      cassettes: files.sort(),
    };
    await writeJson(m, path.join(E2E_CORPUS_DIR, 'MANIFEST.json'), manifest);
    process.stdout.write(`  kept ${kept.length} source(s): ${kept.map((k) => k.citekey).join(', ')}\n`);
  },

  /** 6. Replay research and every kept source's Pass 1 offline: the corpus answers the chain. */
  async verify(m, work) {
    const manifest = readJson(path.join(E2E_CORPUS_DIR, 'MANIFEST.json'));
    const root = await paperRoot(m, work, 'verify-paper');
    const { candidates } = await m.research.discoverSources([...manifest.queries], { topic: manifest.topic, discipline: manifest.discipline, paperRoot: root });
    const byKey = new Map(candidates.map((c) => [c.citekey, c]));
    const kept = manifest.keptSources.map((k) => {
      const c = byKey.get(k.citekey);
      if (!c || c.doi !== k.doi) throw new Error(`replayed research lost the kept source ${k.citekey} (${k.doi})`);
      return c;
    });
    await m.retraction.crossCheckRetractions(kept);
    await m.library.upsertSources(root, kept, { provenance: 'research' });
    const bib = path.join(root, '.paper', 'CITATIONS.bib');
    const draft = `# Section\n\n${kept.map((c) => `A claim [@${c.citekey}].`).join(' ')}\n`;
    for (const v of await m.pass1.runPass1(draft, bib)) {
      if (v.verdict !== 'OK') throw new Error(`offline Pass 1 of ${v.citekey}: ${v.verdict} — ${v.reason}`);
    }
    process.stdout.write(`  offline replay: research and Pass 1 of ${kept.length} kept source(s) OK\n`);
  },
};

async function runE2eChild(phase, work) {
  const run = E2E_PHASE_RUNNERS[phase];
  if (!run) throw new Error(`unknown e2e phase "${phase}"`);
  await run(await e2eModules(), work);
}

function runE2eParent() {
  const email = (process.env.PENSMITH_CONTACT_EMAIL ?? '').trim();
  if (!email) {
    process.stderr.write(
      'refresh-cassettes: PENSMITH_CONTACT_EMAIL is required — the polite pools (Crossref, OpenAlex, ' +
      'Unpaywall) need a contact address. Set it and re-run.\n',
    );
    return 2;
  }
  const work = mkdtempSync(path.join(tmpdir(), 'pensmith-e2e-corpus-'));
  // Keep the committed corpus until the new one is complete.
  const backup = path.join(work, 'backup');
  mkdirSync(backup, { recursive: true });
  const hadRoot = existsSync(E2E_ROOT);
  if (hadRoot) renameSync(E2E_ROOT, path.join(backup, 'e2e'));
  const corpusFiles = ['MANIFEST.json', 'mock-script.json'].filter((f) => existsSync(path.join(E2E_CORPUS_DIR, f)));
  for (const f of corpusFiles) cpSync(path.join(E2E_CORPUS_DIR, f), path.join(backup, f));
  const restore = () => {
    rmSync(E2E_ROOT, { recursive: true, force: true });
    if (hadRoot) renameSync(path.join(backup, 'e2e'), E2E_ROOT);
    for (const f of corpusFiles) cpSync(path.join(backup, f), path.join(E2E_CORPUS_DIR, f));
  };
  let failed = null;
  for (const phase of E2E_PHASES) {
    process.stdout.write(`refresh-cassettes: e2e corpus — ${phase.name} (${phase.mode === 'none' ? 'no network' : phase.mode}) …\n`);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'pensmith-cassettes-'));
    const env = childEnv(dataDir);
    env.PENSMITH_NO_LLM = '1'; // the evaluator runs as its contract stub (keeps every candidate)
    if (phase.mode === 'live') env.PENSMITH_RECORD_CASSETTES = '1';
    if (phase.mode === 'offline') env.PENSMITH_OFFLINE = '1';
    const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), __filename, '--e2e-phase', phase.name, '--work', work], {
      cwd: dataDir,
      env,
      stdio: 'inherit',
    });
    rmSync(dataDir, { recursive: true, force: true });
    if (r.status !== 0) {
      failed = phase.name;
      break;
    }
  }
  if (failed !== null) {
    restore();
    rmSync(work, { recursive: true, force: true });
    process.stderr.write(`refresh-cassettes: the e2e corpus FAILED at ${failed} — the committed corpus was left untouched.\n`);
    return 1;
  }
  rmSync(work, { recursive: true, force: true });
  process.stdout.write('refresh-cassettes: e2e corpus done. Run `npm test` (e2e-corpus-manifest, cassette-size, cassette-no-leak, cassette-provenance).\n');
  return 0;
}

// ---------------------------------------------------------------------------
// Parent: argument handling + one isolated child per adapter
// ---------------------------------------------------------------------------

/**
 * The env of a recording child: every mode variable removed (live, NOT a test
 * context) and a fresh, empty data dir — so the HTTP cache can never answer
 * for the network and nothing touches the user's data dir.
 */
function childEnv(dataDir) {
  const env = { ...process.env };
  for (const k of [
    'NODE_TEST_CONTEXT', 'PENSMITH_TEST', 'PENSMITH_OFFLINE', 'PENSMITH_DRY_RUN',
    'PENSMITH_NETWORK_TESTS', 'PENSMITH_NO_LLM', 'PENSMITH_PAPER_ROOT', 'PENSMITH_RECORD_CASSETTES',
  ]) delete env[k];
  env.XDG_DATA_HOME = dataDir;
  env.LOCALAPPDATA = dataDir;
  env.HOME = dataDir;
  return env;
}

function parseArgs(argv) {
  const out = { only: [], child: null, list: false, corpus: null, e2ePhase: null, work: null };
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
    } else if (a === '--corpus' || a.startsWith('--corpus=')) {
      const v = a === '--corpus' ? argv[++i] : a.slice('--corpus='.length);
      if (v !== 'e2e') throw new Error(`--corpus takes "e2e" (got ${JSON.stringify(v ?? '')})`);
      out.corpus = v;
    } else if (a === '--e2e-phase') {
      out.e2ePhase = argv[++i] ?? null;
    } else if (a === '--work') {
      out.work = argv[++i] ?? null;
    } else {
      throw new Error(`unknown argument "${a}" (usage: npm run cassettes:refresh -- [--only <adapter>[,<adapter>]] [--corpus e2e] [--list])`);
    }
  }
  if (out.corpus !== null && out.only.length > 0) throw new Error('--corpus e2e and --only are separate recordings; pass one');
  return out;
}

function runParent(args) {
  if (args.list) {
    for (const a of ADAPTERS) {
      process.stdout.write(`${a}: ${QUERY_SETS[a].map((c) => `${c.file}.json`).join(', ')}\n`);
    }
    process.stdout.write(`--corpus e2e: queries ${E2E_QUERIES.map((q) => JSON.stringify(q)).join(', ')} → ${repoRel(E2E_ROOT)}/<adapter>/ + ${repoRel(E2E_CORPUS_DIR)}/\n`);
    return 0;
  }
  if (args.corpus === 'e2e') return runE2eParent();
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
    const env = childEnv(dataDir);
    env.PENSMITH_RECORD_CASSETTES = '1';
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
  if (args.e2ePhase) {
    if (!args.work) {
      process.stderr.write('refresh-cassettes: --e2e-phase needs --work <dir>\n');
      process.exit(2);
    }
    runE2eChild(args.e2ePhase, args.work).then(
      () => process.exit(0),
      (e) => {
        process.stderr.write(`refresh-cassettes: e2e ${args.e2ePhase}: ${e.message}\n`);
        process.exit(1);
      },
    );
  } else if (args.child) {
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
