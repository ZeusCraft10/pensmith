// tests/verdicts.test.ts — the Phase 20 seam S-C contract (D-20-01..03):
// one verdict vocabulary, one section-status rule, and the readers routed
// through it. With the labels verify wrote before Phase 20 every reader must
// behave exactly as it did; a label a Phase 20 stream adds must block (or
// pass) everywhere at once.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PASS1_VERDICTS,
  PASS3_VERDICTS,
  DRAFT_VERDICTS,
  PASSING_VERDICTS,
  FAILING_VERDICTS,
  UNVERIFIABLE_VERDICTS,
  BLOCKING_VERDICTS,
  ACCEPTABLE_QUOTE_VERDICT,
  RETRY_ONLINE_VERDICTS,
  LEGACY_UNAVAILABLE_VERDICTS,
  PASS2_TABLE_HEADER,
  PASS2_TABLE_HEADER_V1,
  QUOTE_ID_RE,
  blocksCompile,
  sectionOutcome,
  quoteTextSha256,
  quoteId,
} from '../bin/lib/verify/verdicts.js';
import { BLOCKING_VERDICTS as ROWS_BLOCKING, blockingRowReason, parseBlockingVerdictRows, renderPass1VerdictRow } from '../bin/lib/verify/verdict-rows.js';
import { renderQuoteRow } from '../bin/lib/verify/verification-md.js';
import { readUnsupportedClaims, type DoneSection } from '../bin/cli/done.js';

test('seam S-C: every verdict of every pass is exactly one of passing, failing or unverifiable', () => {
  const all = [...PASS1_VERDICTS, ...PASS3_VERDICTS, ...DRAFT_VERDICTS];
  for (const v of all) {
    const classes = [PASSING_VERDICTS.has(v), FAILING_VERDICTS.has(v), UNVERIFIABLE_VERDICTS.has(v)].filter(Boolean).length;
    assert.equal(classes, 1, `${v} is in exactly one class`);
  }
  for (const v of [...FAILING_VERDICTS, ...UNVERIFIABLE_VERDICTS]) assert.ok(BLOCKING_VERDICTS.has(v), `${v} blocks`);
  for (const v of PASSING_VERDICTS) assert.ok(!BLOCKING_VERDICTS.has(v), `${v} does not block`);
  assert.ok(UNVERIFIABLE_VERDICTS.has(ACCEPTABLE_QUOTE_VERDICT));
  for (const v of RETRY_ONLINE_VERDICTS) assert.ok(UNVERIFIABLE_VERDICTS.has(v));
  assert.strictEqual(ROWS_BLOCKING, BLOCKING_VERDICTS, 'verdict-rows.ts reads the one set');
});

test('seam S-C: the status rule reproduces the pre-Phase-20 aggregation for the old labels', () => {
  // verify.ts before the seam: FABRICATED / MIS-CITED / NOT_FOUND → failed (blocked);
  // a Pass-1 UNVERIFIABLE → unverifiable and blocked; PDF_UNAVAILABLE /
  // TEXT_UNAVAILABLE → unverifiable, not blocked; else verified.
  const row = (verdict: string) => ({ verdict });
  assert.deepEqual(sectionOutcome([]), { status: 'verified', blocked: false });
  assert.deepEqual(sectionOutcome([row('OK'), row('OK')]), { status: 'verified', blocked: false });
  for (const v of ['FABRICATED', 'MIS-CITED', 'NOT_FOUND']) {
    assert.deepEqual(sectionOutcome([row('OK'), row(v)]), { status: 'failed', blocked: true }, v);
  }
  assert.deepEqual(sectionOutcome([row('OK'), row('UNVERIFIABLE')]), { status: 'unverifiable', blocked: true });
  for (const v of LEGACY_UNAVAILABLE_VERDICTS) {
    assert.deepEqual(sectionOutcome([row('OK'), row(v)]), { status: 'unverifiable', blocked: false }, v);
  }
  assert.deepEqual(sectionOutcome([row('UNVERIFIABLE'), row('FABRICATED')]), { status: 'failed', blocked: true });
  assert.deepEqual(sectionOutcome([row('PDF_UNAVAILABLE'), row('UNVERIFIABLE')]), { status: 'unverifiable', blocked: true });
});

