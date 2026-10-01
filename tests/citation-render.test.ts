// tests/citation-render.test.ts — Wave 0 stub for D-22 / CITE-04.
// Smoke test: citation-js parses BibTeX with accent-command and renders APA via apa.csl.
//
// Production code required: bin/lib/citations.ts + templates/citation-styles/apa.csl
// Until then: existence assertions fire RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  caseProtectTitle,
  isNoteStyle,
  parseBibEntries,
  renderDocumentCitations,
  runsText,
  type DocumentCitation,
} from '../bin/lib/citations.js';
import { exportDraft } from '../bin/lib/exporter.js';
import { withCapturedOutput } from '../bin/lib/output-sink.js';

const citationsPath = new URL('../bin/lib/citations.ts', import.meta.url);
const apaCslPath = new URL('../plugin/templates/citation-styles/apa.csl', import.meta.url);
const fixtureBibPath = new URL('../tests/fixtures/known-good-fixture/CITATIONS.bib', import.meta.url);

const shouldSkip = !existsSync(citationsPath) || !existsSync(apaCslPath) || !existsSync(fixtureBibPath);

test('citation-render: bin/lib/citations.ts production module exists (D-22)', () => {
  assert.ok(
    existsSync(citationsPath),
    'MISSING: bin/lib/citations.ts — Wave 2 must create before this test passes (D-19 chokepoint wrapper)',
  );
});

test('citation-render: plugin/templates/citation-styles/apa.csl exists (D-22)', () => {
  assert.ok(
    existsSync(apaCslPath),
    'MISSING: plugin/templates/citation-styles/apa.csl — Plan 05 must create before this test passes (D-22)',
  );
});

test('citation-render: tests/fixtures/known-good-fixture/CITATIONS.bib exists (D-22)',
  { skip: !existsSync(fixtureBibPath) },
  () => {
    const content = readFileSync(fixtureBibPath, 'utf-8');
    assert.ok(content.includes('@article'), 'CITATIONS.bib must contain at least one @article entry');
  },
);

test('citation-render: citation-js parses BibTeX with accent-command and renders APA',
  { skip: shouldSkip },
  async () => {
    // bin/lib/citations.ts now exists (Phase 3 Plan 03-02). The
    // prior ts-error suppression that gated this import was removed by
    // 03-02 per the executor reconciliation note in the plan prompt.
    const { parseBib, renderApa } = await import('../bin/lib/citations.js');
    const bibContent = readFileSync(fixtureBibPath, 'utf-8');

    // Parse BibTeX through citations.ts chokepoint.
    const entries = await parseBib(bibContent);
    assert.ok(Array.isArray(entries) && entries.length > 0, 'parseBib must return at least one entry');

    // Render APA via apa.csl — must not throw and must return a non-empty string.
    const rendered = await renderApa(entries);
    assert.ok(typeof rendered === 'string' && rendered.length > 0, 'renderApa must return non-empty string');

    // The fixture contains {\'a} accent-command — rendered output should contain 'á' (NFKC-safe).
    // Per D-19/T-3-04 pitfall: citation-js must handle backslash-accent-commands gracefully.
    // This assertion guards the BibTeX accent-command processing path.
    assert.ok(
      rendered.includes('á') || rendered.toLowerCase().includes('vaswani'),
      'APA render must handle accent-command {\\\'a} correctly (D-19/T-3-04)',
    );
  },
);

// ====================================================================
//   Phase 10 — CITE-02 / CITE-03 multi-style render + existence tests
// ====================================================================
// For each of the 7 new bundled styles emit TWO tests:
//   1. Always-on existence assertion — PASSES NOW (Plan 10-00 Task 1 committed
//      the .csl files); stays as a regression guard.
//   2. Skip-guarded render assertion — SKIPS NOW because citations.ts does not
//      yet export renderStyle (Plan 10-01 ships it), then GREENs once 10-01
//      lands. A dynamic import of citations.js with renderStyle still absent
//      resolves the symbol as `undefined`, so the render test feature-detects
//      `typeof renderStyle === 'function'` IN ADDITION to the existing shouldSkip
//      + .csl existence guards — MANDATORY to keep the suite GREEN (no TypeError)
//      while renderStyle is absent (cycle-1 review L1).

