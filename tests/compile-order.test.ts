// tests/compile-order.test.ts — COMP-02 outline-order concat + ARCH-20 read-only.
//
// RED-first: bin/lib/compile.ts does not exist yet.
//
// COMP-02 / D-11 (LOCKED): the compiled .paper/DRAFT.md concatenates sections in
// OUTLINE order (sort by section.n ascending), NEVER in wave order. Wave order is
// an execution detail; outline order is the reader's experience.
//
// ARCH-20 / COMP-03 read-only invariant: compile NEVER mutates a section's
// sections/<N>/DRAFT.md — neither content nor mtime. The whole pipeline is
// read-only on section files; all writes target .paper/ project-level files.
//
// Fixture: 3 sections whose dependency (wave) order is the REVERSE of outline
// order. `gamma` (n=3) is a root; `beta` (n=2) depends on gamma; `alpha` (n=1)
// depends on beta. Wave order = gamma, beta, alpha (3,2,1). Outline order =
// alpha, beta, gamma (1,2,3). The compiled draft MUST be outline order.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

interface Sec {
  n: number;
  slug: string;
  heading: string;
  dependsOn: string[];
  draft: string;
}

function seed(secs: Sec[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-order-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const rows = secs
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((s) => `| ${s.n} | ${s.slug} | ${s.heading} | ${s.dependsOn.join(', ')} | 300 |  |`);
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Order Fixture', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  for (const s of secs) {
    const dir = join(root, '.paper', 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), s.draft);
    const hash = computeDraftHash(Buffer.from(s.draft, 'utf8'), []);
    writeFileSync(
      join(dir, 'PLAN.md'),
      [
        '---',
        `section: ${s.n}`,
        `slug: ${s.slug}`,
        `title: ${s.heading}`,
        `depends_on: [${s.dependsOn.map((d) => `'${d}'`).join(', ')}]`,
        'assigned_sources: []',
        `verified_against_draft_hash: '${hash}'`,
        'status: verified',
        '---',
        '',
        `# ${s.heading}`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'VERIFICATION.md'),
      [`# VERIFICATION (Section ${s.n}, ${s.slug})`, '', 'Status: verified', '', '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)', '', '', ''].join('\n'),
    );
  }
  return root;
}

const FIXTURE: Sec[] = [
  { n: 1, slug: 'alpha', heading: 'Alpha Heading', dependsOn: ['beta'], draft: '# Alpha Heading\n\nAlpha body.\n' },
  { n: 2, slug: 'beta', heading: 'Beta Heading', dependsOn: ['gamma'], draft: '# Beta Heading\n\nBeta body.\n' },
  { n: 3, slug: 'gamma', heading: 'Gamma Heading', dependsOn: [], draft: '# Gamma Heading\n\nGamma body.\n' },
];

test('COMP-02: compiled DRAFT.md concatenates in OUTLINE order, not wave order', async () => {
  const root = seed(FIXTURE);
  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.equal(result.refused, false);
  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
  const iAlpha = draft.indexOf('Alpha Heading');
  const iBeta = draft.indexOf('Beta Heading');
  const iGamma = draft.indexOf('Gamma Heading');
  assert.ok(iAlpha >= 0 && iBeta >= 0 && iGamma >= 0, 'all three headings must be present');
  assert.ok(iAlpha < iBeta, 'alpha (n=1) must precede beta (n=2) — outline order');
  assert.ok(iBeta < iGamma, 'beta (n=2) must precede gamma (n=3) — outline order, NOT wave order (3,2,1)');
});

test('ARCH-20: compile is read-only on every section DRAFT.md (mtime + content-hash unchanged)', async () => {
  const root = seed(FIXTURE);
  // Snapshot each section DRAFT.md mtime + content hash BEFORE compile.
  const before = new Map<string, { mtimeMs: number; hash: string }>();
  for (const s of FIXTURE) {
    const p = join(root, '.paper', 'sections', `${String(s.n).padStart(2, '0')}-${s.slug}`, 'DRAFT.md');
    const bytes = readFileSync(p);
    before.set(p, { mtimeMs: statSync(p).mtimeMs, hash: createHash('sha256').update(bytes).digest('hex') });
  }

  await runCompile({ paperRoot: root, yolo: true });

  for (const [p, snap] of before) {
    assert.ok(existsSync(p), `section DRAFT.md ${p} must still exist after compile`);
    const bytes = readFileSync(p);
    const nowHash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(nowHash, snap.hash, `section DRAFT.md content must be unchanged by compile: ${p}`);
    assert.equal(statSync(p).mtimeMs, snap.mtimeMs, `section DRAFT.md mtime must be unchanged by compile: ${p}`);
  }
});
