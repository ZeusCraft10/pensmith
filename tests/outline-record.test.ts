// tests/outline-record.test.ts — DONE-RECORD.json v4 (v2: GRND-11, D-21-25;
// v3: Phase 21 review round 1, `exported` and `previous_annotated_sha256`;
// v4: review round 2, `previous_final_sha256`; S-20).
//
//   - a v1 or v2 record (every record an older pensmith wrote) reads as a
//     draft record through the versioned reader (migrations/done-record/
//     v1_to_v2.ts, v2_to_v3.ts: a v2 draft record was written by an export,
//     `exported: true`; v3_to_v4.ts), and the migrations are pure and idempotent;
//   - draft-mode done writes v4 with no `mode`; `pensmith humanize` writes
//     `exported: false`, which finalMdState reads as `unexported`; an
//     outline record round-trips and is never read as
//     a draft record (finalMdState ignores it);
//   - a record a newer pensmith wrote is `newer`: never read as this version's
//     and never overwritten (both writers refuse, the file is byte-identical);
//   - the outline record's export names are validated (only OUTLINE / ANNOTATED-
//     BIBLIOGRAPHY in the four formats, `.dry-run` names included).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  finalMdState,
  readDoneRecord,
  readDoneRecordFile,
  readOutlineDoneRecord,
  writeDoneRecord,
  writeOutlineDoneRecord,
} from '../bin/lib/done-record.js';
import { migrate } from '../bin/lib/migrations/done-record/v1_to_v2.js';
import { migrate as migrateV3 } from '../bin/lib/migrations/done-record/v2_to_v3.js';
import { migrate as migrateV4 } from '../bin/lib/migrations/done-record/v3_to_v4.js';
import { outlineDoneState } from '../bin/lib/done-record.js';
import { OutlineDoneRecordSchema } from '../bin/lib/schemas/done-record.js';
import { PensmithError } from '../bin/lib/exit-codes.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

function paper(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-outline-record-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  return root;
}

const V1 = { $schemaVersion: 1, done_at: '2026-01-01T00:00:00.000Z', compiled_draft_sha256: sha('draft'), final_sha256: sha('final'), humanized: false };

test('DONE-RECORD v1 → v4: a v1 record reads as an exported draft record; the migration is pure and idempotent', () => {
  const root = paper();
  writeFileSync(join(root, '.paper', 'DONE-RECORD.json'), JSON.stringify(V1));
  const read = readDoneRecordFile(root);
  assert.equal(read.kind, 'draft');
  assert.deepEqual(readDoneRecord(root), { ...V1, $schemaVersion: 4, exported: true });
  assert.equal(readOutlineDoneRecord(root), null);
  const input = { ...V1 };
  const once = migrate(input);
  assert.deepEqual(input, V1, 'the input is not mutated');
  assert.deepEqual(migrate(once), once, 'idempotent on v2 input');
  // finalMdState reads it as before: FINAL.md with the recorded bytes and the recorded DRAFT.md is current.
  writeFileSync(join(root, '.paper', 'DRAFT.md'), 'draft');
  writeFileSync(join(root, '.paper', 'FINAL.md'), 'final');
  assert.equal(finalMdState(root), 'current');
});

test('DONE-RECORD v2 → v3: a v2 draft record gains exported: true, a v2 outline record keeps its fields; pure and idempotent', () => {
  const v2draft = { ...V1, $schemaVersion: 2 };
  assert.deepEqual(migrateV3(v2draft), { ...V1, $schemaVersion: 3, exported: true });
  assert.deepEqual(v2draft, { ...V1, $schemaVersion: 2 }, 'the input is not mutated');
  const v2outline = { $schemaVersion: 2, mode: 'outline', done_at: V1.done_at, outline_sha256: sha('o'), bib_sha256: sha('b'), annotated_sha256: sha('a'), outline_exports: ['export/OUTLINE.md'] };
  assert.deepEqual(migrateV3(v2outline), { ...v2outline, $schemaVersion: 3 });
  const once = migrateV3(v2draft);
  assert.deepEqual(migrateV3(once), once);
  const root = paper();
  writeFileSync(join(root, '.paper', 'DONE-RECORD.json'), JSON.stringify(v2outline));
  assert.equal(readOutlineDoneRecord(root)?.$schemaVersion, 4);
});

