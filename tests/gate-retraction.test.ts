// tests/gate-retraction.test.ts — GATE-03 live-retraction-blocks scaffold (Phase 14, Plan 01).
//
// Contract under test:
//   bin/lib/verify/pass1.ts (Wave-1, Plan 03) — modified verdictForCitekey:
//   After resolving a citation's DOI via Crossref, re-query Retraction Watch
//   via fetchById. A confirmed live hit → verdict 'MIS-CITED' (blocking).
//   fetchById returning null (transport error / no cassette hit) → NOT a false
//   MIS-CITED; follows the normal JW comparison outcome.
//
// RED-by-skip (Wave-0 scaffold): behavioral assertions SKIP until pass1.ts
// imports the retraction-watch fetchById adapter. A source-grep predicate is
// used instead of existsSync (existsSync alone cannot detect whether the not-
// yet-wired behavior is in place — the file exists but the import is absent).
// This mirrors the 07-01 source-grep skip predicate convention.
//
// Offline only: cassettes + PENSMITH_NETWORK_TESTS unset (default offline mode).
//   - Retracted DOI: 10.0000/gate03-retracted (gate03-blocking-doi.json cassette)
//   - No-cassette DOI: a DOI with no cassette entry → fetchById returns null
//     → transport-error-silent path (NOT a false MIS-CITED)
//
// Path resolution: fileURLToPath(import.meta.url) / new URL(...).href —
// spaced-path safe (OneDrive dev folder; Phase-11 %20 lesson).
//
// runPass1 call shape: mirrors known-bad-citations.test.ts lines 58-76
// (bib fixture + draft markdown → full pass1 pipeline via cassettes).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// DOI constants
const RETRACTED_DOI = '10.0000/gate03-retracted';   // hits gate03-blocking-doi.json cassette
const NO_CASSETTE_DOI = '10.0000/no-gate03-cassette'; // no cassette entry → fetchById returns null

// Resolve pass1.ts source path for the source-grep predicate.
// We read the source file to check if it imports retraction-watch fetchById.
const pass1TsUrl = new URL('../bin/lib/verify/pass1.ts', import.meta.url);
const pass1TsPath = fileURLToPath(pass1TsUrl);
const pass1JsUrl = new URL('../bin/lib/verify/pass1.js', import.meta.url);

// ---------------------------------------------------------------------------
// Source-grep skip predicate
// ---------------------------------------------------------------------------
// The behavioral assertions SKIP until pass1.ts imports retraction-watch.
// An existsSync check on pass1.ts would be vacuously true (the file already
// exists), so we grep the source for the import statement instead.
// This is the same convention used in 07-01 to guard the RSCH-10 probe.
//
// The import we're looking for (Wave-1 will add it):
//   import { fetchById as retractionWatchFetchById } from '../sources/retraction-watch.js'
// or equivalently any import from retraction-watch that brings in fetchById.
let pass1ImportsRetractionWatch = false;
let skipReason = '';

if (existsSync(pass1TsPath)) {
  const pass1Source = readFileSync(pass1TsPath, 'utf8');
  // Check that the source imports fetchById from retraction-watch.
  // We accept either the aliased form (as retractionWatchFetchById) or direct import.
  const hasImport = /from\s+['"]\.\.\/sources\/retraction-watch\.js['"]/
    .test(pass1Source);
  if (hasImport) {
    pass1ImportsRetractionWatch = true;
  } else {
    skipReason =
      'pass1.ts does not yet import retraction-watch fetchById — GATE-03 not yet wired (Wave-1, Plan 03)';
  }
} else {
  skipReason = 'bin/lib/verify/pass1.ts not found — cannot check GATE-03 wiring';
}

// ---------------------------------------------------------------------------
// Helpers: minimal paper root fixture for runPass1
// ---------------------------------------------------------------------------
/**
 * Write a minimal paper root with a single CITATIONS.bib entry and return
 * { root, draftMd, bibPath } for use with runPass1.
 */
function makeBibFixture(opts: {
  citekey: string;
  title: string;
  author: string; // "Family, Given"
  doi: string;
}): { root: string; draftMd: string; bibPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gate03-'));
  mkdirSync(join(root, '.paper'), { recursive: true });

  // BibTeX entry for the fixture citation.
  const bib = [
    `@article{${opts.citekey},`,
    `  title = {${opts.title}},`,
    `  author = {${opts.author}},`,
    `  doi = {${opts.doi}},`,
    `  year = {2018},`,
    `  journal = {Test Journal},`,
    `}`,
    '',
  ].join('\n');

  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, bib);

  // Draft markdown referencing the citekey.
  const draftMd = `# Test Section\n\nA claim here [@${opts.citekey}].\n`;

  return { root, draftMd, bibPath };
}