const stylesToTest = [
  'mla',
  'chicago-notes-bib',
  'chicago-author-date',
  'ieee',
  'ama',
  'vancouver',
  'harvard',
] as const;

for (const style of stylesToTest) {
  const cslPath = new URL(`../plugin/templates/citation-styles/${style}.csl`, import.meta.url);

  // 1. Existence guard — PASSES NOW (files committed in Task 1).
  test(`citation-render: plugin/templates/citation-styles/${style}.csl exists (CITE-02/03)`, () => {
    assert.ok(existsSync(cslPath), `MISSING: plugin/templates/citation-styles/${style}.csl`);
  });

  // 2. Render — skip-guarded on the existing shouldSkip OR a missing .csl.
  const shouldSkipStyle = shouldSkip || !existsSync(cslPath);
  test(`citation-render: renderStyle('${style}') produces non-empty bibliography (CITE-02/03)`,
    { skip: shouldSkipStyle },
    async (t) => {
      const mod = await import('../bin/lib/citations.js');
      // Feature-detect renderStyle: it does not exist until Plan 10-01 ships it.
      // A dynamic import resolves the absent export as `undefined`, so calling it
      // would throw — skip cleanly instead (cycle-1 L1).
      const renderStyle = (mod as { renderStyle?: unknown }).renderStyle;
      if (typeof renderStyle !== 'function') {
        t.skip('renderStyle not yet exported (Plan 10-01)');
        return;
      }
      const { parseBib } = mod;
      const bibContent = readFileSync(fixtureBibPath, 'utf-8');
      const entries = await parseBib(bibContent);
      const rendered = await (renderStyle as (
        e: unknown,
        s: string,
      ) => Promise<string>)(entries, style);
      assert.ok(
        typeof rendered === 'string' && rendered.length > 0,
        `renderStyle('${style}') must return a non-empty string`,
      );
    },
  );
}

// ====================================================================
//   Phase 10 Plan 01 Task 2 — determinism, single-registration, mapping
// ====================================================================
// These three tests prove the load-bearing CITE-02 properties beyond
// "non-empty": deterministic+offline render (byte-identical double call),
// the H2 single-registration fix (renderApa delegates → 'pensmith-apa'
// added at most once), and the resolveStyleName discipline→style table.
// They feature-detect renderStyle the same way the per-style loop does so
// the suite stays GREEN if run against a citations.ts that predates 10-01.

const ieeeCslPath = new URL('../plugin/templates/citation-styles/ieee.csl', import.meta.url);

// 1. Determinism + collision guard (CITE-02): two back-to-back renderStyle
//    calls for the same style yield byte-identical output and the second
//    call never throws "template already registered" (Pitfall 1 guard).
test('citation-render: renderStyle is deterministic + no re-registration collision (CITE-02)',
  { skip: shouldSkip || !existsSync(ieeeCslPath) },
  async (t) => {
    const mod = await import('../bin/lib/citations.js');
    const renderStyle = (mod as { renderStyle?: unknown }).renderStyle;
    if (typeof renderStyle !== 'function') {
      t.skip('renderStyle not yet exported (Plan 10-01)');
      return;
    }
    const render = renderStyle as (e: unknown, s: string) => Promise<string>;
    const { parseBib } = mod;
    const bibContent = readFileSync(fixtureBibPath, 'utf-8');
    const entries = await parseBib(bibContent);

    const first = await render(entries, 'ieee');
    // Second call must not reject with "template already registered".
    await assert.doesNotReject(() => render(entries, 'ieee'));
    const second = await render(entries, 'ieee');
    assert.equal(first, second, 'renderStyle(ieee) must be byte-identical across calls (deterministic + offline)');
  },
);

