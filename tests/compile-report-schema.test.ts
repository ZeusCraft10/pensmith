// tests/compile-report-schema.test.ts — RED spec for:
//   bin/lib/schemas/compile-report.ts  (CompileReportSchema)
//   bin/lib/compile-report.ts          (renderCompileReport)
//
// D-14 LOCKED schema from 04-CONTEXT.md — authoritative.
// RESEARCH.md's outline_hash / pandoc_target are NOT in the D-14 reserved
// key set and must be REJECTED by strict zod (no passthrough).

import test from 'node:test';
import assert from 'node:assert/strict';
import { CompileReportSchema } from '../bin/lib/schemas/compile-report.js';
import { renderCompileReport } from '../bin/lib/compile-report.js';

// D-14 fixed body section order — authoritative from 04-CONTEXT.md D-14.
const D14_SECTIONS = [
  '## Transitions Changed',
  '## Cross-Section Consistency Flags',
  '## Citation Density',
  '## Compile-Staleness Resolved',
  '## Advisory Findings',
] as const;

const VALID_INPUT = {
  schema_version: 1 as const,
  compiled_at: '2026-05-31T00:00:00.000Z',
  sections_count: 3,
  stale_resolved_count: 0,
  refuse_reasons: [],
  title: '',
  author: '',
  abstract: '',
};

// ---------- CompileReportSchema ----------

test('CompileReportSchema: accepts valid D-14 frontmatter object', () => {
  const result = CompileReportSchema.safeParse(VALID_INPUT);
  assert.ok(result.success, `Expected parse success; got: ${JSON.stringify(result)}`);
});

test('CompileReportSchema: rejects schema_version: 2 (z.literal(1))', () => {
  const bad = { ...VALID_INPUT, schema_version: 2 };
  const result = CompileReportSchema.safeParse(bad);
  assert.ok(!result.success, 'schema_version 2 must be rejected');
});

test('CompileReportSchema: rejects object carrying outline_hash (RESEARCH-drift key)', () => {
  const bad = { ...VALID_INPUT, outline_hash: 'abc123' };
  const result = CompileReportSchema.safeParse(bad);
  assert.ok(!result.success, 'outline_hash is not a D-14 reserved key and must be rejected');
});

test('CompileReportSchema: rejects object carrying pandoc_target (RESEARCH-drift key)', () => {
  const bad = { ...VALID_INPUT, pandoc_target: 'docx' };
  const result = CompileReportSchema.safeParse(bad);
  assert.ok(!result.success, 'pandoc_target is not a D-14 reserved key and must be rejected');
});

test('CompileReportSchema: compiled_at must be ISO-8601 datetime string', () => {
  const bad = { ...VALID_INPUT, compiled_at: 'not-a-date' };
  const result = CompileReportSchema.safeParse(bad);
  assert.ok(!result.success, 'Non-ISO compiled_at must be rejected');
});

test('CompileReportSchema: sections_count must be non-negative integer', () => {
  assert.ok(!CompileReportSchema.safeParse({ ...VALID_INPUT, sections_count: -1 }).success);
  assert.ok(!CompileReportSchema.safeParse({ ...VALID_INPUT, sections_count: 1.5 }).success);
});

test('CompileReportSchema: Pandoc keys (title/author/abstract) present but can be empty', () => {
  // Phase 4 writes empty strings; Phase 6 reads them. They MUST be in the schema.
  const result = CompileReportSchema.safeParse(VALID_INPUT);
  assert.ok(result.success);
  if (result.success) {
    assert.equal(result.data.title, '');
    assert.equal(result.data.author, '');
    assert.equal(result.data.abstract, '');
  }
});

// ---------- renderCompileReport ----------

test('renderCompileReport: output contains exactly 5 D-14 ## headers in fixed order', () => {
  const output = renderCompileReport(VALID_INPUT);
  // Extract all ## headers from the output body
  const headers = [...output.matchAll(/^## .+$/gm)].map((m) => m[0]);
  assert.deepEqual(
    headers,
    [...D14_SECTIONS],
    `Expected exactly these 5 headers in order:\n${D14_SECTIONS.join('\n')}\nGot:\n${headers.join('\n')}`,
  );
});

test('renderCompileReport: ## Advisory Findings contains empty marker when no advisory entries', () => {
  const output = renderCompileReport(VALID_INPUT);
  assert.ok(
    output.includes('_No advisory passes ran — Phase 5 will populate._'),
    'Advisory Findings empty marker must be present when no advisory entries supplied',
  );
});

test('renderCompileReport: output begins with YAML frontmatter (---)', () => {
  const output = renderCompileReport(VALID_INPUT);
  assert.ok(output.startsWith('---\n'), 'Output must begin with YAML frontmatter block');
});

test('renderCompileReport: frontmatter contains schema_version: 1', () => {
  const output = renderCompileReport(VALID_INPUT);
  assert.ok(output.includes('schema_version: 1'), 'frontmatter must include schema_version: 1');
});

test('renderCompileReport: deterministic — same input produces same output', () => {
  const a = renderCompileReport(VALID_INPUT);
  const b = renderCompileReport(VALID_INPUT);
  assert.equal(a, b, 'renderCompileReport must be deterministic (no LLM, no random)');
});
