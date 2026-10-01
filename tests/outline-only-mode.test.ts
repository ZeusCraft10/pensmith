// tests/outline-only-mode.test.ts — outline-only mode (GRND-02, GRND-11;
// D-21-25 amends D-18-45). The intake answer `mode = outline` routes the paper
// through research and the outline to `done`, which exports a re-verified,
// zero-trace sourced outline and an annotated bibliography — and never plans,
// drafts or verifies a section (router.ts stopAfterOutline, set by
// bin/cli/route-options.ts from `[project] mode`; bin/lib/outline-export.ts).
// Through the BUILT CLI, the RUN-21 mock LLM and the recorded e2e corpus.
//
//   - `new --mode outline --yolo`, then bare `--yolo` until the router says
//     done: research, outline, done; no section-planner or section-drafter
//     call, no sections/*/DRAFT.md, done makes no model call; export/ holds
//     OUTLINE.md and ANNOTATED-BIBLIOGRAPHY.md (+ CITATIONS.bib/.ris of the
//     listed sources), each passing the zero-trace scan; `status` shows
//     `mode: outline only`, complete, and the deliverables; another bare run
//     bills nothing;
//   - a second run, `done --format docx`, adds the .docx pair (scanned) and
//     the record lists both formats;
//   - an edited annotated bibliography is attention, and done refuses to
//     replace it;
//   - an explicit section verb still runs;
//   - a fabricated source the outline lists: done exits 4 naming it, nothing
//     exported.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openChainSandbox, type ChainSandbox } from './helpers/e2e-chain.js';
import { scanExportFile } from '../bin/lib/export/zero-trace.js';
import { upsertSources } from '../bin/lib/library.js';

const sandboxes: ChainSandbox[] = [];
after(async () => {
  for (const sb of sandboxes) await sb.close();
});

/** A sandbox paper in outline mode, routed to the step `until` names. */
async function outlinePaper(prefix: string, until: RegExp): Promise<{ sb: ChainSandbox; paper: string }> {
  const sb = await openChainSandbox({ prefix, assignment: true });
  sandboxes.push(sb);
  sb.applyCorpusScript();
  const paper = join(sb.root, '.paper');
  const intake = await sb.run(['new', '--mode', 'outline', '--yolo']);
  assert.equal(intake.status, 0, `${intake.stdout}\n${intake.stderr}`);
  assert.match(readFileSync(join(paper, 'config.toml'), 'utf8'), /^mode = "outline"$/m);
  const chain = await sb.loop(['--yolo'], { maxRuns: 5, until: (r) => until.test(r.stderr) || r.status !== 0 });
  for (const r of chain) assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(chain.at(-1)?.stderr ?? '', until);
  return { sb, paper };
}

async function assertScanClean(file: string, root: string): Promise<void> {
  assert.ok(existsSync(file), `${file} exists`);
  assert.deepEqual(await scanExportFile(file, { paperRoot: root }), [], `${file} passes the zero-trace scan`);
}

