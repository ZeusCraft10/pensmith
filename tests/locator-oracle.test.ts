// tests/locator-oracle.test.ts — the locator rule against pandoc (carry-over 3,
// D-21-04).
//
// pandoc's citeproc reads a citation's suffix as a locator by its own rules: a
// locator term and a value (`p. 5`, `chap. iv`), or — no term — a value that
// holds a digit (`[@k 33]` is page 33, comma or not), with the rest of the
// suffix after it. citation-token.ts splitLocator is the offline exporter's
// copy of that rule. This differential renders a fixed list (the plan's
// `p. 5`, `33`, `pp. 4–6`, `chap. 2`, `33, emphasis added`, `iv`, `sec. 3`
// and the edge cases: roman numerals, ranges, lists, a trailing comment) and
// fast-check-generated suffixes through pandoc (`-t plain`) and through the
// built-in export (exportDraft, md, no pandoc), in chicago-author-date (no
// `p.` for a page), apa (labels every locator), ieee, harvard and mla (a
// comma before a non-page locator), and requires the same citation text for
// every one — braced locators included (`{33}` prints no label; review round
// 3). Required with CI=true (pandoc on PATH).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportDraft } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';
import { caseProtectItems, cslStyleText, parseBibEntries } from '../bin/lib/citations.js';
import { splitLocator } from '../bin/lib/citation-token.js';
import { requirePandoc, runPandocIn } from './helpers/pandoc-oracle.js';

const BIB = '@book{kuhn1962, author = {Kuhn, Thomas S.}, title = {The Structure of Scientific Revolutions}, publisher = {University of Chicago Press}, year = {1962}}\n';
// PENSMITH_ORACLE_SEED / PENSMITH_ORACLE_RUNS explore other samples (the committed run is the default).
const SEED = Number(process.env['PENSMITH_ORACLE_SEED'] ?? 2121);
const GENERATED = Number(process.env['PENSMITH_ORACLE_RUNS'] ?? 240);

const FIXED = [
  ', p. 5', ' 33', ', 33', ', pp. 4–6', ', chap. 2', ', 33, emphasis added', ', iv', ', sec. 3', ' 33-35', ', 33 and passim', ', p. iv',
  ', pp. 33, 35', ', 33, 35', ', xii-xiv', ', emphasis added', ', p.5', ', 5a', ', 33ff', ', chapter 3', ', figs. 2-3', ', para. 4', ', §4',
  ', vol. 2, p. 5', ', 33–35', ', p. 33 n. 2', ', 1:5', ', II', ', line 4', ', note 3', ', 12.4', ', i', ', mix', ', 2nd ed.', ', p', ', 33,35',
  ' p. 7', ', 33 ff.', ', bk. 2', ', col. 3', ', pt. 2', ', fol. 4', ', l. 12', ', n. 5', ', no. 3', ', p. 12, cf. fig. 2',
  // Review round 1: Pandoc's `--` range, `ff.` before the sentence period, an
  // em dash (never a range), `number` / `issue`, and the en-GB and style-locale terms.
  ', 727--733', ', pp. 727--733', ', 33ff.', ', 33ff., emphasis added', ', 33—35', ', pp. 33---35', ', number 3', ', issue 3',
  ', ch. 2', ', sect. 3', ', chs. 2-3', ', secs. 2--3', ', p. 5.', ', 100-104', ', 7-9',
  // Review round 3: a braced (delimited) locator with no label prints no
  // label — pandoc's pLocatorLabelDelimited — while a braced label is read.
  ' {33}', ', {33 and 34}', ', {p. 33}', ', {iv}', ' {chap. 3}', ', {33}, emphasis added',
];

