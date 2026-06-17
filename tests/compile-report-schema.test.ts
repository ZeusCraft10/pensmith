// tests/compile-report-schema.test.ts — COMPILE-REPORT.md schema v1 + renderer.
//
// RED-first (Plan 04-02 Task 1). Production code:
//   - bin/lib/schemas/compile-report.ts  (CompileReportSchema)
//   - bin/lib/compile-report.ts          (renderCompileReport)
//
// SOURCE OF TRUTH: 04-CONTEXT.md D-14 (LOCKED). 04-RESEARCH §F DRIFTED and
// renamed both the body sections and the frontmatter keys — RESEARCH is WRONG
// where it conflicts. The D-14 reserved-key set is EXACTLY:
//   schema_version, compiled_at, sections_count, stale_resolved_count,
//   refuse_reasons, title, author, abstract
// `outline_hash` / `pandoc_target` are RESEARCH-drift keys and MUST be rejected.
//
// Body — 5 sections, FIXED ORDER (D-14):
//   1. ## Transitions Changed
//   2. ## Cross-Section Consistency Flags
//   3. ## Citation Density
//   4. ## Compile-Staleness Resolved
//   5. ## Advisory Findings  (Phase 4 writes the empty marker)

import test from 'node:test';
import assert from 'node:assert/strict';
import { CompileReportSchema } from '../bin/lib/schemas/compile-report.js';
import { renderCompileReport } from '../bin/lib/compile-report.js';

const VALID_FRONTMATTER = {
  schema_version: 1,
  compiled_at: '2026-05-29T12:00:00.000Z',
  sections_count: 3,
  stale_resolved_count: 0,
  refuse_reasons: [],
  title: '',
  author: '',
  abstract: '',
};

const ADVISORY_EMPTY_MARKER = '_No advisory passes ran — Phase 5 will populate._';

const D14_BODY_ORDER = [
  '## Transitions Changed',
  '## Cross-Section Consistency Flags',
  '## Citation Density',
  '## Compile-Staleness Resolved',
  '## Advisory Findings',
];

// ---- schema ----

test('CompileReportSchema: accepts a valid D-14 frontmatter object', () => {
  const res = CompileReportSchema.safeParse(VALID_FRONTMATTER);
  assert.ok(res.success, 'valid D-14 frontmatter must parse');
});

test('CompileReportSchema: rejects schema_version 2 (literal-1 contract)', () => {
  const res = CompileReportSchema.safeParse({ ...VALID_FRONTMATTER, schema_version: 2 });
  assert.ok(!res.success, 'schema_version 2 must be rejected (D-14 / ARCH-07)');
});

test('CompileReportSchema: rejects outline_hash (RESEARCH-drift key, not D-14)', () => {
  const res = CompileReportSchema.safeParse({
    ...VALID_FRONTMATTER,
    outline_hash: 'deadbeef',
  });
  assert.ok(!res.success, 'outline_hash is not a D-14 reserved key — strict reject');
});

test('CompileReportSchema: rejects pandoc_target (RESEARCH-drift key, not D-14)', () => {
  const res = CompileReportSchema.safeParse({
    ...VALID_FRONTMATTER,
    pandoc_target: 'docx',
  });
  assert.ok(!res.success, 'pandoc_target is not a D-14 reserved key — strict reject');
});

test('CompileReportSchema: Pandoc-reserved keys present even when empty', () => {
  const res = CompileReportSchema.safeParse(VALID_FRONTMATTER);
  assert.ok(res.success);
  if (res.success) {
    assert.equal(res.data.title, '');
    assert.equal(res.data.author, '');
    assert.equal(res.data.abstract, '');
  }
});

// ---- renderer ----

test('renderCompileReport: emits exactly the 5 D-14 body headers in fixed order', () => {
  const md = renderCompileReport({
    compiled_at: '2026-05-29T12:00:00.000Z',
    sections_count: 3,
    stale_resolved_count: 0,
    refuse_reasons: [],
  });
  const headers = [...md.matchAll(/^## .+$/gm)].map((m) => m[0]);
  assert.deepEqual(headers, D14_BODY_ORDER, 'body headers must match D-14 order exactly');
});

test('renderCompileReport: Advisory Findings carries the explicit empty marker', () => {
  const md = renderCompileReport({
    compiled_at: '2026-05-29T12:00:00.000Z',
    sections_count: 1,
    stale_resolved_count: 0,
    refuse_reasons: [],
  });
  const advisoryIdx = md.indexOf('## Advisory Findings');
  assert.ok(advisoryIdx >= 0, 'Advisory Findings header must be present');
  assert.ok(
    md.slice(advisoryIdx).includes(ADVISORY_EMPTY_MARKER),
    'Advisory Findings must include the Phase-4 empty marker',
  );
});

test('renderCompileReport: frontmatter carries schema_version 1 and is schema-valid', () => {
  const md = renderCompileReport({
    compiled_at: '2026-05-29T12:00:00.000Z',
    sections_count: 2,
    stale_resolved_count: 1,
    refuse_reasons: [],
  });
  assert.ok(md.startsWith('---\n'), 'report must open with YAML frontmatter');
  assert.match(md, /schema_version:\s*1/);
  // The frontmatter must NOT carry the RESEARCH-drift keys.
  assert.ok(!md.includes('outline_hash'), 'no outline_hash in v1 frontmatter');
  assert.ok(!md.includes('pandoc_target'), 'no pandoc_target in v1 frontmatter');
});
