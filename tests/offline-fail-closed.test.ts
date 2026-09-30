// tests/offline-fail-closed.test.ts — RUN-03 / D-17-06 / D-17-07: offline
// fixture lookups fail CLOSED.
//
// Offline (here: the test runner; PENSMITH_OFFLINE=1 for the spawned CLI) every
// source, registrar, detector and plagiarism request is answered by an EXACT
// recorded fixture or refused with a typed OfflineEgressError. There is no
// "first search item / first cassette entry" fallback anywhere, so:
//   - an unrecorded identifier is a miss, never another paper's record;
//   - Pass 1 records a miss as UNVERIFIABLE-NETWORK (offline: no answer,
//     D-20-03) — never OK, MIS-CITED or FABRICATED — and it BLOCKS compile and
//     done with "re-run online";
//   - add refuses (non-zero exit) and adds nothing;
//   - research on an unrecorded query yields 0 candidates with a notice;
//   - plagiarism is "skipped (offline)" and honesty "score unavailable (offline)".
// A `Status: unverifiable` section with ZERO verdict rows still compiles
// (Pitfall 3) until VRFY-24.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Deterministic LLM stubs for the in-process orchestrator (the network mode is
// the test runner's; NO_LLM is orthogonal to it, S-15).
process.env['PENSMITH_NO_LLM'] = '1';
delete process.env['PENSMITH_NETWORK_TESTS'];

const { isOfflineEgressError, OfflineEgressError } = await import('../bin/lib/http.js');
const { networkMode } = await import('../bin/lib/http-mock.js');
const { sources } = await import('../bin/lib/sources/index.js');
const { runPass1, UNVERIFIABLE_OFFLINE_REASON } = await import('../bin/lib/verify/pass1.js');
const { renderPass1VerdictRow } = await import('../bin/lib/verify/verdict-rows.js');
const { runCompile } = await import('../bin/lib/compile.js');
const { runExportBlockingGate, recomputeExportGate, doneSections } = await import('../bin/cli/done.js');
const { computeDraftHash } = await import('../bin/lib/draft-hash.js');
const { runPlagiarism } = await import('../bin/lib/plagiarism.js');
const { scoreHonestyWithOptions } = await import('../bin/lib/honesty.js');
const { runResearchPassWithLog } = await import('./helpers/research-pass.js');

