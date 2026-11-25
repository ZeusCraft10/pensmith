// tests/citation-style-choice.test.ts — the citation style the user chose is the
// one the export uses.
//
// The intake clarifier asks which of eight styles to use, but done picked the
// style from a hard-coded discipline map with four values, so AMA, Vancouver,
// Harvard and Chicago notes could never be chosen, and disciplines.json (the
// presets PRD §8 defines) was never read. The style now comes from, in order:
// config.toml `[project] citation_style` (written by `pensmith new
// --citation-style`, or edited by hand), a "Citation style:" answer in
// INTAKE.md, then the discipline's preset in disciplines.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { normalizeStyleName, resolveStyleName, SUPPORTED_STYLES } from '../bin/lib/citations.js';
import { compiledPaper, runCli } from './lib/export-fixture.js';

const BIB = [
  '@article{zeta2020, author = {Zeta, Zed}, title = {Tidal Sediment Transport}, journal = {J}, year = {2020}, doi = {10.1000/zeta}}',
  '@article{alpha2019, author = {Alpha, Al}, title = {Barrage Effects}, journal = {K}, year = {2019}, doi = {10.1000/alpha}}',
  '',
].join('\n');

function paper(extra: { intake?: string; configToml?: string }): string {
  return compiledPaper({
    bib: BIB,
    ...extra,
    sections: [{ slug: 'intro', title: 'Introduction', draft: 'Barrages trap sediment [@zeta2020]. Beds change [@alpha2019].\n', sources: ['zeta2020', 'alpha2019'] }],
  });
}

function exported(root: string): string {
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  return readFileSync(join(root, '.paper', 'export', 'DRAFT.md'), 'utf8');
}

test('config.toml citation_style is honoured over the discipline default', () => {
  // Psychology defaults to APA; the user chose Vancouver.
  const md = exported(paper({ intake: 'Discipline: psychology\n', configToml: '[project]\ncitation_style = "vancouver"\n' }));
  assert.match(md, /trap sediment \(1\)\. Beds change \(2\)\./, md);
  assert.doesNotMatch(md, /\(Zeta, 2020\)/);
});

test('a "Citation style:" answer in INTAKE.md is honoured', () => {
  const md = exported(paper({ intake: 'Discipline: computer science\nCitation style: Chicago (Author-Date)\n' }));
  assert.match(md, /\(Zeta 2020\)/, md);
});

test('with no choice, the discipline preset from disciplines.json is used (CS → IEEE)', () => {
  const md = exported(paper({ intake: 'Discipline: computer science\n' }));
  assert.match(md, /trap sediment \[1\]\. Beds change \[2\]\./, md);
});

test('an unsupported style is named in a warning and the discipline default is used', () => {
  const root = paper({ intake: 'Discipline: history\n', configToml: '[project]\ncitation_style = "turabian"\n' });
  const r = runCli(['done', '--yolo', '--raw', '--format', 'md'], root);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stderr, /citation style 'turabian' is not supported/);
  // History defaults to Chicago notes-bibliography (PRD §8): footnotes.
  assert.match(readFileSync(join(root, '.paper', 'export', 'DRAFT.md'), 'utf8'), /\[\^1\]/);
});

test('disciplines.json matches PRD §8 and is the only source of discipline defaults', () => {
  const presets = JSON.parse(readFileSync(new URL('../templates/presets/disciplines.json', import.meta.url), 'utf8')) as Record<string, { defaultCitationStyle: string }>;
  // PRD §8: Biology "AMA or Vancouver", History "Chicago Notes-Bibliography".
  assert.ok(['ama', 'vancouver'].includes(presets['biology']!.defaultCitationStyle), presets['biology']!.defaultCitationStyle);
  assert.equal(presets['history']!.defaultCitationStyle, 'chicago-notes-bib');
  assert.equal(presets['computer-science']!.defaultCitationStyle, 'ieee');
  for (const [discipline, preset] of Object.entries(presets)) {
    assert.ok(SUPPORTED_STYLES.includes(preset.defaultCitationStyle), `${discipline}: ${preset.defaultCitationStyle} has no CSL file`);
    assert.equal(resolveStyleName(discipline), preset.defaultCitationStyle, discipline);
  }
  assert.equal(resolveStyleName('unknown-field'), presets['other']!.defaultCitationStyle);
});

test('the clarifier\'s eight style names all map to a shipped style', () => {
  for (const name of ['APA', 'MLA', 'Chicago NB', 'Chicago AD', 'Chicago (Notes-Bibliography)', 'Chicago (Author-Date)', 'IEEE', 'AMA', 'Vancouver', 'Harvard']) {
    assert.ok(normalizeStyleName(name), `${name} must map to a style`);
  }
  assert.equal(normalizeStyleName('turabian'), null);
});

test('pensmith new --citation-style persists the choice to config.toml; an unknown style is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pensmith-style-new-'));
  const r = runCli(['new', '--citation-style', 'AMA'], dir);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const cfg = parseToml(readFileSync(join(dir, 'config.toml'), 'utf8')) as { project?: { citation_style?: string } };
  assert.equal(cfg.project?.citation_style, 'ama');

  const bad = mkdtempSync(join(tmpdir(), 'pensmith-style-bad-'));
  const b = runCli(['new', '--citation-style', 'turabian'], bad);
  assert.equal(b.status, 2, `stdout=${b.stdout}\nstderr=${b.stderr}`);
  assert.match(b.stderr, /turabian/);
});
