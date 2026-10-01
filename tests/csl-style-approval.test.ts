// tests/csl-style-approval.test.ts — a `.csl` file a paper's config.toml names
// (EXP-03, D-21-12; Phase 21 review round 2).
//
// A CSL file is code for the citation engine: its literal text is printed in
// every citation, note and bibliography entry of the export, after the gate.
// config.toml travels with a shared paper, so:
//   - a `.csl` file config.toml names is used only once this user approved it
//     for this paper (the `csl-style` gate: --yolo never answers it, no
//     terminal refuses with exit 3; the approval lives in the data dir, bound
//     to the file's real path and sha256 — an edited file is asked about
//     again); a bundled style and a `--style` value the user typed never ask;
//   - the exporter refuses an export whose rendered citations print a DOI,
//     arXiv id or PMID none of the cited entries holds (defence in depth).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExportStyle } from '../bin/lib/export-style.js';
import { approveCslStyle, assertCslStyleApproved, isCslStyleApproved } from '../bin/lib/style-approvals.js';
import { GateRefusedError } from '../bin/lib/gates.js';
import { EXIT_APPROVAL, EXIT_ERROR, EXIT_OK, PensmithError } from '../bin/lib/exit-codes.js';
import { exportDraft } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';
import { seedGatePaper, RECORDED_BIB } from './helpers/gate-paper.js';
import { runCli } from './helpers/paper-cli-harness.js';

const STYLES_DIR = fileURLToPath(new URL('../plugin/templates/citation-styles/', import.meta.url));
const APA = readFileSync(join(STYLES_DIR, 'apa.csl'), 'utf8');
/** apa.csl with a literal "see also Smith 2019, doi:10.9999/fake.123; " printed before every citation. */
const EVIL = APA.replace(/(<citation\b[\s\S]*?<layout\b[^>]*>)/, '$1<text value="see also Smith 2019, doi:10.9999/fake.123; "/>');

function paperWith(config: string): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-csl-approval-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  mkdirSync(join(root, 'styles'), { recursive: true });
  writeFileSync(join(root, '.paper', 'config.toml'), `schema_version = 4\n${config}`);
  return root;
}

test('EXP-03 (review r2): a .csl file config.toml names needs this user\'s approval — refused without a terminal, recorded per paper and file sha256, asked again once the file changes', async () => {
  const root = paperWith('[project]\ncitation_style = "styles/journal.csl"\n');
  const file = join(root, 'styles', 'journal.csl');
  writeFileSync(file, APA);
  const style = resolveExportStyle(root);
  assert.equal(style.source, 'config');
  const lines: string[] = [];
  await assert.rejects(
    assertCslStyleApproved(root, style, (l) => lines.push(l)),
    (e: unknown) => e instanceof GateRefusedError && e.exitCode === EXIT_APPROVAL && /config\.toml names\?|style file/.test(e.message) && /--style /.test(e.message),
  );
  assert.equal(isCslStyleApproved(root, file), false);
  await approveCslStyle(root, file);
  assert.equal(isCslStyleApproved(root, file), true);
  await assertCslStyleApproved(root, style, (l) => lines.push(l));
  // Another paper is another approval.
  const other = paperWith('[project]\ncitation_style = "styles/journal.csl"\n');
  copyFileSync(file, join(other, 'styles', 'journal.csl'));
  assert.equal(isCslStyleApproved(other, join(other, 'styles', 'journal.csl')), false);
  // An edited file is asked about again.
  writeFileSync(file, APA.replace('<title>', '<title>Edited '));
  assert.equal(isCslStyleApproved(root, file), false);
  await assert.rejects(assertCslStyleApproved(root, resolveExportStyle(root), () => {}), GateRefusedError);
  // A style the user typed, and a bundled style, never ask.
  await assertCslStyleApproved(root, resolveExportStyle(root, 'styles/journal.csl', root), () => {});
  await assertCslStyleApproved(paperWith('[project]\ncitation_style = "apa"\n'), resolveExportStyle(paperWith('[project]\ncitation_style = "apa"\n')), () => {});
  assert.deepEqual(lines, []);
});

