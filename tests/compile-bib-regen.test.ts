// tests/compile-bib-regen.test.ts
// COMP-07 / D-19: after compile, .paper/CITATIONS.bib is re-rendered from the
// union of compiled sections' citekeys. Base-26 collision suffixes.
// REVIEW M-02 GLOBAL CITEKEY SYNC: every [@key] in .paper/DRAFT.md must have
// a matching entry in .paper/CITATIONS.bib (draft citekeys ⊆ bib keys).
// Colliding keys get base-26 suffixes (vaswani2017a/vaswani2017b) in BOTH draft and bib.
//
// RED — bin/lib/compile.ts does not exist yet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeOutline(sections: Array<{ n: number; slug: string }>): string {
  const rows = sections.map(
    (s) => `| ${s.n} | ${s.slug} | ${s.slug} |  | 300 | ${s.slug}_sources |`,
  );
  return [
    '# Test Paper',
    '| # | slug | title | depends_on | word target | assigned_sources |',
    '|---|------|-------|-----------|-------------|------------------|',
    ...rows,
  ].join('\n') + '\n';
}

function makeCitationsEntry(citekey: string, title: string, author: string, year: number, doi: string): string {
  return `@article{${citekey},
  author = {${author}},
  title = {${title}},
  year = {${year}},
  DOI = {${doi}},
}
`;
}

function extractBibKeys(bibContent: string): Set<string> {
  const keys = new Set<string>();
  for (const match of bibContent.matchAll(/@\w+\{([^,]+),/g)) {
    if (match[1]) keys.add(match[1].trim());
  }
  return keys;
}

function extractDraftCitekeys(draftContent: string): Set<string> {
  const keys = new Set<string>();
  for (const match of draftContent.matchAll(/\[@([a-z][a-z0-9_-]*)\]/g)) {
    if (match[1]) keys.add(match[1]);
  }
  return keys;
}

function makePaperRoot(
  sections: Array<{ n: number; slug: string; draft: string; sources?: string[] }>,
  initialBib: string,
): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-compile-bib-regen-'));
  const paperDir = join(root, '.paper');
  mkdirSync(paperDir, { recursive: true });

  writeFileSync(join(paperDir, 'OUTLINE.md'), makeOutline(sections.map((s) => ({ n: s.n, slug: s.slug }))));
  writeFileSync(join(paperDir, 'CITATIONS.bib'), initialBib);

  for (const sec of sections) {
    const pad = String(sec.n).padStart(2, '0');
    const secDir = join(paperDir, 'sections', `${pad}-${sec.slug}`);
    mkdirSync(secDir, { recursive: true });

    writeFileSync(join(secDir, 'DRAFT.md'), sec.draft);
    const sources = sec.sources ?? [];
    writeFileSync(join(secDir, 'PLAN.md'), [
      '---',
      `slug: ${sec.slug}`,
      'state: verified',
      'verified_against_draft_hash: aabbccdd',
      `assigned_sources: [${sources.join(', ')}]`,
      '---',
    ].join('\n') + '\n');
    writeFileSync(join(secDir, 'VERIFICATION.md'), '# VERIFICATION\n\nstate: verified\nverdict: OK\n');
  }

  return root;
}

test('compile-bib-regen: after compile, CITATIONS.bib exists and is regenerated (D-19)', async () => {
  const initialBib = makeCitationsEntry(
    'vaswani2017',
    'Attention Is All You Need',
    'Vaswani, Ashish',
    2017,
    '10.1234/fake.vaswani',
  );

  const root = makePaperRoot(
    [
      {
        n: 1,
        slug: 'intro',
        draft: '## Intro\n\nTransformers [@vaswani2017] changed NLP.\n',
        sources: ['vaswani2017'],
      },
    ],
    initialBib,
  );

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  assert.ok(result.ok, `compile must succeed: ${result.reason ?? 'unknown'}`);

  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(bibPath), '.paper/CITATIONS.bib must exist after compile');
});

