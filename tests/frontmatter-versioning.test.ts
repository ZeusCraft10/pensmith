// tests/frontmatter-versioning.test.ts — CONF-04 (D-17-38): section PLAN.md
// frontmatter carries `schema_version: 1`; every reader goes through the
// versioned loader (loadFrontmatterDoc / loadFrontmatterDocSync) with text
// migrations under bin/lib/migrations/<kind>/; a legacy file is migrated —
// written back with exactly one added line, otherwise byte-identical — by the
// readers that own the file, never by the pure router; a newer file is refused
// with "upgrade pensmith".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  migrateFrontmatterText,
  loadFrontmatterDocSync,
  FrontmatterVersionError,
  FRONTMATTER_KINDS,
} from '../bin/lib/frontmatter.js';
import { setFrontmatterVersionText } from '../bin/lib/migrations/loader.js';
import { PlanFrontmatterSchema, CURRENT_PLAN_FRONTMATTER_VERSION } from '../bin/lib/schemas/plan-frontmatter.js';
import { readSectionState } from '../bin/lib/router.js';
import { EXIT_ERROR } from '../bin/lib/exit-codes.js';
import {
  STACK_LINE,
  sandbox,
  runCli,
  runLibScript,
  lastJson,
  seedFabricatedSection,
  sectionDirOf,
  writeState,
  writeOutline,
  writePlan,
} from './helpers/paper-cli-harness.js';

const LEGACY_PLAN = [
  '---',
  '# a comment the migration must keep',
  'section: 2',
  'slug: target',
  "title: 'Target: a quoted title'",
  'depends_on: []',
  'assigned_sources:',
  '  - smith2020',
  'verified_against_draft_hash: null',
  'status: planned',
  '---',
  '',
  '## Brief',
  '',
  'Body text.',
  '',
].join('\n');

test('CONF-04: PLAN.md is at v1; the registry knows plan, intake, draft and verification', () => {
  assert.equal(CURRENT_PLAN_FRONTMATTER_VERSION, 1);
  assert.deepEqual(Object.keys(FRONTMATTER_KINDS).sort(), ['draft', 'intake', 'plan', 'verification']);
  assert.equal(FRONTMATTER_KINDS.plan.current, 1);
  for (const k of ['intake', 'draft', 'verification'] as const) {
    assert.equal(FRONTMATTER_KINDS[k].current, 0, `${k} has no frontmatter yet (GRND-03 / later requirements bump it)`);
  }
  assert.equal(PlanFrontmatterSchema.parse({ section: 1, slug: 'a', title: 'A' }).schema_version, 1);
  assert.throws(() => PlanFrontmatterSchema.parse({ section: 1, slug: 'a', title: 'A', schema_version: 2 }));
});

test('CONF-04: v0 → v1 inserts exactly one line and keeps every other byte (LF and CRLF)', () => {
  const doc = migrateFrontmatterText('plan', LEGACY_PLAN);
  assert.equal(doc.diskVersion, 0);
  assert.equal(doc.version, 1);
  assert.equal(doc.migrated, true);
  assert.equal(doc.text, LEGACY_PLAN.replace('---\n', '---\nschema_version: 1\n'));
  assert.equal(doc.frontmatter['schema_version'], 1);
  assert.equal(doc.frontmatter['title'], 'Target: a quoted title');

  const crlf = LEGACY_PLAN.replace(/\n/g, '\r\n');
  const docCrlf = migrateFrontmatterText('plan', crlf);
  assert.equal(docCrlf.text, crlf.replace('---\r\n', '---\r\nschema_version: 1\r\n'));

  const again = migrateFrontmatterText('plan', doc.text);
  assert.equal(again.migrated, false, 'idempotent at v1');
  assert.equal(again.text, doc.text);

  // A version line is rewritten in place (the vN → vN+1 steps later phases add).
  assert.equal(setFrontmatterVersionText('---\na: 1\nschema_version: 1\n---\nx', 2), '---\na: 1\nschema_version: 2\n---\nx');
  assert.equal(setFrontmatterVersionText('no frontmatter\n', 1), '---\nschema_version: 1\n---\nno frontmatter\n');
});

test('CONF-04: a newer schema_version is refused with "upgrade pensmith"; a malformed one too', () => {
  const newer = LEGACY_PLAN.replace('---\n', '---\nschema_version: 2\n');
  assert.throws(() => migrateFrontmatterText('plan', newer, 'PLAN.md'), (e: unknown) => {
    assert.ok(e instanceof FrontmatterVersionError);
    assert.equal(e.exitCode, EXIT_ERROR);
    assert.equal(e.diskVersion, 2);
    assert.match(e.message, /^PLAN\.md: plan frontmatter schema_version 2 is newer than this pensmith supports \(1\) — upgrade pensmith$/);
    return true;
  });
  assert.throws(() => migrateFrontmatterText('plan', LEGACY_PLAN.replace('---\n', '---\nschema_version: one\n')), /must be a non-negative integer/);
  // Kinds without frontmatter yet refuse any versioned file (it came from a newer build).
  assert.throws(() => migrateFrontmatterText('intake', '---\nschema_version: 1\n---\n# Intake\n'), /upgrade pensmith/);
  const plain = migrateFrontmatterText('intake', '# Intake\n\nTopic: x\n');
  assert.deepEqual({ v: plain.version, migrated: plain.migrated }, { v: 0, migrated: false });
});

