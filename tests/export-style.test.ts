// tests/export-style.test.ts — the export's citation style, resolved once with
// its source (Phase 21 EXP-03; D-21-24, D-21-07): `--style` > config.toml
// `[project] citation_style` > the intake brief's style > the discipline
// preset's default. A name is one of the 8 bundled styles (any alias); a path
// names a local `.csl` file, accepted only when it is a well-formed,
// independent CSL 1.0 style. An unknown name and a bad file are EXIT_USAGE
// with the reason. (Rendering a local style in the export is the export
// stream's half — exportDraft's `style` takes the absolute path.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveExportStyle, validateCslFile, exportStyleChoices } from '../bin/lib/export-style.js';
import { CSL_STYLE_KEYS } from '../bin/lib/disciplines.js';
import { CITATION_STYLE_NAMES } from '../bin/lib/schemas/config.js';
import { EXIT_USAGE, PensmithError } from '../bin/lib/exit-codes.js';
import { intakeMd } from './helpers/pipeline-paper.js';

const STYLES_DIR = fileURLToPath(new URL('../plugin/templates/citation-styles/', import.meta.url));

function paper(o: { intake?: { discipline: string; citationStyle?: string }; config?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-style-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  if (o.intake !== undefined) writeFileSync(join(root, '.paper', 'INTAKE.md'), intakeMd(o.intake));
  if (o.config !== undefined) writeFileSync(join(root, '.paper', 'config.toml'), `schema_version = 4\n${o.config}`);
  return root;
}

function usageError(fn: () => unknown, re: RegExp): void {
  assert.throws(fn, (e: unknown) => e instanceof PensmithError && e.exitCode === EXIT_USAGE && re.test(e.message));
}

test('EXP-03: a computer-science intake that asks for APA exports APA (from INTAKE.md) — not the preset\'s IEEE', () => {
  const root = paper({ intake: { discipline: 'computer science', citationStyle: 'apa' } });
  const s = resolveExportStyle(root);
  assert.deepEqual([s.style, s.source, s.from], ['apa', 'intake', 'INTAKE.md']);
});

test('EXP-03: config.toml citation_style = "MLA" overrides the intake; --style overrides both', () => {
  const root = paper({ intake: { discipline: 'computer science', citationStyle: 'apa' }, config: '[project]\ncitation_style = "MLA"\n' });
  const s = resolveExportStyle(root);
  assert.deepEqual([s.style, s.source, s.from], ['mla', 'config', 'config.toml [project] citation_style']);
  const f = resolveExportStyle(root, 'Chicago (Author-Date)');
  assert.deepEqual([f.style, f.source, f.from], ['chicago-author-date', 'flag', '--style']);
});

test('EXP-03: a paper with no INTAKE.md uses config.toml, else its discipline preset, else the default preset — with the source named', () => {
  assert.equal(resolveExportStyle(paper({ config: '[project]\ncitation_style = "IEEE"\n' })).from, 'config.toml [project] citation_style');
  const cs = resolveExportStyle(paper({ config: '[project]\ndiscipline_preset = "computer-science"\n' }));
  assert.deepEqual([cs.style, cs.source, cs.from], ['ieee', 'preset', 'the computer-science discipline preset']);
  const none = resolveExportStyle(paper());
  assert.equal(none.source, 'preset');
  assert.equal(none.from, 'the default preset (no discipline set)');
  assert.ok((CSL_STYLE_KEYS as readonly string[]).includes(none.style), 'never raw tokens: a bundled style');
});

test('EXP-03: each of the 8 styles via --style, by name or key', () => {
  const root = paper();
  for (const name of CITATION_STYLE_NAMES) assert.ok((CSL_STYLE_KEYS as readonly string[]).includes(resolveExportStyle(root, name).style), name);
  for (const key of CSL_STYLE_KEYS) assert.equal(resolveExportStyle(root, key).style, key);
  assert.equal(resolveExportStyle(root, 'APA 7').style, 'apa');
});

test('EXP-03: --style bogus is EXIT_USAGE listing the 8 styles and the path form', () => {
  const root = paper();
  usageError(() => resolveExportStyle(root, 'bogus'), /--style: unknown citation style "bogus" — use one of APA, MLA, .*Harvard .* or a path to a local \.csl file/);
  assert.match(exportStyleChoices(), /Vancouver/);
  // A configured .csl file is not read here (review round 3): it is returned
  // pending, and read only after the user approves it (csl-style-approval.test.ts).
  const pending = resolveExportStyle(paper({ config: '[project]\ncitation_style = "styles/missing.csl"\n' }));
  assert.equal(pending.pending, true);
  assert.equal(pending.source, 'config');
  assert.match(pending.style, /missing\.csl$/);
});

test('D-21-07: a local .csl file (relative to the folder --style is typed in, or absolute) is accepted when it is an independent CSL 1.0 style', () => {
  const root = paper();
  mkdirSync(join(root, 'styles'));
  copyFileSync(join(STYLES_DIR, 'apa.csl'), join(root, 'styles', 'my-journal.csl'));
  // Typed in the project root (review round 1: a typed path is the typing folder's).
  const rel = resolveExportStyle(root, 'styles/my-journal.csl', root);
  assert.equal(rel.style, join(root, 'styles', 'my-journal.csl'), 'resolved to an absolute path');
  assert.equal(rel.cslClass, 'in-text');
  assert.match(rel.name, /^my-journal\.csl/);
  const abs = resolveExportStyle(root, join(root, 'styles', 'my-journal.csl'));
  assert.equal(abs.style, rel.style);
  const cfg = resolveExportStyle(paper({ config: `[project]\ncitation_style = ${JSON.stringify(join(root, 'styles', 'my-journal.csl'))}\n` }));
  assert.equal(cfg.source, 'config');
  // Every bundled style passes the validator.
  for (const key of CSL_STYLE_KEYS) assert.equal(validateCslFile(join(STYLES_DIR, `${key}.csl`)).ok, true, key);
  assert.equal((validateCslFile(join(STYLES_DIR, 'chicago-notes-bib.csl')) as { cslClass?: string }).cslClass, 'note');
});

test('D-21-07: a malformed, foreign or dependent .csl file is EXIT_USAGE with the validator\'s reason', () => {
  const root = paper();
  const apa = readFileSync(join(STYLES_DIR, 'apa.csl'), 'utf8');
  const cases: Array<[string, string, RegExp]> = [
    ['broken.csl', apa.replace('</style>', ''), /not well-formed XML: <style> is never closed/],
    ['foreign.csl', apa.replace('http://purl.org/net/xbiblio/csl', 'http://example.org/not-csl'), /not a CSL 1\.0 style: <style> must declare xmlns/],
    ['nobib.csl', apa.replace(/<bibliography[\s\S]*<\/bibliography>/, ''), /has no <bibliography> element/],
    [
      'dependent.csl',
      '<?xml version="1.0" encoding="utf-8"?>\n<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">\n<info><title>Dependent</title><link href="http://www.zotero.org/styles/apa" rel="independent-parent"/></info>\n<citation><layout/></citation><bibliography><layout/></bibliography>\n</style>\n',
      /is a dependent style \(it names an independent parent, http:\/\/www\.zotero\.org\/styles\/apa\)/,
    ],
    ['notes.txt.csl', 'just some text', /not well-formed XML|not a CSL style/],
  ];
  for (const [name, body, re] of cases) {
    writeFileSync(join(root, name), body);
    usageError(() => resolveExportStyle(root, name, root), re);
  }
});

// Review round 1.
test('D-21-07 (review r1): --style ./x.csl is the typing folder\'s file; config.toml\'s relative path stays the project root\'s', () => {
  const root = paper();
  const elsewhere = mkdtempSync(join(tmpdir(), 'pensmith-style-cwd-'));
  copyFileSync(join(STYLES_DIR, 'apa.csl'), join(elsewhere, 'other.csl'));
  const r = resolveExportStyle(root, './other.csl', elsewhere);
  assert.equal(r.style, join(elsewhere, 'other.csl'));
  assert.equal(r.source, 'flag');
  usageError(() => resolveExportStyle(root, './other.csl', root), /--style: .*other\.csl cannot be read/);
  mkdirSync(join(root, 'styles'));
  copyFileSync(join(STYLES_DIR, 'mla.csl'), join(root, 'styles', 'cfg.csl'));
  const cfgRoot = paper({ config: '[project]\ncitation_style = "styles/cfg.csl"\n' });
  mkdirSync(join(cfgRoot, 'styles'));
  copyFileSync(join(STYLES_DIR, 'mla.csl'), join(cfgRoot, 'styles', 'cfg.csl'));
  assert.equal(resolveExportStyle(cfgRoot, undefined, elsewhere).style, join(cfgRoot, 'styles', 'cfg.csl'));
});

test('EXP-03 (review r1): an INTAKE.md this build cannot read is a one-line error — never the preset\'s style silently', () => {
  const root = paper();
  writeFileSync(join(root, '.paper', 'INTAKE.md'), '---\nschema_version: 1\ncitation_style: 42\n---\n\nAn assignment.\n');
  assert.throws(() => resolveExportStyle(root), (e: unknown) => e instanceof PensmithError && e.exitCode === 1 && /INTAKE\.md.*the export style cannot be read from it: fix INTAKE\.md, or choose the style with --style or config\.toml \[project\] citation_style/.test(e.message));
  // A flag or config.toml decides before the brief is read.
  assert.equal(resolveExportStyle(root, 'mla').style, 'mla');
});

test('EXP-04 (review r1): a .csl whose <style> attributes are single-quoted (or spaced) is read as the note style it is', async () => {
  const { isNoteStyle, styleLocale } = await import('../bin/lib/citations.js');
  const root = paper();
  const text = readFileSync(join(STYLES_DIR, 'chicago-notes-bib.csl'), 'utf8').replace(/<style\b[^>]*>/, (tag) => tag.replace(/="([^"]*)"/g, " = '$1'").replace(' version', ' default-locale = \'en-GB\' version'));
  assert.match(text, /class = 'note'/);
  writeFileSync(join(root, 'sq.csl'), text);
  const r = resolveExportStyle(root, join(root, 'sq.csl'));
  assert.equal(r.cslClass, 'note');
  assert.equal(isNoteStyle(r.style), true, 'the renderer sees a note style too');
  assert.equal(styleLocale(r.style).locale, 'en-GB', 'and its single-quoted default-locale');
});
