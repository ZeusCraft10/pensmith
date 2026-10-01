// tests/citation-goldens.test.ts — the built-in renderer against pandoc's
// citeproc, for all 8 bundled styles (D-21-05, EXP-04).
//
// tests/fixtures/citation-goldens/<style>.md were rendered ONCE by pandoc 3.9
// (scripts/make-citation-goldens.mjs, from fixture.md / fixture.bib — an
// article, a book and a chapter cited B, A, B, [A; C], with a `p.` locator, a
// bare-number locator and a narrative citation). This test renders the same
// fixture through the real export path with no pandoc (exportDraft, md) and
// compares the two after ONE normalisation, documented here and applied to
// both sides alike:
//   - Markdown markup that does not change the text: fenced div lines
//     (`:::`), attribute blocks (`{#id .class key="v"}`), bracketed spans
//     (`[text]{.class}` → `text`), links (`[text](url)` → `text`, `<url>` →
//     `url`) and backslash escapes;
//   - spellings of the same character: curly and straight quotes, `--` / `–`,
//     `---` / `—`, `...` / `…`;
//   - white space: runs of spaces as one, no trailing space, blank lines as one,
//     a soft line break inside a paragraph as a space (a hard one — a
//     backslash before it — stays).
// After it, the body (every in-text citation string, every number, every
// superscript and note marker in place), every note's text and number, and
// the bibliography's order, labels and entry text must be EQUAL. A genuine
// engine difference in a bibliography entry's text (never in-text) may be
// recorded only as a named exception in EXCEPTIONS.json — with the CSL rule
// and both outputs; an exception that no longer matches fails the test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportDraft } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';

const DIR = fileURLToPath(new URL('./fixtures/citation-goldens/', import.meta.url));
const STYLES = ['apa', 'mla', 'chicago-author-date', 'chicago-notes-bib', 'ieee', 'ama', 'vancouver', 'harvard'] as const;

interface GoldenException {
  readonly style: string;
  /** The bibliography entry's index (0-based) the exception is about. */
  readonly entry: number;
  /** The CSL rule the two engines apply differently. */
  readonly rule: string;
  /** The entry's text, normalised, as pandoc and the built-in renderer print it. */
  readonly pandoc: string;
  readonly builtin: string;
}

const EXCEPTIONS = JSON.parse(readFileSync(join(DIR, 'EXCEPTIONS.json'), 'utf8')) as { exceptions: GoldenException[] };

/** The documented normalisation (header). */
export function normalizeGolden(md: string): string {
  let s = md.replace(/\r\n?/g, '\n');
  s = s.replace(/^:{3,}.*$/gm, '');
  // A soft line break inside a paragraph is a space (a hard one, `\\` before it, stays).
  s = s.replace(/(?<![\\\n])\n(?!\n)/g, ' ');
  // Bracketed spans and links, innermost first; then the attribute blocks left (headings).
  for (let i = 0; i < 6; i++) {
    s = s.replace(/(?<!\\)\[((?:\\.|[^[\]\\])*)\]\{[^{}]*\}/g, '$1').replace(/(?<![\\^])\[((?:\\.|[^[\]\\])*)\]\([^()\s]*\)/g, '$1');
  }
  s = s.replace(/[ \t]*\{[#.][^{}\n]*\}/g, '');
  s = s.replace(/<([a-z][a-z0-9+.-]*:[^<>\s]*)>/gi, '$1');
  s = s.replace(/\\([^\w\s])/g, '$1');
  s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/—/g, '---').replace(/–/g, '--').replace(/…/g, '...');
  s = s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ +$/gm, '').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/**
 * The link targets of a Markdown text, in order (`[text](url)` and `<url>`):
 * compared per bibliography entry beside the normalised text, so a title the
 * style links (pandoc's link-bibliography: Vancouver's DOI) or a printed DOI's
 * target cannot differ unseen (review round 2).
 */
function linkTargets(md: string): string[] {
  return [...md.matchAll(/(?<!\\)\]\(([^()\s]*)\)|<([a-z][a-z0-9+.-]*:[^<>\s]*)>/gi)].map((m) => (m[1] ?? m[2]) as string);
}

/** The bibliography entries of an export, unnormalised (one per entry, in order). */
function rawEntries(md: string): string[] {
  const s = md.replace(/\r\n?/g, '\n');
  const refs = /\n## (References|Bibliography)[^\n]*\n/.exec(s);
  if (refs === null) return [];
  const rest = s.slice(refs.index + refs[0].length);
  const end = rest.search(/^\[\^[^\]]+\]: /m);
  return (end === -1 ? rest : rest.slice(0, end)).split(/\n(?:\s*\n)+/).filter((x) => /[\p{L}\p{N}]/u.test(x.replace(/^:{3,}.*$/gm, '')));
}

/** A normalised export split into its body, its bibliography entries and its notes. */
function parts(md: string): { body: string; entries: string[]; notes: string[] } {
  const n = normalizeGolden(md);
  const noteRe = /^\[\^([^\]]+)\]: /m;
  const firstNote = n.search(noteRe);
  const main = firstNote === -1 ? n : n.slice(0, firstNote).trim();
  const notes = firstNote === -1 ? [] : n.slice(firstNote).split(/\n\n(?=\[\^)/).map((x) => x.trim());
  const refs = /\n## (References|Bibliography)\n/.exec(main);
  const body = refs === null ? main : main.slice(0, refs.index).trim() + `\n## ${refs[1]}`;
  const entries = refs === null ? [] : main.slice(refs.index + refs[0].length).split(/\n\n/).map((x) => x.trim()).filter((x) => x !== '');
  return { body, entries, notes };
}