test('GRND-11 (built CLI): an outline-only paper runs research, outline and done — the re-verified outline and annotated bibliography are exported, no section is drafted', async () => {
  const { sb, paper } = await outlinePaper('outline-only', /next: status \(done/);
  const exportDir = join(paper, 'export');

  // The chain ended with done; the router now names the deliverables.
  const steps = sb.mock.requests.map((r) => r.slug);
  assert.ok(steps.includes('outline-author'), 'the outline was written');
  for (const slug of ['section-planner', 'section-drafter']) assert.equal(steps.includes(slug), false, `no ${slug} call`);

  // The outline is approved and registered; no section went further.
  const sections = readdirSync(join(paper, 'sections')).filter((d) => d !== '_archive');
  assert.ok(sections.length >= 3, `sections registered: ${sections.join(', ')}`);
  for (const dir of sections) {
    assert.match(readFileSync(join(paper, 'sections', dir, 'PLAN.md'), 'utf8'), /^stub: true$/m, `${dir} is still the outline's stub`);
    assert.equal(existsSync(join(paper, 'sections', dir, 'DRAFT.md')), false, `${dir} has no draft`);
  }
  assert.equal(existsSync(join(paper, 'DRAFT.md')), false, 'no compiled draft');
  assert.equal(existsSync(join(paper, 'FINAL.md')), false, 'no FINAL.md');

  // The deliverables: the annotated bibliography in .paper/ and the Markdown exports.
  const annotated = readFileSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8');
  assert.match(annotated, /^# .+ — Annotated Bibliography$/m);
  assert.match(annotated, /^- \*\*Type:\*\* /m);
  assert.match(annotated, /^- \*\*Summary \(abstract excerpt\):\*\* (“.+”|no abstract available)$/m);
  assert.match(annotated, /^- \*\*Why it is relevant:\*\* /m);
  assert.match(annotated, /^- \*\*Supports:\*\* §1 /m);
  assert.doesNotMatch(annotated, /\[@|(^|\s)@[a-z]/m, 'no citation token in the annotated bibliography');
  for (const name of ['OUTLINE.md', 'ANNOTATED-BIBLIOGRAPHY.md', 'CITATIONS.bib', 'CITATIONS.ris']) await assertScanClean(join(exportDir, name), sb.root);
  assert.equal(readFileSync(join(exportDir, 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8'), annotated, 'the Markdown export is the annotated bibliography as written');
  const outlineMd = readFileSync(join(exportDir, 'OUTLINE.md'), 'utf8');
  assert.match(outlineMd, /^## 1\. /m, 'each section is a heading');
  assert.match(outlineMd, /^\*Sources:\* /m);
  assert.match(outlineMd, /^## (References|Bibliography)$/m, 'the listed sources are a References list');
  assert.doesNotMatch(outlineMd, /\[@/, 'every citation rendered in the style');
  const record = JSON.parse(readFileSync(join(paper, 'DONE-RECORD.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(record['$schemaVersion'], 2);
  assert.equal(record['mode'], 'outline');
  assert.deepEqual(record['outline_exports'], ['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.md']);

  // status: outline only, complete, the deliverables; a bare run bills nothing.
  const status = await sb.run(['status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^ {2}mode: outline only$/m);
  assert.match(status.stdout, /^ {2}current: complete$/m);
  assert.match(status.stdout, /next: status \(done\)/);
  assert.match(status.stdout, /note: outline only — complete: export\/OUTLINE\.md and export\/ANNOTATED-BIBLIOGRAPHY\.md — to draft the paper, set mode = "draft"/);
  assert.match(status.stdout, /^ {2}deliverables:\n {4}\.paper\/ANNOTATED-BIBLIOGRAPHY\.md\n {4}\.paper\/export\/OUTLINE\.md\n {4}\.paper\/export\/ANNOTATED-BIBLIOGRAPHY\.md$/m);
  const before = sb.mock.requests.length;
  const again = await sb.run(['--yolo']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stderr, /^pensmith: ran status \(done: outline only — complete/m);
  assert.equal(sb.mock.requests.length, before, 'a finished outline-only paper makes no model call');

  // A second run in another format adds the .docx pair; the record lists both.
  const docx = await sb.run(['done', '--yolo', '--format', 'docx']);
  assert.equal(docx.status, 0, `${docx.stdout}\n${docx.stderr}`);
  assert.equal(sb.mock.requests.length, before, 'done in outline mode makes no model call');
  for (const name of ['OUTLINE.docx', 'ANNOTATED-BIBLIOGRAPHY.docx']) await assertScanClean(join(exportDir, name), sb.root);
  const record2 = JSON.parse(readFileSync(join(paper, 'DONE-RECORD.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(record2['outline_exports'], ['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.md', 'export/OUTLINE.docx', 'export/ANNOTATED-BIBLIOGRAPHY.docx']);
  assert.match((await sb.run(['status'])).stdout, /\.paper\/export\/OUTLINE\.docx/);

  // An edited annotated bibliography is attention; done refuses to replace it.
  appendFileSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md'), '\nMy own note.\n');
  const edited = await sb.run(['status']);
  assert.match(edited.stdout, /attention: \.paper\/ANNOTATED-BIBLIOGRAPHY\.md is not the text `pensmith done` wrote/);
  const refused = await sb.run(['done', '--yolo', '--format', 'md']);
  assert.equal(refused.status, 4, `${refused.stdout}\n${refused.stderr}`);
  assert.match(refused.stdout, /never replaces your file/);
  assert.match(readFileSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8'), /My own note\./, 'the edit is kept');

  // An explicit section verb still runs (the outline-only route is routing only).
  const plan = await sb.run(['plan', '1', '--yolo']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.ok(sb.mock.requests.some((r) => r.slug === 'section-planner'), 'an explicit `plan 1` calls the planner');
});

test('GRND-11 (built CLI): a fabricated source the outline lists blocks the outline export — exit 4, nothing exported', async () => {
  const { sb, paper } = await outlinePaper('outline-fabricated', /next: done/);
  // A source no registrar holds (Crossref answers 404 for the recorded DOI),
  // added to the library and listed by the outline's first section.
  await upsertSources(sb.root, [{ citekey: 'fake2024a', doi: '10.99999/fake.001', title: 'Attention Mechanisms in Modern Transformer Architectures', authors: ['Smith, A.B.'], year: 2024 }], { provenance: 'add' });
  const outlineFile = join(paper, 'OUTLINE.md');
  const rows = readFileSync(outlineFile, 'utf8').split('\n');
  const first = rows.findIndex((l) => /^\|\s*1\s*\|/.test(l));
  assert.ok(first >= 0, 'the outline has a row for section 1');
  const cells = (rows[first] as string).split('|');
  // # | slug | title | role | depends_on | word target | assigned_sources | voice
  cells[7] = ` ${[(cells[7] ?? '').trim(), 'fake2024a'].filter((c) => c !== '').join(', ')} `;
  rows[first] = cells.join('|');
  writeFileSync(outlineFile, rows.join('\n'));

  const d = await sb.run(['done', '--yolo', '--format', 'md']);
  assert.equal(d.status, 4, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /pensmith done: BLOCKED — the outline export refused/);
  assert.match(d.stdout, /citation \[@fake2024a\] is FABRICATED/);
  assert.equal(existsSync(join(paper, 'export')), false, 'nothing exported');
  assert.equal(existsSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md')), false, 'no annotated bibliography');
  assert.equal(existsSync(join(paper, 'DONE-RECORD.json')), false, 'no record');
  assert.match((await sb.run(['status'])).stdout, /next: done/, 'the router still names done');
});
