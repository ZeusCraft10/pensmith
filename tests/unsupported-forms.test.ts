// tests/unsupported-forms.test.ts — every attribution the verifier cannot check
// against the bibliography is an UNSUPPORTED-FORM finding (VRFY-10, D-20-08).
//
// Each positive case names the forms and lines it must report; each has a CRLF
// twin that must report the same. The negative corpus (text that looks a little
// like a citation but is not one, and forms inside provable code or math) must
// report nothing — so a clean draft never gets an UNSUPPORTED-FORM row.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findUnsupportedForms, UNSUPPORTED_FORM_REASONS, UNSUPPORTED_FORMS } from '../bin/lib/verify/unsupported-forms.js';
import { textStub } from '../bin/lib/llm-text-stubs.js';
import { buildPromptRequest } from '../bin/lib/prompt-request.js';

type Case = readonly [name: string, md: string, expected: ReadonlyArray<readonly [form: string, line: number, text: string]>];

const POSITIVE: readonly Case[] = [
  // Author-date prose (V4's in-text half).
  ['APA two authors', 'Trees cool cities (Nguyen & Patel, 2019).', [['author-date', 1, '(Nguyen & Patel, 2019)']]],
  ['et al. with a locator', 'Trees cool cities (Smith et al., 2019, p. 4).', [['author-date', 1, '(Smith et al., 2019, p. 4)']]],
  ['Harvard pair', 'Trees cool cities (Smith 2020; Lee 2021).', [['author-date', 1, '(Smith 2020; Lee 2021)']]],
  ['corporate author', 'Heat kills (World Health Organization, 2020).', [['author-date', 1, '(World Health Organization, 2020)']]],
  ['corporate with abbreviation', 'Heat kills (World Health Organization [WHO], 2020).', [['author-date', 1, '(World Health Organization [WHO], 2020)']]],
  ['prefixes', 'Trees help (see also Smith, 2019; e.g., Lee, 2020).', [['author-date', 1, '(see also Smith, 2019; e.g., Lee, 2020)']]],
  ['particles and diacritics', 'Heat (van der Berg, 2011) and (García-López & O\'Neil, 2018a).', [['author-date', 1, '(van der Berg, 2011)'], ['author-date', 1, "(García-López & O'Neil, 2018a)"]]],
  ['n.d. and in press', 'One (Smith, n.d.) and two (Lee, in press).', [['author-date', 1, '(Smith, n.d.)'], ['author-date', 1, '(Lee, in press)']]],
  ['MLA with two names', 'As argued (Smith and Jones 45).', [['author-date', 1, '(Smith and Jones 45)']]],
  ['bracketed author-date', 'Trees help [Smith 2019].', [['author-date', 1, '[Smith 2019]']]],
  ['narrative pair', 'Nguyen and Patel (2019) found that trees help.', [['author-date', 1, 'Nguyen and Patel (2019)']]],
  ['narrative et al.', 'Heat rose.\nSmith et al. (2019, p. 4) measured it.', [['author-date', 2, 'Smith et al. (2019, p. 4)']]],
  ['narrative possessive', "Smith et al.'s (2019) study was small.", [['author-date', 1, "Smith et al.'s (2019)"]]],
  // Footnotes and inline notes (V7).
  [
    'footnote reference and definition',
    'Trees cool cities.[^1]\n\n[^1]: Nguyen, T. (2019). Street trees. Journal of Urban Trees, 4, 1-9.',
    [['footnote', 1, '[^1]'], ['footnote', 3, '[^1]: Nguyen, T. (2019). Street trees. Journal of Urban Trees, 4, 1-9.']],
  ],
  ['inline note', 'Trees cool cities.^[Nguyen & Patel 2019, see [x]]', [['inline-note', 1, '^[Nguyen & Patel 2019, see [x]]']]],
  // Reference lists (V4's list half).
  [
    'ATX reference list with a DOI-less entry',
    'Trees cool cities (Nguyen & Patel, 2019).\n\n### References\n\nNguyen, T., & Patel, R. (2019). Shade and heat. Urban Climate, 12, 44-51.\n\n- Lee, K. (2021). Canopy.\n- Park, J. (2019). Heat.\n\n## Next section\n\nNothing cited here.',
    [
      ['author-date', 1, '(Nguyen & Patel, 2019)'],
      ['reference-list', 3, '### References'],
      ['reference-list', 5, 'Nguyen, T., & Patel, R. (2019). Shade and heat. Urban Climate, 12, 44-51.'],
      ['reference-list', 7, '- Lee, K. (2021). Canopy.'],
      ['reference-list', 8, '- Park, J. (2019). Heat.'],
    ],
  ],
  ['bold bibliography', 'Body.\n\n**Bibliography**\n\n1. Smith, J. (2019). X.\n2. Jones, K. (2020). Y.', [['reference-list', 3, '**Bibliography**'], ['reference-list', 5, '1. Smith, J. (2019). X.'], ['reference-list', 6, '2. Jones, K. (2020). Y.']]],
  ['setext works cited', 'Body.\n\nWorks Cited\n-----------\n\nSmith, J. Trees. 2019.', [['reference-list', 3, 'Works Cited'], ['reference-list', 6, 'Smith, J. Trees. 2019.']]],
  ['numbered notes heading', 'Body.\n\n## 4. Notes\n\nA note about a source.', [['reference-list', 3, '## 4. Notes'], ['reference-list', 5, 'A note about a source.']]],
  ['a lone label line', 'Body.\n\nSources:\n\n- a\n- b', [['reference-list', 3, 'Sources:'], ['reference-list', 5, '- a'], ['reference-list', 6, '- b']]],
  // Raw TeX (V6).
  ['\\cite', 'Trees cool cities \\cite{fake2019}.', [['tex-cite', 1, '\\cite{fake2019}']]],
  ['starred, optioned natbib', 'Trees \\citep*[p.~4]{a,b} and \\citet{c}.', [['tex-cite', 1, '\\citep*[p.~4]{a,b}'], ['tex-cite', 1, '\\citet{c}']]],
  ['biblatex family', '\\parencite[see][12]{a}, \\textcite{b}, \\footcite{c}, \\autocite{d}, \\nocite{e}.', [
    ['tex-cite', 1, '\\parencite[see][12]{a}'], ['tex-cite', 1, '\\textcite{b}'], ['tex-cite', 1, '\\footcite{c}'], ['tex-cite', 1, '\\autocite{d}'], ['tex-cite', 1, '\\nocite{e}'],
  ]],
  ['a TeX bibliography', 'Body.\n\\bibliography{refs}', [['tex-cite', 2, '\\bibliography{refs}']]],
  // HTML.
  ['<cite>', '<cite>Nguyen 2019</cite> says so.', [['html-cite', 1, '<cite>Nguyen 2019</cite>']]],
  ['<sup> markers', 'Trees help.<sup>1</sup> Shade helps<sup>[2]</sup> and<sup><a href="#r3">3</a></sup>.', [
    ['html-cite', 1, '<sup>1</sup>'], ['html-cite', 1, '<sup>[2]</sup>'], ['html-cite', 1, '<sup><a href="#r3">3</a></sup>'],
  ]],
  // Numbered and superscript markers.
  ['numbered markers', 'Trees help [1]. Shade helps [2, 3] and [4–6, p. 12].', [['numeric-marker', 1, '[1]'], ['numeric-marker', 1, '[2, 3]'], ['numeric-marker', 1, '[4–6, p. 12]']]],
  ['superscript markers', 'Trees help.¹ Studies²,³ agree.^4^', [['superscript-marker', 1, '¹'], ['superscript-marker', 1, '²,³'], ['superscript-marker', 1, '^4^']]],
];