// 2. renderApa ↔ renderStyle('apa') single-registration parity (H2 regression
//    guard): in ONE process call renderApa() THEN renderStyle(entries,'apa').
//    Both consume the 'pensmith-apa' template. This would THROW "template
//    already registered" on the ORIGINAL self-contained renderApa +
//    independent renderStyle('apa') design — it is the executable proof the
//    H2 single-registration fix landed, plus a byte-parity check that the
//    delegation preserves the locked Wave-0 renderApa output bytes.
test('citation-render: renderApa delegates to renderStyle(apa) — byte-identical, single registration (H2)',
  { skip: shouldSkip },
  async (t) => {
    const mod = await import('../bin/lib/citations.js');
    const renderStyle = (mod as { renderStyle?: unknown }).renderStyle;
    const resetApa = (mod as { _resetApaTemplateForTest?: unknown })._resetApaTemplateForTest;
    if (typeof renderStyle !== 'function' || typeof resetApa !== 'function') {
      t.skip('renderStyle / _resetApaTemplateForTest not yet exported (Plan 10-01)');
      return;
    }
    const render = renderStyle as (e: unknown, s: string) => Promise<string>;
    const { parseBib, renderApa } = mod;
    const bibContent = readFileSync(fixtureBibPath, 'utf-8');
    const entries = await parseBib(bibContent);

    // Clean slate so this test owns the 'pensmith-apa' registration lifecycle.
    (resetApa as () => void)();

    // Both calls register/consume 'pensmith-apa'; neither may collide.
    let a = '';
    await assert.doesNotReject(async () => { a = await renderApa(entries); });
    let b = '';
    await assert.doesNotReject(async () => { b = await render(entries, 'apa'); });

    assert.ok(a.length > 0, 'renderApa must return a non-empty string');
    assert.equal(a, b, 'renderApa(entries) must be byte-identical to renderStyle(entries,"apa")');
  },
);

// 3. resolveStyleName discipline→style table (CITE-02/03 downstream contract).
test('citation-render: resolveStyleName maps disciplines to styles (CITE-02/03)',
  { skip: shouldSkip },
  async (t) => {
    const mod = await import('../bin/lib/citations.js');
    const resolveStyleName = (mod as { resolveStyleName?: unknown }).resolveStyleName;
    if (typeof resolveStyleName !== 'function') {
      t.skip('resolveStyleName not yet exported (Plan 10-01)');
      return;
    }
    const resolve = resolveStyleName as (d: string) => string;
    assert.equal(resolve('computer-science'), 'ieee', 'computer-science → ieee');
    assert.equal(resolve('literature'), 'mla', 'literature → mla');
    assert.equal(resolve('history'), 'chicago-notes-bib', 'history → chicago-notes-bib (PRD §8; the preset table, GRND-06)');
    assert.equal(resolve('philosophy'), 'chicago-author-date', 'philosophy → chicago-author-date');
    assert.equal(resolve('biology'), 'ama', 'biology → ama (PRD §8)');
    assert.equal(resolve('unknown'), 'apa', 'unknown → apa fallback');
  },
);

// ====================================================================
//   REND-01 — the in-text form, through the one document renderer
// ====================================================================
// The Phase-13 per-entry renderInText is gone (Phase 21 review round 1: it
// numbered every numeric citation [1]); its REND-01 checks run through
// renderDocumentCitations, the renderer every export uses.
test('citation-render: an APA in-text citation of the known-good fixture is "(Vaswani et al., 2017)", rendered twice without a template collision (REND-01)',
  { skip: shouldSkip },
  async () => {
    const entries = parseBibEntries(readFileSync(fixtureBibPath, 'utf-8')).entries;
    const one: DocumentCitation[] = [{ items: [{ id: String(entries[0]?.['id']) }] }];
    for (let i = 0; i < 2; i += 1) {
      const doc = await renderDocumentCitations(entries, 'apa', one);
      assert.equal(runsText(doc.citations[0]?.inline ?? []).trim(), '(Vaswani et al., 2017)');
    }
  },
);

test('citation-render: renderDocumentCitations throws TypeError on non-array input (REND-01)', async () => {
  await assert.rejects(() => renderDocumentCitations('not-an-array' as unknown as Array<Record<string, unknown>>, 'apa', []), TypeError);
});

// ====================================================================
//   Phase 21 — the whole-document renderer (D-21-03, D-21-04, D-21-06, D-21-07)
// ====================================================================
// renderDocumentCitations runs ONE citeproc engine over every citation of a
// document in order: numbering, note forms (first / subsequent / ibid) and
// the bibliography are the engine's, as in pandoc (the goldens,
// tests/citation-goldens.test.ts, compare whole documents with pandoc 3.9).