test('D-21-12 (review r2): a style that prints an identifier no cited entry holds refuses the export — nothing is written', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-csl-inject-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const csl = join(root, 'evil.csl');
  writeFileSync(csl, EVIL);
  const bibText = '@article{lecun2015, author = {LeCun, Yann}, title = {Deep learning}, journal = {Nature}, year = {2015}, doi = {10.1038/nature14539}}\n';
  const out = join(root, 'out');
  await assert.rejects(
    withCapturedOutput(() => exportDraft({ inputPath: join(root, 'DRAFT.md'), text: '# T\n\nDeep learning changed vision [@lecun2015].\n', bibText, format: 'md', paperRoot: root, outputDir: out, pandocPresent: false, style: csl })),
    (e: unknown) => e instanceof PensmithError && e.exitCode === EXIT_ERROR && /printed an identifier no cited source holds \(doi:10\.9999\/fake\.123;?\)/.test(e.message),
  );
  assert.equal(existsSync(out) ? readdirSync(out).length : 0, 0, 'nothing exported');
  // The same file without the injected identifier exports (its own DOI is the entry's).
  writeFileSync(csl, APA);
  const ok = await withCapturedOutput(() => exportDraft({ inputPath: join(root, 'DRAFT.md'), text: '# T\n\nDeep learning changed vision [@lecun2015].\n', bibText, format: 'md', paperRoot: root, outputDir: out, pandocPresent: false, style: csl }));
  assert.match(readFileSync(ok.result.outputPath, 'utf8'), /https:\/\/doi\.org\/10\.1038\/nature14539/);
});

test('EXP-03 (review r2, built CLI): done refuses a config.toml .csl the user has not approved (exit 3, nothing exported); a scripted yes approves it once; a typed --style is the user\'s own', () => {
  const SECTIONS = [{ n: 1, slug: 'intro', assigned: ['lecun2015'], draft: '# Introduction\n\nDeep networks learn layered representations of their input data [@lecun2015].\n' }];
  const ENV = { PENSMITH_NO_LLM: '1', PENSMITH_CONTACT_EMAIL: undefined };
  const p = seedGatePaper('csl-approval', SECTIONS, RECORDED_BIB);
  assert.equal(p.cli(['verify', '1'], ENV).status, EXIT_OK);
  assert.equal(p.cli(['compile', '--yolo'], ENV).status, EXIT_OK);
  mkdirSync(join(p.root, 'styles'), { recursive: true });
  writeFileSync(join(p.root, 'styles', 'journal.csl'), APA);
  writeFileSync(join(p.root, '.paper', 'config.toml'), 'schema_version = 4\n[project]\ncitation_style = "styles/journal.csl"\n');
  const exportDir = join(p.root, '.paper', 'export');

  const refused = p.cli(['done', '--yolo', '--format', 'md'], ENV);
  assert.equal(refused.status, EXIT_APPROVAL, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /--yolo does not skip this gate/);
  assert.match(refused.stderr, /--style /);
  assert.equal(existsSync(exportDir) ? readdirSync(exportDir).length : 0, 0, 'nothing exported');

  // A scripted terminal answer (numbered prompts read stdin) approves the file once.
  const answered = runCli(p.sb, p.root, ['done', '--yolo', '--format', 'md'], { env: { ...ENV, PENSMITH_PROMPT_MODE: 'numbered' }, input: 'y\n' });
  assert.equal(answered.status, EXIT_OK, answered.stdout + answered.stderr);
  assert.ok(readdirSync(exportDir).includes('DRAFT.md'));
  const again = p.cli(['done', '--yolo', '--format', 'md'], ENV);
  assert.equal(again.status, EXIT_OK, `recorded: no question the second time\n${again.stdout}${again.stderr}`);

  // A file that injects a DOI: typed with --style it is the user's choice, and the exporter still refuses it.
  writeFileSync(join(p.root, 'styles', 'evil.csl'), EVIL);
  const evil = p.cli(['done', '--yolo', '--format', 'md', '--style', 'styles/evil.csl'], ENV);
  assert.equal(evil.status, EXIT_ERROR, evil.stdout + evil.stderr);
  assert.match(evil.stderr, /printed an identifier no cited source holds \(doi:10\.9999\/fake\.123;?\)/);
});
