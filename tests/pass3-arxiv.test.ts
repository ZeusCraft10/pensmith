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
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { parseBibForPass1 } from '../bin/lib/verify/pass1.js';
import { readIntake } from '../bin/lib/intake-record.js';
import type { VerificationRecord } from '../bin/lib/verify/verification-record.js';
import { runCli } from './lib/export-fixture.js';
import { outlineTable } from './lib/outline-fixture.js';
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
  const sec = join(root, '.paper', 'sections', '01-intro');
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(root, '.paper', 'INTAKE.md'), '# Intake\n\nTopic: promise constraint satisfaction\nDiscipline: computer-science\n');
  assert.equal(readIntake(root)?.discipline, 'computer-science');

  const added = runCli(['add', 'arXiv:2205.14719', '--yolo'], root);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  const bib = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /eprint = \{2205\.14719\}/, bib);
  assert.doesNotMatch(bib, /\bdoi = /i, 'kept under its arXiv record alone');
  const key = /^@\w+\{([^,]+),/m.exec(bib)![1]!;

  writeFileSync(join(root, '.paper', 'OUTLINE.md'), outlineTable([{ n: 1, slug: 'intro', title: 'Introduction', sources: [key] }]));
  writeFileSync(join(sec, 'PLAN.md'), `---\nsection: 1\nslug: intro\ntitle: Introduction\nstatus: written\nassigned_sources: [${key}]\n---\n# Introduction\n`);
  const verify = (quote: string): { status: number | null; out: string; quotes: VerificationRecord['quotes'] } => {
    writeFileSync(join(sec, 'DRAFT.md'), quoting(key, quote));
    const r = runCli(['verify', '1'], root);
    const record = JSON.parse(readFileSync(join(sec, 'VERIFICATION.json'), 'utf8')) as VerificationRecord;
    return { status: r.status, out: r.stdout + r.stderr, quotes: record.quotes };
  };

  const ok = verify(NOTE_SAYS);
  assert.equal(ok.status, 0, ok.out);
  assert.deepEqual(ok.quotes.map((q) => q.verdict), ['OK'], ok.out);

  const changed = verify(NOTE_CHANGED);
  assert.equal(changed.status, 2, changed.out);
  assert.deepEqual(changed.quotes.map((q) => q.verdict), ['NOT_FOUND'], changed.out);
});

test('verify reads a work\'s arXiv ID from its eprint field alone, as a hand-written bibliography gives it', () => {
  const ok = verifySection(quoting('wrochna2022', NOTE_SAYS), NOTE_BIB);
  assert.equal(ok.status, 0, ok.out);
  assert.deepEqual(ok.record.quotes.map((q) => q.verdict), ['OK'], ok.out);
  const changed = verifySection(quoting('wrochna2022', NOTE_CHANGED), NOTE_BIB);
  assert.equal(changed.status, 2, changed.out);
  assert.deepEqual(changed.record.quotes.map((q) => q.verdict), ['NOT_FOUND'], changed.out);
});
