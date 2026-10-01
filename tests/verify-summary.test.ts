// tests/verify-summary.test.ts — VRFY-24 (D-20-20): VERIFICATION.md opens with
// its Status and Draft lines, then a `## Summary` table (| Pass | Verdict |
// Count |) listing every non-zero Pass-1 / Pass-3 / draft label, the Pass-2
// verdict counts, the Pass-4 orphan total and the freshness counts — and a
// parser proves the counts equal the rows. A real `pensmith verify` (built
// CLI, offline fixtures) writes it that way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderVerificationMd,
  parseVerificationMd,
  summaryMismatches,
  summaryRows,
  ACCEPTED_QUOTE_LABEL,
  SUMMARY_HEADING,
  PASS1_HEADING,
  PASS3_HEADING,
  DRAFT_CHECKS_HEADING,
} from '../bin/lib/verify/verification-md.js';
import type { GateRow } from '../bin/lib/verify/gate.js';
import { sandbox, runCli, writeState, writeOutline, writePlan, sectionDirOf, STACK_LINE } from './helpers/paper-cli-harness.js';
import { EXIT_OK } from '../bin/lib/exit-codes.js';

const ROWS: GateRow[] = [
  { kind: 'pass1', key: 'lecun2015', verdict: 'OK', titleJW: 1, authorJW: 1, reason: 'D-11 AND-gate passed' },
  { kind: 'pass1', key: 'lecun2015', verdict: 'UNASSIGNED', titleJW: Number.NaN, authorJW: Number.NaN, reason: 'not assigned' },
  { kind: 'pass1', key: 'ghost.2099', verdict: 'FABRICATED', titleJW: 0, authorJW: 0, reason: 'not in bib' },
  { kind: 'text', key: '(L7)', line: 7, verdict: 'UNSUPPORTED-FORM', form: 'tex-cite', text: '\\cite{fake2019}', reason: 'raw TeX citation' },
  { kind: 'pass3', key: 'vaswani2017', id: 'q1', quoteSha256: 'a'.repeat(64), snippet: 'The dominant sequence transduction mod', verdict: 'PASS', levRatio: 1, reason: 'arXiv PDF' },
  { kind: 'pass3', key: 'aggarwal2022', id: 'q2', quoteSha256: 'b'.repeat(64), snippet: 'attention mechanisms are **nothing** mo', verdict: 'UNVERIFIABLE-QUOTE', levRatio: 0, reason: 'no open-access copy', accepted: { at: '2026-09-30T10:00:00.000Z', via: 'flag' } },
  { kind: 'pass3', key: 'aggarwal2022', id: 'q3', quoteSha256: 'c'.repeat(64), snippet: 'another quote that no text supports', verdict: 'UNVERIFIABLE-QUOTE', levRatio: 0, reason: 'paywalled (abstract only)' },
  { kind: 'draft', verdict: 'NO-CITATIONS', reason: 'no citations; 2 sources assigned' },
];

function doc(rows: GateRow[] = ROWS) {
  return renderVerificationMd({
    sectionId: '2',
    slug: 'background',
    offlineMarker: '> OFFLINE MODE (test runner) — recorded fixtures, not live results.',
    status: 'failed',
    draftHash: 'd'.repeat(64),
    rows,
    accepted: [{ id: 'q2', citekey: 'aggarwal2022', excerpt: 'attention mechanisms are nothing more', acceptedAt: '2026-09-30T10:00:00.000Z', via: 'flag' }],
    freshness: [{ citekey: 'lecun2015', doi: '10.1038/nature14539', warnings: [], skipped: [{ probe: 'DOI HEAD', detail: 'skipped (offline)' }] }],
    freshnessSection: '## Source Freshness (RSCH-10)\n\n| Citekey | Probe | Status | Detail |\n|---|---|---|---|\n| lecun2015 | DOI HEAD | skipped (offline) | not probed |\n',
    pass2Verdicts: ['SUPPORTED', 'UNSUPPORTED', 'SUPPORTED'],
    pass2Section: '## Pass-2 (claim support, advisory — LLM-judged)\n\n| Citekey | Claim Sentence | Verdict | Rationale |\n|---|---|---|---|\n| a | A. | **SUPPORTED** | ok |\n| b | B. | **UNSUPPORTED** | no |\n| c | C. | **SUPPORTED** | ok |\n',
    pass4Orphans: 2,
    pass4Section: '## Pass-4 (orphan claims, advisory)\n\n_(stand-in)_\n',
  });
}