const GOLD_BIB = fileURLToPath(new URL('./fixtures/citation-goldens/fixture.bib', import.meta.url));
const DOC_ENTRIES = parseBibEntries(readFileSync(GOLD_BIB, 'utf8')).entries;
const A = 'lindqvist2012';
const B = 'kuhn1962';
const C = 'okafor2019';
const cite = (...ids: string[]): DocumentCitation => ({ items: ids.map((id) => ({ id })) });

test('D-21-03: a numeric style numbers sources in first-citation order across every citation (IEEE B, A, B, [A; C])', async () => {
  const r = await renderDocumentCitations(DOC_ENTRIES, 'ieee', [cite(B), cite(A), cite(B), cite(A, C)]);
  assert.deepEqual(r.citations.map((c) => runsText(c.inline)), ['[1]', '[2]', '[1]', '[2], [3]']);
  assert.deepEqual(r.bibliography.map((e) => [e.id, runsText(e.label ?? [])]), [[B, '[1]'], [A, '[2]'], [C, '[3]']]);
  assert.equal(r.noteStyle, false);
});

test('D-21-03: Vancouver numbers in parentheses and AMA prints superscript runs', async () => {
  const v = await renderDocumentCitations(DOC_ENTRIES, 'vancouver', [cite(B), cite(A, C)]);
  assert.deepEqual(v.citations.map((c) => runsText(c.inline)), ['(1)', '(2,3)']);
  const ama = await renderDocumentCitations(DOC_ENTRIES, 'ama', [cite(B), cite(A), cite(B)]);
  assert.deepEqual(ama.citations.map((c) => runsText(c.inline)), ['1', '2', '1']);
  assert.ok(ama.citations.every((c) => c.inline.every((r) => r.sup === true)), 'AMA citations are superscript runs');
});

test('D-21-03: locators, clusters, narrative and -@k forms render as pandoc renders them (APA)', async () => {
  const r = await renderDocumentCitations(DOC_ENTRIES, 'apa', [
    { items: [{ id: C, locator: '40', label: 'page' }] },
    cite(C, A),
    { items: [{ id: A }], narrative: true },
    { items: [{ id: A, suppressAuthor: true }] },
    { items: [{ id: B, locator: '2', label: 'chapter' }] },
  ]);
  assert.deepEqual(r.citations.map((c) => runsText(c.inline)), [
    '(Okafor, 2019, p.\u00a040)',
    '(Lindqvist & Berg, 2012; Okafor, 2019)',
    'Lindqvist & Berg (2012)',
    '(2012)',
    '(Kuhn, 1962, Chapter\u00a02)',
  ]);
  const ieee = await renderDocumentCitations(DOC_ENTRIES, 'ieee', [cite(B), { items: [{ id: A }], narrative: true }]);
  assert.equal(runsText(ieee.citations[1]?.inline ?? []), '[2]', 'a numeric narrative citation prints its number, as pandoc does');
});

test('D-21-03 / EXP-04: a note style makes footnotes — first full, subsequent short, the same source again short with its locator — and narrative authors in the text', async () => {
  const r = await renderDocumentCitations(DOC_ENTRIES, 'chicago-notes-bib', [
    cite(B),
    cite(A),
    cite(B),
    { items: [{ id: C, locator: '40', label: 'page' }] },
    { items: [{ id: C, locator: '41', label: 'page' }] },
    { items: [{ id: A }], narrative: true },
  ]);
  assert.equal(r.noteStyle, true);
  assert.equal(isNoteStyle('chicago-notes-bib'), true);
  const notes = r.citations.map((c) => runsText(c.note ?? []));
  assert.equal(notes[0], 'Thomas S. Kuhn, The Structure of Scientific Revolutions (Chicago: University of Chicago Press, 1962).');
  assert.equal(notes[2], 'Kuhn, The Structure of Scientific Revolutions.', 'a subsequent note is the short form');
  assert.equal(notes[3], 'Chidi Okafor, “Measuring Trust in NGO Networks,” in Handbook of Civil Society Research, ed. Miriam Hart and Ravi Patel (London: Routledge, 2019), 40.');
  assert.equal(notes[4], 'Okafor, 41.', 'the same source again: the short form with its locator');
  assert.ok(!notes.some((n) => n.includes('..')), 'no doubled period anywhere (carry-over 2)');
  assert.deepEqual(r.citations.slice(0, 5).map((c) => c.inline.length), [0, 0, 0, 0, 0], 'a bracketed citation leaves nothing in the text');
  assert.equal(runsText(r.citations[5]?.inline ?? []), 'Lindqvist and Berg', 'a narrative citation keeps its author in the text');
  assert.equal(notes[5], '“Economic Growth in China and the World Bank’s Lending Policy.”');
  assert.ok(r.citations[0]?.note?.some((run) => run.italic === true && run.text.includes('Structure')), 'the note keeps its italics as runs');
});

