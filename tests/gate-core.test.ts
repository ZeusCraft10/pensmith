// tests/gate-core.test.ts — the ONE gate core (bin/lib/verify/gate.ts, D-20-05).
//
// verify, compile and done call recomputeGate over one text; these cases pin
// what it computes from the text alone:
//   - Pass 1 over the cited keys with the bibliography parsed entry by entry
//     (VRFY-16): a key whose entry does not parse is UNPARSEABLE naming the key
//     and the line; a key in a missing or empty bib is FABRICATED (no stack);
//   - UNASSIGNED next to the key's registrar row (VRFY-17), with the remedy;
//   - NO-CITATIONS / PLACEHOLDER draft rows (VRFY-24);
//   - text findings keyed `L<line>` (the scanners, VRFY-09 / VRFY-10);
//   - the quote-acceptance lift ONLY for a recomputed UNVERIFIABLE-QUOTE with
//     the same citekey, quote hash and current draft hash (VRFY-20, D-20-22);
//   - checkedAt from passing rows only (VRFY-28);
//   - the recheck selection with the test clock (D-20-27).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recomputeGate,
  gateRefusals,
  gateRowReason,
  hasStubMarker,
  stripStubMarker,
  recheckKeys,
  loadBibliography,
  rowBlocks,
  STUB_DRAFT_MARKER,
  type GateInput,
  type AcceptanceSet,
  type GateRow,
} from '../bin/lib/verify/gate.js';
import { quoteTextSha256 } from '../bin/lib/verify/verdicts.js';
import type { Pass1Result } from '../bin/lib/verify/pass1.js';
import type { Pass3Result } from '../bin/lib/verify/pass3.js';
import { needsRecheck, verificationNow, TEST_NOW_ENV } from '../bin/lib/verify/clock.js';
import { upsertSources } from '../bin/lib/library.js';
import type { SourceCandidate } from '../bin/lib/schemas/source-candidate.js';

/** A row's key slot ('' for a draft check). */
function keyOf(r: GateRow): string {
  return r.kind === 'draft' ? '' : r.key;
}

function paper(bib: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-gate-core-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  if (bib !== null) writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  return root;
}

const GOOD = '@article{lecun2015,\n  title = {Deep learning},\n  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},\n  journal = {Nature},\n  year = {2015},\n  doi = {10.1038/nature14539}\n}\n';

/** A Pass 1 stand-in: every cited key OK with a checkedAt, except the ones listed. */
function fakePass1(verdicts: Record<string, Pass1Result['verdict']> = {}, checkedAt = '2026-09-01T00:00:00.000Z') {
  return async (text: string): Promise<Pass1Result[]> => {
    const { extractCitedKeysForVerification } = await import('../bin/lib/citation-token.js');
    return extractCitedKeysForVerification(text).map((k) => ({
      citekey: k,
      verdict: verdicts[k] ?? 'OK',
      titleJW: 1,
      authorJW: 1,
      reason: 'stand-in',
      checkedAt,
    }));
  };
}

function fakePass3(rows: Array<Omit<Partial<Pass3Result>, 'verdict'> & { citekey: string; verdict: string; quote: string }>) {
  return async (): Promise<Pass3Result[]> =>
    rows.map((r, i) => ({
      citekey: r.citekey,
      id: r.id ?? `q${i + 1}`,
      quoteSha256: quoteTextSha256(r.quote),
      quoteSnippet: r.quote.slice(0, 40),
      verdict: r.verdict as Pass3Result['verdict'],
      levRatio: r.levRatio ?? 0,
      reason: r.reason ?? 'stand-in',
      ...(r.localFile !== undefined ? { localFile: r.localFile } : {}),
    }));
}

function input(root: string, text: string, over: Partial<GateInput> = {}): GateInput {
  return { root, text, allowedKeys: new Set(['lecun2015']), scope: { kind: 'section', id: '1' }, dryRun: false, ...over };
}

