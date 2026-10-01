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
import { appendFileSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

  // The deliverables: the annotated bibliography in .paper/ and the exports —
  // the Markdown pair and the default format's (.docx) pair (GRND-11: one
  // routed or explicit done writes both; review round 2).
  const annotated = readFileSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8');
  assert.match(annotated, /^# .+ — Annotated Bibliography$/m);
  assert.match(annotated, /^- \*\*Type:\*\* /m);
  assert.match(annotated, /^- \*\*Summary \(abstract excerpt(?:, from the [A-Za-z.]+ record)?\):\*\* (“.+”|no abstract available \(.+\))$/m);
  // Review round 3: the excerpt quotes the registrar's abstract, never LIBRARY.json's.
  assert.doesNotMatch(annotated, /LLM stubbed/);
  assert.match(annotated, /^- \*\*Why it is relevant:\*\* /m);
  assert.match(annotated, /^- \*\*Supports:\*\* §1 /m);
  assert.doesNotMatch(annotated, /\[@|(^|\s)@[a-z]/m, 'no citation token in the annotated bibliography');
  for (const name of ['OUTLINE.md', 'ANNOTATED-BIBLIOGRAPHY.md', 'OUTLINE.docx', 'ANNOTATED-BIBLIOGRAPHY.docx', 'CITATIONS.bib', 'CITATIONS.ris']) await assertScanClean(join(exportDir, name), sb.root);
  assert.equal(readFileSync(join(exportDir, 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8'), annotated, 'the Markdown export is the annotated bibliography as written');
  const outlineMd = readFileSync(join(exportDir, 'OUTLINE.md'), 'utf8');
  assert.match(outlineMd, /^## 1\. /m, 'each section is a heading');
  assert.match(outlineMd, /^\*Sources:\* /m);
  assert.match(outlineMd, /^## (References|Bibliography)$/m, 'the listed sources are a References list');
  assert.doesNotMatch(outlineMd, /\[@/, 'every citation rendered in the style');
  const record = JSON.parse(readFileSync(join(paper, 'DONE-RECORD.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(record['$schemaVersion'], 4);
  assert.equal(record['mode'], 'outline');
  const FOUR = ['export/OUTLINE.md', 'export/ANNOTATED-BIBLIOGRAPHY.md', 'export/OUTLINE.docx', 'export/ANNOTATED-BIBLIOGRAPHY.docx'];
  assert.deepEqual(record['outline_exports'], FOUR);

  // status: outline only, complete, the deliverables; a bare run bills nothing.
  const status = await sb.run(['status']);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /^ {2}mode: outline only$/m);
  assert.match(status.stdout, /^ {2}current: complete$/m);
  assert.match(status.stdout, /next: status \(done\)/);
  assert.match(status.stdout, /note: outline only — complete: export\/OUTLINE\.md, export\/ANNOTATED-BIBLIOGRAPHY\.md, export\/OUTLINE\.docx and export\/ANNOTATED-BIBLIOGRAPHY\.docx — to draft the paper, set mode = "draft"/);
  assert.match(status.stdout, /^ {2}deliverables:\n {4}\.paper\/ANNOTATED-BIBLIOGRAPHY\.md\n {4}\.paper\/export\/OUTLINE\.md\n {4}\.paper\/export\/ANNOTATED-BIBLIOGRAPHY\.md\n {4}\.paper\/export\/OUTLINE\.docx\n {4}\.paper\/export\/ANNOTATED-BIBLIOGRAPHY\.docx$/m);
  const before = sb.mock.requests.length;
  const again = await sb.run(['--yolo']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stderr, /^pensmith: ran status \(done: outline only — complete/m);
  assert.equal(sb.mock.requests.length, before, 'a finished outline-only paper makes no model call');

  // An explicit `pensmith done --yolo` (no --format) exports what the routed
  // done exported — the .md and .docx pairs (review round 2: it exported only
  // the .docx pair, the routed one only the .md pair).
  const docx = await sb.run(['done', '--yolo']);
  assert.equal(docx.status, 0, `${docx.stdout}\n${docx.stderr}`);
  assert.equal(sb.mock.requests.length, before, 'done in outline mode makes no model call');
  for (const name of ['OUTLINE.docx', 'ANNOTATED-BIBLIOGRAPHY.docx']) await assertScanClean(join(exportDir, name), sb.root);
  const record2 = JSON.parse(readFileSync(join(paper, 'DONE-RECORD.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(record2['outline_exports'], FOUR);
  assert.match((await sb.run(['status'])).stdout, /\.paper\/export\/OUTLINE\.docx/);

  // Review round 1: an earlier export removed since is not carried into the
  // record — the routed done re-exports and the paper is complete again (it
  // looped at `done` forever).
  rmSync(join(exportDir, 'OUTLINE.docx'));
  assert.match((await sb.run(['status'])).stdout, /next: done/, 'a recorded export is gone: done again');
  const redo = await sb.run(['--yolo']);
  assert.equal(redo.status, 0, `${redo.stdout}\n${redo.stderr}`);
  assert.match(redo.stderr, /^pensmith: ran done; next: status \(done/m);
  const record3 = JSON.parse(readFileSync(join(paper, 'DONE-RECORD.json'), 'utf8')) as Record<string, unknown>;
  assert.deepEqual(record3['outline_exports'], FOUR, 'the routed done writes the removed export again');
  assert.ok(existsSync(join(exportDir, 'OUTLINE.docx')));
  assert.match((await sb.run(['status'])).stdout, /^ {2}current: complete$/m);

  // An edited annotated bibliography is attention; done refuses to replace it.
  appendFileSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md'), '\nMy own note.\n');
  const edited = await sb.run(['status']);
  assert.match(edited.stdout, /attention: \.paper\/ANNOTATED-BIBLIOGRAPHY\.md is not the text `pensmith done` wrote/);
  const refused = await sb.run(['done', '--yolo', '--format', 'md']);
  assert.equal(refused.status, 4, `${refused.stdout}\n${refused.stderr}`);
  assert.match(refused.stdout, /never replaces your file/);
  assert.match(readFileSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8'), /My own note\./, 'the edit is kept');

  // Review round 3: `plan` / `verify` with no number route as bare / status
  // do — an outline-only paper names no section (no planner call).
  for (const verb of ['plan', 'verify']) {
    const r = await sb.run([verb, '--yolo']);
    assert.equal(r.status, 1, `${verb}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, new RegExp(`pensmith ${verb}: this paper is outline only \\(\\[project\\] mode = "outline"\\): no section is planned, drafted or verified unless you name it`));
  }
  assert.equal(sb.mock.requests.some((r) => r.slug === 'section-planner'), false, 'no planner call without a section number');

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

test('GRND-11 + EXP-03 (Phase 21 integration, built CLI): the outline export runs after done\'s flag checks in the resolved style — config.toml\'s citation_style, then --style; tex is latex; the prose-only steps are skipped', async () => {
  const { sb, paper } = await outlinePaper('outline-style', /next: done/);
  const exportDir = join(paper, 'export');
  const cfgFile = join(paper, 'config.toml');
  const cfg = readFileSync(cfgFile, 'utf8');
  writeFileSync(
    cfgFile,
    /^citation_style = /m.test(cfg)
      ? cfg.replace(/^citation_style = .*$/m, 'citation_style = "MLA"')
      : cfg.replace(/^\[project\]$/m, '[project]\ncitation_style = "MLA"'),
  );

  // Flag errors come first: nothing is exported.
  const bogus = await sb.run(['done', '--yolo', '--style', 'bogus']);
  assert.equal(bogus.status, 2, `${bogus.stdout}\n${bogus.stderr}`);
  const html = await sb.run(['done', '--yolo', '--format', 'html']);
  assert.equal(html.status, 2, `${html.stdout}\n${html.stderr}`);
  assert.match(`${html.stdout}${html.stderr}`, /md, docx, pdf, latex \(tex\)/);
  assert.equal(existsSync(exportDir), false, 'a usage error exports nothing');

  // The prose-only aliases say why they do nothing.
  for (const verb of ['score', 'plagiarism', 'humanize']) {
    const r = await sb.run([verb, '--yolo']);
    assert.equal(r.status, 0, `${verb}: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, new RegExp(`pensmith done: ${verb} skipped \\(outline only — there is no prose`));
  }
  assert.equal(existsSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md')), false, 'the skipped steps wrote nothing');

  // config.toml's style (MLA): a routed done exports the .md and .docx pairs.
  const mla = await sb.run(['--yolo']);
  assert.equal(mla.status, 0, `${mla.stdout}\n${mla.stderr}`);
  assert.match(mla.stdout, /pensmith done: style: mla \(from config\.toml \[project\] citation_style\)/);
  const mlaAnnotated = readFileSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8');
  const mlaOutline = readFileSync(join(exportDir, 'OUTLINE.md'), 'utf8');
  assert.match(mlaOutline, /^\*Sources:\* \([^()\d]+\)$/m, 'MLA cites by author alone (no year)');

  // --style overrides config; --format tex is the LaTeX export.
  const apa = await sb.run(['done', '--yolo', '--style', 'apa', '--format', 'tex']);
  assert.equal(apa.status, 0, `${apa.stdout}\n${apa.stderr}`);
  assert.match(apa.stdout, /pensmith done: style: apa \(from --style\)/);
  for (const name of ['OUTLINE.tex', 'ANNOTATED-BIBLIOGRAPHY.tex']) await assertScanClean(join(exportDir, name), sb.root);
  const tex = readFileSync(join(exportDir, 'OUTLINE.tex'), 'utf8');
  assert.match(tex, /\\documentclass/);
  // Review round 2: every pair on disk was rebuilt in the new style — no
  // MLA export stays beside the APA ones.
  for (const name of ['OUTLINE.md', 'OUTLINE.docx']) assert.ok(existsSync(join(exportDir, name)), name);
  assert.doesNotMatch(readFileSync(join(exportDir, 'OUTLINE.md'), 'utf8'), /^\*Sources:\* \([^()\d]+\)$/m, 'the Markdown outline is APA now too');
  assert.match(tex, /Sources:.*\(\D+, \d{4}[a-z]?[;)]/, 'APA cites author and year');
  assert.notEqual(readFileSync(join(paper, 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8'), mlaAnnotated, 'the annotated bibliography follows the style');
});

// Review round 3 (VRFY-24 for outline mode): an outline the stubbed model
// wrote (PENSMITH_NO_LLM=1, no --dry-run) is placeholders. Repeated bare runs
// never export it: the router reports attention naming `pensmith outline
// --force`, and an explicit done refuses (exit 4). Deleting the stub line
// makes the outline the user's; the stubbed evaluator's reasons are never
// printed, and a LIBRARY.json abstract is never quoted.
test('review r3 (built CLI): PENSMITH_NO_LLM outline-only bare runs never export the stub outline; once the user owns it, nothing stubbed or local is quoted', async () => {
  // Research runs on the recorded corpus (its queries are the mock model's);
  // the outline is then written with the model stubbed.
  const { sb, paper } = await outlinePaper('outline-stub', /next: outline/);
  const env = { PENSMITH_NO_LLM: '1' };
  const chain = await sb.loop(['--yolo'], { env, maxRuns: 6, until: (r) => /attention|ran done/.test(r.stderr) || r.status !== 0 });
  const last = chain.at(-1);
  assert.equal(last?.status, 0, `${last?.stdout}\n${last?.stderr}`);
  assert.doesNotMatch(chain.map((r) => r.stderr).join('\n'), /ran done/, 'no routed done');
  assert.match(readFileSync(join(paper, 'OUTLINE.md'), 'utf8'), /^<!-- stub outline \(no model configured\) — not a real outline -->$/m);
  const st = await sb.run(['status'], { env });
  assert.match(st.stdout, /current: needs attention/);
  assert.match(st.stdout, /OUTLINE\.md was written without a model \(PENSMITH_NO_LLM=1\).*`pensmith outline --force`/);
  const again = await sb.run(['--yolo'], { env });
  assert.equal(again.status, 0, again.stderr);
  const d = await sb.run(['done', '--yolo', '--format', 'md'], { env });
  assert.equal(d.status, 4, `${d.stdout}\n${d.stderr}`);
  assert.match(d.stdout, /BLOCKED — the outline export refused/);
  assert.equal(existsSync(join(paper, 'export')), false, 'nothing exported');

  // The user takes the outline as their own: the stub line goes, done exports.
  const outlineFile = join(paper, 'OUTLINE.md');
  writeFileSync(outlineFile, readFileSync(outlineFile, 'utf8').replace(/^<!-- stub outline .*\n\n?/m, ''));
  // A LIBRARY.json abstract is a local value: never quoted as the source's.
  const libFile = join(paper, 'LIBRARY.json');
  const lib = JSON.parse(readFileSync(libFile, 'utf8')) as { entries: Array<Record<string, unknown>> };
  for (const e of lib.entries) {
    e['abstract'] = 'This chapter proves that attention mechanisms are conscious.';
    e['why_relevant'] = 'LLM stubbed: kept for your review; no relevance judgment was made';
  }
  writeFileSync(libFile, `${JSON.stringify(lib, null, 2)}\n`);
  const ok = await sb.run(['done', '--yolo', '--format', 'md'], { env });
  assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
  const annotated = readFileSync(join(paper, 'export', 'ANNOTATED-BIBLIOGRAPHY.md'), 'utf8');
  assert.doesNotMatch(annotated, /LLM stubbed|conscious/);
  assert.match(annotated, /^- \*\*Why it is relevant:\*\* not recorded \(no model judged it\)$/m);
  for (const name of ['OUTLINE.md', 'ANNOTATED-BIBLIOGRAPHY.md']) await assertScanClean(join(paper, 'export', name), sb.root);
});
