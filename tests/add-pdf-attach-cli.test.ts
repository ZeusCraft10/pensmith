// tests/add-pdf-attach-cli.test.ts — `add <id> --pdf <file>` attaches a PDF
// only when it is that work, or when the user says so (SRC-13, SRC-15;
// Phase 19 review round 1), through the BUILT CLI on recorded answers.
//
//   - the right PDF (doi-footer.pdf is "Measured measurement", 10.1038/nphys1170)
//     is attached;
//   - a different work's PDF is refused without a terminal — even with --yolo
//     (gate `pdf-attach-unmatched`, exit 3) — and nothing changes;
//   - confirmed at the gate, it is attached "at your word" and recorded
//     `byo.asserted`, and its text never verifies a quote (Pass 3 says why);
//   - an identified copy is never replaced without --replace-pdf.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { sandbox, runCli, writeState, writeOutline, writePlan, sectionDirOf, REPO, STACK_LINE } from './helpers/paper-cli-harness.js';

const BYO = path.join(REPO, 'tests', 'fixtures', 'byo');
const sha = (f: string): string => createHash('sha256').update(fs.readFileSync(f)).digest('hex');

interface Entry {
  citekey: string;
  byo: { file: string; sha256: string; asserted: boolean } | null;
}
const library = (root: string): Entry[] =>
  (JSON.parse(fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8')) as { entries: Entry[] }).entries;

test('SRC-13 (built CLI): `add <doi> --pdf` attaches the right PDF, refuses another work\'s PDF (even --yolo) and never replaces an identified copy silently', () => {
  const sb = sandbox('add-pdf-attach');
  const root = sb.project('p');
  writeState(root, [], 'add-pdf-attach');
  fs.copyFileSync(path.join(BYO, 'doi-footer.pdf'), path.join(root, 'measured.pdf'));
  fs.copyFileSync(path.join(BYO, 'no-match.pdf'), path.join(root, 'moss.pdf'));

  const ok = runCli(sb, root, ['add', '10.1038/nphys1170', '--pdf', 'measured.pdf', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
  assert.match(ok.stdout, /attached measured\.pdf to aspelmeyer2009 as its bring-your-own copy \(\.paper\/sources\/\)\.$/m);
  const stored = path.join(root, '.paper', 'sources', 'aspelmeyer2009.pdf');
  assert.equal(sha(stored), sha(path.join(BYO, 'doi-footer.pdf')));
  assert.equal(library(root)[0]!.byo!.asserted, false);

  const libBefore = fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8');
  const refused = runCli(sb, root, ['add', '10.1038/nphys1170', '--pdf', 'moss.pdf', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(refused.status, 3, `${refused.stdout}\n${refused.stderr}`);
  assert.doesNotMatch(refused.stderr, STACK_LINE);
  assert.match(refused.stderr, /WARN — moss\.pdf: its first page does not show "Measured measurement" by Aspelmeyer, Markus/);
  assert.match(refused.stderr, /--yolo does not skip this gate/);
  assert.equal(sha(stored), sha(path.join(BYO, 'doi-footer.pdf')), 'the identified copy is untouched');
  assert.equal(fs.readFileSync(path.join(root, '.paper', 'LIBRARY.json'), 'utf8'), libBefore, 'LIBRARY.json unchanged');

  // Confirmed at the gate, but the work already has its identified PDF: kept without --replace-pdf.
  const kept = runCli(sb, root, ['add', '10.1038/nphys1170', '--pdf', 'moss.pdf'], {
    timeoutMs: 120_000,
    input: 'y\n',
    env: { PENSMITH_PROMPT_MODE: 'numbered' },
  });
  assert.equal(kept.status, 1, `${kept.stdout}\n${kept.stderr}`);
  assert.match(kept.stderr, /already has a PDF \(sources\/aspelmeyer2009\.pdf\).*pass --replace-pdf to replace it/);
  assert.equal(sha(stored), sha(path.join(BYO, 'doi-footer.pdf')));
});

test('SRC-13 (built CLI): a PDF attached at the user\'s word is recorded asserted, and Pass 3 never verifies a quote against it', () => {
  const sb = sandbox('add-pdf-asserted');
  const root = sb.project('p');
  writeState(root, [], 'add-pdf-asserted');
  fs.copyFileSync(path.join(BYO, 'no-match.pdf'), path.join(root, 'moss.pdf'));
  const r = runCli(sb, root, ['add', '10.1038/nphys1170', '--pdf', 'moss.pdf'], {
    timeoutMs: 120_000,
    input: 'y\n',
    env: { PENSMITH_PROMPT_MODE: 'numbered' },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /attached moss\.pdf to aspelmeyer2009 as its bring-your-own copy \(\.paper\/sources\/\) — at your word: its text is not used to verify quotes\./);
  assert.equal(library(root)[0]!.byo!.asserted, true);

  // A draft quoting the attached PDF's own words: never OK through that text.
  writeState(root, [{ n: 1, slug: 'background' }], 'add-pdf-asserted');
  writeOutline(root, [{ n: 1, slug: 'background', sources: ['aspelmeyer2009'] }]);
  writePlan(root, 1, 'background', { status: 'written', assigned_sources: '[aspelmeyer2009]' });
  fs.writeFileSync(
    path.join(sectionDirOf(root, 1, 'background'), 'DRAFT.md'),
    '# Background\n\nThe notes say "these notes record weekly observations of moss cover on six stones beside the mill stream" [@aspelmeyer2009].\n',
  );
  const v = runCli(sb, root, ['verify', '1', '--yolo'], { timeoutMs: 120_000 });
  const md = fs.readFileSync(path.join(sectionDirOf(root, 1, 'background'), 'VERIFICATION.md'), 'utf8');
  // D-20-20: a Pass-3 row names its quote id — `- <key> [q<N>] ("<snippet>…")`.
  assert.doesNotMatch(md, /aspelmeyer2009 \[q1\] \("these notes record[^\n]*\*\*OK\*\*/, `${v.stdout}\n${v.stderr}`);
  assert.match(md, /aspelmeyer2009 \[q1\] \("these notes record[^\n]*was attached although its first page does not show this work/);
});

test('SRC-13 (built CLI): an essay whose footnote cites "Deep learning" with its DOI is never added as LeCun 2015', () => {
  const sb = sandbox('add-pdf-footnote');
  const root = sb.project('p');
  writeState(root, [], 'add-pdf-footnote');
  fs.copyFileSync(path.join(BYO, 'cites-in-footnote.pdf'), path.join(root, 'essay.pdf'));
  // The DOI lookup (recorded Crossref record of 10.1038/nature14539) and the
  // essay's own title search (recorded at Crossref) are answered; OpenAlex's
  // title search has no recording offline — either way the cited work is refused.
  const r = runCli(sb, root, ['add', 'essay.pdf', '--yolo'], { timeoutMs: 120_000 });
  assert.equal(r.status, 1, `${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stdout, /lecun2015|identified by 10\.1038\/nature14539/);
  assert.equal(fs.existsSync(path.join(root, '.paper', 'LIBRARY.json')), false, 'nothing added');
  assert.equal(fs.existsSync(path.join(root, '.paper', 'sources')), false, 'no bring-your-own copy stored');
});
