// tests/done-final-record.test.ts — VRFY-26, Phase 20 success criterion 5
// (main-branch merge review, round 1): FINAL.md is the file pensmith calls
// the finished paper, so a FINAL.md no gate judged is never reported as one.
//
// In Tier 2 no humanizer runs (the built CLI has no Task transport), so done
// exports the compiled DRAFT.md. Before this, a FINAL.md newer than DRAFT.md
// was kept as "a humanized manuscript of this compile", and the router called
// the paper complete from FINAL.md's mtime alone:
//
//   - done leaves FINAL.md holding exactly the text it exported and records
//     both hashes in .paper/DONE-RECORD.json (done-record.ts);
//   - a hand edit of that FINAL.md is refused by done (exit 4, FINAL.md and
//     export/ untouched) and is attention for the router — never "complete",
//     and bare `pensmith` never runs done over it;
//   - a FINAL.md written by hand, done never run, likewise;
//   - moved out of the paper folder, done exports and the paper is complete.
//
// Built CLI, sources offline (the cited works are recorded), model stubbed, no
// task runner — the path every CLI user takes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { seedGatePaper, mtimes, RECORDED_BIB, type GatePaper } from './helpers/gate-paper.js';
import { STACK_LINE } from './helpers/paper-cli-harness.js';

