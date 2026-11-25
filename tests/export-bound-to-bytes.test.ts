// tests/export-bound-to-bytes.test.ts — done exports only the bytes a gated
// compile produced, and re-checks the citations of the exact text it exports.
//
// The export gate used to read each section's VERIFICATION.md and nothing
// else. A citation added to .paper/DRAFT.md after compile, a bibliography
// entry pointed at another work, a section redone without a recompile, or an
// acknowledgement withdrawn after verify all exported as if verified. Every
// case here drives the real verify, compile and done on recorded registry
// answers (tests/fixtures/cassettes): vaswani2017 is a real arXiv DOI DataCite
// holds, and 10.1038/s41586-024-99999-x is a DOI no registry holds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from './lib/export-fixture.js';

const ATTENTION =
  '@misc{vaswani2017,\n  title = {Attention Is All You Need},\n' +
  '  author = {Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N. and Kaiser, Lukasz and Polosukhin, Illia},\n' +
  '  year = {2017},\n  doi = {10.48550/arXiv.1706.03762}\n}\n';

const GHOST =
  '@article{ghost2024,\n  title = {Room-temperature superconductivity in a ternary hydride at ambient pressure},\n' +
  '  author = {Ghost, Casper},\n  year = {2024},\n  journal = {Nature},\n  doi = {10.1038/s41586-024-99999-x}\n}\n';

const WAKEFIELD_DOI = '10.1016/S0140-6736(97)11096-0';
const WAKEFIELD =
  '@article{wakefield1998,\n  title = {Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children},\n' +
  '  author = {Wakefield, A. J. and Murch, S. H. and Anthony, A. and Linnell, J. and Casson, D. M. and Malik, M. and ' +
  'Berelowitz, M. and Dhillon, A. P. and Thomson, M. A. and Harvey, P. and Valentine, A. and Davies, S. E. and Walker-Smith, J. A.},\n' +
  `  journal = {The Lancet},\n  volume = {351},\n  pages = {637--641},\n  year = {1998},\n  doi = {${WAKEFIELD_DOI}}\n}\n`;

interface Run { status: number | null; out: string }

/** The real CLI in `root` on the recorded registry answers. */
function cli(root: string, args: string[], env: Record<string, string> = {}): Run {
  const r = runCli(args, root, { PENSMITH_OFFLINE: '0', PENSMITH_TEST_CASSETTES: '1', ...env });
  return { status: r.status, out: r.stdout + r.stderr };
}

const SLUGS = ['intro', 'body'];
const secDir = (root: string, i: number): string =>
  join(root, '.paper', 'sections', `${String(i + 1).padStart(2, '0')}-${SLUGS[i]}`);

/** A paper whose sections each cite `key` once, verified and compiled by the real CLI. */
function compiledPaper(bib: string, key: string, sections = 1): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-export-bound-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const slugs = SLUGS.slice(0, sections);
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Bound Export', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      ...slugs.map((s, i) => `| ${i + 1} | ${s} | ${s} | | 300 | ${key} |`), ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), bib);
  slugs.forEach((slug, i) => {
    const sec = secDir(root, i);
    mkdirSync(sec, { recursive: true });
    writeFileSync(join(sec, 'PLAN.md'), `---\nsection: ${i + 1}\nslug: ${slug}\ntitle: ${slug}\nstatus: written\nassigned_sources: [${key}]\n---\n# ${slug}\n`);
    writeFileSync(join(sec, 'DRAFT.md'), `Section ${i + 1} rests on one work [@${key}].\n`);
  });
  slugs.forEach((slug, i) => {
    const v = cli(root, ['verify', String(i + 1), '--slug', slug]);
    assert.equal(v.status, 0, `verify ${i + 1}\n${v.out}`);
  });
  const c = cli(root, ['compile']);
  assert.equal(c.status, 0, `compile\n${c.out}`);
  return root;
}

const exported = (root: string): string => join(root, '.paper', 'export', 'DRAFT.md');

function done(root: string, env: Record<string, string> = {}): Run {
  return cli(root, ['done', '--yolo', '--raw', '--format', 'md'], env);
}

test('a verified, compiled paper exports', () => {
  const root = compiledPaper(ATTENTION, 'vaswani2017');
  const d = done(root);
  assert.equal(d.status, 0, d.out);
  assert.ok(existsSync(exported(root)), d.out);
});

test('a citation added to the compiled DRAFT.md after compile is refused with exit 2, --yolo included', () => {
  const root = compiledPaper(ATTENTION, 'vaswani2017');
  // A hand (or agent) edit after compile: a new work in the bibliography, cited in the manuscript.
  appendFileSync(join(root, '.paper', 'CITATIONS.bib'), `\n${GHOST}`);
  appendFileSync(join(root, '.paper', 'DRAFT.md'), '\nA striking result was reported [@ghost2024].\n');
  const d = done(root);
  assert.equal(d.status, 2, d.out);
  assert.match(d.out, /DRAFT\.md/);
  assert.ok(!existsSync(exported(root)), 'nothing is exported');
  assert.ok(!existsSync(join(root, '.paper', 'FINAL.md')), 'the paper is not marked done');
});

