// tests/section-slug.test.ts — a section's slug comes from the outline.
//
// The per-section verbs (plan/write/verify) used to default the slug to the
// literal 'placeholder' when no --slug was given, operating on a section
// directory that never matched what `outline` registered. resolveSectionSlug
// reads the slug from the outline for section n; an explicit --slug still
// wins; and with neither there is no slug, so the verb is refused.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSectionSlug } from '../bin/lib/section-slug.js';

function seedOutline(rows: Array<{ n: number; slug: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-slug-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const body = [
    '# Paper',
    '',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '|---|------|-------|------------|-------------|------------------|',
    ...rows.map((r) => `| ${r.n} | ${r.slug} | ${r.slug} | | 300 | |`),
    '',
  ].join('\n');
  writeFileSync(join(root, '.paper', 'OUTLINE.md'), body);
  return root;
}

test('audit #23: resolveSectionSlug reads the slug from OUTLINE.md for section n', () => {
  const root = seedOutline([{ n: 1, slug: 'intro' }, { n: 2, slug: 'methods' }]);
  assert.equal(resolveSectionSlug(root, 1), 'intro');
  assert.equal(resolveSectionSlug(root, 2), 'methods');
});

test('audit #23: an explicit slug always wins over OUTLINE.md', () => {
  const root = seedOutline([{ n: 1, slug: 'intro' }]);
  assert.equal(resolveSectionSlug(root, 1, 'custom-slug'), 'custom-slug');
});

// tests/section-isolation.test.ts runs each verb with no outline.
test('no OUTLINE.md: no slug (never throws)', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-slug-none-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  assert.equal(resolveSectionSlug(root, 1), null);
});

test('a section number absent from OUTLINE.md: no slug', () => {
  const root = seedOutline([{ n: 1, slug: 'intro' }]);
  assert.equal(resolveSectionSlug(root, 5), null);
});