test('seam S-C: the Phase 20 labels, the accepted quote and an unknown label', () => {
  const row = (verdict: string, accepted?: boolean) => (accepted === undefined ? { verdict } : { verdict, accepted });
  for (const v of ['OK-BYO', 'PASS', 'FUZZY']) assert.deepEqual(sectionOutcome([row(v)]), { status: 'verified', blocked: false }, v);
  for (const v of ['RETRACTED', 'UNASSIGNED', 'UNPARSEABLE', 'UNSUPPORTED-FORM', 'UNRESOLVABLE', 'UNATTRIBUTED', 'NO-CITATIONS']) {
    assert.deepEqual(sectionOutcome([row(v)]), { status: 'failed', blocked: true }, v);
  }
  for (const v of ['UNVERIFIABLE-NETWORK', 'UNVERIFIABLE-QUOTE', 'PLACEHOLDER']) {
    assert.deepEqual(sectionOutcome([row(v)]), { status: 'unverifiable', blocked: true }, v);
  }
  // An acceptance lifts only an UNVERIFIABLE-QUOTE row.
  assert.deepEqual(sectionOutcome([row('UNVERIFIABLE-QUOTE', true)]), { status: 'verified', blocked: false });
  assert.deepEqual(sectionOutcome([row('NOT_FOUND', true)]), { status: 'failed', blocked: true });
  assert.deepEqual(sectionOutcome([row('UNVERIFIABLE-NETWORK', true)]), { status: 'unverifiable', blocked: true });
  // Fail closed on a label nobody defined.
  assert.deepEqual(sectionOutcome([row('BANANA')]), { status: 'failed', blocked: true });

  assert.equal(blocksCompile('OK'), false);
  assert.equal(blocksCompile('PDF_UNAVAILABLE'), false);
  assert.equal(blocksCompile('UNVERIFIABLE-QUOTE'), true);
  assert.equal(blocksCompile('UNVERIFIABLE-QUOTE', true), false);
  assert.equal(blocksCompile('NOT_FOUND', true), true);
  assert.equal(blocksCompile('BANANA'), true);
});

test('seam S-C: quote ids and the acceptance hash', () => {
  assert.equal(quoteId(0), 'q1');
  assert.equal(quoteId(9), 'q10');
  assert.ok(QUOTE_ID_RE.test('q1') && QUOTE_ID_RE.test('q42'));
  assert.ok(!QUOTE_ID_RE.test('q0') && !QUOTE_ID_RE.test('Q1') && !QUOTE_ID_RE.test('q1a'));
  const a = quoteTextSha256('attention mechanisms are\nnothing   more than lookup tables');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(quoteTextSha256('  attention mechanisms are nothing more than lookup tables '), a, 'whitespace is collapsed');
  assert.equal(quoteTextSha256('ﬁnal answer'), quoteTextSha256('final answer'), 'NFKC');
  assert.notEqual(quoteTextSha256('attention mechanisms are nothing more than lookup tables!'), a);
});

test('seam S-C: the refusal wording of the retry-online and the unverifiable-quote rows; the parser reads the new labels', () => {
  const md = [
    'Status: unverifiable',
    renderPass1VerdictRow('ghost.2099', 'UNVERIFIABLE-NETWORK', Number.NaN, Number.NaN, 'Crossref re-fetch failed: HTTP 503 after retries'),
    renderQuoteRow({ key: 'aggarwal2022', id: 'q1', snippet: 'attention mechanisms are nothing more t', verdict: 'UNVERIFIABLE-QUOTE', levRatio: 0, reason: 'no open-access copy' }),
    renderPass1VerdictRow('ok2020', 'OK-BYO', Number.NaN, Number.NaN, 'your own PDF sources/ok2020.pdf'),
  ].join('\n');
  const rows = parseBlockingVerdictRows(md);
  assert.deepEqual(rows.map((r) => `${r.citekey}:${r.verdict}`), ['ghost.2099:UNVERIFIABLE-NETWORK', 'aggarwal2022:UNVERIFIABLE-QUOTE']);
  assert.match(blockingRowReason(rows[0]!), /\[@ghost\.2099\] is UNVERIFIABLE-NETWORK .* re-run online$/);
  assert.match(blockingRowReason(rows[1]!), /pensmith add <pdf>.*--revise.*--accept-quote <id>/);
  assert.match(blockingRowReason({ citekey: 'x', verdict: 'FABRICATED' }), /\[@x\].*FABRICATED/);
});