test('CONF-04: loadFrontmatterDoc writes a migrated file back only when asked', () => {
  const sb = sandbox('fm-writeback');
  const dir = sb.project('p');
  const file = join(dir, 'PLAN.md');
  writeFileSync(file, LEGACY_PLAN);
  const ro = lastJson<{ ok: boolean; result: { migrated: boolean } }>(runLibScript(sb, 'frontmatter-ops.ts', ['load', 'plan', file, 'false']));
  assert.ok(ro.ok && ro.result.migrated);
  assert.equal(readFileSync(file, 'utf8'), LEGACY_PLAN, 'writeBack:false leaves the file alone');
  const rw = lastJson<{ ok: boolean; result: { migrated: boolean; frontmatter: Record<string, unknown> } }>(
    runLibScript(sb, 'frontmatter-ops.ts', ['load', 'plan', file, 'true']),
  );
  assert.ok(rw.ok && rw.result.migrated);
  assert.equal(readFileSync(file, 'utf8'), LEGACY_PLAN.replace('---\n', '---\nschema_version: 1\n'), 'written back: one added line');

  writeFileSync(file, LEGACY_PLAN.replace('---\n', '---\nschema_version: 9\n'));
  const newer = lastJson<{ ok: boolean; name: string; message: string }>(runLibScript(sb, 'frontmatter-ops.ts', ['load', 'plan', file, 'true']));
  assert.equal(newer.ok, false);
  assert.equal(newer.name, 'FrontmatterVersionError');
  assert.match(newer.message, /upgrade pensmith/);
});

test('CONF-04: updatePlanFrontmatter stamps schema_version: 1 and keeps comments; refuses a newer file', () => {
  const sb = sandbox('fm-update');
  const dir = sb.project('p');
  const file = join(dir, 'PLAN.md');
  writeFileSync(file, LEGACY_PLAN);
  const r = lastJson<{ ok: boolean; result: { updated: boolean } }>(runLibScript(sb, 'frontmatter-ops.ts', ['update-plan', file, 'writing']));
  assert.deepEqual(r, { ok: true, result: { updated: true } });
  const text = readFileSync(file, 'utf8');
  assert.match(text, /^---\nschema_version: 1\n# a comment the migration must keep\n/);
  assert.match(text, /^status: writing$/m);
  writeFileSync(file, LEGACY_PLAN.replace('---\n', '---\nschema_version: 3\n'));
  const n = lastJson<{ ok: boolean; message: string }>(runLibScript(sb, 'frontmatter-ops.ts', ['update-plan', file, 'written']));
  assert.equal(n.ok, false);
  assert.match(n.message, /upgrade pensmith/);
  assert.match(readFileSync(file, 'utf8'), /^schema_version: 3$/m, 'a newer file is never rewritten');
});

test('CONF-04: the router reads through the loader WITHOUT write-back; a newer file routes to attention', () => {
  const sb = sandbox('fm-router');
  const dir = sb.project('p');
  const file = join(dir, 'PLAN.md');
  writeFileSync(file, LEGACY_PLAN.replace('status: planned', 'status: written'));
  const before = readFileSync(file, 'utf8');
  assert.deepEqual(readSectionState(file), { status: 'written', corrupt: false, absent: false });
  assert.equal(readFileSync(file, 'utf8'), before, 'the pure router never writes');
  assert.equal(loadFrontmatterDocSync('plan', file).migrated, true);

  writeFileSync(file, LEGACY_PLAN.replace('---\n', '---\nschema_version: 2\n'));
  const stderrWrite = process.stderr.write.bind(process.stderr);
  const lines: string[] = [];
  process.stderr.write = ((c: string | Uint8Array, ...rest: unknown[]): boolean => {
    lines.push(String(c));
    return (stderrWrite as (x: string | Uint8Array, ...r: unknown[]) => boolean)(c, ...rest);
  }) as typeof process.stderr.write;
  try {
    assert.deepEqual(readSectionState(file), { status: 'planned', corrupt: true, absent: false });
  } finally {
    process.stderr.write = stderrWrite;
  }
  assert.match(lines.join(''), /upgrade pensmith/);
});

test('CONF-04: through the CLI — verify writes a legacy PLAN.md back at v1; a newer PLAN.md stops write with one line', () => {
  const sb = sandbox('fm-cli');
  const root = sb.project('p');
  seedFabricatedSection(root);
  const plan = join(sectionDirOf(root, 1, 'intro'), 'PLAN.md');
  const legacy = readFileSync(plan, 'utf8');
  assert.doesNotMatch(legacy, /schema_version/);
  runCli(sb, root, ['verify', '1']);
  const after = readFileSync(plan, 'utf8');
  assert.match(after, /^---\nschema_version: 1\n/);
  assert.match(after, /^status: failed$/m);

  const root2 = sb.project('q');
  writeState(root2, [{ n: 1, slug: 'intro' }]);
  writeOutline(root2, [{ n: 1, slug: 'intro' }]);
  writePlan(root2, 1, 'intro', { schema_version: '2' });
  const w = runCli(sb, root2, ['write', '1']);
  assert.equal(w.status, EXIT_ERROR, `${w.stdout}\n${w.stderr}`);
  assert.match(w.stderr, /^pensmith: .*PLAN\.md: plan frontmatter schema_version 2 is newer than this pensmith supports \(1\) — upgrade pensmith$/m);
  assert.doesNotMatch(w.stderr, STACK_LINE);
});