const TERMS = ['', 'p. ', 'pp. ', 'p.', 'page ', 'pages ', 'chap. ', 'chapter ', 'sec. ', 'section ', '§', '§ ', 'para. ', 'vol. ', 'fig. ', 'figure ', 'line ', 'note ', 'col. ', 'pt. ', 'part ', 'bk. ', 'book '];
const NUMBER = fc.oneof(
  fc.integer({ min: 1, max: 999 }).map(String),
  fc.constantFrom('iv', 'xii', 'II', 'XIV', 'iii', '5a', '33ff', '1:5', '12.4', '2nd'),
);
const VALUE = fc.oneof(
  NUMBER,
  fc.tuple(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 100, max: 199 }), fc.constantFrom('-', '–')).map(([a, b, d]) => `${a}${d}${b}`),
  fc.tuple(fc.integer({ min: 1, max: 99 }), fc.integer({ min: 100, max: 199 }), fc.constantFrom(', ', ',')).map(([a, b, d]) => `${a}${d}${b}`),
);
const TAIL = fc.constantFrom('', ', emphasis added', ' and passim', ' n. 2', ', p. 5', ', cf. fig. 2', ' (translated)', ', note');
const SUFFIX = fc.tuple(fc.constantFrom(', ', ' ', ','), fc.constantFrom(...TERMS), VALUE, TAIL).map(([lead, term, value, tail]) => `${lead}${term}${value}${tail}`);

/** The normalised text of each `Pn …` paragraph of a rendering. */
function byParagraph(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const m = /^P(\d+) ([\s\S]*)$/.exec(para.trim());
    if (m === null) continue;
    const norm = (m[2] as string)
      .replace(/\\([^\w\s])/g, '$1')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    out.set(m[1] as string, norm);
  }
  return out;
}

async function builtIn(md: string, style: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), `pensmith-locator-${style}-`));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, md);
  const { result } = await withCapturedOutput(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style }));
  return (readFileSync(result.outputPath, 'utf8').split(/\n## (?:References|Works Cited)\n/)[0] as string);
}

function viaPandoc(md: string, style: string): string {
  const { entries } = parseBibEntries(BIB);
  return runPandocIn(
    { 'input.md': md, 'references.json': JSON.stringify(caseProtectItems(entries)), 'style.csl': cslStyleText(style) },
    ['input.md', '--from', 'markdown-yaml_metadata_block-raw_attribute-raw_tex', '-t', 'plain', '--wrap=none', '--citeproc', '--csl', 'style.csl',
      '--bibliography', 'references.json', '-M', 'suppress-bibliography=true'],
  );
}

test('carry-over 3: [@k 33] is page 33 and the built-in export prints it as pandoc does', () => {
  assert.deepEqual(splitLocator(' 33'), { locator: '33', label: 'page', rest: '' });
});

// chicago-author-date (no `p.`), apa (labels every locator), and — review
// round 1 — ieee (a suffix outside its brackets, `Ch.`) and harvard (en-GB:
// its own locator terms). The note style's locators are in the goldens.
for (const style of ['chicago-author-date', 'apa', 'ieee', 'harvard', 'mla']) {
  test(`D-21-04: every locator suffix renders as pandoc renders it (${style}; ${FIXED.length} fixed + ${GENERATED} generated, seed ${SEED})`, async (t) => {
    if (!requirePandoc(t, 'locator oracle')) return;
    const suffixes = [...FIXED, ...fc.sample(SUFFIX, { seed: SEED, numRuns: GENERATED })];
    const md = suffixes.map((s, i) => `P${i} [@kuhn1962${s}].`).join('\n\n') + '\n';
    const theirs = byParagraph(viaPandoc(md, style));
    const ours = byParagraph(await builtIn(md, style));
    const diffs: string[] = [];
    suffixes.forEach((s, i) => {
      const a = theirs.get(String(i));
      const b = ours.get(String(i));
      if (a !== b) diffs.push(`[@kuhn1962${s}] → pandoc ${JSON.stringify(a)} / built-in ${JSON.stringify(b)}`);
    });
    assert.deepEqual(diffs, [], `${diffs.length} of ${suffixes.length} locator suffixes differ:\n${diffs.slice(0, 20).join('\n')}`);
  });
}