test('a cited bibliography entry pointed at another work after compile is refused with exit 2', () => {
  const root = compiledPaper(ATTENTION, 'vaswani2017');
  const bibPath = join(root, '.paper', 'CITATIONS.bib');
  // Same key, same title: only the DOI behind it changed, to one no registry holds.
  writeFileSync(bibPath, readFileSync(bibPath, 'utf8').replace(/10\.48550\/arXiv\.1706\.03762/i, '10.1038/s41586-024-99999-x'));
  assert.match(readFileSync(bibPath, 'utf8'), /s41586-024-99999-x/, 'precondition: the entry now names the other DOI');
  const d = done(root);
  assert.equal(d.status, 2, d.out);
  assert.match(d.out, /vaswani2017/);
  assert.ok(!existsSync(exported(root)), 'nothing is exported');
});

test('a section redone after compile, with no recompile, is refused with exit 2', () => {
  const root = compiledPaper(ATTENTION, 'vaswani2017', 2);
  appendFileSync(join(secDir(root, 1), 'DRAFT.md'), '\nA sentence added to section 2 after compile.\n');
  const d = done(root);
  assert.equal(d.status, 2, d.out);
  assert.match(d.out, /compile/);
  assert.ok(!existsSync(exported(root)), 'the stale compiled draft is not exported');
});

test('an acknowledgement withdrawn after compile: done re-checks the citation, finds it RETRACTED, and refuses', () => {
  const root = compiledPaperWithAck();
  rmSync(join(secDir(root, 0), 'ACKNOWLEDGEMENTS.json'));
  const d = done(root);
  assert.equal(d.status, 2, d.out);
  assert.match(d.out, /RETRACTED/);
  assert.match(d.out, /wakefield1998/);
  assert.ok(!existsSync(exported(root)), 'nothing is exported');
});

test('an acknowledged retraction still exports, with a warning', () => {
  const root = compiledPaperWithAck();
  const d = done(root);
  assert.equal(d.status, 0, d.out);
  assert.match(d.out, /WARN.*wakefield1998.*retracted/i);
});

test('offline, done cannot re-check the citations, so it refuses: UNRESOLVED is never an export', () => {
  const root = compiledPaper(ATTENTION, 'vaswani2017');
  const d = done(root, { PENSMITH_OFFLINE: '1' });
  assert.equal(d.status, 2, d.out);
  assert.match(d.out, /UNRESOLVED/);
  assert.match(d.out, /offline/i);
  assert.ok(!existsSync(exported(root)), 'nothing is exported');
});

/** Wakefield 1998 cited in section 1, acknowledged there, verified and compiled. */
function compiledPaperWithAck(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-export-bound-ack-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(
    join(root, '.paper', 'OUTLINE.md'),
    ['# Bound Export', '', '| # | slug | title | depends_on | word target | assigned_sources |', '| --- | --- | --- | --- | --- | --- |',
      '| 1 | intro | intro | | 300 | wakefield1998 |', ''].join('\n'),
  );
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), WAKEFIELD);
  const sec = secDir(root, 0);
  mkdirSync(sec, { recursive: true });
  writeFileSync(join(sec, 'PLAN.md'), '---\nsection: 1\nslug: intro\ntitle: intro\nstatus: written\nassigned_sources: [wakefield1998]\n---\n# intro\n');
  writeFileSync(join(sec, 'DRAFT.md'), 'The retracted study claimed a link [@wakefield1998].\n');
  assert.equal(cli(root, ['verify', '1', '--slug', 'intro']).status, 2, 'precondition: RETRACTED blocks');
  const a = cli(root, ['ack', '1', 'wakefield1998', '--slug', 'intro', '--reason', 'This section is about the retraction itself.']);
  assert.equal(a.status, 0, a.out);
  const v = cli(root, ['verify', '1', '--slug', 'intro']);
  assert.equal(v.status, 0, v.out);
  const c = cli(root, ['compile']);
  assert.equal(c.status, 0, c.out);
  return root;
}

test('the exporter writes the manuscript and bibliography done checked, not what is on disk by then', async () => {
  const { exportDraft } = await import('../bin/lib/exporter.js');
  const root = mkdtempSync(join(tmpdir(), 'pensmith-export-bound-bytes-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  // What done read and checked, then the files as an edit left them afterwards.
  const checked = '# Paper\n\nAttention suffices [@vaswani2017].\n';
  writeFileSync(join(root, '.paper', 'DRAFT.md'), `${checked}A sentence added later [@ghost2024].\n`);
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), GHOST);
  const r = await exportDraft({
    inputPath: join(root, '.paper', 'DRAFT.md'),
    markdown: checked,
    bibText: ATTENTION,
    format: 'md',
    paperRoot: root,
    pandocPresent: false,
  });
  const md = readFileSync(r.outputPath, 'utf8');
  assert.doesNotMatch(md, /added later|ghost2024|superconductivity/i, md);
  assert.match(md, /Attention Is All You Need/, md);
  assert.deepEqual(r.citedKeys, ['vaswani2017']);
});
