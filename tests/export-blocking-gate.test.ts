// tests/export-blocking-gate.test.ts — audit #3/#14 regression, and the export
// bound to what a gated compile produced.
//
// `pensmith done`/export must re-assert the blocking gate, not trust that
// compile already gated: `done --raw`, a bare `/pensmith` dispatch, or a
// section that became unclean after compile could otherwise export a
// fabricated citation. runExportBlockingGate is the unconditional gate (neither
// --raw nor --yolo bypasses it). It reads the sections' recorded verdicts
// (VERIFICATION.json), never their Markdown reports, and checks the compiled
// draft, each section and each cited bibliography entry against
// .paper/COMPILE-MANIFEST.json.

import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runExportBlockingGate } from '../bin/cli/done.js';
import { bibForDrafts } from './lib/bib-fixture.js';
import {
  fixtureBibHashes,
  writeCompileManifestFixture,
  writeVerificationFixture,
  type VerificationSpec,
} from './lib/verification-fixture.js';

type Section = Omit<VerificationSpec, 'n' | 'draft'> & { draft?: string; record?: false };

/** A compiled paper: each section's verdicts recorded as given, then a manifest of the files as they stand. */
async function seed(sections: Section[]): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-exportgate-'));
  const pdir = join(root, '.paper');
  mkdirSync(pdir, { recursive: true });
  const drafts = sections.map((s) => s.draft ?? `A claim in ${s.slug} [@smith2020].\n`);
  const bib = bibForDrafts(...drafts);
  writeFileSync(join(pdir, 'CITATIONS.bib'), bib);
  writeFileSync(
    join(pdir, 'OUTLINE.md'),
    ['# Paper', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      ...sections.map((s, i) => `| ${i + 1} | ${s.slug} | ${s.slug} | | 300 | |`), ''].join('\n'),
  );
  for (const [i, s] of sections.entries()) {
    const dir = join(pdir, 'sections', `${String(i + 1).padStart(2, '0')}-${s.slug}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'DRAFT.md'), drafts[i]!);
    writeVerificationFixture(dir, { ...s, n: i + 1, draft: drafts[i]!, bibEntries: await fixtureBibHashes(bib, drafts[i]!) });
  }
  writeFileSync(join(pdir, 'DRAFT.md'), `# Paper\n\n${drafts.join('\n')}`);
  await writeCompileManifestFixture(root, sections.map((s, i) => ({ n: i + 1, slug: s.slug })));
  for (const [i, s] of sections.entries()) {
    if (s.record === false) rmSync(join(pdir, 'sections', `${String(i + 1).padStart(2, '0')}-${s.slug}`, 'VERIFICATION.json'));
  }
  return root;
}

test('export gate: a clean verified section does NOT block', async () => {
  const root = await seed([{ slug: 'intro' }]);
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, false, `expected no block; reasons: ${r.reasons.join('; ')}`);
});

test('export gate (audit #3): a section with a FABRICATED verdict BLOCKS export', async () => {
  const root = await seed([
    { slug: 'intro' },
    { slug: 'body', draft: 'An invented claim [@fakeauthor2099].\n', citations: [{ citekey: 'fakeauthor2099', verdict: 'FABRICATED', reason: 'citekey not in bib' }] },
  ]);
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(
    r.reasons.some((x) => /section 2 \(body\)/.test(x) && /\[@fakeauthor2099\] is FABRICATED/.test(x)),
    `expected a blocking-verdict reason; got: ${r.reasons.join('; ')}`,
  );
});

test('export gate (audit #14): a DRAFT.md no gated compile produced (no manifest) BLOCKS', async () => {
  const root = await seed([{ slug: 'intro' }]);
  rmSync(join(root, '.paper', 'COMPILE-MANIFEST.json'));
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /not produced by a gated compile/.test(x)), r.reasons.join('; '));
});

