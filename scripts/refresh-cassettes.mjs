#!/usr/bin/env node
// scripts/refresh-cassettes.mjs — record REAL cassettes from the live endpoints
// (CI-07, D-17-14, D-19-26).
//
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run cassettes:refresh
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run cassettes:refresh -- --only crossref
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run cassettes:refresh -- --only crossref --files search-title-attention
//   PENSMITH_CONTACT_EMAIL=pensmith-dev@example.org npm run cassettes:refresh -- --corpus e2e
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
//     query set are removed (their requests are no longer made) — except with
//     `--files`, which records only the named files and leaves every other
//     file of the directory as it is.
//   - Redirects and binary bodies (D-19-07): a call answered through redirects
//     records one entry per hop (a 3xx keeps its `location`); a non-text body
//     (a PDF) is stored base64 with `bodyEncoding: "base64"`. The `generic`
//     group records plain URL fetches (`fn: 'fetch'`) through http.ts.
//     tests/fixtures/cassettes/synthetic/ is never touched (hand-written
//     negative-test fixtures live there).
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
/** A DOI registered with ISTIC, not Crossref (Zou et al. 2026, Zhonghua Wei Chang Wai Ke Za Zhi), and its PMID. */
export const ISTIC_DOI = '10.3760/cma.j.cn441530-20260508-00189-1';
export const ISTIC_PMID = '42706103';
/** A retracted work with a Retraction Watch record in Crossref (Wakefield et al. 1998). */
export const RECORDED_RETRACTED_DOI = '10.1016/S0140-6736(97)11096-0';
/** An arXiv id recorded for lookups. */
export const RECORDED_ARXIV_ID = '1706.03762';
/** An old-style arXiv id (archive/number) recorded for lookups. */
export const RECORDED_OLD_ARXIV_ID = 'hep-th/9901001';
/** The title add.ts extracts from tests/fixtures/pdf/byo-text.pdf. */
export const BYO_PDF_TITLE = 'Attention Is All You Need';
/** The title of tests/fixtures/byo/no-match.pdf (a work no registrar knows). */
export const NO_MATCH_PDF_TITLE = 'Field Notes on Moss Growth Beside the Old Mill Stream';
/** tests/fixtures/byo/cites-in-footnote.pdf's own title (its DOIs name a cited work, SRC-13). */
export const CITES_IN_FOOTNOTE_PDF_TITLE = 'Machine Perception and the Limits of Representation';
/** `plan 2 --research` (GRND-17): the query, and the query joined to the seeded section title. */
export const PLAN_RESEARCH_QUERY = 'instagram adolescent depression longitudinal';
export const PLAN_RESEARCH_SECTION_TITLE = 'Social media and depression';
/** A research query whose Crossref hits include Aspelmeyer's "Measured measurement" (10.1038/nphys1170). */
export const BYO_MERGE_QUERY = 'measured measurement Aspelmeyer';
/** Research's results per query (bin/lib/adapter-plan.ts RESEARCH_PER_QUERY_LIMIT) — a lowered count would not replay. */
const RESEARCH_LIMIT = 10;
/** The title search's hits per registrar (bin/lib/source-input.ts TITLE_SEARCH_LIMIT). */
const TITLE_LIMIT = 5;
/** A `.pdf` path a real site answers with a 200 HTML page (SRC-01). */
export const HTML_AT_PDF_URL = 'https://duckduckgo.com/paper.pdf';
/** A small real PDF behind a 301 (http → https): SRC-01 / D-19-07. */
export const REDIRECT_PDF_URL = 'http://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