const NEGATIVE: ReadonlyArray<readonly [string, string]> = [
  ['a lone name before a year', 'The Treaty of Versailles (1919) ended the war.'],
  ['a statistic', 'The sample (n = 2019) was large.'],
  ['an acronym with a number', 'During the pandemic (COVID-19) people walked more.'],
  ['a year range', 'The war (World War II, 1939–1945) ended.'],
  ['dates and structural words', '(March 2020), (Since 2019), (Figure 3), (Table 1, 2019), (Study 2, 2019), (p < .05), (1919).'],
  ['an email address', 'Write to jane.doe@example.org for the data.'],
  ['math', 'The interval $[1]$ and $x_{[2]}$ and $$[3] (Smith, 2019)$$ are closed.'],
  ['a fenced code block', '```\n\\cite{fake2019} (Smith, 2019) [1] <cite>x</cite> [^1]\n```\n\nPlain text follows.'],
  ['exponents', 'An area of 10 m<sup>2</sup>, x<sup>2</sup>, 10 m² and E = mc^2^.'],
  ['links, arrays and definitions', 'See x[1], [text][1], [1](http://example.org) and ![a figure](f.png).\n\n[1]: http://example.org'],
  ['Pandoc citations', 'Trees cool cities [@nguyen2019; @patel2019, p. 4]. As @smith2020 argues, shade helps [-@lee2021].'],
  ['headings that are not reference lists', '## Notes on method\n\nText.\n\n## Background\n\nMore text.'],
  ['a parenthetical aside', 'Paris (France) is large, and the result (a small one) held.'],
];

