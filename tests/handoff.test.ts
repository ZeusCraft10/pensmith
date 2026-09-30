// tests/handoff.test.ts — HANDOFF.json v2 (PLUG-14, D-23a-16; D-17, D-18).
//
// - The v2 schema: phase ∈ {intake, research, outline, sectioning, compile,
//   export, done, attention}, a section id, a plan/write/verify position set
//   exactly inside `sectioning`, and the v1 bounds (≤ 5 breadcrumbs, ≤ 5120
//   bytes).
// - The router decision → position mapping for every decision kind.
// - The v1 → v2 migration (bin/lib/migrations/handoff/v1_to_v2.ts) and the
//   reader: v1 is migrated in memory (the file is not rewritten), a file newer
//   than v2 is ignored and left in place, anything else invalid reads as such.
// - The write: atomic, schema-checked, and no lock file beside HANDOFF.json in
//   `.paper/` (the lock lives in the data dir, D-40).
// The PreCompact hook that writes it is exercised through its bundle in
// tests/hooks/pre-compact.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleHandoff,
  describeHandoffPosition,
  handoffPositionOf,
  HandoffSchema,
  loadHandoff,
  nextActionOf,
  nextStepLabel,
  readHandoff,
  writeHandoff,
  type Handoff,
} from '../bin/lib/handoff.js';
import { HandoffV1Schema } from '../bin/lib/schemas/handoff.js';
import { migrate } from '../bin/lib/migrations/handoff/v1_to_v2.js';
import type { RouterDecision } from '../bin/lib/router.js';
import { CLI_BIN, runCli, sandbox } from './helpers/paper-cli-harness.js';
import { seedThreeSectionPaper } from './helpers/status-fixture.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');

function paperDirFixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'pensmith-handoff-')), '.paper');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const V2_MINIMAL: Handoff = {
  schema_version: 2,
  last_updated: '2026-01-01T00:00:00.000Z',
  phase: 'research',
  section: null,
  position: null,
  current_section: null,
  next_action: 'Find and evaluate sources: run /pensmith (or `pensmith research`).',
  breadcrumbs: [],
  section_pointers: [],
};