/** The research fixture lane (19-PLAN §7.3): the attention query from 2015 (SRC-10), exactly as research asks it. */
const researchFrom2015 = () => ({
  file: 'search-attention-from-2015',
  calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: RESEARCH_LIMIT, minLimit: RESEARCH_LIMIT, opts: { fromYear: 2015 } }],
});
/** `plan 2 --research` (GRND-17): both of its queries, exactly as research asks them. */
const planResearch = () => [
  { file: 'search-plan-research-query', calls: [{ fn: 'search', arg: PLAN_RESEARCH_QUERY, limit: RESEARCH_LIMIT, minLimit: RESEARCH_LIMIT }] },
  {
    file: 'search-plan-research-section',
    calls: [{ fn: 'search', arg: `${PLAN_RESEARCH_QUERY} ${PLAN_RESEARCH_SECTION_TITLE}`, limit: RESEARCH_LIMIT, minLimit: RESEARCH_LIMIT }],
  },
];
/** PDF identification's title searches (SRC-13 / SRC-15): the attention paper, the no-match PDF and the essay that cites in a footnote. */
const titleSearches = () => [
  { file: 'search-title-attention', calls: [{ fn: 'search', arg: BYO_PDF_TITLE, limit: TITLE_LIMIT, minLimit: TITLE_LIMIT }] },
  { file: 'search-title-no-match', calls: [{ fn: 'search', arg: NO_MATCH_PDF_TITLE, limit: TITLE_LIMIT, minLimit: TITLE_LIMIT }] },
  { file: 'search-title-cites-in-footnote', calls: [{ fn: 'search', arg: CITES_IN_FOOTNOTE_PDF_TITLE, limit: TITLE_LIMIT, minLimit: TITLE_LIMIT }] },
];

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
    // A DOI no registrar ever minted: Crossref's definitive 404 (Pass 1 FABRICATED).
    { file: 'works-no-such-doi-404', calls: [{ fn: 'lookupById', arg: '10.5555/pensmith-no-such-work-2017' }] },
    // An ISTIC-registered DOI (a PubMed-indexed article, PMID 42706103): Crossref's 404 says
    // nothing about it — Pass 1 asks doi.org for the agency and checks the PMID instead.
    { file: 'works-istic-404', calls: [{ fn: 'lookupById', arg: ISTIC_DOI }] },
    // SRC-05: a complete journal record (Nature 521(7553), 436-444).
    { file: 'works-nature14539', calls: [{ fn: 'lookupById', arg: '10.1038/nature14539' }] },
    // SRC-05: a consortium author (name only).
    { file: 'works-nature11247-encode', calls: [{ fn: 'lookupById', arg: '10.1038/nature11247' }] },
    // SRC-04: a retracted work whose record carries its Retraction Watch notice (updated-by).
    { file: 'works-wakefield-1998', calls: [{ fn: 'lookupById', arg: RECORDED_RETRACTED_DOI }] },
    // SRC-12: a particle surname (van der Maaten).
    { file: 'works-foreco-2013', calls: [{ fn: 'lookupById', arg: '10.1016/j.foreco.2013.06.030' }] },
    // SRC-12: the Crossref record of PMID 31978945 (Pass 1 of a PubMed-added source).
    { file: 'works-nejmoa2001017', calls: [{ fn: 'lookupById', arg: '10.1056/NEJMoa2001017' }] },
    // GRND-14: an open-access PLOS ONE article (`add` records its Unpaywall OA PDF, unpaywall/doi-pone-0000001).
    { file: 'works-pone-0000001', calls: [{ fn: 'lookupById', arg: '10.1371/journal.pone.0000001' }] },
    // SRC-05 / SRC-12 (review round 2): registrar markup — an <i> in the title, an &amp; in the journal.
    { file: 'works-pnas-drosophila-coli', calls: [{ fn: 'lookupById', arg: '10.1073/pnas.74.11.5041' }] },
    { file: 'works-jaac-2010', calls: [{ fn: 'lookupById', arg: '10.1016/j.jaac.2010.05.017' }] },
    researchFrom2015(),
    ...titleSearches(),
    ...planResearch(),
    // SRC-15: a research query whose Crossref hits include a bring-your-own PDF's
    // work (10.1038/nphys1170, tests/fixtures/byo/doi-footer.pdf) — the two merge.
    { file: 'search-byo-merge', calls: [{ fn: 'search', arg: BYO_MERGE_QUERY, limit: RESEARCH_LIMIT, minLimit: RESEARCH_LIMIT }] },
  ],
  openalex: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
    // SRC-05: a lookup by DOI and by W-id (venue, biblio, abstract, PMID).
    { file: 'works-doi-nature14539', calls: [{ fn: 'lookupById', arg: '10.1038/nature14539' }] },
    { file: 'works-W2919115771', calls: [{ fn: 'lookupById', arg: 'W2919115771' }] },
    // A W-id OpenAlex does not know: a real 404 (not-found).
    { file: 'works-W2963403868-404', calls: [{ fn: 'lookupById', arg: 'W2963403868' }] },
    // Title searches only: research's own queries ask OpenAlex for 10 works
    // with abstracts, which exceeds the 51200-byte cassette cap at any size
    // research requests — the fixture lane reports those as `offline: no
    // recorded fixture`, and the live lane (npm run live:sources) covers them.
    ...titleSearches(),
  ],
  arxiv: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3, pauseMs: 3500 }] },
    { file: 'id-1706.03762', calls: [{ fn: 'lookupById', arg: RECORDED_ARXIV_ID, pauseMs: 3500 }] },
    { file: 'id-hep-th-9901001', calls: [{ fn: 'lookupById', arg: RECORDED_OLD_ARXIV_ID, pauseMs: 3500 }] },
    // PDF identification's arXiv title search (source-input.ts arxivTitleQuery),
    // asked when OpenAlex's only match is a later re-post (review round 2).
    { file: 'search-title-attention', calls: [{ fn: 'search', arg: `ti:"${BYO_PDF_TITLE}"`, limit: TITLE_LIMIT, minLimit: TITLE_LIMIT, pauseMs: 3500 }] },
    // (No from-2015 file: the arXiv API has no date filter, so research's
    // request with min_year set is search-attention-neural-networks — the
    // [sources] policy drops the older works afterwards.)
  ],
  pubmed: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
    { file: 'esummary-31978945', calls: [{ fn: 'lookupById', arg: '31978945' }] },
    // The PubMed record of the ISTIC-registered DOI above (Pass 1's PMID fallback).
    { file: 'esummary-42706103', calls: [{ fn: 'lookupById', arg: ISTIC_PMID }] },
    researchFrom2015(),
    ...planResearch(),
  ],
  semanticscholar: [
    { file: 'search-attention-neural-networks', calls: [{ fn: 'search', arg: RECORDED_QUERY, limit: 10, minLimit: 3 }] },
    researchFrom2015(),
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
    { file: 'updates-nejmoa2001017', calls: [{ fn: 'fetchById', arg: '10.1056/nejmoa2001017' }] },
    { file: 'updates-pnas-drosophila-coli', calls: [{ fn: 'fetchById', arg: '10.1073/pnas.74.11.5041' }] },
  ],
  books: [
    // SRC-11: Kuhn, The Structure of Scientific Revolutions (3rd ed., 1996).
    { file: 'isbn-9780226458083', calls: [{ fn: 'lookupById', arg: 'isbn:9780226458083' }] },
    { file: 'search-economic-consequences-of-the-peace', calls: [{ fn: 'search', arg: 'The Economic Consequences of the Peace', limit: 5, minLimit: 2 }] },
  ],
  // Plain URL fetches through http.ts (source 'generic'), redirects recorded hop by hop.
  generic: [
    { file: 'redirect-w3-dummy-pdf', calls: [{ fn: 'fetch', arg: REDIRECT_PDF_URL }] },
    // A `.pdf` URL that answers an HTML page with HTTP 200 (`add <url>` must say
    // "not a PDF (got text/html)" and never hand it to the PDF parser).
    { file: 'html-at-pdf-url', calls: [{ fn: 'fetch', arg: HTML_AT_PDF_URL }] },
    // open-access.ts confirms the PDF Unpaywall lists for a DOI by reading its
    // first 1029 bytes (review round 3): PLOS ONE 10.1371/journal.pone.0000001
    // (tests/open-access.test.ts, the built-CLI `add`).
    {
      file: 'oa-pdf-prefix-plos-one',
      calls: [{ fn: 'confirmOpenAccessPdf', arg: 'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0000001&type=printable' }],
    },
    // doi.org's registration-agency lookup (bin/lib/sources/doi-ra.ts): asked
    // when Crossref answers 404 for a DOI `add` resolves or Pass 1 re-fetches —
    // a Crossref prefix (Nature), a DataCite prefix (Zenodo), a prefix no
    // agency holds, Crossref's test prefix (Pass 1's "did not resolve"
    // fixture, 10.5555) and an ISTIC prefix (the Chinese Medical Association,
    // 10.3760: Pass 1 falls back to the entry's PMID).
    {
      file: 'doi-ra-prefixes',
      calls: [
        { fn: 'fetch', arg: 'https://doi.org/ra/10.1038' },
        { fn: 'fetch', arg: 'https://doi.org/ra/10.5281' },
        { fn: 'fetch', arg: 'https://doi.org/ra/10.99999' },
        { fn: 'fetch', arg: 'https://doi.org/ra/10.5555' },
        { fn: 'fetch', arg: 'https://doi.org/ra/10.3760' },
      ],
    },
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
// Cassette entries
// ---------------------------------------------------------------------------

/** Any email address (an author's address inside an affiliation string, say). */
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * The committed cassette entry for one recorded fixture — the per-adapter
 * recordings and the e2e corpus share it: sensitive headers dropped, the
 * contact email and then every other email address redacted (fixtures commit
 * no email address at all, tests/cassette-no-leak), a non-text body kept as
 * base64 (D-19-07), recorder provenance.
 */
function recordedEntry(mock, f, adapter, recordedAt) {
  const email = (process.env.PENSMITH_CONTACT_EMAIL ?? '').trim();
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
    // D-19-07: a non-text body (a PDF) is base64 — replay decodes it by this field.
    ...(f.bodyEncoding ? { bodyEncoding: f.bodyEncoding } : {}),
    ...(f.bodySha256 ? { bodySha256: f.bodySha256 } : {}),
    provenance: { recordedAt, recorder: 'scripts/refresh-cassettes.mjs', adapter },
  };
  const text = JSON.stringify(entry);
  return JSON.parse((email ? text.split(email).join('REDACTED_CONTACT_EMAIL') : text).replace(EMAIL_ADDRESS, 'REDACTED_EMAIL'));
}

