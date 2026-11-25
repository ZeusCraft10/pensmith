// tests/export-bibliography.test.ts — the exported CITATIONS.bib and .ris list
// exactly the works the exported paper cites.
//
// research writes .paper/CITATIONS.ris with every candidate it found: uncited,
// pruned, retracted and never checked by the verifier. The exporter used to
// copy that file into the deliverable, so the user's reference manager got
// works the paper never cites, fabricated records included, while works added
// later with `add` were missing. The exported .bib also carried pensmith's own
// fields (the verification timestamp, the RETRACTED note) and free-text notes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compiledPaper, needsTool, runCli } from './lib/export-fixture.js';

// Two cited works, one uncited candidate, one fabricated candidate.
const BIB = [
  '@article{zeta2020,',
  '  author = {Zeta, Zed},',
  '  title = {Tidal Sediment Transport},',
  '  journal = {Estuarine Science},',
  '  year = {2020},',
  '  doi = {10.1000/zeta.2020},',
  '  note = {RETRACTED},',
  '  last_verified = {2026-11-25T00:00:00Z},',
  '  abstract = {Long abstract text.}',
  '}',
  '@book{alpha2019,',
  '  author = {Alpha, Al},',
  '  title = {Barrage Effects on Estuaries},',
  '  publisher = {Coastal Press},',
  '  year = {2019},',
  '  isbn = {978-0-306-40615-7},',
  '  note = {Found via the search step}',
  '}',
  '@article{uncited2018,',
  '  author = {Never, Cited},',
  '  title = {An Uncited Candidate},',
  '  journal = {J},',
  '  year = {2018},',
  '  doi = {10.1000/uncited}',
  '}',
  '',
].join('\n');

const RESEARCH_RIS = [
  'TY  - JOUR', 'ID  - fabricated2024', 'TI  - A Paper That Does Not Exist', 'DO  - 10.9999/fake', 'ER  - ',
  'TY  - JOUR', 'ID  - uncited2018', 'TI  - An Uncited Candidate', 'ER  - ',
  '',
].join('\n');

function keysInBib(bib: string): string[] {
  return [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]!).sort();
}

function keysInRis(ris: string): string[] {
  return [...ris.matchAll(/^ID {2}- (.+)$/gm)].map((m) => m[1]!.trim()).sort();
}

test('done: the exported .bib and .ris hold exactly the cited works, with no pensmith fields', () => {
  const root = compiledPaper({
    bib: BIB,
    ris: RESEARCH_RIS,
    sections: [
      { slug: 'intro', title: 'Introduction', draft: 'Barrages trap sediment [@zeta2020, p. 5].\n', sources: ['zeta2020'] },
      { slug: 'effects', title: 'Effects', draft: 'Beds change [see @alpha2019; @zeta2020].\n', sources: ['alpha2019', 'zeta2020'] },
    ],
  });
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);

  const bib = readFileSync(join(root, '.paper', 'export', 'CITATIONS.bib'), 'utf8');
  const ris = readFileSync(join(root, '.paper', 'export', 'CITATIONS.ris'), 'utf8');
  assert.deepEqual(keysInBib(bib), ['alpha2019', 'zeta2020'], bib);
  assert.deepEqual(keysInRis(ris), keysInBib(bib), `the RIS and BibTeX key sets must match:\n${ris}`);
  for (const [name, text] of [['CITATIONS.bib', bib], ['CITATIONS.ris', ris]] as const) {
    assert.doesNotMatch(text, /fabricated2024|uncited2018|10\.9999\/fake/, `${name} must not carry uncited candidates`);
    assert.doesNotMatch(text, /RETRACTED|last_verified|Found via the search step|Long abstract/i, `${name} must not carry pensmith or free-text fields`);
  }
  // The identifiers a reader needs survive.
  assert.match(bib, /10\.1000\/zeta\.2020/);
  assert.match(bib, /978-0-306-40615-7/);
  assert.match(ris, /^DO {2}- 10\.1000\/zeta\.2020$/m);
});

test('done: a source added after research (only in CITATIONS.bib) is in the exported .ris too', () => {
  // `add` rewrites CITATIONS.bib but not the research-time .ris.
  const root = compiledPaper({
    bib: BIB,
    ris: RESEARCH_RIS,
    sections: [{ slug: 'intro', title: 'Introduction', draft: 'A book on barrages [@alpha2019].\n', sources: ['alpha2019'] }],
  });
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const ris = readFileSync(join(root, '.paper', 'export', 'CITATIONS.ris'), 'utf8');
  assert.deepEqual(keysInRis(ris), ['alpha2019']);
});

test('done: a citation with no bibliography entry refuses the export (exit 2)', () => {
  const root = compiledPaper({
    bib: BIB,
    sections: [{ slug: 'intro', title: 'Introduction', draft: 'A claim [@ghost2022].\n', sources: [] }],
  });
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 2, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stdout + r.stderr, /ghost2022/);
});

