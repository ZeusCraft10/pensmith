// tests/stale-inputs.test.ts — VRFY-27 (D-20-23, D-20-24): done exports only
// the compiled draft compile wrote from the verifications the sections hold
// now. Each stale input is refused with its own reason, listed together:
//   - a section draft changed since its verification (`stale: §N changed since
//     verification — re-verify and recompile`);
//   - a section verified again (or its record changed) since compile (`stale:
//     §N was verified again or changed since compile — recompile`);
//   - a compile record from an older pensmith (COMPILE-INPUTS.json v1, migrated
//     with null hashes) or none at all (`recompile`).
// The v1 → v2 migration keeps every v1 value and adds the two fields as null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXIT_BLOCKED, EXIT_OK } from '../bin/lib/exit-codes.js';
import { readCompileInputs, compileRecordProblems } from '../bin/lib/compile-inputs.js';
import { migrate as v1ToV2 } from '../bin/lib/migrations/compile-inputs/v1_to_v2.js';
import { seedGatePaper, mtimes, RECORDED_BIB, type GatePaper } from './helpers/gate-paper.js';

const SECTIONS = [
  { n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Introduction\n\nDeep networks learn layered representations of their input data [@lecun2015].\n' },
  { n: 2, slug: 'measurement', assigned: ['aspelmeyer2009'], draft: '# Measurement\n\nMeasurement in quantum physics shapes what an observer can record [@aspelmeyer2009].\n' },
];

function compiledPaper(prefix: string): GatePaper {
  const p = seedGatePaper(prefix, SECTIONS, RECORDED_BIB);
  for (const s of SECTIONS) assert.equal(p.cli(['verify', String(s.n)]).status, EXIT_OK);
  const c = p.cli(['compile', '--yolo']);
  assert.equal(c.status, EXIT_OK, `${c.stdout}\n${c.stderr}`);
  return p;
}

function done(p: GatePaper): { status: number | null; out: string } {
  const d = p.cli(['done', '--yolo', '--format', 'md']);
  return { status: d.status, out: `${d.stdout}\n${d.stderr}` };
}

test('VRFY-27: COMPILE-INPUTS.json v1 → v2 keeps every v1 value and adds the compiled-draft and verified hashes as null (idempotent)', () => {
  const v1 = { $schemaVersion: 1, compiled_at: '2026-01-01T00:00:00.000Z', sections: [{ id: '1', slug: 'intro', draft_sha256: 'a'.repeat(64), verification_sha256: 'b'.repeat(64) }] };
  const v2 = v1ToV2(v1);
  assert.deepEqual(v2, {
    $schemaVersion: 2,
    compiled_at: '2026-01-01T00:00:00.000Z',
    compiled_draft_sha256: null,
    sections: [{ id: '1', slug: 'intro', draft_sha256: 'a'.repeat(64), verification_sha256: 'b'.repeat(64), verified_against_draft_hash: null }],
  });
  assert.deepEqual(v1ToV2(v2), v2, 'idempotent on v2 input');
  assert.equal((v1 as { $schemaVersion: number }).$schemaVersion, 1, 'the input is never mutated');
});

test('VRFY-27 (built CLI): a section draft changed since its verification — done is BLOCKED naming it stale (and the compile record too); nothing exported', () => {
  const p = compiledPaper('stale-draft');
  writeFileSync(join(p.sectionDir(1, 'intro'), 'DRAFT.md'), `${SECTIONS[0]!.draft}\nA sentence added later.\n`);
  const sectionsBefore = mtimes(join(p.root, '.paper', 'sections'));
  const d = done(p);
  assert.equal(d.status, EXIT_BLOCKED, d.out);
  assert.match(d.out, /stale: §1 changed since verification — re-verify and recompile/);
  assert.doesNotMatch(d.out, /§2 changed since verification/);
  assert.ok(!existsSync(join(p.root, '.paper', 'export')));
  assert.deepEqual(mtimes(join(p.root, '.paper', 'sections')), sectionsBefore, 'done never writes under sections/');
});

test('VRFY-27 (built CLI): a section re-drafted and verified again after compile — done asks for a recompile; the recompile clears it', () => {
  const p = compiledPaper('stale-reverified');
  writeFileSync(join(p.sectionDir(2, 'measurement'), 'DRAFT.md'), '# Measurement\n\nWhat an observer can record depends on how the measurement is made [@aspelmeyer2009].\n');
  assert.equal(p.cli(['verify', '2']).status, EXIT_OK);
  const d = done(p);
  assert.equal(d.status, EXIT_BLOCKED, d.out);
  assert.match(d.out, /stale: §2 was verified again or changed since compile — recompile with `pensmith compile`/);
  assert.equal(p.cli(['compile', '--yolo']).status, EXIT_OK);
  const again = done(p);
  assert.equal(again.status, EXIT_OK, again.out);
});

test('VRFY-27 (built CLI): a compile record from an older pensmith (v1) or none at all — done is BLOCKED asking for a recompile; the router sends a bare run to compile', () => {
  const p = compiledPaper('stale-v1');
  const inputs = join(p.root, '.paper', 'COMPILE-INPUTS.json');
  const rec = JSON.parse(readFileSync(inputs, 'utf8')) as { compiled_at: string; sections: Array<Record<string, unknown>> };
  writeFileSync(
    inputs,
    JSON.stringify({ $schemaVersion: 1, compiled_at: rec.compiled_at, sections: rec.sections.map((s) => ({ id: s['id'], slug: s['slug'], draft_sha256: s['draft_sha256'], verification_sha256: s['verification_sha256'] })) }),
  );
  const migrated = readCompileInputs(p.root);
  assert.equal(migrated?.compiled_draft_sha256, null);
  assert.ok(migrated?.sections.every((s) => s.verified_against_draft_hash === null));
  const problems = compileRecordProblems(p.root, SECTIONS.map((s) => ({ n: s.n, slug: s.slug })), new Map([['1', 'x'], ['2', 'y']]));
  assert.match(problems.join('\n'), /compiled by an older pensmith that recorded no hash of it — recompile/);
  assert.match(problems.join('\n'), /stale: §1 was verified again or changed since compile/);

  const d = done(p);
  assert.equal(d.status, EXIT_BLOCKED, d.out);
  assert.match(d.out, /stale: \.paper\/DRAFT\.md was compiled by an older pensmith that recorded no hash of it — recompile with `pensmith compile`/);
  assert.match(p.cli(['status']).stdout, /next: compile/);

  rmSync(inputs);
  const none = done(p);
  assert.equal(none.status, EXIT_BLOCKED, none.out);
  assert.match(none.out, /stale: \.paper\/DRAFT\.md has no compile record \(COMPILE-INPUTS\.json\) — recompile with `pensmith compile`/);
  assert.ok(!existsSync(join(p.root, '.paper', 'export')));
});