function v1(phase: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    last_updated: '2026-01-01T00:00:00.000Z',
    current_section: 'methods',
    phase,
    next_action: `Resume ${phase} on section methods. Last verb: plan.`,
    breadcrumbs: [{ ts: '2026-01-01T00:00:00.000Z', verb: 'plan', section: 'methods', ok: true }],
    section_pointers: [
      { slug: 'intro', plan_path: '/p/.paper/sections/01-intro/PLAN.md', draft_path: null, verification_path: null, state: 'verified' },
      { slug: 'methods', plan_path: 'C:\\p\\.paper\\sections\\02a-methods\\PLAN.md', draft_path: null, verification_path: null, state: 'writing' },
    ],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

test('HANDOFF v2: the schema accepts a minimal document and keeps the v1 bounds', () => {
  assert.ok(HandoffSchema.safeParse(V2_MINIMAL).success);
  const crumbs = Array.from({ length: 6 }, () => ({ ts: '2026-01-01T00:00:00.000Z', verb: 'plan', section: null, ok: true }));
  assert.equal(HandoffSchema.safeParse({ ...V2_MINIMAL, breadcrumbs: crumbs }).success, false, 'at most 5 breadcrumbs');
  const pointer = { slug: 'x'.repeat(100), plan_path: 'p'.repeat(390), draft_path: 'd'.repeat(390), verification_path: 'v'.repeat(390), state: 'planned' };
  const huge = { ...V2_MINIMAL, section_pointers: Array.from({ length: 6 }, () => pointer) };
  const r = HandoffSchema.safeParse(huge);
  assert.equal(r.success, false, 'over 5120 bytes is rejected');
  assert.match(JSON.stringify(r.error?.issues), /5120/);
});

test('HANDOFF v2: position is set exactly when phase is sectioning; the section id uses the status spelling', () => {
  assert.ok(HandoffSchema.safeParse({ ...V2_MINIMAL, phase: 'sectioning', section: '2', position: 'write', current_section: 'methods' }).success);
  assert.ok(HandoffSchema.safeParse({ ...V2_MINIMAL, phase: 'sectioning', section: '1a', position: 'verify', current_section: 'background' }).success);
  assert.equal(HandoffSchema.safeParse({ ...V2_MINIMAL, phase: 'sectioning', section: '2', position: null }).success, false);
  assert.equal(HandoffSchema.safeParse({ ...V2_MINIMAL, phase: 'compile', position: 'write' }).success, false);
  assert.equal(HandoffSchema.safeParse({ ...V2_MINIMAL, phase: 'sectioning', section: '§2', position: 'write' }).success, false);
  for (const phase of ['plan', 'write', 'verify']) {
    assert.equal(HandoffSchema.safeParse({ ...V2_MINIMAL, phase }).success, false, `v1 phase ${phase} is not a v2 phase`);
  }
  assert.equal(HandoffSchema.safeParse({ ...V2_MINIMAL, schema_version: 1 }).success, false);
});

// ---------------------------------------------------------------------------
// Router decision → position
// ---------------------------------------------------------------------------

test('HANDOFF v2: every router decision maps to its phase, section and position', () => {
  const cases: Array<[RouterDecision, ReturnType<typeof handoffPositionOf>]> = [
    [{ verb: 'new' }, { phase: 'intake', section: null, position: null, current_section: null }],
    [{ verb: 'research' }, { phase: 'research', section: null, position: null, current_section: null }],
    [{ verb: 'outline' }, { phase: 'outline', section: null, position: null, current_section: null }],
    [{ verb: 'plan', n: 1, slug: 'intro' }, { phase: 'sectioning', section: '1', position: 'plan', current_section: 'intro' }],
    [{ verb: 'write', n: 2, slug: 'methods' }, { phase: 'sectioning', section: '2', position: 'write', current_section: 'methods' }],
    [{ verb: 'verify', n: 1, slug: 'background', suffix: 'a' }, { phase: 'sectioning', section: '1a', position: 'verify', current_section: 'background' }],
    [{ verb: 'compile' }, { phase: 'compile', section: null, position: null, current_section: null }],
    [{ verb: 'done' }, { phase: 'export', section: null, position: null, current_section: null }],
    [{ verb: 'status', reason: 'done' }, { phase: 'done', section: null, position: null, current_section: null }],
    [
      { verb: 'status', reason: 'attention', section: { n: 3, slug: 'results' }, detail: 'section 3 failed' },
      { phase: 'attention', section: '3', position: null, current_section: 'results' },
    ],
  ];
  for (const [decision, expected] of cases) {
    assert.deepEqual(handoffPositionOf(decision), expected, JSON.stringify(decision));
    const h = assembleHandoff({ decision, breadcrumbs: [], sectionPointers: [], now: NOW });
    assert.ok(HandoffSchema.safeParse(h).success, `assembled HANDOFF for ${decision.verb} is schema-valid`);
    assert.ok(h.next_action.length > 0 && h.next_action.length <= 200);
  }
  assert.equal(nextStepLabel({ verb: 'write', n: 1, slug: 'b', suffix: 'a' }), 'write 1a');
  assert.equal(nextStepLabel({ verb: 'status', reason: 'done' }), 'status (done)');
  assert.equal(nextStepLabel({ verb: 'compile' }), 'compile');
  assert.match(nextActionOf({ verb: 'write', n: 2, slug: 'methods' }), /Draft section §2 \(methods\): run \/pensmith \(or `pensmith write 2`\)/);
  assert.match(nextActionOf({ verb: 'status', reason: 'attention', detail: 'fix OUTLINE.md row 3' }), /Needs attention: fix OUTLINE\.md row 3/);
  assert.match(nextActionOf({ verb: 'status', reason: 'done' }), /The paper is complete/);
  assert.match(
    nextActionOf({ verb: 'status', reason: 'done', detail: 'outline only: the approved outline is .paper/OUTLINE.md' }),
    /^Nothing more is routed: outline only/,
    'a mode\'s own end state is never called complete',
  );
  const long = nextActionOf({ verb: 'status', reason: 'attention', detail: 'x'.repeat(500) });
  assert.equal(long.length, 200, 'next_action is bounded at 200 chars');
});

test('HANDOFF v2: describeHandoffPosition names phase, section and position', () => {
  const h = assembleHandoff({ decision: { verb: 'write', n: 2, slug: 'methods' }, breadcrumbs: [], sectionPointers: [], now: NOW });
  assert.equal(describeHandoffPosition(h), 'phase sectioning, section 2 (write)');
  const c = assembleHandoff({ decision: { verb: 'compile' }, breadcrumbs: [], sectionPointers: [], now: NOW });
  assert.equal(describeHandoffPosition(c), 'phase compile');
});

// ---------------------------------------------------------------------------
// Migration and reading
// ---------------------------------------------------------------------------

test('HANDOFF v1 → v2: plan/write/verify become sectioning + position; the section id comes from the pointer folder', () => {
  for (const step of ['plan', 'write', 'verify'] as const) {
    const out = migrate(HandoffV1Schema.parse(v1(step)));
    assert.equal(out.schema_version, 2);
    assert.equal(out.phase, 'sectioning');
    assert.equal(out.position, step);
    assert.equal(out.section, '2a', 'read from 02a-methods (a Windows-spelled path)');
    assert.equal(out.current_section, 'methods');
    assert.ok(HandoffSchema.safeParse(out).success, `${step}: the migrated document is v2-valid`);
  }
  for (const phase of ['intake', 'research', 'outline', 'compile', 'done'] as const) {
    const out = migrate(HandoffV1Schema.parse(v1(phase)));
    assert.equal(out.phase, phase);
    assert.equal(out.position, null);
    assert.ok(HandoffSchema.safeParse(out).success, `${phase}: v2-valid`);
  }
  const noPointer = migrate(HandoffV1Schema.parse(v1('write', { current_section: 'discussion' })));
  assert.equal(noPointer.section, null, 'no pointer for the slug: no section id');
  assert.equal(noPointer.phase, 'sectioning');
  assert.ok(HandoffSchema.safeParse(noPointer).success);
  const kept = migrate(HandoffV1Schema.parse(v1('write')));
  assert.deepEqual(kept.breadcrumbs, v1('write')['breadcrumbs'], 'breadcrumbs are carried over');
  assert.deepEqual(kept.section_pointers, v1('write')['section_pointers'], 'section pointers are carried over');
});

test('HANDOFF reader: v1 is migrated in memory, v2 read as is, a newer file ignored and left alone, junk invalid', () => {
  const dir = paperDirFixture();
  const file = join(dir, 'HANDOFF.json');
  assert.deepEqual(readHandoff(dir), { kind: 'absent' });

  const v1Text = JSON.stringify(v1('verify'));
  writeFileSync(file, v1Text);
  const r1 = readHandoff(dir);
  assert.equal(r1.kind, 'ok');
  assert.equal(r1.kind === 'ok' && r1.migratedFrom, 1);
  assert.equal(r1.kind === 'ok' && r1.handoff.position, 'verify');
  assert.equal(readFileSync(file, 'utf8'), v1Text, 'the v1 file is not rewritten (in-memory migration)');
  assert.equal(loadHandoff(dir)?.phase, 'sectioning');

  writeFileSync(file, JSON.stringify(V2_MINIMAL));
  const r2 = readHandoff(dir);
  assert.equal(r2.kind === 'ok' && r2.migratedFrom, null);
  assert.deepEqual(loadHandoff(dir), V2_MINIMAL);

  const newer = JSON.stringify({ ...V2_MINIMAL, schema_version: 3, phase: 'something-new' });
  writeFileSync(file, newer);
  assert.deepEqual(readHandoff(dir), { kind: 'newer', version: 3 });
  assert.equal(loadHandoff(dir), null, 'a newer HANDOFF is ignored, never downgraded');
  assert.equal(readFileSync(file, 'utf8'), newer, 'and left in place');

  for (const junk of ['{', '[]', 'null', JSON.stringify({ ...V2_MINIMAL, phase: 'plan' }), JSON.stringify(v1('bogus'))]) {
    writeFileSync(file, junk);
    assert.deepEqual(readHandoff(dir), { kind: 'invalid' }, junk);
    assert.equal(loadHandoff(dir), null);
  }
});

// ---------------------------------------------------------------------------
// `pensmith resume` (the built CLI) reads it
// ---------------------------------------------------------------------------

test('HANDOFF v2: `pensmith resume` prints phase, section and position (a v1 file migrated), consumes it, and leaves a newer one', async () => {
  assert.ok(existsSync(CLI_BIN), 'dist/ is missing — run `npm run build`');
  const sb = sandbox('handoff-resume');
  const root = sb.project('paper');
  await seedThreeSectionPaper(root);
  const file = join(root, '.paper', 'HANDOFF.json');
  writeFileSync(file, JSON.stringify(v1('write', {
    section_pointers: [{ slug: 'methods', plan_path: join(root, '.paper', 'sections', '02-methods', 'PLAN.md'), draft_path: null, verification_path: null, state: 'writing' }],
  })));
  const r = runCli(sb, root, ['resume']);
  assert.match(r.stderr, /pensmith resume: last at phase='sectioning', section='2', position='write'\. Next: Resume write on section methods/, r.stderr);
  assert.equal(existsSync(file), false, 'resume consumes the HANDOFF');

  const newer = JSON.stringify({ schema_version: 3, phase: 'from-the-future' });
  writeFileSync(file, newer);
  const r2 = runCli(sb, root, ['resume']);
  assert.doesNotMatch(r2.stderr, /last at phase/, 'a newer HANDOFF gives no summary');
  assert.equal(readFileSync(file, 'utf8'), newer, 'and is not consumed');
});

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

test('HANDOFF write: atomic, schema-checked, and no lock file beside it in .paper/', async () => {
  const dir = paperDirFixture();
  const h = assembleHandoff({ decision: { verb: 'write', n: 2, slug: 'methods' }, breadcrumbs: [], sectionPointers: [], now: NOW });
  await writeHandoff(h, dir);
  assert.deepEqual(readdirSync(dir), ['HANDOFF.json'], 'only HANDOFF.json in .paper/ (the lock lives in the data dir)');
  const text = readFileSync(join(dir, 'HANDOFF.json'), 'utf8');
  assert.ok(text.endsWith('\n'));
  assert.deepEqual(JSON.parse(text), h);
  await assert.rejects(writeHandoff({ ...h, phase: 'plan' } as unknown as Handoff, dir));
  assert.ok(existsSync(join(dir, 'HANDOFF.json')));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'HANDOFF.json'), 'utf8')), h, 'a rejected write leaves the old file');
});