test('gate core: a cited key whose bib entry does not parse is UNPARSEABLE naming the key and line; the good entry is checked (VRFY-16)', async () => {
  const root = paper(`${GOOD}\n@article{broken2020,\n  title = A {broken value,\n  author = {X, Y}\n}\n`);
  const r = await recomputeGate(input(root, 'Deep [@lecun2015] and [@broken2020].\n', { allowedKeys: new Set(['lecun2015', 'broken2020']) }));
  const rows = r.rows.filter((x) => x.kind === 'pass1');
  assert.deepEqual(rows.map((x) => `${x.key}:${x.verdict}`), ['lecun2015:OK', 'broken2020:UNPARSEABLE']);
  const bad = rows[1]!;
  assert.match(bad.reason, /CITATIONS\.bib entry \(line 9\) does not parse/);
  assert.equal(r.outcome.status, 'failed');
  assert.ok(r.outcome.blocked);
  assert.deepEqual(r.bib.problems.map((p) => [p.key, p.line]), [['broken2020', 9]]);
});

test('gate core: a missing or empty bibliography makes every cited key FABRICATED with the reason — never a stack (VRFY-16)', async () => {
  for (const [bib, why] of [[null, /CITATIONS\.bib is missing/], ['', /CITATIONS\.bib has no entries/]] as const) {
    const root = paper(bib);
    const r = await recomputeGate(input(root, 'A claim [@a].\n', { allowedKeys: new Set(['a']) }));
    assert.deepEqual(r.rows.map((x) => `${x.kind}:${keyOf(x)}:${x.verdict}`), ['pass1:a:FABRICATED']);
    assert.match((r.rows[0] as { reason: string }).reason, why);
    assert.equal(r.outcome.status, 'failed');
  }
});

