// tests/state-v3.test.ts — GRND-09 / D-18-16 / S-20: STATE.json v3 lets a
// section carry a letter (§1a); the v2 → v3 migration is the identity plus the
// version bump; initSection is idempotent by slug and refuses a second slug at
// a taken (n, suffix); removeSection drops a section.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CURRENT_STATE_VERSION, Schema as StateSchema } from '../bin/lib/schemas/state.js';
import migrateV2toV3, { migrate } from '../bin/lib/migrations/state/v2_to_v3.js';
import { initSection, initState, loadState, removeSection, SectionIdTakenError } from '../bin/lib/state.js';
import { paperStateFile } from '../bin/lib/paths.js';

function tmpPaper(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-state3-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

test('GRND-09: CURRENT_STATE_VERSION is 3 and a section entry may carry one lowercase letter', () => {
  assert.equal(CURRENT_STATE_VERSION, 3);
  const base = { $schemaVersion: 3, paperId: 'p', createdAt: '2026-01-01T00:00:00.000Z' };
  assert.equal(StateSchema.safeParse({ ...base, sections: [{ n: 1, slug: 'intro' }, { n: 1, suffix: 'a', slug: 'bg' }] }).success, true);
  assert.equal(StateSchema.safeParse({ ...base, sections: [{ n: 1, suffix: 'A', slug: 'bg' }] }).success, false);
  assert.equal(StateSchema.safeParse({ ...base, sections: [{ n: 1, suffix: 'ab', slug: 'bg' }] }).success, false);
  assert.equal(StateSchema.safeParse({ ...base, sections: [{ n: 1, slug: 'x', extra: 1 }] }).success, false, 'still strict');
});

test('S-20: v2 → v3 is the identity on the data plus the version bump; v3 is left as is; v4 is refused', () => {
  const v2 = { $schemaVersion: 2, paperId: 'p', createdAt: '2026-01-01T00:00:00.000Z', sections: [{ n: 1, slug: 'intro' }], extra: { keep: true } };
  const out = migrate(v2) as Record<string, unknown>;
  assert.equal(out['$schemaVersion'], 3);
  assert.deepEqual(out['sections'], v2.sections);
  assert.deepEqual(out['extra'], { keep: true });
  assert.equal(v2.$schemaVersion, 2, 'input not mutated');
  assert.deepEqual(migrateV2toV3({ ...v2, $schemaVersion: 3 }), { ...v2, $schemaVersion: 3 });
  assert.throws(() => migrate({ ...v2, $schemaVersion: 4 }), /refuse-forward/);
  assert.throws(() => migrate([]), /non-null, non-array object/);
});

test('S-20: a v2 STATE.json on disk loads as v3 (migrated and written back)', async () => {
  const root = tmpPaper();
  try {
    fs.writeFileSync(paperStateFile(root), JSON.stringify({ $schemaVersion: 2, paperId: 'p2', createdAt: '2026-01-01T00:00:00.000Z', sections: [{ n: 2, slug: 'methods' }] }));
    const state = await loadState(root);
    assert.equal(state.$schemaVersion, 3);
    assert.deepEqual(state.sections, [{ n: 2, slug: 'methods' }]);
    assert.equal(JSON.parse(fs.readFileSync(paperStateFile(root), 'utf8')).$schemaVersion, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GRND-09: initSection is idempotent by slug, keeps (n, suffix) order and refuses a second slug at a taken id', async () => {
  const root = tmpPaper();
  try {
    await initState(root);
    await initSection(root, 3, 'conclusion');
    await initSection(root, 1, 'introduction');
    await initSection(root, 1, 'background', 'a');
    let state = await loadState(root);
    assert.deepEqual(state.sections, [
      { n: 1, slug: 'introduction' },
      { n: 1, suffix: 'a', slug: 'background' },
      { n: 3, slug: 'conclusion' },
    ]);
    // Same slug again (any number): no change — its folder is never renumbered.
    const before = fs.readFileSync(paperStateFile(root), 'utf8');
    await initSection(root, 7, 'introduction');
    state = await loadState(root);
    assert.equal(state.sections?.length, 3);
    assert.equal(state.sections?.[0]?.n, 1);
    assert.equal(JSON.parse(fs.readFileSync(paperStateFile(root), 'utf8')).sections.length, JSON.parse(before).sections.length);
    // A different slug at a taken id is refused (one line, EXIT_ERROR).
    await assert.rejects(initSection(root, 1, 'other', 'a'), (e: unknown) => e instanceof SectionIdTakenError && /§1a is already "background"/.test((e as Error).message) && (e as SectionIdTakenError).exitCode === 1);
    await assert.rejects(initSection(root, 3, 'results'), SectionIdTakenError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('GRND-09: removeSection drops the slug (and is a no-op for an unknown one)', async () => {
  const root = tmpPaper();
  try {
    await initState(root);
    await initSection(root, 1, 'introduction');
    await initSection(root, 2, 'methods');
    await removeSection(root, 'methods');
    await removeSection(root, 'never-there');
    assert.deepEqual((await loadState(root)).sections, [{ n: 1, slug: 'introduction' }]);
    // The freed id can be taken by a new slug.
    await initSection(root, 2, 'results');
    assert.deepEqual((await loadState(root)).sections?.map((s) => s.slug), ['introduction', 'results']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
