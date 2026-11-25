// tests/retraction-gates.test.ts — what compile, done and revise do with the
// retraction verdicts, and the OpenAlex cross-check on real recordings.
//
//   RETRACTED                blocks compile and export (and revise can swap it);
//   RETRACTED_ACKNOWLEDGED   the author acknowledged that citation: no block, a warning;
//   EXPRESSION_OF_CONCERN    no block, a warning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isBlockingVerdict } from '../bin/lib/verify/verdict-rows.js';
import { verificationGate } from '../bin/lib/verify/verification-record.js';
import { runExportBlockingGate } from '../bin/cli/done.js';
import { firstFailingCitation } from '../bin/lib/revise.js';
import { lookupRetraction } from '../bin/lib/sources/openalex.js';
import { verificationRecord, writeCompileManifestFixture, writeVerificationFixture, type CitationSpec } from './lib/verification-fixture.js';

const verification = (row: string, status = 'verified'): string =>
  `# VERIFICATION (Section 1, intro)\n\nStatus: ${status}\n\n## Pass-1 (citation integrity, deterministic)\n\n${row}\n`;

const RETRACTED_ROW =
  '- wakefield1998: **RETRACTED** — titleJW=1.00, authorJW=1.00 — retracted (Retraction, 2010-02-06, notice 10.1016/s0140-6736(10)60175-4, per Crossref)';

const RETRACTED: CitationSpec = {
  citekey: 'wakefield1998', verdict: 'RETRACTED',
  reason: 'retracted (Retraction, 2010-02-06, notice 10.1016/s0140-6736(10)60175-4, per Crossref)',
};
const ACKED: CitationSpec = {
  citekey: 'wakefield1998', verdict: 'RETRACTED_ACKNOWLEDGED',
  reason: 'retracted (Retraction, 2010-02-06, per Crossref); acknowledged 2026-11-25: "This section is about the retraction itself."',
};
const CONCERN: CitationSpec = {
  citekey: 'feng2013', verdict: 'EXPRESSION_OF_CONCERN',
  reason: 'matches the Crossref record; an expression of concern was published about it',
};

const DRAFT = '# Intro\n\nClaim [@wakefield1998]. Another [@feng2013].\n';
const record = (citations: CitationSpec[], status?: 'verified'): ReturnType<typeof verificationRecord> =>
  verificationRecord({ n: 1, slug: 'intro', draft: DRAFT, citations, ...(status ? { status } : {}) });

test('RETRACTED blocks; RETRACTED_ACKNOWLEDGED and EXPRESSION_OF_CONCERN do not', () => {
  assert.equal(isBlockingVerdict('RETRACTED'), true);
  assert.equal(isBlockingVerdict('RETRACTED_ACKNOWLEDGED'), false);
  assert.equal(isBlockingVerdict('EXPRESSION_OF_CONCERN'), false);
});

test('compile and done: a RETRACTED verdict is a refusal naming the citation', () => {
  const g = verificationGate(record([RETRACTED]), 'section 1');
  assert.equal(g.reasons.length, 2, g.reasons.join('\n'));
  assert.match(g.reasons.join('\n'), /verify failed this section/);
  const named = g.reasons.find((r) => r.includes('[@wakefield1998]'));
  assert.ok(named, g.reasons.join('\n'));
  assert.match(named, /RETRACTED/);
});

test('compile and done: an acknowledged retraction and an expression of concern each warn, naming the citation', () => {
  const g = verificationGate(record([ACKED, CONCERN]), 'section 1');
  assert.deepEqual(g.reasons, []);
  assert.equal(g.warnings.length, 2, g.warnings.join('\n'));
  assert.match(g.warnings[0]!, /\[@wakefield1998\].*retracted/i);
  assert.match(g.warnings[0]!, /This section is about the retraction itself/);
  assert.match(g.warnings[1]!, /\[@feng2013\].*expression of concern/i);
});

/** A compiled one-section paper whose verdicts are `citations`. */
async function exportRoot(citations: CitationSpec[], status?: 'verified'): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-retraction-export-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), '# Paper\n\n| # | slug | title | depends_on | word target | assigned_sources |\n| --- | --- | --- | --- | --- | --- |\n| 1 | intro | Intro | | 300 | |\n');
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  writeFileSync(join(sec, 'DRAFT.md'), DRAFT);
  writeVerificationFixture(sec, { n: 1, slug: 'intro', draft: DRAFT, citations, ...(status ? { status } : {}) });
  writeFileSync(join(root, '.paper', 'DRAFT.md'), `# Paper\n\n${DRAFT}`);
  await writeCompileManifestFixture(root, [{ n: 1, slug: 'intro' }]);
  return root;
}

test('export gate: a RETRACTED verdict blocks export, even in a section marked verified', async () => {
  const r = await runExportBlockingGate(await exportRoot([RETRACTED], 'verified'));
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => x.includes('[@wakefield1998]')), r.reasons.join('\n'));
});

test('export gate: an acknowledged retraction exports, with a warning', async () => {
  const r = await runExportBlockingGate(await exportRoot([ACKED]));
  assert.equal(r.blocked, false, r.reasons.join('\n'));
  assert.ok(r.warnings.some((w) => /wakefield1998.*retracted/i.test(w)), r.warnings.join('\n'));
});

test('revise: a RETRACTED citation is one revise can swap or remove', () => {
  const f = firstFailingCitation(verification(RETRACTED_ROW, 'failed'));
  assert.equal(f?.citekey, 'wakefield1998');
  assert.match(f?.reason ?? '', /^RETRACTED:/);
});

test('OpenAlex: the recorded answers for a retracted work, a work that is not, and an unknown DOI', async () => {
  assert.deepEqual(await lookupRetraction('10.1016/S0140-6736(97)11096-0'), { kind: 'found', retracted: true });
  assert.deepEqual(await lookupRetraction('10.1371/journal.pone.0061107'), { kind: 'found', retracted: false });
  assert.deepEqual(await lookupRetraction('10.1038/s41586-024-99999-x'), { kind: 'not_found' });
  const miss = await lookupRetraction('10.0000/never-recorded');
  assert.equal(miss.kind, 'unavailable');
});

test('nothing in the shipped code asks the Crossref Labs retraction route, which answers every DOI with an error', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const root = new URL('../bin/', import.meta.url);
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => join(e.parentPath, e.name));
  const hits = files.filter((f) => readFileSync(f, 'utf8').includes('api.labs.crossref.org'));
  assert.deepEqual(hits, []);
});