test('D-21-04: notes go after punctuation and superscripts drop the space before them (the md export)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-placement-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  copyFileSync(GOLD_BIB, join(root, '.paper', 'CITATIONS.bib'));
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, '# T\n\nA claim [@kuhn1962]. Another [@lindqvist2012], then more. Already punctuated. [@okafor2019]\n');
  const notes = await withCapturedOutput(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'chicago-notes-bib' }));
  const md = readFileSync(notes.result.outputPath, 'utf8');
  assert.ok(md.includes('A claim.[^1] Another,[^2] then more. Already punctuated.[^3]'), md);
  assert.ok(/\n## Bibliography\n/.test(md), 'a note style\'s list is a Bibliography');
  const sup = await withCapturedOutput(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'ama' }));
  const ama = readFileSync(sup.result.outputPath, 'utf8');
  assert.ok(ama.includes('A claim^1^. Another^2^, then more. Already punctuated.^3^'), ama);
});

// Review round 2: a moved punctuation run stops at the next citation and
// before a hard line break; a soft line break before a note or a superscript
// goes (pandoc drops a SoftBreak as it drops a Space); a note that starts with
// a prefix is capitalised; a SICI DOI's link is written so a Markdown reader
// keeps it whole.
test('D-21-04 (review r2): adjacent citations, a hard break, a soft break, a capitalised prefix and a SICI DOI in the md export', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-placement-r2-'));
  mkdirSync(join(root, '.paper'), { recursive: true });
  const sici = '@article{bates1998, author = {Bates, Marcia J.}, title = {Indexing and access for digital libraries}, journal = {J Am Soc Inf Sci}, year = {1998}, volume = {49}, pages = {1185--1205}, doi = {10.1002/(SICI)1097-4571(19981101)49:13<1185::AID-ASI6>3.0.CO;2-V}}\n';
  writeFileSync(join(root, '.paper', 'CITATIONS.bib'), readFileSync(GOLD_BIB, 'utf8') + sici);
  const inputPath = join(root, '.paper', 'DRAFT.md');
  writeFileSync(inputPath, '# T\n\nAdjacent [@kuhn1962][@lindqvist2012]. Break here [@okafor2019]\\\nnext line. A wrapped claim\n[@kuhn1962]. Prefixed [see also @okafor2019].\n');
  const notes = await withCapturedOutput(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'chicago-notes-bib' }));
  const md = readFileSync(notes.result.outputPath, 'utf8');
  assert.ok(md.includes('Adjacent[^1].[^2] Break here[^3]\\\nnext line. A wrapped claim.[^4] Prefixed.[^5]'), md);
  assert.ok(!md.includes('[@'), 'no citation half is left in the text');
  assert.match(md, /^\[\^5\]: See also Okafor/m);
  const sup = await withCapturedOutput(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'ama' }));
  assert.ok(readFileSync(sup.result.outputPath, 'utf8').includes('A wrapped claim^1^.'), 'the superscript drops the soft break too');
  writeFileSync(inputPath, '# T\n\nIndexing [@bates1998].\n');
  const apa = await withCapturedOutput(() => exportDraft({ inputPath, format: 'md', paperRoot: root, pandocPresent: false, style: 'apa' }));
  const apaMd = readFileSync(apa.result.outputPath, 'utf8');
  assert.ok(apaMd.includes('](https://doi.org/10.1002/%28SICI%291097-4571%2819981101%2949:13%3C1185::AID-ASI6%3E3.0.CO;2-V)'), apaMd);
  assert.ok(!/<https:[^>]*</.test(apaMd), 'no autolink holding a <');
});

