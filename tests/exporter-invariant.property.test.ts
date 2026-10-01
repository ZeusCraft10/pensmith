// tests/exporter-invariant.property.test.ts — nothing the exporter adds can
// carry an unverified citation (D-21-12, carry-over 4).
//
// Note-style footnotes, superscripts and the bibliography are produced by the
// exporter AFTER the gate ran and never re-enter it. This property proves
// they carry nothing the gate did not judge: over generated drafts (every
// citation form a draft may hold — bracketed, clustered, located, prefixed,
// author-suppressed, narrative, `@k [p. n]` — in all 8 styles), the exported
// Markdown with the rendered citations, the note markers and definitions and
// the bibliography removed equals the gated text with its citation tokens
// removed; every rendered key is a key the gate read; and the bibliography
// holds exactly the rendered keys. exportDraft asserts the key half itself
// before writing (assertRenderedKeys).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportDraft } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';
import { prepareText } from '../bin/lib/export/render.js';
import { runsMarkdown } from '../bin/lib/export/md-writer.js';
import { parseBibEntries } from '../bin/lib/citations.js';
import { extractCitedKeysForVerification, findRenderedCitations } from '../bin/lib/citation-token.js';

const SEED = 2112;
const RUNS = Number(process.env['PENSMITH_INVARIANT_RUNS'] ?? 160);
const BIB =
  '@article{lindqvist2012, author = {Lindqvist, Anna and Berg, Erik}, title = {Economic growth in China}, journal = {Journal of Development Economics}, year = {2012}, volume = {98}, pages = {145--162}, doi = {10.1016/j.jdeveco.2011.08.003}}\n' +
  '@book{kuhn1962, author = {Kuhn, Thomas S.}, title = {The Structure of Scientific Revolutions}, publisher = {University of Chicago Press}, address = {Chicago}, year = {1962}}\n' +
  '@incollection{okafor2019, author = {Okafor, Chidi}, title = {Measuring trust in NGO networks}, booktitle = {Handbook of Civil Society Research}, editor = {Hart, Miriam}, publisher = {Routledge}, year = {2019}, pages = {33--58}}\n' +
  '@article{smith2020, author = {Smith, John}, title = {Credit cycles}, journal = {Econ}, year = {2020}, doi = {10.1000/x2}}\n';
const ENTRIES = parseBibEntries(BIB).entries;
const KEYS = ['lindqvist2012', 'kuhn1962', 'okafor2019', 'smith2020'];
const STYLES = ['apa', 'mla', 'chicago-author-date', 'chicago-notes-bib', 'ieee', 'ama', 'vancouver', 'harvard'];

const key = fc.constantFrom(...KEYS);
const locator = fc.constantFrom('', ', p. 5', ', pp. 4–6', ' 33', ', chap. 2', ', 12, emphasis added');
const citation = fc.oneof(
  { weight: 4, arbitrary: fc.tuple(key, locator).map(([k, l]) => `[@${k}${l}]`) },
  { weight: 2, arbitrary: fc.tuple(key, key).filter(([a, b]) => a !== b).map(([a, b]) => `[@${a}; @${b}]`) },
  { weight: 1, arbitrary: key.map((k) => `[see @${k}]`) },
  { weight: 1, arbitrary: key.map((k) => `[-@${k}]`) },
  { weight: 2, arbitrary: key.map((k) => `@${k}`) },
  { weight: 1, arbitrary: key.map((k) => `@${k} [p. 7]`) },
);
const word = fc.stringMatching(/^[a-z]{1,9}$/);
const sentence = fc.tuple(fc.array(word, { minLength: 2, maxLength: 8 }), fc.option(citation, { nil: undefined }), fc.constantFrom('.', ',', ';', '', '?')).map(
  ([ws, c, p]) => {
    if (c === undefined) return `${ws.join(' ')}${p || '.'}`;
    // A narrative citation opens or sits inside the sentence; a bracketed one closes it.
    if (c.startsWith('@')) return `${ws.slice(0, 1).join(' ')} ${c} ${ws.slice(1).join(' ')}${p || '.'}`;
    return `${ws.join(' ')} ${c}${p}`;
  },
);
const paragraph = fc.array(sentence, { minLength: 1, maxLength: 4 }).map((s) => s.join(' '));
const draft = fc.tuple(fc.array(paragraph, { minLength: 1, maxLength: 4 }), fc.constantFrom(...STYLES)).map(([ps, style]) => ({
  md: `# A Generated Paper\n\n## Section\n\n${ps.join('\n\n')}\n`,
  style,
}));

