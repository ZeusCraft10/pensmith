// scripts/make-citation-goldens.mjs — the citation goldens (D-21-05, EXP-04).
//
// Renders the committed fixture (tests/fixtures/citation-goldens/fixture.md
// over fixture.bib: an article, a book and a chapter, cited B, A, B, [A; C],
// with a `p.` locator, a bare-number locator and a narrative citation)
// through pandoc's citeproc for each of the 8 bundled styles, into
// tests/fixtures/citation-goldens/<style>.md. tests/citation-goldens.test.ts
// renders the same fixture with the built-in renderer (exportDraft, md, no
// pandoc) and compares the two under one documented normalisation.
//
// Pandoc gets exactly what the export's pandoc path gives it (export/pandoc.ts,
// D-21-06, D-21-09): the fixture bibliography parsed by citations.ts and
// case-protected (caseProtectItems) as CSL JSON, the bundled style, and an
// unnumbered `## References` (`## Bibliography` for a note style) heading over
// a `#refs` div. Its Markdown writer runs with `-citations` (so citations are
// written as their rendered text, not re-encoded as `[@key]`) and `--wrap=none`.
//
// Run once, with pandoc 3.9 on PATH, after a change to the fixture or a style:
//   node scripts/make-citation-goldens.mjs
// (it re-runs itself under tsx to import bin/lib), then commit the goldens.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DIR = join(ROOT, 'tests', 'fixtures', 'citation-goldens');
export const GOLDEN_STYLES = ['apa', 'mla', 'chicago-author-date', 'chicago-notes-bib', 'ieee', 'ama', 'vancouver', 'harvard'];

if (!process.argv.includes('--child')) {
  const r = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fileURLToPath(import.meta.url), '--child'], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const version = execFileSync('pandoc', ['--version'], { encoding: 'utf8' }).split('\n')[0];
if (!/^pandoc 3\.9\b/.test(version)) {
  process.stderr.write(`make-citation-goldens: pandoc 3.9 is required (found "${version}")\n`);
  process.exit(1);
}
const { parseBibEntries, caseProtectItems, cslStyleText, isNoteStyle } = await import(join(ROOT, 'bin', 'lib', 'citations.ts'));
const { entries, problems } = parseBibEntries(readFileSync(join(DIR, 'fixture.bib'), 'utf8'));
if (problems.length > 0) throw new Error(`fixture.bib: ${JSON.stringify(problems)}`);
const fixture = readFileSync(join(DIR, 'fixture.md'), 'utf8').replace(/\s+$/u, '');

for (const style of GOLDEN_STYLES) {
  const tmp = mkdtempSync(join(os.tmpdir(), 'pensmith-goldens-'));
  try {
    const title = isNoteStyle(style) ? 'Bibliography' : 'References';
    writeFileSync(join(tmp, 'input.md'), `${fixture}\n\n## ${title} {.unnumbered}\n\n::: {#refs}\n:::\n`);
    writeFileSync(join(tmp, 'references.json'), JSON.stringify(caseProtectItems(entries), null, 1));
    writeFileSync(join(tmp, 'style.csl'), cslStyleText(style));
    execFileSync(
      'pandoc',
      ['input.md', '--from', 'markdown-yaml_metadata_block-raw_attribute-raw_tex', '--to', 'markdown-citations', '--wrap=none',
        '--citeproc', '--csl', 'style.csl', '--bibliography', 'references.json', '--output', 'out.md'],
      { cwd: tmp },
    );
    writeFileSync(join(DIR, `${style}.md`), readFileSync(join(tmp, 'out.md'), 'utf8'));
    process.stdout.write(`make-citation-goldens: ${style}.md\n`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
writeFileSync(join(DIR, 'PANDOC-VERSION'), `${version}\n`);