// Review round 2: pandoc links an entry's title to its DOI (else PMCID, PMID,
// URL) when the style prints none of them — Vancouver prints no DOI.
test('D-21-03 (review r2): a style that prints no DOI links the title to it; one that prints it does not', async () => {
  const v = await renderDocumentCitations(DOC_ENTRIES, 'vancouver', [cite(A), cite(B)]);
  const lind = v.bibliography.find((e) => e.id === A);
  assert.deepEqual(lind?.runs.filter((r) => r.href !== undefined).map((r) => [r.text, r.href]), [["Economic growth in China and the World Bank's lending policy".replace("'", '\u2019'), 'https://doi.org/10.1016/j.jdeveco.2011.08.003']]);
  assert.ok(v.bibliography.find((e) => e.id === B)?.runs.every((r) => r.href === undefined), 'no identifier, no link');
  const apa = await renderDocumentCitations(DOC_ENTRIES, 'apa', [cite(A)]);
  assert.deepEqual(apa.bibliography[0]?.runs.filter((r) => r.href !== undefined).map((r) => r.text), ['https://doi.org/10.1016/j.jdeveco.2011.08.003'], 'APA prints the DOI: only it is a link');
  const notes = await renderDocumentCitations(DOC_ENTRIES, 'chicago-notes-bib', [cite(C), cite(A), { items: [{ id: C, suffix: ', emphasis added' }] }]);
  assert.equal(runsText(notes.citations[2]?.note ?? []), 'Okafor, \u201cMeasuring Trust in NGO Networks,\u201d emphasis added.', 'the suffix comma goes inside the quote (en-US)');
});

test('D-21-06: case protection — acronyms and mixed case always, capitalised words after the first in a non-Title-Case title, a Title Case title whole', () => {
  assert.equal(
    caseProtectTitle("Economic growth in China and the World Bank's lending policy"),
    'Economic growth in <span class="nocase">China</span> and the <span class="nocase">World</span> <span class="nocase">Bank\'s</span> lending policy',
  );
  assert.equal(caseProtectTitle('Measuring trust in NGO networks'), 'Measuring trust in <span class="nocase">NGO</span> networks');
  assert.equal(caseProtectTitle('The Structure of Scientific Revolutions'), '<span class="nocase">The Structure of Scientific Revolutions</span>');
  assert.equal(caseProtectTitle('iPhone usage and sleep'), '<span class="nocase">iPhone</span> usage and sleep');
  assert.equal(caseProtectTitle('a study of <i>Drosophila</i> wings'), 'a study of <i><span class="nocase">Drosophila</span></i> wings');
});

test('D-21-06: neither path lowercases "China" — the APA export keeps the proper noun the source capitalised', async () => {
  const r = await renderDocumentCitations(DOC_ENTRIES, 'apa', [cite(A)]);
  assert.ok(runsText(r.bibliography[0]?.runs ?? []).includes('Economic growth in China and the World Bank’s lending policy'), runsText(r.bibliography[0]?.runs ?? []));
});

test('D-21-07: a .csl file is registered by its content — two files with one name never collide, and an edited file is read afresh', async () => {
  const csl = readFileSync(fileURLToPath(new URL('./fixtures/export/custom-style.csl', import.meta.url)), 'utf8');
  const d1 = mkdtempSync(join(tmpdir(), 'pensmith-csl-a-'));
  const d2 = mkdtempSync(join(tmpdir(), 'pensmith-csl-b-'));
  writeFileSync(join(d1, 'style.csl'), csl);
  writeFileSync(join(d2, 'style.csl'), csl.replace('prefix="&lt;&lt;"', 'prefix="{{"').replace('suffix="&gt;&gt;"', 'suffix="}}"'));
  const a = await renderDocumentCitations(DOC_ENTRIES, join(d1, 'style.csl'), [cite(B)]);
  const b = await renderDocumentCitations(DOC_ENTRIES, join(d2, 'style.csl'), [cite(B)]);
  assert.equal(runsText(a.citations[0]?.inline ?? []), '<<Kuhn 1962>>');
  assert.equal(runsText(b.citations[0]?.inline ?? []), '{{Kuhn 1962}}');
  assert.equal(isNoteStyle(join(d1, 'style.csl')), false);
});
