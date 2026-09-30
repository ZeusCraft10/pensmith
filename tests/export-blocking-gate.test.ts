// tests/export-blocking-gate.test.ts — audit #3/#14 regression, VRFY-26/27.
//
// `pensmith done`/export must re-assert the gate, not trust that compile
// already gated. Before the fix, done re-read DRAFT.md and exported it without
// re-verifying — so `done --raw`, a bare `/pensmith` dispatch, or a section
// that became unclean after compile could export a fabricated citation.
// runExportBlockingGate is the unconditional record gate (neither --raw nor
// --yolo bypasses it); since Phase 20 its sections come from STATE.json and
// OUTLINE.md (never a directory listing), a stale section refuses, and the
// verdicts themselves are recomputed by the gate core over the exported text
// (tests/done-recompute.test.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExportBlockingGate } from '../bin/cli/done.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

interface Spec {
  n: number;
  slug: string;
  /** VERIFICATION.md body; null → no file. */
  verification: string | null;
  /** false → PLAN.md's verified hash is not the draft's (stale). */
  current?: boolean;
  /** false → registered in STATE.json and OUTLINE.md, but no folder at all. */
  folder?: boolean;
}

function seed(sections: Spec[], stray: string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-exportgate-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nClaim [@smith2020].\n');
  writeFileSync(join(root, '.paper', 'STATE.json'), JSON.stringify({ $schemaVersion: 3, paperId: 'export-gate', createdAt: '2026-01-01T00:00:00.000Z', sections: sections.map((s) => ({ n: s.n, slug: s.slug })) }));
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# O', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', ...sections.map((s) => `| ${s.n} | ${s.slug} | ${s.slug} |  | 300 | smith2020 |`), ''].join('\n'),
  );
  for (const s of sections) {
    if (s.folder === false) continue;
    const dir = join(root, '.paper', 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    const draft = `# ${s.slug}\n\nClaim [@smith2020].\n`;
    writeFileSync(join(dir, 'DRAFT.md'), draft);
    const hash = s.current === false ? 'f'.repeat(64) : computeDraftHash(Buffer.from(draft), ['smith2020']);
    writeFileSync(join(dir, 'PLAN.md'), `---\nschema_version: 2\nsection: ${s.n}\nslug: ${s.slug}\ntitle: ${s.slug}\ndepends_on: []\nassigned_sources: ['smith2020']\nverified_against_draft_hash: '${hash}'\nstatus: verified\n---\n\n## Brief\n`);
    if (s.verification !== null) writeFileSync(join(dir, 'VERIFICATION.md'), s.verification);
  }
  for (const name of stray) mkdirSync(join(root, '.paper', 'sections', name), { recursive: true });
  return root;
}

const CLEAN = ['Status: verified', '', '## Pass-1', '- smith2020: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed', ''].join('\n');
const FABRICATED = ['Status: failed', '', '## Pass-1', '- fakeauthor2099: **FABRICATED** — titleJW=0.00, authorJW=0.00 — citekey not in bib', ''].join('\n');

test('export gate: a clean verified section does NOT block', () => {
  const root = seed([{ n: 1, slug: 'intro', verification: CLEAN }]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, false, `expected no block; reasons: ${r.reasons.join('; ')}`);
});

test('export gate (audit #3): a section whose verification failed BLOCKS export', () => {
  const root = seed([
    { n: 1, slug: 'intro', verification: CLEAN },
    { n: 2, slug: 'body', verification: FABRICATED },
  ]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /section 2 \(body\): VERIFICATION\.md Status is 'failed'/.test(x)), `got: ${r.reasons.join('; ')}`);
  assert.deepEqual(r.verdictReasons?.map((x) => x.split(':')[0]), ['section 2 (body)']);
});

test('export gate (audit #14): a section with no Status line BLOCKS (never verified)', () => {
  const noStatus = '## Pass-2\n\n| Citekey | Claim | Verdict | Rationale |\n| a | b | **UNSUPPORTED** | c |\n';
  const root = seed([{ n: 1, slug: 'intro', verification: noStatus }]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /no Status line/.test(x)));
});

test('export gate (audit #14, VRFY-26): a DRAFT.md with NO registered section BLOCKS', () => {
  const root = seed([]); // DRAFT.md present, but zero sections
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /no sections are registered/.test(x)), r.reasons.join('; '));
});

test('export gate (CodeRabbit, VRFY-26): a CLEAN section alongside a registered one with no VERIFICATION.md — or no folder at all — BLOCKS', () => {
  const root = seed([
    { n: 1, slug: 'intro', verification: CLEAN },
    { n: 2, slug: 'body', verification: null },
    { n: 3, slug: 'end', verification: null, folder: false },
  ]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /section 2 \(body\)/.test(x) && /missing VERIFICATION\.md/.test(x)), `got: ${r.reasons.join('; ')}`);
  assert.ok(r.reasons.some((x) => /section 3 \(end\)/.test(x) && /missing or unreadable PLAN\.md/.test(x)), `got: ${r.reasons.join('; ')}`);
});

test('export gate (VRFY-26): sections come from STATE.json + OUTLINE.md — a stray folder is not a section, a divergent outline refuses', () => {
  const root = seed([{ n: 1, slug: 'intro', verification: CLEAN }], ['02-leftover']);
  assert.equal(runExportBlockingGate(root).blocked, false, 'an unregistered folder is not part of the paper');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), '# O\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | renamed | x |  | 300 | smith2020 |\n');
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.match(r.reasons.join(' '), /OUTLINE\.md and STATE\.json disagree/);
});

test('export gate (VRFY-27): a section whose draft changed since verification is stale', () => {
  const root = seed([{ n: 1, slug: 'intro', verification: CLEAN, current: false }]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /stale: §1 changed since verification — re-verify and recompile/.test(x)), r.reasons.join('; '));
});

test('export gate (CodeRabbit): Status: failed with NO parseable verdict row still BLOCKS (fail-closed)', () => {
  const failedNoRow = 'Status: failed\n\n## Pass-1\n\n(verifier hard-failed; rows did not parse)\n';
  const root = seed([{ n: 1, slug: 'intro', verification: failedNoRow }]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /Status is 'failed'/.test(x)), `a failed section must block even with no parseable row; got: ${r.reasons.join('; ')}`);
});

test('export gate: UNSUPPORTED (advisory Pass-2 pipe row) does NOT block', () => {
  const advisory = ['Status: verified', '', '## Pass-2', '| Citekey | Claim Sentence | Verdict | Rationale |', '| smith2020 | x | **UNSUPPORTED** | y |', ''].join('\n');
  const root = seed([{ n: 1, slug: 'intro', verification: advisory }]);
  const r = runExportBlockingGate(root);
  assert.equal(r.blocked, false, `UNSUPPORTED is advisory, must not block; reasons: ${r.reasons.join('; ')}`);
});
