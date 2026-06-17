// tests/smoother-token-protect.test.ts — COMP-03 / D-13 citation-token protection.
//
// RED-first: bin/lib/compile.ts does not exist yet.
//
// D-13 (LOCKED): the compile pipeline substitutes every [@key] → {{cite_K_M}}
// BEFORE calling the smoother (the model never sees raw tokens). AFTER the call
// it checks the output placeholder-set == the input placeholder-set. ANY drift
// (added / removed / renamed / reordered-set) REJECTS smoothing for that
// boundary: the ORIGINAL prose (with its real [@citekey] tokens) is kept, and a
// rejection entry is recorded in `## Transitions Changed` in COMPILE-REPORT.md.
// Compile NEVER refuses on smoothing rejection — smoothing is best-effort prose;
// citations are the invariant.
//
// The test injects a smoother seam that DROPS a placeholder (drift) → must fall
// back to raw concat and never mutate any [@citekey].

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile, type SmoothBoundaryInput } from '../bin/lib/compile.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

function seedTwoSection(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-token-protect-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    [
      '# Token Protect Fixture',
      '',
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | Intro | | 300 | smith2020 |',
      '| 2 | body | Body | | 300 | jones2019 |',
      '',
    ].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), '');
  const seed = (n: number, slug: string, draft: string, sources: string[]): void => {
    const dir = join(root, '.paper', 'sections', `${String(n).padStart(2, '0')}-${slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), draft);
    const hash = computeDraftHash(Buffer.from(draft, 'utf8'), sources);
    writeFileSync(
      join(dir, 'PLAN.md'),
      ['---', `section: ${n}`, `slug: ${slug}`, `title: ${slug}`, 'depends_on: []', `assigned_sources: [${sources.map((k) => `'${k}'`).join(', ')}]`, `verified_against_draft_hash: '${hash}'`, 'status: verified', '---', '', `# ${slug}`, ''].join('\n'),
    );
    writeFileSync(
      join(dir, 'VERIFICATION.md'),
      [`# VERIFICATION (Section ${n}, ${slug})`, '', 'Status: verified', '', '## Pass-1 (citation integrity, deterministic — D-11 AND-gate)', '', `- ${sources[0]}: **OK** — titleJW=1.00, authorJW=1.00 — D-11 AND-gate passed`, '', ''].join('\n'),
    );
  };
  seed(1, 'intro', '# Intro\n\nThe last paragraph of the intro cites [@smith2020].\n', ['smith2020']);
  seed(2, 'body', '# Body\n\nThe first paragraph of the body cites [@jones2019].\n', ['jones2019']);
  return root;
}

test('D-13: a smoother that DROPS a placeholder → raw-concat fallback + zero citation mutation', async () => {
  const root = seedTwoSection();
  const result = await runCompile({
    paperRoot: root,
    yolo: true,
    // The seam receives placeholder-substituted text; it deliberately DROPS the
    // placeholder (returns prose without any {{cite_..}} token) → token drift.
    smoothBoundary: async (input: SmoothBoundaryInput) => {
      void input;
      return 'A smoothed transition with NO placeholder at all.\n\nAnd a second smoothed paragraph, also missing its token.';
    },
  });
  assert.equal(result.refused, false, 'smoothing rejection must NEVER refuse compile (D-13)');

  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
  // Both real citekeys must survive intact (zero mutation — the invariant).
  assert.match(draft, /\[@smith2020\]/, 'flagged-free citation [@smith2020] must survive a drift-rejected boundary');
  assert.match(draft, /\[@jones2019\]/, 'citation [@jones2019] must survive a drift-rejected boundary');
  // No placeholder token may leak into the final draft.
  assert.ok(!/\{\{cite_/.test(draft), 'no {{cite_K_M}} placeholder may leak into the compiled draft');
  // The original prose (raw concat) must be present, not the drifted smoother output.
  assert.ok(!draft.includes('NO placeholder at all'), 'drifted smoother output must be discarded (original prose kept)');

  // A rejection entry must be recorded under ## Transitions Changed.
  const report = readFileSync(join(root, '.paper', 'COMPILE-REPORT.md'), 'utf8');
  assert.match(report, /## Transitions Changed/);
  assert.match(report, /reject/i, 'a rejected/skipped boundary entry must be recorded for the drifted boundary');
});

test('D-13: a clean smoother (placeholders intact) is accepted and stitched in', async () => {
  const root = seedTwoSection();
  const result = await runCompile({
    paperRoot: root,
    yolo: true,
    smoothBoundary: async (input: SmoothBoundaryInput) => {
      // Echo the exact placeholder set back (clean — accepted).
      return `${input.tail}\n\n${input.head}`;
    },
  });
  assert.equal(result.refused, false);
  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
  // Citations restored from placeholders → real tokens present, no placeholder leak.
  assert.match(draft, /\[@smith2020\]/);
  assert.match(draft, /\[@jones2019\]/);
  assert.ok(!/\{\{cite_/.test(draft), 'placeholders must be restored to real tokens, none leaking');
});