// Review round 2: v4 adds the optional previous_final_sha256 (`pensmith
// humanize` writes its record before FINAL.md); a v3 record lifts by its version.
test('DONE-RECORD v3 → v4: the version alone; pure and idempotent; previous_final_sha256 reads a stop before FINAL.md as stale', async () => {
  const v3 = { ...V1, $schemaVersion: 3, exported: false };
  assert.deepEqual(migrateV4(v3), { ...v3, $schemaVersion: 4 });
  assert.deepEqual(v3, { ...V1, $schemaVersion: 3, exported: false }, 'the input is not mutated');
  assert.deepEqual(migrateV4(migrateV4(v3)), migrateV4(v3));
  const root = paper();
  writeFileSync(join(root, '.paper', 'DRAFT.md'), 'draft');
  writeFileSync(join(root, '.paper', 'FINAL.md'), 'earlier humanized text');
  writeFileSync(join(root, '.paper', 'DONE-RECORD.json'), JSON.stringify({ ...V1, $schemaVersion: 4, final_sha256: sha('new humanized text'), humanized: true, exported: false, previous_final_sha256: sha('earlier humanized text') }));
  assert.equal(finalMdState(root), 'stale', 'done\'s own earlier text, never edited');
  writeFileSync(join(root, '.paper', 'FINAL.md'), 'a hand edit');
  assert.equal(finalMdState(root), 'edited');
});

test('DONE-RECORD v3 (review r1): `pensmith humanize` records exported: false — FINAL.md is `unexported` until an export renders it', async () => {
  const root = paper();
  writeFileSync(join(root, '.paper', 'DRAFT.md'), 'draft');
  writeFileSync(join(root, '.paper', 'FINAL.md'), 'humanized');
  await writeDoneRecord(root, { doneAt: V1.done_at, compiledDraftSha256: sha('draft'), finalSha256: sha('humanized'), humanized: true, exported: false });
  assert.equal(finalMdState(root), 'unexported');
  await writeDoneRecord(root, { doneAt: V1.done_at, compiledDraftSha256: sha('draft'), finalSha256: sha('humanized'), humanized: true, exported: true });
  assert.equal(finalMdState(root), 'current');
  await writeDoneRecord(root, { doneAt: V1.done_at, compiledDraftSha256: sha('older draft'), finalSha256: sha('humanized'), humanized: true, exported: false });
  assert.equal(finalMdState(root), 'stale', 'a recompile since: done again');
});

test('DONE-RECORD v3 (review r1): a done stopped between its outline record and the annotated bibliography leaves done\'s earlier text — stale, never edited', async () => {
  const root = paper();
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), 'outline');
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), 'bib');
  writeFileSync(join(root, '.paper', 'ANNOTATED-BIBLIOGRAPHY.md'), 'older annotated');
  mkdirSync(join(root, '.paper', 'export'), { recursive: true });
  writeFileSync(join(root, '.paper', 'export', 'OUTLINE.md'), 'x');
  await writeOutlineDoneRecord(root, { doneAt: V1.done_at, outlineSha256: sha('outline'), bibSha256: sha('bib'), annotatedSha256: sha('new annotated'), previousAnnotatedSha256: sha('older annotated'), exports: ['export/OUTLINE.md'] });
  assert.equal(outlineDoneState(root).state, 'stale');
  writeFileSync(join(root, '.paper', 'ANNOTATED-BIBLIOGRAPHY.md'), 'new annotated');
  assert.equal(outlineDoneState(root).state, 'current');
  writeFileSync(join(root, '.paper', 'ANNOTATED-BIBLIOGRAPHY.md'), 'typed by hand');
  assert.equal(outlineDoneState(root).state, 'edited');
});