test('VRFY-24: the Status and Draft lines, then the Summary FIRST, then Pass-1, Pass-3, Draft checks, Accepted quotes, freshness, Pass-2, Pass-4', () => {
  const md = doc();
  const lines = md.split('\n');
  assert.equal(lines[0], '> OFFLINE MODE (test runner) — recorded fixtures, not live results.');
  assert.equal(lines[2], '# VERIFICATION (Section 2, background)');
  assert.equal(lines[4], 'Status: failed');
  assert.equal(lines[5], `Draft: sha256 ${'d'.repeat(64)}`);
  const headings = lines.filter((l) => l.startsWith('## '));
  assert.deepEqual(headings.map((h) => h.split(' (')[0]), ['## Summary', '## Pass-1', '## Pass-3', '## Draft checks', '## Accepted quotes', '## Source Freshness', '## Pass-2', '## Pass-4']);
  assert.ok(md.indexOf(SUMMARY_HEADING) < md.indexOf(PASS1_HEADING));
  assert.ok(md.indexOf(PASS3_HEADING) < md.indexOf(DRAFT_CHECKS_HEADING));
  // Row formats (D-20-20).
  assert.match(md, /^- ghost\.2099: \*\*FABRICATED\*\* — titleJW=0\.00, authorJW=0\.00 — not in bib$/m);
  assert.match(md, /^- \(L7\): \*\*UNSUPPORTED-FORM\*\* — titleJW=n\/a, authorJW=n\/a — `\\cite\{fake2019\}`: raw TeX citation$/m);
  assert.match(md, /^- vaswani2017 \[q1\] \("The dominant sequence transduction mod…"\): \*\*PASS\*\* — lev=1\.000 — arXiv PDF$/m);
  assert.match(md, /^- aggarwal2022 \[q2\] \("attention mechanisms are \\\*\\\*nothing\\\*\\\* mo…"\): \*\*UNVERIFIABLE-QUOTE\*\* — lev=n\/a — no open-access copy — accepted by you 2026-09-30T10:00:00\.000Z \(--accept-quote\)$/m);
  assert.match(md, /^- draft: \*\*NO-CITATIONS\*\* — no citations; 2 sources assigned$/m);
  assert.match(md, /^\| q2 "attention mechanisms are nothing more" \| aggarwal2022 \| 2026-09-30T10:00:00\.000Z \| --accept-quote \|$/m);
});

test('VRFY-24: the Summary counts equal the rows — a parser proves it, and catches a forged count or a hidden row (LF and CRLF)', () => {
  const md = doc();
  assert.deepEqual(summaryMismatches(md), []);
  assert.deepEqual(summaryMismatches(md.replace(/\n/g, '\r\n')), [], 'CRLF');
  const parsed = parseVerificationMd(md);
  assert.equal(parsed.status, 'failed');
  assert.equal(parsed.draftHash, 'd'.repeat(64));
  assert.deepEqual(
    parsed.summary.map((s) => `${s.pass}|${s.verdict}|${s.count}`),
    [
      'Pass-1|OK|1',
      'Pass-1|FABRICATED|1',
      'Pass-1|UNASSIGNED|1',
      'Pass-1|UNSUPPORTED-FORM|1',
      'Pass-3|PASS|1',
      'Pass-3|UNVERIFIABLE-QUOTE|1',
      `Pass-3|${ACCEPTED_QUOTE_LABEL}|1`,
      'Draft|NO-CITATIONS|1',
      'Pass-2|SUPPORTED|2',
      'Pass-2|UNSUPPORTED|1',
      'Pass-4|orphans|2',
      'Freshness|WARN|0',
      'Freshness|not probed|1',
    ],
  );
  assert.deepEqual(parsed.pass3.map((r) => [r.key, r.quoteId, r.verdict, r.accepted]), [
    ['vaswani2017', 'q1', 'PASS', false],
    ['aggarwal2022', 'q2', 'UNVERIFIABLE-QUOTE', true],
    ['aggarwal2022', 'q3', 'UNVERIFIABLE-QUOTE', false],
  ]);
  // A forged count, and a row the summary does not list, are both caught.
  assert.match(summaryMismatches(md.replace('| Pass-1 | FABRICATED | 1 |', '| Pass-1 | FABRICATED | 0 |')).join('\n'), /Pass-1 FABRICATED: the Summary says 0, the rows hold 1/);
  const hidden = md.replace('- draft: **NO-CITATIONS**', '- ghost.2100: **MIS-CITED** — x\n- draft: **NO-CITATIONS**').replace(DRAFT_CHECKS_HEADING, `${DRAFT_CHECKS_HEADING}`);
  const withRow = hidden.replace(`${PASS1_HEADING}\n\n`, `${PASS1_HEADING}\n\n- ghost.2101: **MIS-CITED** — titleJW=0.10, authorJW=0.00 — wrong\n`);
  assert.match(summaryMismatches(withRow).join('\n'), /Pass-1 MIS-CITED: 1 row\(s\) missing from the Summary/);
});