function crlf(s: string): string {
  return s.replace(/\r?\n/g, '\r\n');
}

const found = (md: string): Array<[string, number, string]> => findUnsupportedForms(md).map((f) => [f.form, f.line, f.text]);

for (const [name, md, expected] of POSITIVE) {
  test(`VRFY-10: ${name} is UNSUPPORTED-FORM (LF and CRLF)`, () => {
    assert.deepEqual(found(md), expected.map((e) => [...e]), 'LF');
    assert.deepEqual(found(crlf(md)), expected.map((e) => [...e]), 'CRLF twin');
    for (const f of findUnsupportedForms(md)) {
      assert.equal(f.verdict, 'UNSUPPORTED-FORM');
      assert.equal(f.reason, UNSUPPORTED_FORM_REASONS[f.form as keyof typeof UNSUPPORTED_FORM_REASONS]);
      assert.match(f.reason, /\[@citekey\]/, 'the reason says what to write instead');
    }
  });
}

test('VRFY-10: the negative corpus (LF and CRLF) yields nothing', () => {
  for (const [name, md] of NEGATIVE) {
    assert.deepEqual(found(md), [], name);
    assert.deepEqual(found(crlf(md)), [], `${name} (CRLF)`);
  }
});

test('VRFY-10: the audit\'s V4 / V6 / V7 draft is refused on every form, and every form has a reason', () => {
  const draft = [
    '## Background',
    '',
    'Street trees cool cities (Nguyen & Patel, 2019). Shade also lowers asthma rates \\cite{fake2019}.',
    'Canopy loss is accelerating.[^1] <cite>Nguyen 2019</cite> agrees.^[Nguyen & Patel 2019]',
    '',
    '[^1]: Fakeson, A. (2019). A study that does not exist. Journal of Nothing.',
    '',
    '### References',
    '',
    'Nguyen, T., & Patel, R. (2019). Shade and heat. Urban Climate, 12, 44-51.',
  ].join('\n');
  assert.deepEqual([...new Set(findUnsupportedForms(draft).map((f) => f.form))].sort(), ['author-date', 'footnote', 'html-cite', 'inline-note', 'reference-list', 'tex-cite']);
  for (const form of UNSUPPORTED_FORMS) assert.ok(UNSUPPORTED_FORM_REASONS[form].length > 20, form);
});

test('VRFY-10: a clean draft — the stub drafter\'s prose with Pandoc citations — gets no UNSUPPORTED-FORM row', () => {
  const req = buildPromptRequest('section-drafter', {
    brief: { topic: 'urban street trees and heat', discipline: 'environmental science' },
    section: { n: 2, slug: 'background', title: 'Background', word_target: 400 },
    voice: 'plain',
    plan: 'Explain the cooling effect.',
    sources: [{ citekey: 'nguyen2019' }, { citekey: 'patel2020' }, { citekey: 'lee2021' }],
  });
  const draft = textStub('section-drafter', req.messages);
  assert.match(draft, /\[@nguyen2019\]/);
  assert.deepEqual(found(draft), []);
});

test('VRFY-10: only code the grammar proves is code is skipped; an inline code span next to a backslash is scanned (fail closed)', () => {
  assert.deepEqual(found('Use `x[1]` to index.'), [], 'a provable inline code span');
  assert.deepEqual(found('Use `\\cite{x}` to cite.').map((f) => f[0]), ['tex-cite'], 'an escape in the paragraph voids the inline-code proof');
});