// Works with no publisher (a dataset, a web page, an article whose record has
// none) whose URLs hold the characters LaTeX treats as commands: `_` `%` `&`
// `#` `~`. Percent-encoding, query strings and fragments are common in URLs.
const MISC_URL = 'https://ex.org/a_b%20c?x=1&y=2#f';
const ARTICLE_URL = 'https://ex.org/~p/q_r%20s?x=1&y=2#g';
const URL_BIB = [
  `@misc{gauge2021, author = {Doe, Jane}, title = {Tide gauge dataset}, year = {2021}, url = {${MISC_URL}}}`,
  `@article{tides2020, author = {Roe, Rick}, title = {Tides}, journal = {Coastal Letters}, year = {2020}, url = {${ARTICLE_URL}}}`,
  '',
].join('\n');

function urlPaper(style = 'apa'): string {
  return compiledPaper({
    title: 'Tides',
    bib: URL_BIB,
    configToml: `[project]\ncitation_style = "${style}"\n`,
    sections: [
      { slug: 'intro', title: 'Introduction', draft: 'Gauges record tides [@gauge2021; @tides2020].\n', sources: ['gauge2021', 'tides2020'] },
    ],
  });
}

function exportedUrlBib(): string {
  const root = urlPaper();
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  return readFileSync(join(root, '.paper', 'export', 'CITATIONS.bib'), 'utf8');
}

test('done: the exported .bib writes no LaTeX special character unescaped outside url and doi', () => {
  const bib = exportedUrlBib();
  const fields = [...bib.matchAll(/^\s*([a-z]+) = \{(.*)\},?$/gm)].map((m) => ({ name: m[1]!, value: m[2]! }));
  assert.ok(fields.length > 0, bib);
  for (const { name, value } of fields) {
    if (name === 'url' || name === 'doi') continue;
    assert.doesNotMatch(value, /(?<!\\)[_%&#~^$]/, `${name} = {${value}} would break BibTeX/LaTeX and Pandoc:\n${bib}`);
  }
  // The URL itself is kept exactly, once per work.
  for (const url of [MISC_URL, ARTICLE_URL]) {
    assert.equal(bib.split(url).length - 1, 1, `${url} must appear once:\n${bib}`);
    assert.ok(bib.includes(`url = {${url}}`), `url = {${url}} is missing:\n${bib}`);
  }
});

test('done: the exported .bib typesets with BibTeX', needsTool('pdflatex'), () => {
  const bib = exportedUrlBib();
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-bibtex-'));
  writeFileSync(join(dir, 'CITATIONS.bib'), bib);
  writeFileSync(
    join(dir, 'main.tex'),
    '\\documentclass{article}\n\\usepackage[T1]{fontenc}\n\\begin{document}\n\\nocite{*}\n\\bibliographystyle{plain}\n\\bibliography{CITATIONS}\n\\end{document}\n',
  );
  const run = (cmd: string, args: string[]): void => {
    const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 120_000 });
    assert.equal(r.status, 0, `${cmd} ${args.join(' ')} failed:\n${r.stdout}\n${r.stderr}\n${bib}`);
  };
  run('pdflatex', ['-halt-on-error', '-interaction=nonstopmode', 'main.tex']);
  run('bibtex', ['main']);
  run('pdflatex', ['-halt-on-error', '-interaction=nonstopmode', 'main.tex']);
  const bbl = readFileSync(join(dir, 'main.bbl'), 'utf8');
  assert.match(bbl, /Tide gauge dataset/);
  assert.match(bbl, /Coastal Letters/);
});

for (const style of ['apa', 'mla']) {
  for (const format of ['docx', 'latex'] as const) {
    test(`done --format ${format} (${style}) with real Pandoc lists each work's URL once and in full`, needsTool('pandoc'), () => {
      const root = urlPaper(style);
      const r = runCli(['done', '--yolo', '--raw', '--format', format], root);
      assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
      const file = join(root, '.paper', 'export', format === 'docx' ? 'DRAFT.docx' : 'DRAFT.tex');
      const copy = join(mkdtempSync(join(tmpdir(), 'pensmith-read-')), format === 'docx' ? 'in.docx' : 'in.tex');
      copyFileSync(file, copy);
      const plain = spawnSync('pandoc', [copy, '-f', format, '-t', 'plain', '--wrap=none'], { encoding: 'utf8' });
      assert.equal(plain.status, 0, plain.stderr);
      const text = plain.stdout;
      for (const url of [MISC_URL, ARTICLE_URL]) {
        assert.equal(text.split(url).length - 1, 1, `${url} must be listed once and in full:\n${text}`);
      }
      // No cut-off copy of either URL (Pandoc reads an unescaped % as a comment).
      assert.doesNotMatch(text, /https:\/\/ex\.org\/a_b(?!%20c\?x=1&y=2#f)/, text);
      assert.doesNotMatch(text, /https:\/\/ex\.org\/~p\/q_r(?!%20s\?x=1&y=2#g)/, text);
    });
  }
}