/**
 * The gated text with every citation (and the white space before it) removed;
 * a citation the style prints nothing for (`printsNothing`, by start offset)
 * is removed alone, as pandoc removes it ("Citation with no printed form").
 */
function gatedMinusCitations(md: string, printsNothing: ReadonlySet<number>): string {
  let out = '';
  let at = 0;
  for (const c of findRenderedCitations(md)) {
    if (c.start < at) continue;
    let end = c.end;
    const loc = c.narrative === true ? /^[ \t]*\[[^[\]@^][^[\]@]*\](?![({:])/.exec(md.slice(end)) : null;
    if (loc !== null) end += loc[0].length;
    const before = md.slice(at, c.start);
    out += printsNothing.has(c.start) ? before : before.replace(/[ \t]+$/, '');
    at = end;
  }
  return (out + md.slice(at)).replace(/[ \t]+$/gm, '').trimEnd();
}

test(`D-21-12: export text minus rendered citations, notes and bibliography = gated text minus citation tokens (${RUNS} drafts × 8 styles, seed ${SEED})`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-invariant-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), BIB);
  const inputPath = join(root, '.paper', 'DRAFT.md');
  const samples = fc.sample(draft, { seed: SEED, numRuns: RUNS });
  let rendered = 0;
  for (const { md, style } of samples) {
    writeFileSync(inputPath, md);
    const { result } = await withCapturedOutput(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style }));
    const out = readFileSync(result.outputPath, 'utf8');
    const prep = await prepareText(md, ENTRIES, style);
    // Remove the bibliography and the note definitions.
    let body = out.split(/\n\n## (?:References|Bibliography|Works Cited)\n\n/)[0] as string;
    body = body.split(/\n\n\[\^\d+\]: /)[0] as string;
    // Remove each rendered citation, in order, with the white space before it.
    let rest = body;
    let cursor = 0;
    for (const p of prep.placed) {
      for (const part of p.parts) {
        if (part.kind === 'text') continue;
        const piece = part.kind === 'runs' ? runsMarkdown(part.runs) : `[^${part.n}]`;
        const at = rest.indexOf(piece, cursor);
        assert.ok(at !== -1, `the rendered "${piece}" is in the export (${style}): ${JSON.stringify(md)}`);
        let from = at;
        while (from > 0 && (rest[from - 1] === ' ' || rest[from - 1] === '\t')) from--;
        rest = rest.slice(0, from) + rest.slice(at + piece.length);
        cursor = from;
        rendered += 1;
      }
    }
    assert.equal(
      rest.replace(/[ \t]+$/gm, '').trimEnd(),
      gatedMinusCitations(md, new Set(prep.placed.filter((p) => p.parts.every((x) => x.kind === 'text')).map((p) => p.start))),
      `${style}: the export added or changed text outside its citations: ${JSON.stringify(md)}`,
    );
    const gated = new Set(extractCitedKeysForVerification(md));
    for (const k of prep.renderedKeys) assert.ok(gated.has(k), `${k} rendered but not gated`);
    assert.deepEqual(new Set(prep.bibliography.map((e) => e.id)), new Set(prep.renderedKeys), `${style}: the bibliography is exactly the rendered keys`);
  }
  assert.ok(rendered > RUNS, `citations were rendered (${rendered})`);
});