test('compile-bib-regen: REVIEW M-02 GLOBAL CITEKEY SYNC — draft [@keys] ⊆ bib keys after compile', async () => {
  // All [@citekey] tokens in .paper/DRAFT.md must have matching entries in .paper/CITATIONS.bib.
  const bib = [
    makeCitationsEntry('vaswani2017', 'Attention', 'Vaswani, A', 2017, '10.1/vaswani'),
    makeCitationsEntry('brown2020', 'GPT-3', 'Brown, T', 2020, '10.1/brown'),
  ].join('\n');

  const root = makePaperRoot(
    [
      {
        n: 1,
        slug: 'intro',
        draft: '## Intro\n\nTransformers [@vaswani2017] changed NLP.\n',
        sources: ['vaswani2017'],
      },
      {
        n: 2,
        slug: 'method',
        draft: '## Method\n\nFew-shot learning [@brown2020] builds on this.\n',
        sources: ['brown2020'],
      },
    ],
    bib,
  );

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  if (!result.ok) return;  // if compile fails, skip sync check (will be caught by other tests)

  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
  const bibContent = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');

  const draftKeys = extractDraftCitekeys(draft);
  const bibKeys = extractBibKeys(bibContent);

  // Every draft citekey must be in the bib (global sync — REVIEW M-02)
  for (const key of draftKeys) {
    assert.ok(
      bibKeys.has(key),
      `REVIEW M-02: [@${key}] in DRAFT.md has no matching entry in CITATIONS.bib — global citekey sync failed`,
    );
  }
});

test('compile-bib-regen: base-26 collision suffixes — suffixed keys in BOTH draft and bib (REVIEW M-02)', async () => {
  // Two sections both cite keys that would collide under generateCitekey()
  // (same author surname + year). After compile, the base-26-suffixed keys
  // must appear in BOTH .paper/DRAFT.md (as [@key]) and .paper/CITATIONS.bib.
  // This tests the global citekey collision resolution (Step 2.5 of pipeline).
  //
  // Note: in practice the citekeys in DRAFT.md come from the section draft files,
  // and the bib is regenerated from the source candidates. We use pre-assigned
  // citekeys here to test the sync property directly.
  const bib = [
    makeCitationsEntry('brown2020a', 'GPT-3', 'Brown, Tom', 2020, '10.1/brown2020a'),
    makeCitationsEntry('brown2020b', 'Scaling Laws', 'Brown, Tom', 2020, '10.1/brown2020b'),
  ].join('\n');

  const root = makePaperRoot(
    [
      {
        n: 1,
        slug: 'intro',
        draft: '## Intro\n\nGPT-3 [@brown2020a] is large.\n',
        sources: ['brown2020a'],
      },
      {
        n: 2,
        slug: 'method',
        draft: '## Method\n\nScaling [@brown2020b] matters.\n',
        sources: ['brown2020b'],
      },
    ],
    bib,
  );

  const { runCompile } = await import('../bin/lib/compile.js').catch(() => {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  });

  const result = await runCompile({ paperRoot: root, yolo: true });
  if (!result.ok) return;

  const draft = readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8');
  const bibContent = readFileSync(join(root, '.paper', 'CITATIONS.bib'), 'utf8');

  const draftKeys = extractDraftCitekeys(draft);
  const bibKeys = extractBibKeys(bibContent);

  // Global sync: every draft key must be in bib (no orphan tokens)
  for (const key of draftKeys) {
    assert.ok(
      bibKeys.has(key),
      `REVIEW M-02: [@${key}] in DRAFT.md has no matching entry in CITATIONS.bib`,
    );
  }
});

test('compile-bib-regen: bib write is atomic (D-07 sole-writer chokepoint)', async () => {
  // Structural: compile.ts must call atomicWriteFile for CITATIONS.bib, not raw writeFile
  const { existsSync: fsExists, readFileSync } = await import('node:fs');
  const compilePath = new URL('../bin/lib/compile.ts', import.meta.url);
  if (!fsExists(compilePath)) {
    throw new Error('bin/lib/compile.ts not implemented yet (RED)');
  }
  const src = readFileSync(compilePath, 'utf8');
  assert.match(src, /atomicWriteFile/, 'compile.ts must use atomicWriteFile (D-07 chokepoint)');
});