// ---------------------------------------------------------------------------
// Child: record one adapter (runs under `node --import tsx`)
// ---------------------------------------------------------------------------

async function runChild(adapter, files = []) {
  const all = QUERY_SETS[adapter];
  if (!all) throw new Error(`unknown adapter "${adapter}"`);
  const unknownFiles = files.filter((f) => !all.some((c) => c.file === f));
  if (unknownFiles.length > 0) throw new Error(`unknown file(s) for ${adapter}: ${unknownFiles.join(', ')}`);
  const spec = files.length > 0 ? all.filter((c) => files.includes(c.file)) : all;
  const bin = (rel) => pathToFileURL(path.join(REPO_ROOT, 'bin', 'lib', rel)).href;
  const http = await import(bin('http.js'));
  // `generic`: plain URL fetches through the one transport (no adapter module).
  const mod = adapter === 'generic'
    ? {
        fetch: (url) => http.fetch(url, { source: 'generic', noCache: true, maxBytes: 16 * 1024 * 1024 }),
        // open-access.ts's PDF check: only the first bytes of the listed PDF
        // are read (FetchOptions.prefixBytes), so the recording is that prefix.
        confirmOpenAccessPdf: async (url) => {
          const oa = await import(bin('open-access.js'));
          const c = await oa.confirmOpenAccessPdf(url);
          if (!c.ok) throw new Error(`the open-access link did not answer with a PDF: ${c.reason}`);
        },
      }
    : await import(bin(path.join('sources', `${adapter}.js`)));
  const mock = await import(bin('http-mock.js'));
  const { atomicWriteFile } = await import(bin('atomic-write.js'));

  if (!mock.isRecordingEnabled()) {
    throw new Error('recording is not enabled (needs PENSMITH_RECORD_CASSETTES=1, live mode, outside a test context)');
  }
  const recordedAt = new Date().toISOString();
  const entryFor = (f) => recordedEntry(mock, f, adapter, recordedAt);

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
    if (call.fn === 'fetch') {
      const res = await mod.fetch(call.arg);
      if (res.status !== 200) throw new Error(`fetch answered HTTP ${res.status}`);
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
  const wanted = new Set(all.map((c) => `${c.file}.json`));
  for (const f of files.length > 0 ? [] : readdirSync(dir)) {
    if (f.endsWith('.json') && !wanted.has(f)) {
      rmSync(path.join(dir, f));
      process.stdout.write(`  removed ${adapter}/${f} (no longer in the recorded query set)\n`);
    }
  }
  // The exact-match store must stay unambiguous (tests/cassette-provenance):
  // a request another file of this directory already answers (PubMed's
  // esummary of the same ids, reached by two searches) is left to that file.
  const { readFileSync } = await import('node:fs');
  const keysElsewhere = (file) => {
    const keys = new Set();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f === `${file}.json`) continue;
      if (outcomes.some((o) => `${o.file}.json` === f && o.error === null)) continue; // re-recorded below
      for (const e of JSON.parse(readFileSync(path.join(dir, f), 'utf8'))) keys.add(mock.cassetteKey(e));
    }
    for (const o of outcomes) {
      if (o.file === file || o.error !== null) continue;
      if (outcomes.indexOf(o) < outcomes.findIndex((x) => x.file === file)) for (const e of o.entries) keys.add(mock.cassetteKey(e));
    }
    return keys;
  };
  for (const o of outcomes) {
    if (o.error !== null) continue;
    const taken = keysElsewhere(o.file);
    const kept = o.entries.filter((e) => !taken.has(mock.cassetteKey(e)));
    if (kept.length !== o.entries.length) {
      o.notes.push(`${o.entries.length - kept.length} entr${o.entries.length - kept.length === 1 ? 'y' : 'ies'} already answered by another file — left there`);
      o.entries = kept;
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
//   1. search   (live)    discoverCandidates (research-orchestrator.ts) for each
//                         scripted query, recorded;
//   2. stage    (no net)  write the search cassettes (≤ 51200 bytes each; a
//                         response over the cap, a 429/5xx or an error body is
//                         an expected miss, never truncated or hand-written);
//   3. select   (offline) replay the searches exactly as the chain will (dedup,
//                         citekeys) and preselect the DOI-bearing candidates;
//   4. lookups  (live)    record each preselected source's retraction
//                         cross-check and Pass-1 lookups, with its live verdict;
//   5. assemble (no net)  keep ≤ 6 sources whose live Pass 1 is OK, write their
//                         lookup cassettes, mock-script.json and MANIFEST.json.
//                         This filter is a LIMIT of the GRND-18 acceptance the
//                         corpus replays: it shows that the chain reaches done
//                         over sources that verify, not that every live search
//                         hit verifies — a source whose live Pass 1 fails is
//                         never in the corpus (the live lane covers that);
//   6. verify   (offline) replay research and Pass 1 of every kept source.
// Any failure restores the previous corpus. Keys another committed cassette
// already answers are not duplicated (tests/cassette-provenance.test.ts keeps
// the store unambiguous).

/** The topic, discipline and queries the corpus is recorded for (the PRD §15 assignment). */
export const E2E_TOPIC = 'attention mechanisms in transformers';
export const E2E_DISCIPLINE = 'computer-science';
/**
 * The scripted scope's queries. Research sends 5–10 per scope (SRC-08: fewer
 * are padded from the topic's deterministic expansion), so the corpus scripts
 * exactly five — the chain sends them unchanged (query-expansion.ts
 * clampQueries keeps them as written).
 */
export const E2E_QUERIES = Object.freeze([
  'transformer self-attention mechanism',
  'attention mechanism neural machine translation',
  'multi-head attention transformer architecture',
  'scaled dot-product attention transformer',
  'transformer attention interpretability',
]);
/** The scripted scope (topic-disambiguator, SRC-08). */
const E2E_SCOPE = Object.freeze({
  label: 'transformer-attention',
  description: 'Attention mechanisms in transformer neural networks: self-attention, multi-head attention and their analysis.',
});
/** At most this many sources are kept (the evaluator keep-list, D-18-31). */
export const E2E_MAX_KEPT = 6;
/** DOI-bearing candidates whose Pass-1 lookups are recorded, to keep ≤ E2E_MAX_KEPT that verify. */
const E2E_PRESELECT = 12;
/** A 1500-word literature review in computer science: intro, discussion, conclusion (no counterargument). */
export const E2E_EXPECTED_SECTIONS = 3;
const E2E_ROOT = path.join(CASSETTES_ROOT, 'e2e');
const E2E_CORPUS_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'e2e-corpus');
const E2E_ASSIGNMENT = path.join(REPO_ROOT, 'tests', 'fixtures', 'assignment.txt');
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
    policy: await import(bin('source-policy.js')),
    sourceContext: await import(bin('source-context.js')),
    retraction: await import(bin('sources/retraction-cross-check.js')),
    library: await import(bin('library.js')),
    pass1: await import(bin('verify/pass1.js')),
  };
}