test('seam S-C: done reads the Pass-2 table with or without the Evidence column (LF and CRLF)', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-verdicts-'));
  try {
    const write = (dir: string, body: string): void => {
      mkdirSync(join(root, '.paper', 'sections', dir), { recursive: true });
      writeFileSync(join(root, '.paper', 'sections', dir, 'VERIFICATION.md'), body);
    };
    const v1 = ['# VERIFICATION', 'Status: verified', '', '## Pass-2 (claim support, advisory — LLM-judged)', '', PASS2_TABLE_HEADER_V1, '|---|---|---|---|', '| a2020 | Claim A. | **UNSUPPORTED** | contradicts |', '| b2020 | Claim B. | **SUPPORTED** | fine |', ''].join('\n');
    const v2 = ['# VERIFICATION', 'Status: verified', '', '## Pass-2 (claim support, advisory — LLM-judged)', '', PASS2_TABLE_HEADER, '|---|---|---|---|---|', '| c2020 | Claim C. | **UNSUPPORTED** | contradicts | the abstract says the opposite |', ''].join('\r\n');
    write('01-a', v1);
    write('02-c', v2);
    const section = (n: number, slug: string): DoneSection => ({ identity: { n, slug }, id: String(n), planPath: join(root, '.paper', 'sections', `0${n}-${slug}`, 'PLAN.md'), assignedSources: [], verifiedHash: null, currentDraftHash: null });
    const sections = [section(1, 'a'), section(2, 'c')];
    const readSectionUnsupported = (r: string) => readUnsupportedClaims(r, sections).map((c) => c.result);
    const rows = readSectionUnsupported(root).sort((x, y) => x.citekey.localeCompare(y.citekey));
    assert.deepEqual(rows.map((r) => [r.citekey, r.verdict, r.evidence]), [
      ['a2020', 'UNSUPPORTED', ''],
      ['c2020', 'UNSUPPORTED', 'the abstract says the opposite'],
    ]);
    // A 5-column header with a 4-cell row fails safe (an UNSUPPORTED sentinel), never clean.
    write('02-c', v2.replace('| contradicts | the abstract says the opposite |', '| contradicts |'));
    assert.ok(readSectionUnsupported(root).some((r) => r.citekey === '<unparseable>'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('seam S-C: runPass1 reads pre-parsed bibliography entries (no file read); runPass3 rows carry the quote id and hash', async () => {
  const { runPass1 } = await import('../bin/lib/verify/pass1.js');
  const missingBib = join(tmpdir(), 'pensmith-verdicts-no-such-dir', 'CITATIONS.bib');
  const rows = await runPass1('A claim [@ghost2099].', missingBib, { bibEntries: [] });
  assert.deepEqual(rows.map((r) => `${r.citekey}:${r.verdict}`), ['ghost2099:FABRICATED']);

  const { runPass3 } = await import('../bin/lib/verify/pass3.js');
  const q1 = 'the dominant sequence transduction models are based on complex recurrent networks';
  const q2 = 'we propose a new simple network architecture based solely on attention mechanisms';
  const draft = `As shown, "${q1}" [@nodoi2017]. Later, "${q2}" [@nodoi2017].\n`;
  const p3 = await runPass3(draft, new Map());
  assert.deepEqual(p3.map((r) => r.id), ['q1', 'q2']);
  assert.deepEqual(p3.map((r) => r.quoteSha256), [quoteTextSha256(q1), quoteTextSha256(q2)]);
  assert.ok(p3.every((r) => r.localFile === undefined));
});