test('VRFY-24: summaryRows lists only non-zero labels; with nothing to check the table says so', () => {
  assert.deepEqual(summaryRows({ rows: [] }), []);
  const md = renderVerificationMd({ sectionId: '1', slug: 'intro', offlineMarker: null, status: 'verified', draftHash: 'e'.repeat(64), rows: [] });
  assert.match(md, /\| — \| nothing to check \| 0 \|/);
  assert.match(md, /_\(no citations to check\)_/);
  assert.deepEqual(summaryMismatches(md), []);
});

test('VRFY-24 (built CLI): a real `pensmith verify` writes the summary table first and its counts equal the rows', () => {
  const sb = sandbox('verify-summary');
  const root = sb.project('p');
  writeState(root, [{ n: 1, slug: 'intro' }]);
  writeOutline(root, [{ n: 1, slug: 'intro', sources: ['lecun2015', 'nphys2009'] }]);
  writeFileSync(
    join(root, '.paper', 'CITATIONS.bib'),
    '@article{lecun2015,\n  title = {Deep learning},\n  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},\n  journal = {Nature},\n  year = {2015},\n  doi = {10.1038/nature14539}\n}\n',
  );
  writePlan(root, 1, 'intro', { assigned_sources: "['lecun2015', 'nphys2009']", status: 'written' });
  mkdirSync(sectionDirOf(root, 1, 'intro'), { recursive: true });
  writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'), '# Intro\n\nDeep networks learn representations [@lecun2015]. Also [@ghost2099].\n');
  const r = runCli(sb, root, ['verify', '1'], { env: { PENSMITH_NO_LLM: '1' } });
  assert.equal(r.status, 4, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, STACK_LINE);
  const md = readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8');
  const headings = md.split('\n').filter((l) => l.startsWith('## '));
  assert.equal(headings[0], SUMMARY_HEADING, 'the summary is the first section');
  assert.match(md, /^Status: failed$/m);
  assert.match(md, /^Draft: sha256 [0-9a-f]{64}$/m);
  assert.deepEqual(summaryMismatches(md), []);
  const parsed = parseVerificationMd(md);
  assert.deepEqual(parsed.pass1.map((x) => `${x.key}:${x.verdict}`), ['lecun2015:OK', 'ghost2099:FABRICATED', 'ghost2099:UNASSIGNED']);
  assert.ok(parsed.summary.some((s) => s.pass === 'Pass-1' && s.verdict === 'FABRICATED' && s.count === 1));
  assert.ok(parsed.summary.some((s) => s.pass === 'Pass-4' && s.verdict === 'orphans'));
  assert.ok(parsed.summary.some((s) => s.pass === 'Freshness' && s.verdict === 'not probed'));
  // An introduction with no assigned sources and no citations verifies (exit 0).
  writePlan(root, 1, 'intro', { assigned_sources: '[]', status: 'written' });
  writeFileSync(join(sectionDirOf(root, 1, 'intro'), 'DRAFT.md'), '# Intro\n\nThis paper argues a point without citing anything yet.\n');
  const ok = runCli(sb, root, ['verify', '1'], { env: { PENSMITH_NO_LLM: '1' } });
  assert.equal(ok.status, EXIT_OK, `${ok.stdout}\n${ok.stderr}`);
  assert.match(readFileSync(join(sectionDirOf(root, 1, 'intro'), 'VERIFICATION.md'), 'utf8'), /^Status: verified$/m);
});