// ---------------------------------------------------------------------------
// Test 1: Live-retracted DOI (cassette hit) → MIS-CITED (blocking)
// ---------------------------------------------------------------------------
test('GATE-03: live-retracted DOI (cassette hit) → Pass-1 verdict is MIS-CITED (blocking)', {
  skip: !pass1ImportsRetractionWatch ? skipReason : false,
}, async () => {
  const { runPass1 } = await import(pass1JsUrl.href) as {
    runPass1: (draftMd: string, bibPath: string) => Promise<Array<{ citekey: string; verdict: string; reason: string }>>;
  };

  // The gate03-blocking-doi.json cassette covers 10.0000/gate03-retracted.
  // In Wave-1, the retraction-watch adapter is wired so that this cassette
  // is found during the live-retraction re-query inside verdictForCitekey.
  const { draftMd, bibPath } = makeBibFixture({
    citekey: 'retracted2022',
    title: 'A Gate-03 Live-Retraction Fixture',
    author: 'Retracted, Alice',
    doi: RETRACTED_DOI,
  });

  const results = await runPass1(draftMd, bibPath);
  const r = results.find((x) => x.citekey === 'retracted2022');
  assert.ok(r, 'runPass1 must return a result for the retracted citekey');
  assert.equal(
    r.verdict,
    'MIS-CITED',
    'A live-retracted DOI (cassette hit) must produce verdict MIS-CITED (GATE-03 blocking)',
  );
  // The reason should mention the live re-query (distinguishes GATE-03 from
  // the stored claimed.retracted fast-path).
  assert.match(
    r.reason,
    /Retraction Watch|live re-query|retraction/i,
    'MIS-CITED reason must reference the live Retraction Watch re-query',
  );
});