const PENSMITH_TS = fileURLToPath(new URL('../bin/pensmith.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');

const UNRECORDED_DOI = '10.9999/not-recorded';
const ALPHAFOLD_DOI = '10.1038/s41586-021-03819-2';

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function captureStreams<T>(fn: () => Promise<T>): Promise<{ value: T; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  // Tee, never swallow: the node:test child reports results on stdout, and a
  // swallowed report line makes earlier tests silently vanish from the run.
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => { out.push(String(s)); return o(s); };
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => { err.push(String(s)); return e(s); };
  try {
    return { value: await fn(), out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as unknown as { write: typeof o }).write = o;
    (process.stderr as unknown as { write: typeof e }).write = e;
  }
}

test('RUN-03: the test runner is a sources-offline mode with fixtures available', () => {
  const mode = networkMode();
  assert.equal(mode.sourcesOffline, true);
  assert.equal(mode.reason, 'test runner');
  assert.equal(mode.fixturesAvailable, true, 'a source checkout has tests/fixtures/cassettes');
});

// ---------------------------------------------------------------------------
// Adapters: an unrecorded identifier is a miss — never another paper's record.
// ---------------------------------------------------------------------------

test('RUN-03: fetchById on an unrecorded identifier throws OfflineEgressError in every adapter (no fallback)', async (t) => {
  const cases: Array<[string, (id: string) => Promise<unknown>, string]> = [
    ['crossref', sources.crossref.fetchById, UNRECORDED_DOI],
    ['unpaywall', sources.unpaywall.fetchById, UNRECORDED_DOI],
    ['retraction-watch', sources['retraction-watch'].fetchById, UNRECORDED_DOI],
    ['openalex', sources.openalex.fetchById, `https://doi.org/${UNRECORDED_DOI}`],
    ['semanticscholar', sources.semanticscholar.fetchById, `DOI:${UNRECORDED_DOI}`],
    ['arxiv', sources.arxiv.fetchById, '2999.99999'],
    ['pubmed', sources.pubmed.fetchById, '99999999'],
    ['books', sources.books.fetchById, 'isbn:9791000000008'],
  ];
  // Unpaywall refuses to run without a contact email (D-19-12, "Unpaywall
  // skipped") before any request; with one, its miss is the offline refusal.
  const savedEmail = process.env['PENSMITH_CONTACT_EMAIL'];
  process.env['PENSMITH_CONTACT_EMAIL'] = 'pensmith-dev@example.org';
  t.after(() => {
    if (savedEmail === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
    else process.env['PENSMITH_CONTACT_EMAIL'] = savedEmail;
  });
  for (const [name, fetchById, id] of cases) {
    await assert.rejects(
      fetchById(id),
      (err: unknown) => {
        assert.ok(isOfflineEgressError(err), `${name}: a miss is a typed OfflineEgressError, got ${String(err)}`);
        assert.ok(err instanceof OfflineEgressError);
        assert.equal(err.mode, 'offline', `${name}: the miss names the mode`);
        return true;
      },
      `${name}.fetchById(${id}) must fail closed`,
    );
  }
});

test('RUN-03: a recorded fixture replays ONLY for its own identifier', async () => {
  const hit = await sources.crossref.fetchById('10.1038/nphys1170');
  assert.ok(hit, 'the recorded Crossref work replays');
  assert.equal(hit.doi, '10.1038/nphys1170');
  assert.equal(hit.title, 'Measured measurement');
  // The same record is never returned for another DOI.
  await assert.rejects(sources.crossref.fetchById('10.1038/nphys1171'), (e: unknown) => isOfflineEgressError(e));
  // Unpaywall replays its own record (the current shape parses since SRC-03) —
  // never a record for another DOI. It needs the contact email (D-19-12).
  const savedEmail = process.env['PENSMITH_CONTACT_EMAIL'];
  process.env['PENSMITH_CONTACT_EMAIL'] = 'pensmith-dev@example.org';
  try {
    const up = await sources.unpaywall.fetchById('10.1038/nphys1170');
    assert.equal(up?.doi, '10.1038/nphys1170');
  } finally {
    if (savedEmail === undefined) delete process.env['PENSMITH_CONTACT_EMAIL'];
    else process.env['PENSMITH_CONTACT_EMAIL'] = savedEmail;
  }
  const ax = await sources.arxiv.fetchById('1706.03762');
  assert.ok(ax === null || ax.id.includes('1706.03762'), `arXiv replays its own id, got ${ax?.id}`);
});

test('RUN-03: search on an unrecorded query is a miss in every searchable adapter (never the recorded papers)', async () => {
  for (const name of ['crossref', 'openalex', 'arxiv', 'pubmed', 'semanticscholar'] as const) {
    await assert.rejects(
      sources[name].search('medieval Icelandic sagas', { limit: 10 }),
      (e: unknown) => isOfflineEgressError(e),
      `${name}.search must fail closed on an unrecorded query`,
    );
  }
});

test('RUN-03: offline research on an unrecorded query yields 0 candidates with the notice', async () => {
  const root = tmp('pensmith-offline-research-');
  mkdirSync(join(root, '.paper'), { recursive: true });
  const { value, err } = await captureStreams(() =>
    runResearchPassWithLog(['medieval Icelandic sagas'], {
      topic: 'medieval Icelandic sagas', discipline: 'history', paperRoot: root,
    }),
  );
  assert.deepEqual(value, [], 'no candidates — never the attention/BERT fixture papers');
  assert.match(err, /offline: no recorded results for this query/);
  const log = readFileSync(join(root, '.paper', 'RESEARCH.md'), 'utf8');
  assert.match(log, /^> OFFLINE MODE \(test runner\)/m, 'RESEARCH.md carries the offline marker');
});

// ---------------------------------------------------------------------------
// Pass 1: a miss is UNVERIFIABLE-NETWORK (offline) — never OK, MIS-CITED or FABRICATED.
// ---------------------------------------------------------------------------

function bibFile(entries: Array<{ key: string; doi: string; title: string; author: string; year: number }>): string {
  const dir = tmp('pensmith-offline-bib-');
  const p = join(dir, 'CITATIONS.bib');
  writeFileSync(
    p,
    entries.map((e) => `@article{${e.key},\n  title = {${e.title}},\n  author = {${e.author}},\n  doi = {${e.doi}},\n  year = {${e.year}}\n}\n`).join('\n'),
  );
  return p;
}

test('RUN-03 / D-17-07 / D-20-03: offline Pass 1 of an unrecorded DOI (AlphaFold) is UNVERIFIABLE-NETWORK, never MIS-CITED against nphys1170', async () => {
  const bib = bibFile([{
    key: 'jumper2021', doi: ALPHAFOLD_DOI,
    title: 'Highly accurate protein structure prediction with AlphaFold', author: 'Jumper, John', year: 2021,
  }]);
  const [r] = await runPass1('AlphaFold changed structural biology [@jumper2021].\n', bib);
  assert.ok(r);
  assert.equal(r.verdict, 'UNVERIFIABLE-NETWORK');
  assert.ok(r.reason.startsWith(UNVERIFIABLE_OFFLINE_REASON), r.reason);
  assert.ok(!/nphys1170/.test(r.reason));
});

test('RUN-03: a made-up DOI carrying a recorded paper\'s title and authors is no longer OK', async () => {
  const bib = bibFile([{
    key: 'fake2009', doi: '10.9999/made-up-measured', title: 'Measured measurement', author: 'Aspelmeyer, Markus', year: 2009,
  }]);
  const [r] = await runPass1('A claim [@fake2009].\n', bib);
  assert.equal(r?.verdict, 'UNVERIFIABLE-NETWORK', 'no recorded fixture for the made-up DOI → no answer (unverifiable), not OK');
});

test('RUN-03: the recorded fixture is still evidence — correct metadata OK, wrong title MIS-CITED', async () => {
  const bib = bibFile([
    { key: 'aspelmeyer2009', doi: '10.1038/nphys1170', title: 'Measured measurement', author: 'Aspelmeyer, Markus', year: 2009 },
    { key: 'wrong2009', doi: '10.1038/nphys1170', title: 'Deep residual learning for image recognition', author: 'He, Kaiming', year: 2009 },
  ]);
  const results = await runPass1('One [@aspelmeyer2009]. Two [@wrong2009].\n', bib);
  const by = new Map(results.map((r) => [r.citekey, r]));
  assert.equal(by.get('aspelmeyer2009')?.verdict, 'OK', by.get('aspelmeyer2009')?.reason);
  assert.equal(by.get('wrong2009')?.verdict, 'MIS-CITED', by.get('wrong2009')?.reason);
});

// ---------------------------------------------------------------------------
// compile refuse-gate and done re-check: UNVERIFIABLE blocks with "re-run
// online"; a zero-row `Status: unverifiable` section passes (Pitfall 3).
// ---------------------------------------------------------------------------

/**
 * A compiled-paper fixture whose files agree with its VERIFICATION.md, since
 * compile and done recompute the gate from the draft (D-20-23/25): `cites`
 * → the draft cites jumper2021 (an unrecorded DOI: UNVERIFIABLE offline),
 * assigned and in the bib; otherwise a citation-free draft over an empty bib
 * (the zero-row case).
 */
function seedCompiledPaper(verification: string, cites = true): string {
  const root = tmp('pensmith-offline-compile-');
  const pDir = join(root, '.paper');
  const secDir = join(pDir, 'sections', '01-intro');
  mkdirSync(secDir, { recursive: true });
  const assigned = cites ? ['jumper2021'] : [];
  writeFileSync(join(pDir, 'STATE.json'), JSON.stringify({ $schemaVersion: 3, paperId: 'offline', createdAt: '2026-01-01T00:00:00.000Z', sections: [{ n: 1, slug: 'intro' }] }));
  writeFileSync(
    join(pDir, 'CITATIONS.bib'),
    cites ? `@article{jumper2021,\n  title = {Highly accurate protein structure prediction with AlphaFold},\n  author = {Jumper, John},\n  doi = {${ALPHAFOLD_DOI}},\n  year = {2021}\n}\n` : '',
  );
  writeFileSync(
    join(pDir, 'OUTLINE.md'),
    ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', `| 1 | intro | Introduction | | 300 | ${assigned.join(', ')} |`, ''].join('\n'),
  );
  const draft = cites ? '# Introduction\n\nAlphaFold changed structural biology [@jumper2021].\n' : '# Introduction\n\nAlphaFold changed structural biology.\n';
  writeFileSync(join(secDir, 'DRAFT.md'), draft);
  const hash = computeDraftHash(Buffer.from(draft, 'utf8'), assigned);
  writeFileSync(
    join(secDir, 'PLAN.md'),
    ['---', 'section: 1', 'slug: intro', 'title: Introduction', 'depends_on: []', `assigned_sources: [${assigned.join(', ')}]`, `verified_against_draft_hash: '${hash}'`, 'status: unverifiable', '---', '', '# Introduction', ''].join('\n'),
  );
  writeFileSync(join(secDir, 'VERIFICATION.md'), verification);
  return root;
}

const UNVERIFIABLE_VERIFICATION = [
  '> OFFLINE MODE (test runner) — recorded fixtures, not live results.',
  '',
  '# VERIFICATION (Section 1, intro)',
  '',
  'Status: unverifiable',
  '',
  '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)',
  '',
  renderPass1VerdictRow('jumper2021', 'UNVERIFIABLE-NETWORK', 0, 0, UNVERIFIABLE_OFFLINE_REASON),
  '',
].join('\n');

// The short-circuit body verify writes offline (RUN-02: it carries the marker too).
const ZERO_ROW_UNVERIFIABLE = [
  '> OFFLINE MODE (test runner) — recorded fixtures, not live results.',
  '',
  '# VERIFICATION (Section 1, intro)',
  '',
  'Status: unverifiable',
  'Reason: CITATIONS.bib is empty and DRAFT.md has no [@citekey] references — nothing to verify.',
  '',
].join('\n');

test('RUN-03 / D-17-07, VRFY-12: the compile refuse-gate blocks an offline (UNVERIFIABLE-NETWORK) row with "re-run online"', async () => {
  const root = seedCompiledPaper(UNVERIFIABLE_VERIFICATION);
  const res = await runCompile({ paperRoot: root, yolo: true, onWarn: () => {} });
  assert.equal(res.refused, true, 'compile must refuse');
  assert.ok(
    (res.refuseReasons ?? []).some((r) => /\[@jumper2021\] is UNVERIFIABLE-NETWORK .*re-run online/.test(r)),
    `refusal names the row and "re-run online": ${JSON.stringify(res.refuseReasons)}`,
  );
  assert.ok(!existsSync(join(root, '.paper', 'DRAFT.md')), 'no compiled DRAFT.md is written');
});

test('Pitfall 3: a `Status: unverifiable` section with ZERO verdict rows still compiles', async () => {
  const root = seedCompiledPaper(ZERO_ROW_UNVERIFIABLE, false);
  const res = await runCompile({ paperRoot: root, yolo: true, onWarn: () => {} });
  assert.equal(res.refused, false, `zero-row unverifiable passes: ${JSON.stringify(res.refuseReasons)}`);
});

test('RUN-03 / D-17-07, VRFY-12: the done re-check blocks an offline (UNVERIFIABLE-NETWORK) row with "re-run online"; zero-row unverifiable passes', async () => {
  // done recomputes the verdicts over the text it exports (D-20-25).
  const blockedRoot = seedCompiledPaper(UNVERIFIABLE_VERIFICATION);
  const text = readFileSync(join(blockedRoot, '.paper', 'sections', '01-intro', 'DRAFT.md'), 'utf8');
  const blocked = await recomputeExportGate(blockedRoot, text, { sections: doneSections(blockedRoot) });
  assert.ok(blocked.refusals.some((r) => /\[@jumper2021\] is UNVERIFIABLE-NETWORK .*re-run online/.test(r)), JSON.stringify(blocked.refusals));
  const cleanRoot = seedCompiledPaper(ZERO_ROW_UNVERIFIABLE, false);
  const clean = runExportBlockingGate(cleanRoot);
  assert.equal(clean.blocked, false, JSON.stringify(clean.reasons));
  const cleanGate = await recomputeExportGate(cleanRoot, readFileSync(join(cleanRoot, '.paper', 'sections', '01-intro', 'DRAFT.md'), 'utf8'), { sections: doneSections(cleanRoot) });
  assert.deepEqual(cleanGate.refusals, []);
});

// ---------------------------------------------------------------------------
// The CLI: `verify` is unverifiable + blocked (exit 4); `add` refuses (exit 1).
// ---------------------------------------------------------------------------

function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const data = tmp('pensmith-offline-data-');
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, {
    XDG_DATA_HOME: data, LOCALAPPDATA: data, PENSMITH_OFFLINE: '1', PENSMITH_NO_LLM: '1',
  });
  const r = spawnSync(process.execPath, ['--import', TSX_LOADER, PENSMITH_TS, ...args], {
    cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('RUN-03: offline `verify` of a section citing an unrecorded DOI → unverifiable, exit 4, marker line, compile refuses', () => {
  const root = tmp('pensmith-offline-verify-');
  const pDir = join(root, '.paper');
  const secDir = join(pDir, 'sections', '01-intro');
  mkdirSync(secDir, { recursive: true });
  writeFileSync(join(root, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'offline', createdAt: new Date().toISOString(), sections: [{ n: 1, slug: 'intro' }] }));
  writeFileSync(join(pDir, 'OUTLINE.md'), ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', '| 1 | intro | Introduction | | 300 | jumper2021 |', ''].join('\n'));
  writeFileSync(join(pDir, 'CITATIONS.bib'), `@article{jumper2021,\n  title = {Highly accurate protein structure prediction with AlphaFold},\n  author = {Jumper, John},\n  doi = {${ALPHAFOLD_DOI}},\n  year = {2021}\n}\n`);
  writeFileSync(join(secDir, 'PLAN.md'), ['---', 'section: 1', 'slug: intro', 'title: Introduction', 'depends_on: []', 'assigned_sources: [jumper2021]', 'status: written', '---', ''].join('\n'));
  writeFileSync(join(secDir, 'DRAFT.md'), '# Introduction\n\nAlphaFold changed structural biology [@jumper2021].\n');

  const v = runCli(['verify', '1', '--slug', 'intro', '--yolo'], root);
  assert.equal(v.status, 4, `verify exits EXIT_BLOCKED (4); stderr=${v.stderr}`);
  const md = readFileSync(join(secDir, 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^> OFFLINE MODE \(PENSMITH_OFFLINE=1\) — recorded fixtures, not live results\.$/m);
  assert.match(md, /^Status: unverifiable$/m);
  assert.match(md, /- jumper2021: \*\*UNVERIFIABLE-NETWORK\*\* .*offline: no recorded fixture — re-run online/);
  assert.ok(!/\*\*(MIS-CITED|FABRICATED|OK)\*\*/.test(md), 'never OK, MIS-CITED or FABRICATED');
  assert.match(readFileSync(join(secDir, 'PLAN.md'), 'utf8'), /status: unverifiable/);

  // compile refuses (its exit code is RUN-09's, paper-cli): the refusal names
  // the row and "re-run online", and no compiled DRAFT.md is written.
  const c = runCli(['compile', '--yolo'], root);
  assert.match(c.stderr + c.stdout, /REFUSE: section 1 \(intro\): citation \[@jumper2021\] is UNVERIFIABLE-NETWORK .*re-run online/);
  assert.ok(!existsSync(join(pDir, 'DRAFT.md')), 'compile writes no DRAFT.md');
});

test('RUN-03: `PENSMITH_OFFLINE=1 add 10.1093/nar/gkab1112` exits non-zero and adds nothing', () => {
  const root = tmp('pensmith-offline-add-');
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, 'STATE.json'), JSON.stringify({ $schemaVersion: 2, paperId: 'offline', createdAt: new Date().toISOString(), sections: [] }));
  const r = runCli(['add', '10.1093/nar/gkab1112', '--yolo'], root);
  assert.notEqual(r.status, 0, `add must refuse; stdout=${r.stdout} stderr=${r.stderr}`);
  assert.match(r.stderr, /DOI verification unavailable \(offline\) — 10\.1093\/nar\/gkab1112 NOT added; re-run online/);
  const bib = join(root, '.paper', 'CITATIONS.bib');
  assert.ok(!existsSync(bib) || !readFileSync(bib, 'utf8').includes('gkab1112'), 'nothing is added');
});

// ---------------------------------------------------------------------------
// Plagiarism and honesty: offline sends nothing and replays nothing canned.
// ---------------------------------------------------------------------------

test('RUN-03: offline plagiarism on nonsense text gives 0 matches ("skipped (offline)")', async () => {
  const { value } = await captureStreams(() =>
    runPlagiarism('Zorblax quintessential frumious bandersnatch gyred gimbling in the wabe outgrabe mimsy borogoves.'),
  );
  assert.ok(value.length > 0);
  for (const r of value) {
    assert.deepEqual(r.matches, []);
    assert.equal(r.skipped, 'offline');
  }
});

test('RUN-03: offline honesty with GPTZERO_API_KEY set reports "score unavailable (offline)", never a number', async () => {
  const saved = process.env['GPTZERO_API_KEY'];
  process.env['GPTZERO_API_KEY'] = 'gz-sentinel-offline-fail-closed';
  try {
    const { value, out, err } = await captureStreams(() =>
      scoreHonestyWithOptions('Some paper text that would be scored.', { yolo: true }),
    );
    assert.equal(value, null, 'no score offline');
    assert.match(out, /GPTZero honesty score unavailable \(offline\) — no text was sent\./);
    assert.ok(!/\d+(\.\d+)?%/.test(out + err), 'no percentage is ever printed offline');
    assert.ok(!(out + err).includes('gz-sentinel-offline-fail-closed'));
  } finally {
    if (saved === undefined) delete process.env['GPTZERO_API_KEY'];
    else process.env['GPTZERO_API_KEY'] = saved;
  }
});
