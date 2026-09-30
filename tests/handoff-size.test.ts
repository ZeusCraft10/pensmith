// tests/handoff-size.test.ts — HANDOFF.json stays ≤ 5120 bytes (D-17, ARCH-04;
// v2 PLUG-14, D-23a-16).
//
// A long paper must still get a handoff: assembleHandoff drops the pointers of
// verified sections first, then the ones furthest from the current section,
// instead of failing the write. Checked on the assembler directly and through
// the bundled PreCompact hook (plugin/dist/hooks/pre-compact.mjs) in a paper
// with 40 long-slug sections.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleHandoff, HandoffSchema, HANDOFF_MAX_BYTES, type HandoffSectionPointer } from '../bin/lib/handoff.js';
import { REPO, sandbox, writePlan, writeState } from './helpers/paper-cli-harness.js';

const HOOK = join(REPO, 'plugin', 'dist', 'hooks', 'pre-compact.mjs');

function pointer(i: number, state: HandoffSectionPointer['state']): HandoffSectionPointer {
  const slug = `section-number-${i}-with-a-rather-long-descriptive-slug`;
  const dir = `.paper/sections/${String(i).padStart(2, '0')}-${slug}`;
  return { slug, plan_path: `${dir}/PLAN.md`, draft_path: `${dir}/DRAFT.md`, verification_path: `${dir}/VERIFICATION.md`, state };
}

test('handoff-size: a 40-section handoff fits 5120 bytes, keeps the current section and drops verified ones first', () => {
  const pointers = Array.from({ length: 40 }, (_, i) => pointer(i + 1, i < 20 ? 'verified' : 'planned'));
  const current = pointers[24]!;
  const h = assembleHandoff({
    decision: { verb: 'write', n: 25, slug: current.slug },
    sectionPointers: pointers,
  });
  const bytes = Buffer.byteLength(JSON.stringify(h, null, 2) + '\n', 'utf8');
  assert.ok(bytes <= HANDOFF_MAX_BYTES, `${bytes} bytes`);
  assert.ok(HandoffSchema.safeParse(h).success);
  assert.ok(h.section_pointers.some((p) => p.slug === current.slug), 'the current section keeps its pointer');
  assert.ok(h.section_pointers.every((p) => p.state !== 'verified'), 'verified sections are dropped first');
  assert.ok(h.section_pointers.length > 1, 'as many pointers as fit are kept');

  const small = assembleHandoff({ decision: { verb: 'compile' }, sectionPointers: pointers.slice(0, 3) });
  assert.equal(small.section_pointers.length, 3, 'a handoff under the budget keeps every pointer');
});

test('handoff-size: the bundled PreCompact hook writes ≤ 5120 bytes for a 40-section paper', () => {
  assert.ok(existsSync(HOOK), 'plugin/dist/hooks/pre-compact.mjs is missing — run `npm run bundle`');
  const sb = sandbox('handoff-size');
  const root = sb.project('paper');
  const sections = Array.from({ length: 40 }, (_, i) => ({ n: i + 1, slug: `section-number-${i + 1}-with-a-rather-long-descriptive-slug` }));
  writeState(root, sections);
  writeFileSync(join(root, '.paper', 'RESEARCH.md'), '# Research log\n');
  const rows = sections.map((s) => `| ${s.n} | ${s.slug} | ${s.slug} |  | 300 |  |`);
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Outline', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'),
  );
  for (const s of sections) writePlan(root, s.n, s.slug, { status: s.n < 30 ? 'verified' : 'planned' });
  const r = spawnSync(process.execPath, [HOOK], {
    cwd: root,
    env: sb.env({ NODE_V8_COVERAGE: undefined }), // a bundle is not a coverage target
    input: JSON.stringify({ session_id: 's-size', cwd: root, hook_event_name: 'PreCompact', trigger: 'auto' }),
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  const file = join(root, '.paper', 'HANDOFF.json');
  assert.ok(existsSync(file), `HANDOFF.json written (stderr: ${r.stderr})`);
  assert.ok(statSync(file).size <= HANDOFF_MAX_BYTES, `${statSync(file).size} bytes`);
  const h = HandoffSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  assert.equal(h.phase, 'sectioning');
  assert.equal(h.section, '30');
  assert.equal(h.position, 'write');
});
