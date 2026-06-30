// tests/section-slug.test.ts — audit #23 regression.
//
// The Tier-2 per-section verbs (plan/write/verify) used to default the slug to
// the literal 'placeholder' when no --slug was given, operating on a section
// directory that never matched what `outline` registered. resolveSectionSlug now
// reads the slug from OUTLINE.md for section n; explicit --slug still wins;
// 'placeholder' is only the last-resort fallback.

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

test('audit #23: no OUTLINE.md → placeholder fallback (never throws)', () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-slug-none-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  assert.equal(resolveSectionSlug(root, 1), 'placeholder');
});

test('audit #23: a section number absent from OUTLINE.md → placeholder fallback', () => {
  const root = seedOutline([{ n: 1, slug: 'intro' }]);
  assert.equal(resolveSectionSlug(root, 5), 'placeholder');
});