test('gate core: UNASSIGNED is its own row right after the key\'s registrar row, naming plan --revise and add --remap (VRFY-17)', async () => {
  const root = paper(GOOD);
  const r = await recomputeGate(input(root, 'Deep learning [@lecun2015].\n', { allowedKeys: new Set(['other2020']), deps: { runPass1: fakePass1(), runPass3: fakePass3([]) } }));
  assert.deepEqual(r.rows.map((x) => `${keyOf(x)}:${x.verdict}`), ['lecun2015:OK', 'lecun2015:UNASSIGNED']);
  const reason = gateRowReason(r.rows[1]!, { kind: 'section', id: '1' });
  assert.match(reason, /\[@lecun2015\] is UNASSIGNED — not in section 1's assigned_sources — .*`pensmith plan 1 --revise`.*`pensmith add --remap lecun2015 --section 1`/);
  assert.equal(r.outcome.status, 'failed');
  // At done the allowed set is the union of every section's sources: the paper wording.
  const paperScope = await recomputeGate(input(root, 'Deep learning [@lecun2015].\n', { scope: { kind: 'paper' }, allowedKeys: new Set(), deps: { runPass1: fakePass1(), runPass3: fakePass3([]) } }));
  assert.match(gateRefusals(paperScope, { kind: 'paper' }).join('\n'), /UNASSIGNED — not in the assigned_sources of any section of the paper/);
});

test('gate core: NO-CITATIONS when sources are assigned and nothing is cited; an introduction with none assigned verifies (VRFY-24)', async () => {
  const root = paper(GOOD);
  const deps = { runPass1: fakePass1(), runPass3: fakePass3([]) };
  const none = await recomputeGate(input(root, 'A paragraph with no citation at all.\n', { allowedKeys: new Set(['a', 'b']), deps }));
  assert.deepEqual(none.rows.map((x) => `${x.kind}:${x.verdict}`), ['draft:NO-CITATIONS']);
  assert.match((none.rows[0] as { reason: string }).reason, /^no citations; 2 sources assigned$/);
  assert.equal(none.outcome.status, 'failed');
  const intro = await recomputeGate(input(root, 'A paragraph with no citation at all.\n', { allowedKeys: new Set(), deps }));
  assert.deepEqual(intro.rows, []);
  assert.deepEqual(intro.outcome, { status: 'verified', blocked: false });
});

test('gate core: the stub-draft marker is PLACEHOLDER (unverifiable, blocking) outside --dry-run only; the dry-run compile strips it (VRFY-24)', async () => {
  const root = paper(GOOD);
  const deps = { runPass1: fakePass1(), runPass3: fakePass3([]) };
  const stub = `${STUB_DRAFT_MARKER}\n\n# Intro\n\nStub prose [@lecun2015].\n`;
  assert.ok(hasStubMarker(stub));
  assert.ok(hasStubMarker(stub.replace(/\n/g, '\r\n')), 'CRLF');
  const real = await recomputeGate(input(root, stub, { deps }));
  assert.deepEqual(real.rows.filter((x) => x.kind === 'draft').map((x) => x.verdict), ['PLACEHOLDER']);
  assert.deepEqual(real.outcome, { status: 'unverifiable', blocked: true });
  assert.match(gateRefusals(real, { kind: 'section', id: '1' }).join('\n'), /PLACEHOLDER — .*no model configured.* `pensmith write 1`/);
  const dry = await recomputeGate(input(root, stub, { dryRun: true, deps }));
  assert.deepEqual(dry.outcome, { status: 'verified', blocked: false });
  assert.equal(stripStubMarker(stub), '# Intro\n\nStub prose [@lecun2015].\n');
  assert.equal(stripStubMarker(stub.replace(/\n/g, '\r\n')), '# Intro\r\n\r\nStub prose [@lecun2015].\r\n');
  assert.ok(!hasStubMarker(`Prose quoting ${STUB_DRAFT_MARKER} inline is not the marker line.\n`));
});

test('gate core: scanner findings become rows keyed L<line> and block (VRFY-09 / VRFY-10 plumbing)', async () => {
  const root = paper(GOOD);
  const r = await recomputeGate(
    input(root, 'Line one [@lecun2015].\nAs shown (Nguyen & Patel, 2019).\n', {
      deps: { runPass1: fakePass1(), runPass3: fakePass3([]) },
      scanners: [(md) => (md.includes('(Nguyen') ? [{ verdict: 'UNSUPPORTED-FORM', form: 'author-date', text: '(Nguyen & Patel, 2019)', line: 2, reason: 'author-date prose the verifier cannot check — cite it as [@key]' }] : [])],
    }),
  );
  const text = r.rows.find((x) => x.kind === 'text');
  assert.ok(text && text.key === 'L2' && text.verdict === 'UNSUPPORTED-FORM');
  assert.equal(r.outcome.status, 'failed');
  assert.match(gateRefusals(r, { kind: 'section', id: '1' })[0] ?? '', /^line 2: UNSUPPORTED-FORM `\(Nguyen & Patel, 2019\)` — author-date prose/);
});

test('gate core: an acceptance lifts ONLY a recomputed UNVERIFIABLE-QUOTE with the same citekey, quote and current draft hash (VRFY-20, S-17)', async () => {
  const root = paper(GOOD);
  const quote = 'attention mechanisms are nothing more than lookup tables for bananas';
  const draftHash = 'a'.repeat(64);
  const acceptance = { quote_id: 'q1', citekey: 'lecun2015', quote_sha256: quoteTextSha256(quote), excerpt: quote.slice(0, 40), draft_sha256: draftHash, accepted_at: '2026-09-30T10:00:00.000Z', via: 'flag' as const };
  const run = async (verdict: string, sets: AcceptanceSet[], citekey = 'lecun2015', q = quote) =>
    recomputeGate(input(root, `As they write, "${q}" [@lecun2015].\n`, { acceptanceSets: sets, deps: { runPass1: fakePass1(), runPass3: fakePass3([{ citekey, verdict, quote: q }]) } }));

  const lifted = await run('UNVERIFIABLE-QUOTE', [{ currentDraftHash: draftHash, acceptances: [acceptance], section: '1' }]);
  const row = lifted.rows.find((x) => x.kind === 'pass3');
  assert.ok(row && row.kind === 'pass3' && row.accepted?.at === '2026-09-30T10:00:00.000Z');
  assert.equal(rowBlocks(row), false);
  assert.deepEqual(lifted.outcome, { status: 'verified', blocked: false });
  assert.deepEqual(lifted.accepted.map((a) => [a.id, a.citekey, a.section]), [['q1', 'lecun2015', '1']]);

  // Unaccepted, it blocks with the three remedies.
  const open = await run('UNVERIFIABLE-QUOTE', []);
  assert.deepEqual(open.outcome, { status: 'unverifiable', blocked: true });
  assert.match(gateRefusals(open, { kind: 'section', id: '1' })[0] ?? '', /`pensmith add <pdf>`.*`pensmith plan 1 --revise`.*`pensmith verify 1 --accept-quote q1`/);
  // At paper scope the paper-wide id is not the section's: the remedy names the quote's own section and id.
  const paperWide = gateRefusals(open, { kind: 'paper', quoteSections: new Map([[quoteTextSha256(quote), { section: '2', id: 'q3' }]]) })[0] ?? '';
  assert.match(paperWide, /^quote q1 \(§2's q3\) /);
  assert.match(paperWide, /`pensmith plan 2 --revise`.*`pensmith verify 2 --accept-quote q3`/);
  assert.doesNotMatch(paperWide, /<N>|--accept-quote q1/);
  // A quote in no section draft (added after compile) has nothing to accept it in.
  assert.match(gateRefusals(open, { kind: 'paper' })[0] ?? '', /it is in no section draft: remove it/);
  // A changed draft (hash) voids it.
  assert.equal((await run('UNVERIFIABLE-QUOTE', [{ currentDraftHash: 'b'.repeat(64), acceptances: [acceptance] }])).outcome.blocked, true);
  // Another quote (text hash) or another source is never covered.
  assert.equal((await run('UNVERIFIABLE-QUOTE', [{ currentDraftHash: draftHash, acceptances: [acceptance] }], 'lecun2015', `${quote} indeed`)).outcome.blocked, true);
  assert.equal((await run('UNVERIFIABLE-QUOTE', [{ currentDraftHash: draftHash, acceptances: [{ ...acceptance, citekey: 'other2020' }] }])).outcome.blocked, true);
  // A hand-written acceptance for a quote the recomputation finds NOT_FOUND (or anything else) lifts nothing.
  for (const verdict of ['NOT_FOUND', 'UNVERIFIABLE-NETWORK', 'UNATTRIBUTED']) {
    const r = await run(verdict, [{ currentDraftHash: draftHash, acceptances: [acceptance] }]);
    assert.equal(r.outcome.blocked, true, verdict);
    assert.deepEqual(r.accepted, [], verdict);
  }
});

test('gate core: checkedAt is collected from passing registrar rows only; quotes verified against a local file are listed (VRFY-28, VRFY-19)', async () => {
  const root = paper(GOOD);
  const r = await recomputeGate(
    input(root, 'One [@lecun2015], two [@ghost2099].\n', {
      allowedKeys: new Set(['lecun2015', 'ghost2099']),
      deps: {
        runPass1: fakePass1({ ghost2099: 'FABRICATED' }, '2026-08-01T00:00:00.000Z'),
        runPass3: fakePass3([{ citekey: 'lecun2015', verdict: 'PASS', quote: 'deep learning allows computational models', localFile: 'sources/lecun2015.pdf' }]),
      },
    }),
  );
  assert.deepEqual(r.checkedAt, { lecun2015: '2026-08-01T00:00:00.000Z' });
  assert.deepEqual(r.byoQuotes.map((q) => [q.citekey, q.localFile]), [['lecun2015', 'sources/lecun2015.pdf']]);
});

test('gate core: loadBibliography reads CRLF and LF alike and reports each broken entry with its line', () => {
  const crlf = paper(`${GOOD}@article{bad,\n  title = {X\n`.replace(/\n/g, '\r\n'));
  const b = loadBibliography(crlf);
  assert.deepEqual(b.entries.map((e) => e['id']), ['lecun2015']);
  assert.deepEqual(b.problems.map((p) => [p.key, p.line]), [['bad', 8]]);
  assert.equal(loadBibliography(paper(null)).exists, false);
});

test('D-20-27 clock: PENSMITH_TEST_NOW moves "now" only under a test context; needsRecheck applies recheck_after_days', () => {
  const prev = process.env[TEST_NOW_ENV];
  try {
    process.env[TEST_NOW_ENV] = '2030-01-31T00:00:00.000Z';
    assert.equal(verificationNow().toISOString(), '2030-01-31T00:00:00.000Z', 'the test runner is a test context');
    process.env[TEST_NOW_ENV] = 'not a time';
    assert.ok(Math.abs(verificationNow().getTime() - Date.now()) < 60_000, 'an unreadable value is ignored');
  } finally {
    if (prev === undefined) delete process.env[TEST_NOW_ENV];
    else process.env[TEST_NOW_ENV] = prev;
  }
  const now = new Date('2030-01-31T00:00:00.000Z');
  assert.equal(needsRecheck(null, 30, now), true, 'never verified');
  assert.equal(needsRecheck('garbage', 30, now), true);
  assert.equal(needsRecheck('2029-12-31T00:00:00.000Z', 30, now), true, '31 days old');
  assert.equal(needsRecheck('2030-01-30T00:00:00.000Z', 30, now), false, '1 day old');
  assert.equal(needsRecheck('2030-01-20T00:00:00.000Z', 7, now), true, 'recheck_after_days = 7');
  assert.equal(needsRecheck('2030-01-20T00:00:00.000Z', 30, now), false);
});

test('VRFY-28: recheckKeys selects the cited keys whose last_verified is null or older than recheck_after_days (config and test clock)', async () => {
  const root = paper(GOOD);
  const cand = (citekey: string, doi: string, last: string | null): SourceCandidate =>
    ({ source: 'crossref', id: doi, doi, title: citekey, authors: ['Doe, Jane'], year: 2020, retracted: false, last_verified: last, citekey, raw: null }) as unknown as SourceCandidate;
  await upsertSources(root, [
    cand('old2020', '10.5555/old', '2030-01-01T00:00:00.000Z'),
    cand('fresh2020', '10.5555/fresh', '2030-01-30T00:00:00.000Z'),
    cand('week2020', '10.5555/week', '2030-01-20T00:00:00.000Z'),
  ], { provenance: 'add' });
  const { tryLoadLibrary } = await import('../bin/lib/library.js');
  const lib = await tryLoadLibrary(root);
  const stamps = new Map((lib?.entries ?? []).map((e) => [e.citekey, e.last_verified]));
  assert.equal(stamps.get('old2020'), '2030-01-01T00:00:00.000Z', 'the fixture library carries the stamps');
  const prev = process.env[TEST_NOW_ENV];
  process.env[TEST_NOW_ENV] = '2030-01-31T12:00:00.000Z';
  try {
    assert.deepEqual([...(await recheckKeys(root, ['old2020', 'fresh2020', 'week2020', 'notinlib']))].sort(), ['old2020']);
    writeFileSync(join(root, '.paper', 'config.toml'), 'schema_version = 2\n\n[verification]\nrecheck_after_days = 7\n');
    assert.deepEqual([...(await recheckKeys(root, ['old2020', 'fresh2020', 'week2020']))].sort(), ['old2020', 'week2020']);
  } finally {
    if (prev === undefined) delete process.env[TEST_NOW_ENV];
    else process.env[TEST_NOW_ENV] = prev;
  }
});

test('VRFY-10 / VRFY-16: a bare identifier\'s row keeps its registrar reason — a missing or empty bibliography rewrites only cited keys\' rows', async () => {
  for (const bib of [null, '']) {
    const root = paper(bib);
    const gate = await recomputeGate({
      root,
      text: 'A claim [@ghost2099]. See also doi:10.9999/x for details.\n',
      allowedKeys: new Set(['ghost2099']),
      scope: { kind: 'section', id: '1' },
      dryRun: false,
    });
    const byKey = new Map(gate.rows.filter((r) => r.kind === 'pass1').map((r) => [r.key, r] as const));
    const bare = byKey.get('doi:10.9999/x');
    assert.equal(bare?.kind === 'pass1' ? bare.verdict : null, 'FABRICATED');
    assert.match(bare?.kind === 'pass1' ? bare.reason : '', /^bare identifier in the text \(line 1\): DOI 10\.9999\/x did not resolve via Crossref/, 'the registrar\'s answer, not the bibliography\'s state');
    const cited = byKey.get('ghost2099');
    assert.match(cited?.kind === 'pass1' ? cited.reason : '', /CITATIONS\.bib (is missing|has no entries)/, 'the cited key names the bibliography');
  }
});
