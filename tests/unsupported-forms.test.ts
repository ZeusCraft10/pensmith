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
  // `$` is a citation-key character: a `$` in a key opens no TeX math, so the
  // text between two such keys is scanned (HARDEN-03, seed 699952924) — and
  // math that opens before a citation runs to its closing `$`, as in Pandoc.
  [
    'author-date between two keys holding `$`',
    '[see @k$x, pp. 1-4; also -@smith2020] (World Health Organization, 2020) -@k$x notes @A argues',
    [['author-date', 1, '(World Health Organization, 2020)']],
  ],
  ['author-date after math that swallows a key', 'Let $a [@k$x] (Smith, 2020) hold.', [['author-date', 1, '(Smith, 2020)']]],
  ['prefixes', 'Trees help (see also Smith, 2019; e.g., Lee, 2020).', [['author-date', 1, '(see also Smith, 2019; e.g., Lee, 2020)']]],
  ['particles and diacritics', 'Heat (van der Berg, 2011) and (García-López & O\'Neil, 2018a).', [['author-date', 1, '(van der Berg, 2011)'], ['author-date', 1, "(García-López & O'Neil, 2018a)"]]],
  ['n.d. and in press', 'One (Smith, n.d.) and two (Lee, in press).', [['author-date', 1, '(Smith, n.d.)'], ['author-date', 1, '(Lee, in press)']]],
  ['MLA with two names', 'As argued (Smith and Jones 45).', [['author-date', 1, '(Smith and Jones 45)']]],
  ['MLA author-page', 'Street trees lower asthma rates (Nguyen 45) and heat (van der Berg 12).', [['author-date', 1, '(Nguyen 45)'], ['author-date', 1, '(van der Berg 12)']]],
  ['MLA / Chicago with a title', 'Shade helps (Nguyen, *Street Trees*, 2019) and cools (see Nguyen, "Shade" 12).', [['author-date', 1, '(Nguyen, *Street Trees*, 2019)'], ['author-date', 1, '(see Nguyen, "Shade" 12)']]],
  ['APA personal communication', 'Trees help (T. Nguyen, personal communication, May 3, 2019).', [['author-date', 1, '(T. Nguyen, personal communication, May 3, 2019)']]],
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
  // Any heading made of reference-list words, when an entry under it has an entry's shape.
  ...['References Cited', 'References and Notes', 'Selected References', 'Reference', 'Literature', 'Sources Consulted', 'Key Sources', 'Source list'].map(
    (h): Case => [
      `a "${h}" heading`,
      `Body [@k].\n\n## ${h}\n\nNguyen, T., & Patel, R. (2019). Street trees and urban asthma. Journal of Urban Climate, 12(3), 45–67.`,
      [['reference-list', 3, `## ${h}`], ['reference-list', 5, 'Nguyen, T., & Patel, R. (2019). Street trees and urban asthma. Journal of Urban Climate, 12(3), 45–67.']],
    ],
  ),
  // Typed reference entries with no heading: APA, MLA, Chicago, Vancouver.
  [
    'heading-less entries',
    'Body [@k].\n\nNguyen, T., & Patel, R. (2019). Street trees. Urban Climate, 12, 45–67.\n\n- Lee, K. (2021). Canopy. Nature, 1, 2.\n\n' +
      'Nguyen, Thanh. "Street Trees and Asthma." Journal of Urban Climate, vol. 12, 2019, pp. 45–67.\n\nNguyen, Thanh, and Raj Patel. *Street Trees*. Urban Press, 2019.\n\n' +
      'Nguyen, Thanh. 2019. "Street Trees." Journal of Urban Climate 12 (3): 45–67.\n\n1. Nguyen T, Patel R. Street trees and asthma. J Urban Clim. 2019;12(3):45-67.',
    [
      ['reference-list', 3, 'Nguyen, T., & Patel, R. (2019). Street trees. Urban Climate, 12, 45–67.'],
      ['reference-list', 5, '- Lee, K. (2021). Canopy. Nature, 1, 2.'],
      ['reference-list', 7, 'Nguyen, Thanh. "Street Trees and Asthma." Journal of Urban Climate, vol. 12, 2019, pp. 45–67.'],
      ['reference-list', 9, 'Nguyen, Thanh, and Raj Patel. *Street Trees*. Urban Press, 2019.'],
      ['reference-list', 11, 'Nguyen, Thanh. 2019. "Street Trees." Journal of Urban Climate 12 (3): 45–67.'],
      ['reference-list', 13, '1. Nguyen T, Patel R. Street trees and asthma. J Urban Clim. 2019;12(3):45-67.'],
    ],
  ],
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
  // A citing verb before the preposition keeps a group a marker; a plain claim keeps one too.
  ['numbered markers after a citing phrase', 'As described in [1, 5], and according to [2, 3], trees help. As reported in [1] and later [2].', [
    ['numeric-marker', 1, '[1, 5]'], ['numeric-marker', 1, '[2, 3]'], ['numeric-marker', 1, '[1]'], ['numeric-marker', 1, '[2]'],
  ]],
  ['superscript markers', 'Trees help.¹ Studies²,³ agree.^4^', [['superscript-marker', 1, '¹'], ['superscript-marker', 1, '²,³'], ['superscript-marker', 1, '^4^']]],
  // A metadata block (its `references` take priority over CITATIONS.bib) and raw output (copied into the export unread).
  [
    'a metadata block redefining a key',
    'Deep learning helps [@lecun2015].\n\n---\nreferences:\n- id: lecun2015\n  title: "A totally fabricated title"\n...\n',
    [['metadata-block', 3, '---']],
  ],
  ['a leading metadata block', '---\ntitle: X\nnocite: "@*"\n---\n\nBody [@k].', [['metadata-block', 1, '---']]],
  [
    'raw blocks and spans',
    'Text [@k].\n\n```{=latex}\n\\section*{References}\nFakename, Z. (1999) \\cite{fake2019}.\n```\n\n~~~{=openxml}\n<w:p/>\n~~~\n\nInline `(Nguyen, 2019)`{=html} too.',
    [['raw-output', 3, '```{=latex}'], ['raw-output', 8, '~~~{=openxml}'], ['raw-output', 12, '`(Nguyen, 2019)`{=html}']],
  ],
  // Review round 2: raw TeX notes are footnotes; any other raw TeX environment is refused.
  [
    'raw TeX notes',
    'Deep networks learn [@lecun2015].\\footnote{Nobody, N. A study. Journal of Nothing 12, 2017.} And \\endnote{Nguyen 2019} and \\marginpar{x}.',
    [['footnote', 1, '\\footnote{Nobody, N. A study. Journal of Nothing 12, 2017.}'], ['footnote', 1, '\\endnote{Nguyen 2019}'], ['footnote', 1, '\\marginpar{x}']],
  ],
  ['a raw TeX environment', 'Text [@k].\n\n\\begin{quote}\nNguyen said so.\n\\end{quote}', [['raw-tex', 3, '\\begin{quote}']]],
  // What the reader sees: emphasis, entities and escapes do not hide a citation.
  [
    'emphasis, entities and escapes',
    'Sleep (*Nobody*, 2017) and (Smith&nbsp;et&nbsp;al., 2019) and attention \\[3\\] and \\[Smith, 2019\\].',
    [['author-date', 1, '(*Nobody*, 2017)'], ['author-date', 1, '(Smith&nbsp;et&nbsp;al., 2019)'], ['numeric-marker', 1, '\\[3\\]'], ['author-date', 1, '\\[Smith, 2019\\]']],
  ],
  [
    'author-date in a link or an HTML element',
    '(see [Nguyen & Patel, 2019](https://example.org/trees)) and [Nguyen et al., 2019](https://example.org) and <span class="citation">Nguyen 2019</span>.',
    [
      ['author-date', 1, '(see [Nguyen & Patel, 2019](https://example.org/trees))'],
      ['author-date', 1, '[Nguyen et al., 2019](https://example.org)'],
      ['author-date', 1, '<span class="citation">Nguyen 2019</span>'],
    ],
  ],
  [
    'run-in labels',
    '**References:** Nguyen, T., & Patel, R. (2019). Street trees. Urban Climate, 3(2), 1-10.\n\nTrees help (Source: Okafor 2021).\n\nSources: World Bank (2020); IMF (2021).',
    [
      ['reference-list', 1, '**References:** Nguyen, T., & Patel, R. (2019). Street trees. Urban Climate, 3(2), 1-10.'],
      ['author-date', 3, '(Source: Okafor 2021)'],
      ['reference-list', 5, 'Sources: World Bank (2020); IMF (2021).'],
    ],
  ],
  [
    'typed entries in a fenced div, an HTML block, a block quote and a table',
    '::: {.references}\nNguyen, T. (2019). Street trees. Urban Climate, 3, 1-10.\n:::\n\n<p>Lee, K. (2021). Canopy. Nature, 1, 2.</p>\n\n> Park, J. (2019). Heat. Urban Climate, 2, 3-4.\n\n' +
      '| n | entry |\n|---|---|\n| 1 | Kim, S. (2018). Shade. Urban Climate, 1, 5-6. |',
    [
      ['reference-list', 2, 'Nguyen, T. (2019). Street trees. Urban Climate, 3, 1-10.'],
      ['reference-list', 5, '<p>Lee, K. (2021). Canopy. Nature, 1, 2.'],
      ['reference-list', 7, '> Park, J. (2019). Heat. Urban Climate, 2, 3-4.'],
      ['reference-list', 11, '| 1 | Kim, S. (2018). Shade. Urban Climate, 1, 5-6. |'],
    ],
  ],
  // A single author before a year that the prose cites (D-20-08, narrowed in review round 2).
  [
    'single-author narrative citations',
    "Nguyen (2019) argued it. According to Lee (2020), it rose. Park's (2018) review agrees. Kim and colleagues (2017) found it. Diaz (2016, p. 5) wrote it. Cho (2015a) agrees.",
    [
      ['author-date', 1, 'Nguyen (2019)'],
      ['author-date', 1, 'Lee (2020)'],
      ['author-date', 1, "Park's (2018)"],
      ['author-date', 1, 'Kim and colleagues (2017)'],
      ['author-date', 1, 'Diaz (2016, p. 5)'],
      ['author-date', 1, 'Cho (2015a)'],
    ],
  ],
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
  ['reference-list words with prose under them', '## Literature Review\n\nThe literature on street trees is broad [@k].\n\n## Literature\n\nMost studies measure heat [@k].\n\n## Sources of Error\n\nSampling was uneven.'],
  ['a place name before a year', 'Washington, D.C. (2019) hosted the summit, and Paris, France is large.'],
  ['prose that opens like a Vancouver entry', 'World War II. It was long. Many died. 1945 ended it [@k].'],
  ['a rule, a table and code with braces', 'Para.\n\n---\n\nNext part.\n\n---\nSome text\n---\n\n```python\nx = {"a": 1}\n```\n\nDone [@k].'],
  ['numbered labels', 'See (Figure 3), (Level 2), (Apollo 11), (Python 3), (World War 2), (COVID 19), (Windows 10), (Grade 5) and (Title 9).'],
  ['a parenthetical aside', 'Paris (France) is large, and the result (a small one) held.'],
  // Intervals, index lists and shapes are not numbered markers (a citation number is never 0, never descends).
  ['intervals', 'Scores are normalized to the interval [0, 1] [@k]. Probabilities lie in [0,1]. Values lie in [1, 5]; ages in the range [18, 65] were eligible.'],
  ['shapes and indices', 'The input tensor has shape [32, 224, 224, 3] [@k], embeddings have shape [32, 128], and array indices [1] and [2] refer to rows.'],
  ['relations and operators', 'We map x ∈ [2, 7], set w = [1, 3], and cover the square [1, 5] × [1, 5]. Weights are scaled to [1, 10].'],
  // Review round 2: a lone name before a year the prose does not cite, a note label over prose, links and emphasis.
  ['a lone name the prose does not cite', 'The Treaty of Versailles (1919) established peace, and Washington, D.C. (2019) was the host.'],
  ['a note label over prose', 'Notes: values are means of three runs.'],
  ['links and emphasis that attribute nothing', 'We used [Python 3](https://python.org), see the [methods](#methods) section, and a *large* effect (n = 12) held.'],
  ['math with a TeX environment', 'The system $$\\begin{aligned}a &= b\\end{aligned}$$ holds.'],
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
  assert.deepEqual(found('Footnotes in code: `[^1]` are not notes [@k].'), [], 'a construct inside the code span is its literal text');
  assert.deepEqual(found('Footnotes in code: `[^1]` and a note^[x] outside.').map((f) => f[0]), ['footnote', 'inline-note'], 'a note outside the span voids the proof (fail closed)');
  assert.deepEqual(found('Use `\\cite{x}` to cite.').map((f) => f[0]), ['tex-cite'], 'an escape in the paragraph voids the inline-code proof');
});