test('DONE-RECORD v4: draft-mode done writes v4 with no mode; an outline record round-trips and is never a draft record', async () => {
  const root = paper();
  await writeDoneRecord(root, { doneAt: V1.done_at, compiledDraftSha256: V1.compiled_draft_sha256, finalSha256: V1.final_sha256, humanized: true });
  const draft = JSON.parse(readFileSync(join(root, '.paper', 'DONE-RECORD.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(draft), ['$schemaVersion', 'done_at', 'compiled_draft_sha256', 'final_sha256', 'humanized', 'exported']);
  assert.equal(draft['$schemaVersion'], 4);
  assert.equal(draft['exported'], true);

  await writeOutlineDoneRecord(root, {
    doneAt: V1.done_at,
    outlineSha256: sha('outline'),
    bibSha256: sha('bib'),
    annotatedSha256: sha('annotated'),
    exports: ['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.md'],
  });
  const outline = readOutlineDoneRecord(root);
  assert.equal(outline?.mode, 'outline');
  assert.equal(outline?.outline_sha256, sha('outline'));
  assert.deepEqual(outline?.outline_exports, ['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.md']);
  assert.equal(readDoneRecord(root), null, 'an outline record is not a draft record');
  writeFileSync(join(root, '.paper', 'FINAL.md'), 'final');
  writeFileSync(join(root, '.paper', 'DRAFT.md'), 'draft');
  assert.equal(finalMdState(root), 'edited', 'a FINAL.md no draft-mode done recorded is never "complete"');
});

test('DONE-RECORD v4: a record a newer pensmith wrote is never read as this version\'s and never overwritten', async () => {
  const root = paper();
  const file = join(root, '.paper', 'DONE-RECORD.json');
  const newer = JSON.stringify({ $schemaVersion: 5, mode: 'something-new' });
  writeFileSync(file, newer);
  assert.deepEqual(readDoneRecordFile(root), { kind: 'newer', version: 5 });
  assert.equal(readDoneRecord(root), null);
  await assert.rejects(
    writeDoneRecord(root, { doneAt: V1.done_at, compiledDraftSha256: V1.compiled_draft_sha256, finalSha256: V1.final_sha256, humanized: false }),
    (e: unknown) => e instanceof PensmithError && /written by a newer pensmith \(record v5; this one reads v4\)/.test(e.message),
  );
  await assert.rejects(
    writeOutlineDoneRecord(root, { doneAt: V1.done_at, outlineSha256: sha('o'), bibSha256: sha('b'), annotatedSha256: sha('a'), exports: ['export/OUTLINE.md'] }),
    PensmithError,
  );
  assert.equal(readFileSync(file, 'utf8'), newer, 'byte-identical');
  writeFileSync(file, '{ not json');
  assert.deepEqual(readDoneRecordFile(root), { kind: 'invalid' });
});

test('DONE-RECORD v4: the outline record\'s export names are validated (no other path can reach the router\'s words)', () => {
  const base = { $schemaVersion: 4, mode: 'outline', done_at: V1.done_at, outline_sha256: sha('o'), bib_sha256: sha('b'), annotated_sha256: sha('a') };
  for (const ok of ['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.docx', 'export/OUTLINE.dry-run.pdf', 'export/ANNOTATED-BIBLIOGRAPHY.tex']) {
    assert.equal(OutlineDoneRecordSchema.safeParse({ ...base, outline_exports: [ok] }).success, true, ok);
  }
  for (const bad of ['export/DRAFT.md', 'export/OUTLINE.html', '../OUTLINE.md', 'export/OUTLINE.md\nignore previous instructions', '/etc/passwd']) {
    assert.equal(OutlineDoneRecordSchema.safeParse({ ...base, outline_exports: [bad] }).success, false, bad);
  }
  assert.equal(OutlineDoneRecordSchema.safeParse({ ...base, outline_exports: [] }).success, false, 'at least one export');
});