// ---------------------------------------------------------------------------
// Test 2: No-cassette DOI (fetchById null) → NOT a false MIS-CITED
// ---------------------------------------------------------------------------
test('GATE-03: no-cassette DOI (transport/no-hit → fetchById null) → NOT a false MIS-CITED', {
  skip: !pass1ImportsRetractionWatch ? skipReason : false,
}, async () => {
  const { runPass1 } = await import(pass1JsUrl.href) as {
    runPass1: (draftMd: string, bibPath: string) => Promise<Array<{ citekey: string; verdict: string; reason: string }>>;
  };

  // This DOI has NO cassette entry → in offline mode, fetchById returns null.
  // The GATE-03 path must be a silent skip — it must NOT produce a false MIS-CITED
  // based solely on the transport/no-hit result.
  // We use a DOI that the Crossref cassette ALSO has no entry for → FABRICATED
  // (DOI didn't resolve), which is distinct from a GATE-03-triggered MIS-CITED.
  const { draftMd, bibPath } = makeBibFixture({
    citekey: 'nocassette2020',
    title: 'A No-Cassette DOI Fixture',
    author: 'Phantom, Author',
    doi: NO_CASSETTE_DOI,
  });

  const results = await runPass1(draftMd, bibPath);
  const r = results.find((x) => x.citekey === 'nocassette2020');
  assert.ok(r, 'runPass1 must return a result for the no-cassette citekey');

  // The GATE-03 retraction re-query returned null (no hit) → must NOT produce
  // a MIS-CITED verdict from GATE-03 alone. The verdict should be FABRICATED
  // (DOI did not resolve via Crossref) or OK/MIS-CITED from the JW path —
  // never MIS-CITED purely because fetchById returned null.
  // We assert by checking the reason does NOT mention "live re-query" / "Retraction Watch (live".
  const reasonMentionsLiveRetraction =
    /Retraction Watch \(live|live re-query/i.test(r.reason);
  assert.equal(
    reasonMentionsLiveRetraction,
    false,
    'A no-cassette DOI (fetchById null) must NOT produce a GATE-03 false MIS-CITED reason (transport-error-silent)',
  );
});

// ---------------------------------------------------------------------------
// Test 3: D-15 STORED retraction (note = {RETRACTED} round-trip) → MIS-CITED
// ---------------------------------------------------------------------------
// Regression for the audit finding: writeBibtex serializes a retracted source as
// BibTeX `note = {RETRACTED}` (bibtex-write.ts:93), and citation-js preserves
// `note` verbatim but does NOT repopulate the synthetic `retracted` boolean — so
// a bib-sourced retracted entry arrives in Pass-1 with `note:'RETRACTED'` and
// `retracted:undefined`. Before the fix, pass1 only checked `claimed.retracted`,
// so EVERY stored-retracted work passed Pass-1 offline (the live re-query is null
// without a cassette). This asserts the stored flag alone blocks, with NO live
// re-query — the entire point of D-15 "surface twice".
test('D-15 stored retraction: a bib entry with note = {RETRACTED} → Pass-1 MIS-CITED (offline, stored path)', async () => {
  const { runPass1 } = await import(pass1JsUrl.href) as {
    runPass1: (draftMd: string, bibPath: string) => Promise<Array<{ citekey: string; verdict: string; reason: string }>>;
  };

  const root = mkdtempSync(join(tmpdir(), 'pensmith-stored-retr-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const bib = [
    '@article{retracted2019,',
    '  title = {A Stored-Retraction Fixture},',
    '  author = {Doe, Jane},',
    '  doi = {10.0000/stored-retracted-d15},',
    '  year = {2019},',
    '  journal = {Test Journal},',
    '  note = {RETRACTED},',
    '}',
    '',
  ].join('\n');
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, bib);
  const draftMd = '# Section\n\nA claim here [@retracted2019].\n';

  const results = await runPass1(draftMd, bibPath);
  const r = results.find((x) => x.citekey === 'retracted2019');
  assert.ok(r, 'runPass1 must return a result for the stored-retracted citekey');
  assert.equal(
    r.verdict,
    'MIS-CITED',
    'A stored note=RETRACTED bib entry must block as MIS-CITED (D-15 stored path)',
  );
  // Must fire via the stored fast-path, NOT the live Retraction Watch re-query
  // (which is null offline). The stored reason references the research-time check.
  assert.doesNotMatch(
    r.reason,
    /live re-query/i,
    'stored-retraction must block via the stored note, not the live re-query',
  );
});

// ---------------------------------------------------------------------------
// Test 4: #16 — claimed DOI redirects (via Crossref) to a RETRACTED canonical DOI
// ---------------------------------------------------------------------------
// The claimed alias DOI is NOT in Retraction Watch, but Crossref resolves it to a
// canonical DOI that IS retracted. Querying only the claimed DOI (the original
// bug) misses it and — because the bib metadata strict-matches the canonical —
// the multi-DOI-redirect branch would return OK, so a retracted work escapes.
// The fix re-queries BOTH the claimed and the canonical DOI, so it is blocked.
test('GATE-03 (#16): claimed DOI redirecting to a retracted canonical → MIS-CITED', async () => {
  const { runPass1 } = await import(pass1JsUrl.href) as {
    runPass1: (draftMd: string, bibPath: string) => Promise<Array<{ citekey: string; verdict: string; reason: string }>>;
  };
  // bib metadata strict-matches the crossref redirect fixture (redirect-audit16.json):
  // claimed 10.0000/alias-audit16 resolves to canonical 10.0000/retracted, which
  // the freshness-hit retraction-watch cassette lists as retracted.
  const { draftMd, bibPath } = makeBibFixture({
    citekey: 'alias16',
    title: 'A Redirect-to-Retracted Fixture (Audit 16)',
    author: 'Roe, Jane',
    doi: '10.0000/alias-audit16',
  });

  const results = await runPass1(draftMd, bibPath);
  const r = results.find((x) => x.citekey === 'alias16');
  assert.ok(r, 'runPass1 must return a result for the alias citekey');
  assert.equal(
    r.verdict,
    'MIS-CITED',
    'a claimed DOI that redirects to a retracted canonical must be blocked (#16)',
  );
});