// tests/bom-draft-cli.test.ts — review round 3: a section draft saved with a
// UTF-8 byte-order mark (Windows Notepad does) is read the way Pandoc reads
// it. Pandoc strips one leading U+FEFF and parses line 1 normally, so a block
// quote, a YAML metadata block or a raw fence on line 1 is what the export
// renders — the gate must see it too. compile strips each section's leading
// mark when it concatenates, so the compiled DRAFT.md holds no U+FEFF in the
// middle (Pandoc would keep that one as a character).
//
// Built CLI, sources offline (lecun2015 and aspelmeyer2009 are recorded
// Crossref works: Pass 1 OK with no network).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { seedGatePaper, LECUN_BIB, ASPELMEYER_BIB } from './helpers/gate-paper.js';

const BOM = '﻿';

test('review round 3 (built CLI): a fabricated block quote on line 1 after a byte-order mark is UNATTRIBUTED at verify — never "(no direct quotes)"', () => {
  const draft = `${BOM}> Deep networks will soon replace every radiologist in all hospitals, and no human reader will be needed.\n\nLeCun and colleagues wrote this [@lecun2015].\n`;
  const p = seedGatePaper('bom-quote', [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft }], LECUN_BIB);
  const v = p.cli(['verify', '1', '--yolo']);
  assert.equal(v.status, EXIT_BLOCKED, `${v.stdout}\n${v.stderr}`);
  const md = readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8');
  assert.match(md, /^Status: failed$/m);
  assert.match(md, /^- \(unattributed\) \[q1\] \("Deep networks will soon replace every ra…"\): \*\*UNATTRIBUTED\*\*/m);
  assert.doesNotMatch(md, /no direct quotes/);
});

test('review round 3 (built CLI): a YAML metadata block after a byte-order mark is UNSUPPORTED-FORM at verify', () => {
  const draft = `${BOM}---\nreferences:\n- id: lecun2015\n  title: Totally Invented Work\n---\n\nDeep learning changed vision [@lecun2015].\n`;
  const p = seedGatePaper('bom-meta', [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft }], LECUN_BIB);
  const v = p.cli(['verify', '1', '--yolo']);
  assert.equal(v.status, EXIT_BLOCKED, `${v.stdout}\n${v.stderr}`);
  assert.match(readFileSync(join(p.sectionDir(1, 'intro'), 'VERIFICATION.md'), 'utf8'), /^- \(L1\): \*\*UNSUPPORTED-FORM\*\* — titleJW=n\/a, authorJW=n\/a — `---`: a Pandoc metadata block/m);
});

test('review round 3 (built CLI): compile strips each section\'s leading byte-order mark — the compiled DRAFT.md holds none', () => {
  const p = seedGatePaper(
    'bom-compile',
    [
      { n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Intro\n\nDeep learning changed computer vision [@lecun2015].\n' },
      { n: 2, slug: 'mirrors', assigned: ['aspelmeyer2009'], draft: `${BOM}# Mirrors\n\nMeasurement was reviewed at length [@aspelmeyer2009].\n` },
    ],
    LECUN_BIB + ASPELMEYER_BIB,
  );
  for (const n of ['1', '2']) {
    const v = p.cli(['verify', n, '--yolo']);
    assert.equal(v.status, EXIT_OK, `verify ${n}: ${v.stdout}\n${v.stderr}`);
  }
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `${c.stdout}\n${c.stderr}`);
  const compiled = readFileSync(join(p.root, '.paper', 'DRAFT.md'), 'utf8');
  assert.ok(!compiled.includes(BOM), 'no byte-order mark in the compiled draft');
  assert.match(compiled, /^# Mirrors$/m, 'section 2 opens with its heading');
});