const SECTIONS = [
  { n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Introduction\n\nDeep networks learn layered representations of their input data [@lecun2015].\n' },
  { n: 2, slug: 'measurement', assigned: ['aspelmeyer2009'], draft: '# Measurement\n\nMeasurement in quantum physics shapes what an observer can record [@aspelmeyer2009].\n' },
];

const ENV = { PENSMITH_NO_LLM: '1', PENSMITH_CONTACT_EMAIL: undefined };

const EDITED = /\.paper\/FINAL\.md is not the text `pensmith done` exported \(it was edited or written by hand\) [-—] done exports only the compiled draft it checks and never replaces your file: make the edit in the section drafts .*move \.paper\/FINAL\.md out of the paper folder, and run `pensmith done`/;

const HAND_EDIT = '\nAs (Nguyen & Patel, 2019) showed, [@Fake2021] and @fake2019 agree.[^1]\n\n[^1]: A note typed by hand.\n';

function sha(p: string): string {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

/** A two-section paper, verified, compiled and done through the built CLI. */
function finishedPaper(prefix: string): GatePaper {
  const p = seedGatePaper(prefix, SECTIONS, RECORDED_BIB);
  for (const s of SECTIONS) {
    const v = p.cli(['verify', String(s.n)], ENV);
    assert.equal(v.status, EXIT_OK, `verify ${s.n}\n${v.stdout}\n${v.stderr}`);
  }
  const c = p.cli(['compile', '--yolo'], ENV);
  assert.equal(c.status, EXIT_OK, `compile\n${c.stdout}\n${c.stderr}`);
  return p;
}

function paperFile(p: GatePaper, name: string): string {
  return join(p.root, '.paper', name);
}

test('VRFY-26 (built CLI, no humanizer): done leaves FINAL.md = the text it exported and records both hashes; the paper is complete', () => {
  const p = finishedPaper('done-final-record');
  const d = p.cli(['done', '--yolo', '--format', 'md'], ENV);
  assert.equal(d.status, EXIT_OK, `${d.stdout}\n${d.stderr}`);
  assert.equal(readFileSync(paperFile(p, 'FINAL.md'), 'utf8'), readFileSync(paperFile(p, 'DRAFT.md'), 'utf8'), 'FINAL.md is the compiled draft done judged');
  const record = JSON.parse(readFileSync(paperFile(p, 'DONE-RECORD.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(record['$schemaVersion'], 1);
  assert.equal(record['compiled_draft_sha256'], sha(paperFile(p, 'DRAFT.md')));
  assert.equal(record['final_sha256'], sha(paperFile(p, 'FINAL.md')));
  assert.equal(record['humanized'], false);
  assert.match(p.cli(['status'], ENV).stdout, /current: complete/);
  const bare = p.cli(['--yolo'], ENV);
  assert.equal(bare.status, EXIT_OK, `${bare.stdout}\n${bare.stderr}`);
  assert.match(bare.stderr, /^pensmith: ran status \(done\)/m, 'nothing left to run');
});

test('VRFY-26 / criterion 5 (built CLI, no humanizer): a hand edit of the exported FINAL.md is refused by done (exit 4, FINAL.md and export/ untouched) and is attention — never "complete"; moved away, done exports again', () => {
  const p = finishedPaper('done-final-edited');
  const first = p.cli(['done', '--yolo', '--format', 'md'], ENV);
  assert.equal(first.status, EXIT_OK, `${first.stdout}\n${first.stderr}`);
  appendFileSync(paperFile(p, 'FINAL.md'), HAND_EDIT);
  const edited = readFileSync(paperFile(p, 'FINAL.md'));
  const exportBefore = mtimes(join(p.root, '.paper', 'export'));
  const sectionsBefore = mtimes(join(p.root, '.paper', 'sections'));

  const d = p.cli(['done', '--yolo', '--format', 'md'], ENV);
  assert.equal(d.status, EXIT_BLOCKED, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /pensmith done: BLOCKED/);
  assert.match(d.stdout, EDITED);
  assert.doesNotMatch(d.stderr, STACK_LINE);
  assert.deepEqual(readFileSync(paperFile(p, 'FINAL.md')), edited, 'the hand edit is never replaced');
  assert.deepEqual(mtimes(join(p.root, '.paper', 'export')), exportBefore, 'nothing exported');
  assert.deepEqual(mtimes(join(p.root, '.paper', 'sections')), sectionsBefore, 'done never writes under sections/');

  const s = p.cli(['status'], ENV);
  assert.doesNotMatch(s.stdout, /current: complete/);
  assert.match(s.stdout, /current: needs attention/);
  assert.match(s.stdout, EDITED);
  // Bare `pensmith` reports the attention; it never runs done over the edit.
  const bare = p.cli(['--yolo'], ENV);
  assert.equal(bare.status, EXIT_OK, `${bare.stdout}\n${bare.stderr}`);
  assert.doesNotMatch(bare.stderr, /ran status \(done\)|ran done/);
  assert.deepEqual(readFileSync(paperFile(p, 'FINAL.md')), edited);

  // The remedy: move the file out of the paper folder, then done exports again.
  renameSync(paperFile(p, 'FINAL.md'), join(p.root, 'FINAL.mine.md'));
  const again = p.cli(['done', '--yolo', '--format', 'md'], ENV);
  assert.equal(again.status, EXIT_OK, `${again.stdout}\n${again.stderr}`);
  assert.equal(readFileSync(paperFile(p, 'FINAL.md'), 'utf8'), readFileSync(paperFile(p, 'DRAFT.md'), 'utf8'));
  assert.match(p.cli(['status'], ENV).stdout, /current: complete/);
});

test('VRFY-26 (built CLI, no humanizer): a FINAL.md written by hand, done never run, is attention — bare `pensmith` never calls the paper complete, done refuses it', () => {
  const p = finishedPaper('done-final-handwritten');
  writeFileSync(paperFile(p, 'FINAL.md'), 'A hand-written final paper citing [@Fake2021].\n');
  const s = p.cli(['status'], ENV);
  assert.doesNotMatch(s.stdout, /current: complete/);
  assert.match(s.stdout, EDITED);
  const bare = p.cli(['--yolo'], ENV);
  assert.equal(bare.status, EXIT_OK, `${bare.stdout}\n${bare.stderr}`);
  assert.doesNotMatch(bare.stderr, /ran status \(done\)|ran done/);
  const d = p.cli(['done', '--yolo', '--format', 'md'], ENV);
  assert.equal(d.status, EXIT_BLOCKED, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, EDITED);
  assert.ok(!existsSync(join(p.root, '.paper', 'export')), 'nothing exported');
  assert.ok(!existsSync(paperFile(p, 'DONE-RECORD.json')), 'no record');
  assert.equal(readFileSync(paperFile(p, 'FINAL.md'), 'utf8'), 'A hand-written final paper citing [@Fake2021].\n');
});

test('VRFY-26 (built CLI): a FINAL.md that is the compiled draft with no record (a paper an older pensmith finished) is replaced by done — nothing written by hand is lost', () => {
  const p = finishedPaper('done-final-legacy');
  writeFileSync(paperFile(p, 'FINAL.md'), readFileSync(paperFile(p, 'DRAFT.md')));
  rmSync(paperFile(p, 'DONE-RECORD.json'), { force: true });
  const bare = p.cli(['--yolo'], ENV);
  assert.equal(bare.status, EXIT_OK, `${bare.stdout}\n${bare.stderr}`);
  assert.match(bare.stderr, /^pensmith: ran done; next: status \(done\)$/m);
  assert.ok(readdirSync(join(p.root, '.paper', 'export')).some((f) => f.startsWith('DRAFT.')), 'exported');
  assert.ok(existsSync(paperFile(p, 'DONE-RECORD.json')));
});