test('export gate (audit #14): a hand-placed DRAFT.md with no sections at all BLOCKS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-exportgate-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nClaim [@smith2020].\n');
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /not produced by a gated compile/.test(x)), r.reasons.join('; '));
});

test('export gate (CodeRabbit): a CLEAN section alongside one with no recorded verdicts BLOCKS', async () => {
  const root = await seed([{ slug: 'intro' }, { slug: 'body', record: false }]);
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(
    r.reasons.some((x) => /section 2 \(body\)/.test(x) && /recorded verdicts are missing/.test(x)),
    `unverified section must block, not be invisible; got: ${r.reasons.join('; ')}`,
  );
});

test('export gate (CodeRabbit): a failed section with NO blocking verdict still BLOCKS (fail-closed)', async () => {
  const root = await seed([{ slug: 'intro', status: 'failed', reason: 'the draft cites none of its assigned sources' }]);
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /verify failed this section/.test(x)), r.reasons.join('; '));
});

test('export gate: UNSUPPORTED (advisory Pass-2 pipe row) does NOT block', async () => {
  const advisoryMarkdown = [
    '## Pass-2',
    '| Citekey | Claim Sentence | Verdict | Rationale |',
    '| smith2020 | x | **UNSUPPORTED** | y |',
  ].join('\n');
  const root = await seed([{ slug: 'intro', advisoryMarkdown }]);
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, false, `UNSUPPORTED is advisory, must not block; reasons: ${r.reasons.join('; ')}`);
});

test('export gate: a quotation with no citation does not block export, but is reported as a warning', async () => {
  const root = await seed([
    { slug: 'intro' },
    {
      slug: 'body', status: 'unverifiable',
      quotes: [{ citekey: '(no citation)', quote: 'I just did not feel like the system cared', verdict: 'UNATTRIBUTED' }],
    },
  ]);
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, false, `UNATTRIBUTED does not block; reasons: ${r.reasons.join('; ')}`);
  assert.ok(r.warnings.some((w) => /section 2 \(body\).*1 quotation with no citation/.test(w)), r.warnings.join('; '));
});

test('export gate: the compiled DRAFT.md edited after compile BLOCKS', async () => {
  const root = await seed([{ slug: 'intro' }]);
  appendFileSync(join(root, '.paper', 'DRAFT.md'), '\nAn unverified sentence [@smith2020].\n');
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /\.paper\/DRAFT\.md changed after compile/.test(x)), r.reasons.join('; '));
});

test('export gate: a section draft or its recorded verdicts changed after compile BLOCKS', async () => {
  const root = await seed([{ slug: 'intro' }, { slug: 'body' }]);
  appendFileSync(join(root, '.paper', 'sections', '02-body', 'DRAFT.md'), '\nA new sentence.\n');
  appendFileSync(join(root, '.paper', 'sections', '01-intro', 'VERIFICATION.json'), '\n');
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /section 2 \(body\): DRAFT\.md changed after compile/.test(x)), r.reasons.join('; '));
  assert.ok(r.reasons.some((x) => /section 1 \(intro\): VERIFICATION\.json changed after compile/.test(x)), r.reasons.join('; '));
});

test('export gate: a cited bibliography entry changed after compile BLOCKS', async () => {
  const root = await seed([{ slug: 'intro' }]);
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  writeFileSync(bibPath, '@article{smith2020,\n  title = {Another Work},\n  author = {Other, Ann},\n  year = {2021},\n  doi = {10.1000/other}\n}\n');
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /CITATIONS\.bib entry for \[@smith2020\] changed after compile/.test(x)), r.reasons.join('; '));
});

test('export gate: a section added to the outline after compile BLOCKS', async () => {
  const root = await seed([{ slug: 'intro' }]);
  appendFileSync(join(root, '.paper', 'OUTLINE.md'), '| 2 | body | body | | 300 | |\n');
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /not the ones compiled/.test(x)), r.reasons.join('; '));
});
