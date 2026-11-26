// tests/pass3-arxiv.test.ts — quotations of a work known by its arXiv record.
//
// Computer science prefers arXiv's record of a work, so a work kept under it
// prints only its arXiv identifiers, and many computer-science papers (those
// posted only to arXiv) have no DOI at all. Pass 3 found a work's text only
// through a DOI, so every quotation of such a work was PDF_UNAVAILABLE: never
// checked, and never blocked. Its text is at its arXiv PDF.
//
// The recordings are arXiv's own answers: its record and PDF of "A note on
// hardness of promise hypergraph colouring" (arXiv:2205.14719, no DOI), and
// its PDF of "A Note on Visible Islands" (arXiv:2109.00022, which also has a
// DOI).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reCheckFinalMd } from '../bin/cli/done.js';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { parseBibForPass1 } from '../bin/lib/verify/pass1.js';
import { readIntake } from '../bin/lib/intake-record.js';
import { runCli } from './lib/export-fixture.js';
import { verifySection } from './lib/verify-cli.js';

// As CITATIONS.bib writes a work kept under its arXiv record.
const NOTE_BIB =
  '@misc{wrochna2022,\n  title = {A note on hardness of promise hypergraph colouring},\n  author = {Wrochna, Marcin},\n' +
  '  year = {2022},\n  eprint = {2205.14719},\n  archiveprefix = {arXiv}\n}\n';
const ISLANDS_BIB =
  '@misc{leuchtner2022,\n  title = {A Note on Visible Islands},\n  author = {Leuchtner, Sophie and Nicol{\\\'a}s, Carlos M. and Suk, Andrew},\n' +
  '  year = {2022},\n  eprint = {2109.00022},\n  archiveprefix = {arXiv}\n}\n';

// Page 1 of the note, and the same sentence with one word changed.
const NOTE_SAYS = 'Thus instead of a more quantitative analysis, we use only constants everywhere';
const NOTE_CHANGED = 'Thus instead of a more quantitative analysis, we use only variables everywhere';
const ISLANDS_SAYS = 'In this paper, we study a relaxed version of this question by replacing holes with visible islands';

const quoting = (key: string, quote: string): string => `# Introduction\n\nAs the authors put it, "${quote}" [@${key}, p. 1].\n`;

async function quoteVerdicts(draft: string, bibText: string): Promise<Array<{ verdict: string; reason: string }>> {
  const bib = await parseBibForPass1(bibText);
  return runPass3(draft, bib.entries, bib.fields);
}

test('a quotation of a work known only by its arXiv ID is checked against its arXiv PDF and found', async () => {
  const [r] = await quoteVerdicts(quoting('wrochna2022', NOTE_SAYS), NOTE_BIB);
  assert.equal(r?.verdict, 'OK', r?.reason);
  assert.match(r!.reason, /https:\/\/arxiv\.org\/pdf\/2205\.14719/);
});

test('a quotation of a work known only by its arXiv ID that its arXiv PDF does not print is NOT_FOUND', async () => {
  const [r] = await quoteVerdicts(quoting('wrochna2022', NOTE_CHANGED), NOTE_BIB);
  assert.equal(r?.verdict, 'NOT_FOUND', r?.reason);
});

test('a work with a DOI, printed with only its arXiv ID, is checked against its arXiv PDF', async () => {
  // Under computer-science the arXiv record is kept and only its eprint printed.
  const [r] = await quoteVerdicts(quoting('leuchtner2022', ISLANDS_SAYS), ISLANDS_BIB);
  assert.equal(r?.verdict, 'OK', r?.reason);
});

test('verify checks a quotation of a computer-science work added by its arXiv ID, and blocks a changed one', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-pass3-arxiv-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'INTAKE.md'), '# Intake\n\nTopic: promise constraint satisfaction\nDiscipline: computer-science\n');
  assert.equal(readIntake(root)?.discipline, 'computer-science');

  const added = runCli(['add', 'arXiv:2205.14719', '--yolo'], root);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  const bib = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /eprint = \{2205\.14719\}/, bib);
  assert.doesNotMatch(bib, /\bdoi = /i, 'kept under its arXiv record alone');
  const key = /^@\w+\{([^,]+),/m.exec(bib)![1]!;

  // verify reads no intake, so the bibliography `add` wrote is verified on its own.
  const ok = verifySection(quoting(key, NOTE_SAYS), bib);
  assert.equal(ok.status, 0, ok.out);
  assert.deepEqual(ok.record.quotes.map((q) => q.verdict), ['OK'], ok.out);

  const changed = verifySection(quoting(key, NOTE_CHANGED), bib);
  assert.equal(changed.status, 2, changed.out);
  assert.deepEqual(changed.record.quotes.map((q) => q.verdict), ['NOT_FOUND'], changed.out);
});

test('verify reads a work\'s arXiv ID from its eprint field alone, as a hand-written bibliography gives it', () => {
  const ok = verifySection(quoting('wrochna2022', NOTE_SAYS), NOTE_BIB);
  assert.equal(ok.status, 0, ok.out);
  assert.deepEqual(ok.record.quotes.map((q) => q.verdict), ['OK'], ok.out);
  const changed = verifySection(quoting('wrochna2022', NOTE_CHANGED), NOTE_BIB);
  assert.equal(changed.status, 2, changed.out);
  assert.deepEqual(changed.record.quotes.map((q) => q.verdict), ['NOT_FOUND'], changed.out);
});

test('done\'s check of a humanized FINAL.md reads a work\'s arXiv ID from its eprint field, and blocks a quotation its arXiv PDF does not print', async () => {
  // The humanizer's output is checked against the source itself, not only
  // against DRAFT.md: a DRAFT.md quotation that was never in the source must
  // not reach the export because FINAL.md repeats it word for word.
  const root = mkdtempSync(join(tmpdir(), 'pensmith-pass3-arxiv-final-'));
  const bibPath = join(root, 'CITATIONS.bib');
  writeFileSync(bibPath, NOTE_BIB);

  const real = quoting('wrochna2022', NOTE_SAYS);
  assert.deepEqual(await reCheckFinalMd(real, real, bibPath), { passed: true, reason: '' });

  const changed = quoting('wrochna2022', NOTE_CHANGED);
  const r = await reCheckFinalMd(changed, changed, bibPath);
  assert.equal(r.passed, false, r.reason);
  assert.match(r.reason, /Pass-3 quote NOT_FOUND in humanized FINAL\.md: \[@wrochna2022\]/);
});
