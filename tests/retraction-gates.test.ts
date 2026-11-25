// tests/retraction-gates.test.ts — what compile, done and revise do with the
// retraction verdicts, and the OpenAlex cross-check on real recordings.
//
//   RETRACTED                blocks compile and export (and revise can swap it);
//   EXPRESSION_OF_CONCERN    no block, a warning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isBlockingVerdict, verdictGate } from '../bin/lib/verify/verdict-rows.js';
import { runExportBlockingGate } from '../bin/cli/done.js';
import { firstFailingCitation } from '../bin/lib/revise.js';
import { lookupRetraction } from '../bin/lib/sources/openalex.js';

const verification = (row: string, status = 'verified'): string =>
  `# VERIFICATION (Section 1, intro)\n\nStatus: ${status}\n\n## Pass-1 (citation integrity, deterministic)\n\n${row}\n`;

const RETRACTED_ROW =
  '- wakefield1998: **RETRACTED** — titleJW=1.00, authorJW=1.00 — retracted (Retraction, 2010-02-06, notice 10.1016/s0140-6736(10)60175-4, per Crossref)';
const CONCERN_ROW =
  '- feng2013: **EXPRESSION_OF_CONCERN** — titleJW=1.00, authorJW=1.00 — matches the Crossref record; an expression of concern was published about it';

test('RETRACTED blocks; EXPRESSION_OF_CONCERN does not', () => {
  assert.equal(isBlockingVerdict('RETRACTED'), true);
  assert.equal(isBlockingVerdict('EXPRESSION_OF_CONCERN'), false);
});

test('compile and done: a RETRACTED row is a refusal naming the citation', () => {
  const g = verdictGate(verification(RETRACTED_ROW), 'section 1');
  assert.equal(g.reasons.length, 1);
  assert.match(g.reasons[0]!, /\[@wakefield1998\]/);
  assert.match(g.reasons[0]!, /RETRACTED/);
});

test('compile and done: an expression of concern warns, naming the citation', () => {
  const g = verdictGate(verification(CONCERN_ROW), 'section 1');
  assert.deepEqual(g.reasons, []);
  assert.equal(g.warnings.length, 1, g.warnings.join('\n'));
  assert.match(g.warnings[0]!, /\[@feng2013\].*expression of concern/i);
});

function exportRoot(verificationMd: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-retraction-export-'));
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nClaim [@wakefield1998].\n');
  writeFileSync(join(sec, 'VERIFICATION.md'), verificationMd);
  return root;
}

test('export gate: a RETRACTED row blocks export, even in a section marked verified', () => {
  const r = runExportBlockingGate(exportRoot(verification(RETRACTED_ROW)));
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => x.includes('[@wakefield1998]')), r.reasons.join('\n'));
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
