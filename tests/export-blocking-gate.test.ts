// tests/export-blocking-gate.test.ts — done re-asserts the blocking gate, and
// the export is bound to what a gated compile produced.
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
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSectionUnsupported, runExportBlockingGate } from '../bin/cli/done.js';
import { recheckExportText } from '../bin/lib/export-gate.js';
import { checkCitationsAndQuotes } from '../bin/lib/verify/check-text.js';
import { parseBibForPass1 } from '../bin/lib/verify/pass1.js';
import { buildVerificationRecord } from '../bin/lib/verify/verification-record.js';
import { bibForDrafts } from './lib/bib-fixture.js';
import { compiledPaper } from './lib/export-fixture.js';
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

test('export gate: a section with a FABRICATED verdict BLOCKS export', async () => {
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

test('export gate: a DRAFT.md no gated compile produced (no manifest) BLOCKS', async () => {
  const root = await seed([{ slug: 'intro' }]);
  rmSync(join(root, '.paper', 'COMPILE-MANIFEST.json'));
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /not produced by a gated compile/.test(x)), r.reasons.join('; '));
});

test('export gate: a hand-placed DRAFT.md with no sections at all BLOCKS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-exportgate-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'DRAFT.md'), '# Paper\n\nClaim [@smith2020].\n');
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /not produced by a gated compile/.test(x)), r.reasons.join('; '));
});

test('export gate: a CLEAN section alongside one with no recorded verdicts BLOCKS', async () => {
  const root = await seed([{ slug: 'intro' }, { slug: 'body', record: false }]);
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(
    r.reasons.some((x) => /section 2 \(body\)/.test(x) && /recorded verdicts are missing/.test(x)),
    `unverified section must block, not be invisible; got: ${r.reasons.join('; ')}`,
  );
});

test('export gate: a failed section with NO blocking verdict still BLOCKS (fail-closed)', async () => {
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

test('export gate: a manifest whose section slug leaves .paper/sections BLOCKS, and nothing outside is read', async () => {
  const root = await seed([{ slug: 'intro' }]);
  const manifestPath = join(root, '.paper', 'COMPILE-MANIFEST.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sections: Array<{ slug: string }> };
  manifest.sections[0]!.slug = '/../../outside';
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /COMPILE-MANIFEST\.json does not match its schema/.test(x)), r.reasons.join('; '));
});

test('export gate: a section DRAFT.md that cannot be read BLOCKS, and the gate does not throw', async () => {
  const root = await seed([{ slug: 'intro' }]);
  const draft = join(root, '.paper', 'sections', '01-intro', 'DRAFT.md');
  rmSync(draft);
  mkdirSync(draft);
  const r = await runExportBlockingGate(root);
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => /section 1 \(intro\): DRAFT\.md could not be read \(EISDIR\)/.test(x)), r.reasons.join('; '));
});

test('export confirmation: UNSUPPORTED claims come from the recorded verdicts, so deleting them from VERIFICATION.md hides nothing', async () => {
  const advisoryMarkdown = [
    '## Pass-2 (claim support, advisory — LLM-judged)',
    '',
    '| Citekey | Claim Sentence | Verdict | Rationale |',
    '|---------|---------------|---------|-----------|',
    '| smith2020 | The effect persists across all populations. | **UNSUPPORTED** | Single cohort only. |',
  ].join('\n');
  const root = await seed([{ slug: 'intro', advisoryMarkdown }]);
  writeFileSync(join(root, '.paper', 'sections', '01-intro', 'VERIFICATION.md'), '# VERIFICATION (Section 1, intro)\n\nStatus: verified\n');
  const rows = readSectionUnsupported(root);
  assert.deepEqual(rows.map((r) => [r.citekey, r.verdict]), [['smith2020', 'UNSUPPORTED']]);
});

// A PLOS ONE article under an expression of concern (2023); the registry
// recordings hold it, and no open-access PDF of it.
const CONCERN =
  '@article{feng2013,\n  title = {Impairment of FOS mRNA Stabilization Following Translation Arrest in Granulocytes from Myelodysplastic Syndrome Patients},\n' +
  '  author = {Feng, Xiaomin and Shikama, Yayoi and Shichishima, Tsutomu and Noji, Hideyoshi and Ikeda, Kazuhiko and Ogawa, Kazuei and Kimura, Hideo and Takeishi, Yasuchika and Kimura, Junko},\n' +
  '  journal = {PLoS ONE},\n  volume = {8},\n  year = {2013},\n  doi = {10.1371/journal.pone.0061107}\n}\n';
const CONCERN_DRAFT =
  'FOS stabilization is impaired [@feng2013]. As the authors put it, ' +
  '"the stabilization of FOS mRNA was impaired following translation arrest in granulocytes" [@feng2013, p. 3].\n';

test('re-check: what the sections\' records did not report is a warning (an expression of concern since verify, a quotation with no source text)', async () => {
  assert.equal(process.env['PENSMITH_TEST_CASSETTES'], '1', 'the test runner replays recordings');
  // The records say OK: verify ran before the notice, and before the PDF went away.
  const root = await compiledPaper({ bib: CONCERN, sections: [{ slug: 'intro', title: 'Intro', sources: ['feng2013'], draft: CONCERN_DRAFT }] });
  const r = await recheckExportText(root, readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8'), { label: '.paper/DRAFT.md' });
  assert.equal(r.blocked, false, r.reasons.join('; '));
  assert.equal(r.warnings.length, 2, r.warnings.join('\n'));
  assert.match(r.warnings[0]!, /^\.paper\/DRAFT\.md: citation \[@feng2013\] is a work under an expression of concern/);
  assert.match(r.warnings[1]!, /^\.paper\/DRAFT\.md has 1 quotation that could not be checked against the source text: \[@feng2013\] "the stabilization/);
});

test('re-check: a warning a section\'s record already gave is not repeated', async () => {
  const root = await compiledPaper({ bib: CONCERN, sections: [{ slug: 'intro', title: 'Intro', sources: ['feng2013'], draft: CONCERN_DRAFT }] });
  // The section's record as verify would write it now: the same two findings.
  const dir = join(root, '.paper', 'sections', '01-intro');
  const bib = await parseBibForPass1(CONCERN);
  const checked = await checkCitationsAndQuotes(CONCERN_DRAFT, { bib, bibPath: join(root, '.paper', 'CITATIONS.bib') });
  const record = buildVerificationRecord({
    section: 1, slug: 'intro', status: 'unverifiable', checked: true, draftBytes: Buffer.from(CONCERN_DRAFT),
    assignedSources: ['feng2013'], bibEntries: await fixtureBibHashes(CONCERN, CONCERN_DRAFT), pass1: checked.pass1, pass3: checked.pass3,
  });
  writeFileSync(join(dir, 'VERIFICATION.json'), `${JSON.stringify(record, null, 2)}\n`);
  await writeCompileManifestFixture(root, [{ n: 1, slug: 'intro' }]);

  const gate = await runExportBlockingGate(root);
  assert.equal(gate.blocked, false, gate.reasons.join('; '));
  assert.equal(gate.warnings.length, 2, gate.warnings.join('\n'));
  const r = await recheckExportText(root, readFileSync(join(root, '.paper', 'DRAFT.md'), 'utf8'), { label: '.paper/DRAFT.md' });
  assert.deepEqual(r.warnings, []);
});