/**
 * The adapter plan and registry `pensmith research` uses for the corpus
 * brief (bin/cli/research.ts): the computer-science preset's source
 * preference over the default five, no `[sources]` settings.
 */
function e2ePlan(m) {
  const registry = m.research.researchRegistry();
  const plan = m.research.researchAdapterPlan({ registry, byPreference: true, discipline: E2E_DISCIPLINE });
  return { registry, plan };
}

/** research's pass over the corpus queries (the evaluator runs as its contract stub: it keeps every candidate). */
async function e2eResearchPass(m) {
  const { registry, plan } = e2ePlan(m);
  return m.research.runResearchPass({
    queries: [...E2E_QUERIES],
    plan,
    registry,
    policy: m.policy.sourcePolicyFrom(undefined),
    topic: E2E_TOPIC,
    discipline: E2E_DISCIPLINE,
    scope: `${E2E_SCOPE.label} — ${E2E_SCOPE.description}`,
    warn: (line) => process.stdout.write(`  ${line}\n`),
  });
}

async function writeJson(m, file, value) {
  await m.atomic.atomicWriteFile(file, JSON.stringify(value, null, 2) + '\n');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
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
  /** 1. The research searches (research-orchestrator.ts discoverCandidates, the chain's plan), live and recorded — one drain per query. */
  async search(m, work) {
    assertRecording(m);
    const { registry, plan } = e2ePlan(m);
    const out = [];
    for (const query of E2E_QUERIES) {
      m.http.takeRecordedFixtures();
      const d = await m.research.discoverCandidates({ queries: [query], plan, registry, warn: (line) => process.stdout.write(`  ${line}\n`) });
      out.push({ query, fixtures: m.http.takeRecordedFixtures() });
      process.stdout.write(`  searched "${query}": ${d.adapters.map((a) => `${a.adapter} ${a.count} (${a.status})`).join(', ')}\n`);
    }
    await writeJson(m, path.join(work, 'search.json'), { adapters: plan.entries.map((e) => e.adapter), searches: out });
  },

  /** 2. Write the search cassettes: one file per (adapter, query), or an expected miss. */
  async stage(m, work) {
    const recordedAt = new Date().toISOString();
    const committed = committedKeysOutsideE2e(m);
    const files = [];
    const misses = [];
    const { adapters, searches } = readJson(path.join(work, 'search.json'));
    for (const { query, fixtures } of searches) {
      for (const adapter of adapters) {
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
        const entries = fx.filter((f) => !committed.has(f.key)).map((f) => recordedEntry(m.mock, f, adapter, recordedAt));
        if (entries.length === 0) continue; // a committed per-adapter cassette answers it already
        const text = fitting(entries);
        if (text === null) {
          const bytes = Buffer.byteLength(renderCassette(entries, true), 'utf8');
          misses.push({ adapter, query, why: `the recorded response is ${bytes} bytes, over the ${MAX_CASSETTE_BYTES}-byte cassette cap` });
          continue;
        }
        const file = path.join(E2E_ROOT, adapter, `search-${querySlug(query)}.json`);
        await m.atomic.atomicWriteFile(file, text);
        files.push(repoRel(file));
        process.stdout.write(`  recorded ${repoRel(file)} (${(Buffer.byteLength(text, 'utf8') / 1024).toFixed(1)} KiB)\n`);
      }
    }
    for (const miss of misses) process.stdout.write(`  expected miss: ${miss.adapter} "${miss.query}" — ${miss.why}\n`);
    await writeJson(m, path.join(work, 'stage.json'), { files, misses });
  },

  /**
   * 3. Replay research's pass offline, exactly as the chain will (discovery,
   * dedup, citekeys, tiers, the `[sources]` policy; the evaluator stub keeps
   * every candidate), and preselect the candidates the chain can cite: a DOI
   * the verifier checks (source-context.ts verifierBlindSpot), not retracted.
   */
  async select(m, work) {
    const pass = await e2eResearchPass(m);
    // The evaluator's batch: every candidate the pre-evaluation policy let
    // through (kept, rejected, or excluded afterwards with its final tier —
    // those carry the evaluator's relevance).
    const batch = [...pass.kept, ...pass.rejected, ...pass.excluded.filter((e) => e.relevance !== null)];
    if (batch.length > m.research.EVALUATOR_BATCH) {
      throw new Error(`the replayed research sends ${batch.length} candidates to the evaluator, over one batch of ${m.research.EVALUATOR_BATCH} — the chain would make two evaluator calls; pick narrower E2E_QUERIES`);
    }
    const preselected = pass.kept
      .filter((i) => i.view.doi !== null && i.candidate.retracted !== true && m.sourceContext.verifierBlindSpot(i.view, false) === null)
      .slice(0, E2E_PRESELECT)
      .map((i) => i.candidate);
    if (preselected.length === 0) throw new Error('the replayed research found no citable DOI-bearing source — nothing to keep');
    process.stdout.write(`  replayed research: ${pass.distinct} distinct candidate(s), ${batch.length} evaluated, ${preselected.length} preselected\n`);
    await writeJson(m, path.join(work, 'select.json'), {
      evaluated: batch.map((i) => ({ citekey: i.candidate.citekey, tier: i.tier ?? i.tierHint ?? 'other' })),
      preselected,
    });
  },

  /** 4. Each preselected source's retraction cross-check and Pass-1 lookups (with the freshness probe), live and recorded. */
  async lookups(m, work) {
    assertRecording(m);
    const { preselected } = readJson(path.join(work, 'select.json'));
    const root = await paperRoot(m, work, 'lookup-paper');
    const results = [];
    for (const c of preselected) {
      m.http.takeRecordedFixtures();
      await m.retraction.crossCheckRetractions([c]);
      results.push({
        citekey: c.citekey,
        doi: c.doi,
        title: c.title,
        source: c.source,
        retracted: c.retracted === true || c.retraction_status === 'retracted',
        retractionUnknown: c.retraction_status === 'unknown',
        fixtures: m.http.takeRecordedFixtures(),
      });
    }
    await m.library.upsertSources(root, preselected, { provenance: 'research' });
    const bib = path.join(root, '.paper', 'CITATIONS.bib');
    for (const r of results) {
      if (r.retracted || r.retractionUnknown) {
        r.verdict = r.retracted ? 'RETRACTED' : 'RETRACTION-UNKNOWN';
        continue;
      }
      const draft = `# Section\n\nA claim the source supports [@${r.citekey}].\n`;
      m.http.takeRecordedFixtures();
      const [v] = await m.pass1.runPass1(draft, bib, { root });
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
        const text = fitting(list.map((f) => recordedEntry(m.mock, f, adapter, recordedAt)));
        if (text === null) over = `${adapter} lookups are over the ${MAX_CASSETTE_BYTES}-byte cap`;
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
        },
      }],
      'topic-disambiguator': [{ data: { ambiguous: false, scopes: [{ ...E2E_SCOPE, queries: [...E2E_QUERIES] }] } }],
      // One verdict per candidate of the evaluator's batch (SRC-09): the
      // keep-list is kept, every other candidate rejected — a candidate with no
      // verdict would be kept as "not evaluated".
      'source-evaluator': [{
        data: {
          verdicts: select.evaluated.map((c) => ({
            citekey: c.citekey,
            keep: keptKeys.has(c.citekey),
            reason: keptKeys.has(c.citekey) ? 'recorded e2e corpus: kept' : 'recorded e2e corpus: not in the keep-list',
            relevance: keptKeys.has(c.citekey) ? 0.9 : 0.1,
            tier: c.tier,
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
    const pass = await e2eResearchPass(m);
    const byKey = new Map(pass.kept.map((i) => [i.candidate.citekey, i.candidate]));
    const kept = manifest.keptSources.map((k) => {
      const c = byKey.get(k.citekey);
      if (!c || c.doi !== k.doi) throw new Error(`replayed research lost the kept source ${k.citekey} (${k.doi})`);
      return c;
    });
    await m.retraction.crossCheckRetractions(kept);
    for (const c of kept) if (c.retraction_status !== 'clear') throw new Error(`offline retraction check of ${c.citekey}: ${c.retraction_status}`);
    await m.library.upsertSources(root, kept, { provenance: 'research' });
    const bib = path.join(root, '.paper', 'CITATIONS.bib');
    const draft = `# Section\n\n${kept.map((c) => `A claim [@${c.citekey}].`).join(' ')}\n`;
    for (const v of await m.pass1.runPass1(draft, bib, { root })) {
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
  const out = { only: [], files: [], child: null, list: false, corpus: null, e2ePhase: null, work: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') {
      const v = argv[++i];
      if (!v) throw new Error('--only needs an adapter name');
      out.only.push(...v.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a.startsWith('--only=')) {
      out.only.push(...a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean));
    } else if (a === '--files') {
      const v = argv[++i];
      if (!v) throw new Error('--files needs file names (without .json)');
      out.files.push(...v.split(',').map((f) => f.trim().replace(/\.json$/, '')).filter(Boolean));
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
      throw new Error(`unknown argument "${a}" (usage: npm run cassettes:refresh -- [--only <adapter>[,<adapter>]] [--files <file>[,<file>]] [--corpus e2e] [--list])`);
    }
  }
  if (out.corpus !== null && (out.only.length > 0 || out.files.length > 0)) throw new Error('--corpus e2e and --only / --files are separate recordings; pass one');
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
  if (args.files.length > 0 && targets.length !== 1) {
    process.stderr.write('refresh-cassettes: --files goes with exactly one --only <adapter>\n');
    return 2;
  }
  const failed = [];
  for (const adapter of targets) {
    process.stdout.write(`refresh-cassettes: recording ${adapter} …\n`);
    const dataDir = mkdtempSync(path.join(tmpdir(), 'pensmith-cassettes-'));
    const env = childEnv(dataDir);
    env.PENSMITH_RECORD_CASSETTES = '1';
    // tsx resolved to an absolute URL: the child's cwd is the temp data dir.
    const childArgs = [__filename, '--child', adapter, ...(args.files.length > 0 ? ['--files', args.files.join(',')] : [])];
    const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), ...childArgs], {
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
    runChild(args.child, args.files).then(
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
