// tests/compile-headings.test.ts — the compiled manuscript has a title and headings.
//
// The drafter is told not to start a section with a title (the outline owns
// it), and write saves the text as returned, so section drafts are bare
// paragraphs. compile used to concatenate them as they were: every exported
// paper was one run of paragraphs with no title and no section headings.
// The old compile-order fixture passed only because its drafts had headings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCompile } from '../bin/lib/compile.js';
import { computeDraftHash } from '../bin/lib/draft-hash.js';

function seed(title: string, sections: Array<{ slug: string; title: string; draft: string }>): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-headings-'));
  const pdir = join(root, '.paper');
  mkdirSync(pdir, { recursive: true });
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    [
      ...(title ? [`# ${title}`, ''] : []),
      '| # | slug | title | depends_on | word target | assigned_sources |',
      '| --- | --- | --- | --- | --- | --- |',
      ...sections.map((s, i) => `| ${i + 1} | ${s.slug} | ${s.title} | | 300 | |`),
      '',
    ].join('\n'),
  );
  writeFileSync(join(pdir, 'CITATIONS.bib'), '');
  sections.forEach((s, i) => {
    const dir = join(pdir, 'sections', `${String(i + 1).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), s.draft);
    writeFileSync(
      join(dir, 'PLAN.md'),
      `---\nsection: ${i + 1}\nslug: ${s.slug}\nstatus: verified\nassigned_sources: []\nverified_against_draft_hash: '${computeDraftHash(Buffer.from(s.draft), [])}'\n---\n`,
    );
    writeFileSync(join(dir, 'VERIFICATION.md'), 'Status: verified\n\n## Pass-1\n');
  });
  return root;
}

async function compiled(root: string): Promise<string> {
  const r = await runCompile({ paperRoot: root, onWarn: () => {} });
  assert.equal(r.refused, false, JSON.stringify(r.refuseReasons));
  return readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
}

test('compile: the paper title leads the draft and each section starts with its outline title', async () => {
  const root = seed('Tidal Barrages and Estuary Sediment', [
    { slug: 'intro', title: 'Introduction', draft: 'Barrages change how sediment moves.\n' },
    { slug: 'methods', title: 'Methods', draft: 'We compare three estuaries.\n\nA second paragraph.\n' },
  ]);
  const draft = await compiled(root);
  assert.equal(
    draft,
    '# Tidal Barrages and Estuary Sediment\n\n## Introduction\n\nBarrages change how sediment moves.\n\n' +
      '## Methods\n\nWe compare three estuaries.\n\nA second paragraph.\n',
  );
});

test('compile: a section that already starts with a heading is not given a second one', async () => {
  const root = seed('Paper', [
    { slug: 'intro', title: 'Introduction', draft: '## Introduction\n\nBody one.\n' },
    // A draft that used a top-level heading is moved under the paper title.
    { slug: 'results', title: 'Results', draft: '# Results\n\nBody two.\n\n## Detail\n\nMore.\n' },
  ]);
  const draft = await compiled(root);
  assert.equal(draft, '# Paper\n\n## Introduction\n\nBody one.\n\n## Results\n\nBody two.\n\n### Detail\n\nMore.\n');
});

test('compile: with no paper title in the outline, sections still get headings', async () => {
  const root = seed('', [{ slug: 'intro', title: 'Introduction', draft: 'Body.\n' }]);
  assert.equal(await compiled(root), '## Introduction\n\nBody.\n');
});