async function builtIn(style: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), `pensmith-goldens-${style}-`));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), readFileSync(join(DIR, 'fixture.bib')));
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, readFileSync(join(DIR, 'fixture.md')));
  const { result } = await withCapturedOutput(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style }));
  return readFileSync(result.outputPath, 'utf8');
}

test('D-21-05: the goldens were rendered by pandoc 3.9', () => {
  assert.match(readFileSync(join(DIR, 'PANDOC-VERSION'), 'utf8'), /^pandoc 3\.9\b/);
});

for (const style of STYLES) {
  test(`D-21-05 / EXP-04: the built-in ${style} export equals pandoc's golden (in-text, numbers, notes, bibliography order and labels)`, async () => {
    const golden = parts(readFileSync(join(DIR, `${style}.md`), 'utf8'));
    const ours = parts(await builtIn(style));
    assert.equal(ours.body, golden.body, `${style}: the body (in-text citations, numbers, note markers, the heading) differs`);
    assert.deepEqual(ours.notes, golden.notes, `${style}: the notes differ`);
    assert.equal(ours.entries.length, golden.entries.length, `${style}: the bibliography has another number of entries`);
    const ourLinks = rawEntries(await builtIn(style)).map(linkTargets);
    const goldenLinks = rawEntries(readFileSync(join(DIR, `${style}.md`), 'utf8')).map(linkTargets);
    assert.deepEqual(ourLinks, goldenLinks, `${style}: the bibliography's link targets differ (a linked title, a printed DOI or URL)`);
    ours.entries.forEach((entry, i) => {
      const g = golden.entries[i] as string;
      if (entry === g) return;
      const ex = EXCEPTIONS.exceptions.find((e) => e.style === style && e.entry === i);
      assert.ok(ex !== undefined, `${style}: bibliography entry ${i + 1} differs and no exception names it\n  pandoc:   ${g}\n  built-in: ${entry}`);
      assert.equal(ex.pandoc, g, `${style}: exception for entry ${i + 1} no longer matches pandoc's text`);
      assert.equal(ex.builtin, entry, `${style}: exception for entry ${i + 1} no longer matches the built-in text`);
      // A label is never excepted: the text before the first space (`[1]`, `1.`) must still agree.
      const label = (x: string): string => (/^(\[\d+\]|\d+\.)\s/.exec(x)?.[1] ?? '');
      assert.equal(label(entry), label(g), `${style}: entry ${i + 1}'s label differs`);
    });
    for (const ex of EXCEPTIONS.exceptions.filter((e) => e.style === style)) {
      assert.ok(ours.entries[ex.entry] !== golden.entries[ex.entry], `${style}: the exception for entry ${ex.entry + 1} is no longer needed — remove it`);
      assert.ok(ex.rule.trim().length > 10, 'an exception names the CSL rule');
    }
  });
}

test('D-21-05: the fixture covers B, A, B, [A; C], a p. locator, a bare-number locator and a narrative citation over an article, a book and a chapter — and (review rounds 1 and 2) the note punctuation, locator, prefix, suffix and line-break forms', () => {
  const md = readFileSync(join(DIR, 'fixture.md'), 'utf8');
  const order = [...md.matchAll(/@([a-z]+\d{4})/g)].map((m) => m[1]);
  assert.deepEqual(order, [
    'kuhn1962', 'lindqvist2012', 'kuhn1962', 'lindqvist2012', 'okafor2019', 'okafor2019', 'okafor2019', 'lindqvist2012',
    'kuhn1962', 'lindqvist2012', 'kuhn1962', 'kuhn1962', 'lindqvist2012', 'okafor2019', 'okafor2019', 'kuhn1962', 'kuhn1962',
    'okafor2019', 'lindqvist2012', 'okafor2019', 'kuhn1962', 'lindqvist2012', 'okafor2019',
  ]);
  // Review round 2: a note opening with a prefix is capitalised, a suffix's comma
  // goes inside a closing quote (en-US), a soft line break before a note goes, a
  // hard line break stays after the marker, a run stops at what is not punctuation.
  for (const form of ['[see also @okafor2019].', '[e.g., @lindqvist2012].', '[@okafor2019, emphasis added].', 'A wrapped claim\n[@kuhn1962].', '[@lindqvist2012]\\\n', '[@okafor2019]&more.']) {
    assert.ok(md.includes(form), JSON.stringify(form));
  }
  assert.ok(md.includes('[@lindqvist2012; @okafor2019]') && md.includes(', p. 40]') && md.includes('[@okafor2019 41]') && /^@lindqvist2012 /m.test(md));
  // A note marker moves past an ellipsis and `?!`, a period goes inside a closing
  // quote (en-US) and is dropped after `?`, a `).` run moves; a `--` page range,
  // `33ff.`, and `chap.` / `sec.` (terms in en-US, suffix text in en-GB Harvard).
  for (const form of ['[@kuhn1962]...', '[@lindqvist2012]?!', '"the essential tension" [@kuhn1962].', '"is it a paradigm?" [@kuhn1962].', '[@lindqvist2012]).', '[@okafor2019, 33--38]', '[@okafor2019, 33ff.].', '[@kuhn1962, chap. 2]', '[@kuhn1962, sec. 3]']) {
    assert.ok(md.includes(form), form);
  }
  const bib = readFileSync(join(DIR, 'fixture.bib'), 'utf8');
  assert.ok(/@article\{/.test(bib) && /@book\{/.test(bib) && /@incollection\{/.test(bib));
});
