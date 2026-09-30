// tests/quote-extractor.test.ts — VRFY-18 (D-20-17): every direct quote of a
// draft, with its id, line, locator and one entry per cited key; a quote no
// citation claims is UNATTRIBUTED (citekey null). Scare quotes, titles, link
// titles and provable code are not quotes. Every case runs as LF and as CRLF.
// The ground-truth fuzz (Phase 19 review round 2, kept for the rewrite) checks
// 30,000 generated drafts: every quote extracted with exactly its keys, and no
// text that is not a quote.

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractQuotes, DEFAULT_QUOTE_MIN_WORDS, type ExtractedQuote } from '../bin/lib/quote-extractor.js';
import { quoteId } from '../bin/lib/verify/verdicts.js';

const Q = 'the dominant sequence transduction models are based on complex recurrent networks';

/** extractQuotes of `md` as LF and as CRLF — the two must agree (the CRLF twin of every case). */
function both(md: string, opts: { minWords?: number } = {}): ExtractedQuote[] {
  const lf = extractQuotes(md, opts);
  const crlf = extractQuotes(md.replace(/\r?\n/g, '\r\n'), opts);
  assert.deepEqual(crlf, lf, `CRLF twin differs for ${JSON.stringify(md.slice(0, 80))}`);
  return lf;
}

const keys = (md: string, opts: { minWords?: number } = {}): Array<string | null> => both(md, opts).map((q) => q.citekey);

test('VRFY-18: the acceptance list — each form yields its entries (keys, locators, text)', () => {
  const six = 'one two three four five six';
  assert.deepEqual(both(`A six-word quote: "${six}" [@k].`), [{ id: 'q1', text: six, citekey: 'k', kind: 'inline', line: 1 }]);
  const cases: Array<[string, Array<[string, string | undefined]>]> = [
    [`As noted, "${Q}" [@k, p. 3].`, [['k', 'p. 3']]],
    [`As noted, "${Q}" [@k p. 3].`, [['k', 'p. 3']]],
    [`As noted, "${Q}" [@Vaswani2017].`, [['Vaswani2017', undefined]]],
    [`As noted, "${Q}" [@a; @b].`, [['a', undefined], ['b', undefined]]],
    [`As noted, "${Q}" [see @k].`, [['k', undefined]]],
    [`As noted, “${Q}” [@k, p. 3].`, [['k', 'p. 3']]],
    [`[@k] writes, "${Q}".`, [['k', undefined]]],
    [`@k notes that "${Q}".`, [['k', undefined]]],
    [`As @k [p. 12] wrote, “${Q}”.`, [['k', 'p. 12']]],
    [`> ${Q}\n> and it goes on [@k, p. 3]\n`, [['k', 'p. 3']]],
    [`> ${Q}\n\n[see @k, chap. 2; @j]\n`, [['k', 'chap. 2'], ['j', undefined]]],
    [`@k puts it this way:\n\n> ${Q}\n\nNext.\n`, [['k', undefined]]],
    [`"${Q}" [-@k].`, [['k', undefined]]],
    [`"${Q}" @k [p. 3].`, [['k', 'p. 3']]],
    [`‘${Q}’ [@k].`, [['k', undefined]]],
    // Straight single quotes, entity and escaped marks, block quotes in a list item or a definition.
    [`As noted, '${Q}' [@k, p. 3].`, [['k', 'p. 3']]],
    [`@k notes that '${Q}'.`, [['k', undefined]]],
    [`As noted, &ldquo;${Q}&rdquo; [@k].`, [['k', undefined]]],
    [`As noted, &#8216;${Q}&#8217; [@k].`, [['k', undefined]]],
    [`As noted, &quot;${Q}&quot; [@k].`, [['k', undefined]]],
    [`As noted, \\"${Q}\\" [@k].`, [['k', undefined]]],
    [`Intro.\n\n- > ${Q} [@k]\n`, [['k', undefined]]],
    [`Intro.\n\n1. > ${Q} [@k]\n`, [['k', undefined]]],
    [`Term\n:   > ${Q} [@k]\n`, [['k', undefined]]],
    [`- item\n\n    > ${Q} [@k]\n`, [['k', undefined]]],
  ];
  for (const [md, want] of cases) {
    const got = both(md);
    assert.deepEqual(got.map((q) => [q.citekey, q.locator]), want, md);
    assert.ok(got.every((q) => q.id === 'q1'), `one quote, one id: ${md}`);
    assert.ok(got.every((q) => q.text.startsWith('the dominant sequence transduction')), md);
  }
});

test('VRFY-18 (review round 3): a citation after a short reporting phrase attributes the quote — "…," wrote @k; "…," as LeCun argued [@k]; "…" (LeCun et al.) [@k]', () => {
  const q = 'Deep networks will soon replace every radiologist in hospitals';
  assert.deepEqual(both(`"${q}," wrote @lecun2015 [p. 3].`).map((x) => [x.citekey, x.locator ?? null]), [['lecun2015', 'p. 3']]);
  assert.deepEqual(keys(`"${q}," as LeCun argued [@lecun2015].`), ['lecun2015']);
  assert.deepEqual(keys(`"${q}" (LeCun et al.) [@lecun2015].`), ['lecun2015']);
  assert.deepEqual(keys(`"${q}," @lecun2015 argued.`), ['lecun2015']);
  // Not past a sentence end, another quote, or more than six words.
  assert.deepEqual(keys(`"${q}." Later work disagreed [@lee2019].`), [null]);
  assert.deepEqual(keys(`"${q}," and "a second quoted phrase of five words" [@lee2019].`), [null, 'lee2019']);
  assert.deepEqual(keys(`"${q}," said one reviewer in a long and winding aside about it [@lee2019].`), [null]);
});

test('VRFY-18 (review round 3): a leading byte-order mark is read as Pandoc reads it — a block quote or quote on line 1 is extracted', () => {
  const bq = '\uFEFF> Deep networks will soon replace every radiologist in all hospitals, and no human reader will be needed.\n\nLeCun and colleagues wrote this [@lecun2015].\n';
  assert.deepEqual(both(bq).map((x) => [x.id, x.citekey, x.line]), [['q1', null, 1]]);
  assert.deepEqual(both('\uFEFF"deep networks will soon replace every radiologist" [@lecun2015].\n').map((x) => [x.citekey, x.line]), [['lecun2015', 1]]);
});

test('VRFY-18: a quote no citation claims is one UNATTRIBUTED entry (citekey null)', () => {
  assert.deepEqual(both(`Critics say "${Q}" and move on.`), [{ id: 'q1', text: Q, citekey: null, kind: 'inline', line: 1 }]);
  // A citation in an EARLIER sentence does not claim the quote.
  assert.deepEqual(keys(`@k built it. Later work says "${Q}".`), [null]);
  assert.deepEqual(keys(`It works [@k]. Critics say "${Q}".`), [null]);
  // A citation in the same sentence before the quote does.
  assert.deepEqual(keys(`It works [@k], and as its authors put it, "${Q}".`), ['k']);
  // Abbreviations and initials are not sentence ends.
  assert.deepEqual(keys(`As @k (2019, p. 4) put it, "${Q}".`), ['k']);
  assert.deepEqual(keys(`As J. Smith and @k et al. wrote, "${Q}".`), ['k']);
  // A block quote with no citation after it, inside it, or in its lead-in.
  assert.deepEqual(keys(`Consider this.\n\n> ${Q}\n\nThen more prose follows.\n`), [null]);
});

test('VRFY-18: ids follow document order across inline and block quotes; lines are 1-based; a cluster shares its id', () => {
  const md = [`# Section`, '', `First, "${Q}" [@a; @b].`, '', `> ${Q}`, `> again [@c]`, '', `Last, “${Q} again” [@d].`, ''].join('\n');
  const got = both(md);
  assert.deepEqual(
    got.map((q) => [q.id, q.citekey, q.kind, q.line]),
    [
      ['q1', 'a', 'inline', 3],
      ['q1', 'b', 'inline', 3],
      ['q2', 'c', 'block', 5],
      ['q3', 'd', 'inline', 8],
    ],
  );
  assert.equal(quoteId(2), 'q3', 'verdicts.ts quoteId is the id scheme');
});

test('VRFY-18: [verification] quote_min_words — the default is 5; fewer words is a scare quote', () => {
  assert.equal(DEFAULT_QUOTE_MIN_WORDS, 5);
  assert.deepEqual(keys('He called it "a very odd idea" [@k].'), [], '4 words');
  assert.deepEqual(keys('He called it "a very odd idea" [@k].', { minWords: 4 }), ['k']);
  assert.deepEqual(keys('He called it "a very odd idea indeed" [@k].'), ['k'], '5 words');
  // Citations are not words.
  assert.deepEqual(keys('He called it "a very [@x] odd idea" [@k].'), []);
  assert.deepEqual(keys('The "so-called" effect and the “best” one.'), []);
});

test('VRFY-18: a quoted title is not a quote — Title Case (≤ 12 words, no sentence end) right after a title cue, or with no citation right after it', () => {
  assert.deepEqual(keys('She read the paper titled "Attention Is All You Need In The End" [@k].'), []);
  assert.deepEqual(keys('In the book "War and Peace and Other Long Stories" [@k] the plot turns.'), []);
  for (const intro of ['entitled', 'the article', 'the paper', 'the report']) {
    assert.deepEqual(keys(`It appeared in ${intro} "Some Words That Make a Title" [@k].`), [], intro);
  }
  // Review round 3: a title cue is a title only right before the mark and with a title's shape —
  // a sentence after it, or a comma or colon between, is a quotation (fail toward extracting).
  assert.deepEqual(keys('She read the paper titled "attention is all you need in the end" [@k].'), ['k']);
  assert.deepEqual(keys('In the book "war and peace and other long stories" [@k] the plot turns.'), ['k']);
  for (const md of [
    'As stated in the paper, "deep networks have already replaced radiologists in most European hospitals since 2012" [@lecun2015].',
    'As the authors conclude in the study, "convolutional networks need no labelled data at all for any vision task" [@lecun2015].',
    'As LeCun et al. write in the paper, "deep networks replaced every radiologist in every hospital" [@lecun2015].',
    'In the report, "deep networks replaced every radiologist in every hospital" [@lecun2015].',
    'According to the journal, "deep networks replaced every radiologist in every hospital" [@lecun2015].',
    'LeCun et al. conclude in the paper: "deep networks replaced every radiologist in every hospital" [@lecun2015].',
    'In the paper, "Deep Networks Replaced Every Radiologist In Every Hospital" [@lecun2015].',
  ]) {
    assert.deepEqual(keys(md), ['lecun2015'], md);
  }
  // Title Case that a citation claims, or after a reporting verb or "In X's words", is checked.
  assert.deepEqual(keys('LeCun and colleagues predicted "Deep Networks Will Soon Replace Every Radiologist In Every Hospital" [@lecun2015].'), ['lecun2015']);
  assert.deepEqual(keys('In LeCun\'s words, "Deep Networks Will Soon Replace Every Radiologist" [@lecun2015].'), ['lecun2015']);
  assert.deepEqual(keys('Vaswani et al. titled their paper "Attention Is All You Need For Language" and it spread.'), [], 'Title Case no citation claims');
  // After `called` / `named` only what looks like a title is one (review round 2): a sentence of any length is a quote.
  for (const intro of ['called', 'named']) {
    assert.deepEqual(keys(`A policy ${intro} "Clean Air For All Our Children" [@k] passed.`), [], intro);
    assert.deepEqual(keys(`Smith ${intro} "for an immediate halt to all funding of the program until the review is complete" [@k].`), ['k'], intro);
  }
  // Title Case after a reporting colon or verb is a quotation, never a title.
  assert.deepEqual(keys('LeCun wrote: “Deep Networks Are Nothing More Than Lookup Tables For Bananas In Disguise” [@k].'), ['k']);
  assert.deepEqual(keys('The review states that "Attention Is All You Need For Everything" [@k].'), ['k']);
  assert.deepEqual(keys('As Smith put it, "Attention Is All You Need For Everything" [@k].'), ['k']);
  // A Title Case quote a citation follows is checked (a real title of the cited work passes against its own text).
  assert.deepEqual(keys('"Attention Is All You Need for Language Tasks" [@vaswani2017] changed things.'), ['vaswani2017']);
  assert.deepEqual(keys('"Deep Learning: A Review of the Field and Its Methods" [@k].'), ['k']);
  assert.deepEqual(keys('"Deep Learning: A Review of the Field and Its Methods" changed things.'), []);
  // Not a title: a sentence (it ends), lower-case words, or more than 12 words.
  assert.deepEqual(keys('"Attention Is All You Need. For Everything." [@k]'), ['k']);
  assert.deepEqual(keys('"Attention is all you need for most tasks" [@k]'), ['k']);
  assert.deepEqual(keys('"One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen" [@k]'), ['k']);
  // A Markdown link or image title is not a quote.
  assert.deepEqual(keys('See [the site](https://example.org "a link title of many words here") for more.'), []);
  assert.deepEqual(keys('![A figure](fig.png "the caption of the figure goes here")'), []);
});

test('VRFY-18: quotes in other languages\' quotation marks are quotes — guillemets, low-high marks, angle and corner brackets (and their entities)', () => {
  assert.deepEqual(keys('Le rapport affirme «que la politique a échoué dans toutes les régions étudiées» [@smith].'), ['smith']);
  // French typography: a space, a no-break space or a narrow no-break space inside the guillemets.
  assert.deepEqual(keys('Le rapport affirme « que la politique a échoué dans toutes les régions étudiées » [@smith].'), ['smith']);
  assert.deepEqual(keys('Le rapport affirme «\u00A0que la politique a échoué dans toutes les régions étudiées\u00A0» [@smith].'), ['smith']);
  assert.deepEqual(keys('Le rapport affirme «\u202Fque la politique a échoué dans toutes les régions étudiées\u202F» [@smith].'), ['smith']);
  assert.deepEqual(keys('Il écrit ‹ les données ne montrent aucun effet du traitement › [@smith].'), ['smith']);
  assert.deepEqual(
    extractQuotes('Le rapport affirme « que la politique a échoué dans toutes les régions » [@smith].').map((q) => q.text),
    ['que la politique a échoué dans toutes les régions'],
  );
  assert.deepEqual(keys('Der Bericht sagt „dass die Politik in allen Regionen gescheitert ist“ [@smith].'), ['smith']);
  assert.deepEqual(keys('Der Bericht sagt „dass die Politik in allen Regionen gescheitert ist” [@smith].'), ['smith']);
  assert.deepEqual(keys('Der Bericht sagt »dass die Politik in allen Regionen gescheitert ist« [@smith].'), ['smith']);
  assert.deepEqual(keys('Rapporten säger »att politiken har misslyckats i alla regioner» [@smith].'), ['smith']);
  assert.deepEqual(keys('They wrote ‹the data show no effect of the treatment› [@smith].'), ['smith']);
  assert.deepEqual(keys('Er schrieb ‚die Daten zeigen keinerlei Wirkung der Behandlung‘ [@smith].'), ['smith']);
  assert.deepEqual(keys('報告は「the policy failed in every region we studied」[@smith]。'), ['smith']);
  assert.deepEqual(keys('Entity &laquo;que la politique a échoué dans toutes les régions&raquo; [@smith].'), ['smith']);
  assert.deepEqual(keys('Entity &bdquo;dass die Politik in allen Regionen gescheitert ist&ldquo; [@smith].'), ['smith']);
  // The text is the words, without the marks; a closing “ opens no quote of its own.
  assert.deepEqual(extractQuotes('„dass die Politik in allen Regionen gescheitert ist“. Then more text follows here [@x].').map((q) => q.text), ['dass die Politik in allen Regionen gescheitert ist']);
  // Fewer than five words is a quoted term, whatever the marks.
  assert.deepEqual(keys('Le «mot juste» [@smith].'), []);
});

test('VRFY-18: quotes in provable code are skipped; code the grammar cannot prove is text (fail closed)', () => {
  assert.deepEqual(keys('Run `print("hello world this is a test")` to see it.'), []);
  assert.deepEqual(keys('Before.\n\n```\nx = "one two three four five six"\n```\n\nAfter.\n'), []);
  assert.deepEqual(keys('Before.\n\n~~~python\nx = "one two three four five six"\n~~~\n\nAfter.\n'), []);
  // The same quote outside the code span still counts.
  assert.deepEqual(keys('Run `f()`; critics say "one two three four five six" [@k].'), ['k']);
  // An unclosed fence proves nothing: the quote counts.
  assert.deepEqual(keys('Before.\n\n```\nx = "one two three four five six" [@k]\n'), ['k']);
  // Indented code is not proved (a list item may hold it): the quote counts.
  assert.deepEqual(keys('Before.\n\n    x = "one two three four five six"\n'), [null]);
  // A paragraph that holds a construct able to take a backtick: no proof.
  assert.deepEqual(keys('Math $x$ and `print("hello world this is a test")` here.'), [null]);
});

test('VRFY-18: an apostrophe never opens a straight single quote (it\'s, the authors\', \'90s, rock \'n\' roll)', () => {
  for (const md of [
    "It's the authors' view that data rarely lie about such things at all [@k].",
    "Since the 1980s, many of the country's largest teachers' unions grew stronger [@k].",
    "In the '90s, the teachers' unions grew stronger across the whole country [@k].",
    "Rock 'n' roll was loud and it was everywhere in the whole wide world [@k].",
  ]) {
    assert.deepEqual(both(md), [], md);
  }
  // An abbreviation is not a list marker: `Dr. > 5 mg` is prose, not a block quote.
  assert.deepEqual(both('Dr. > 5 mg was given to every single patient in the trial.\n'), []);
  // A plural possessive inside the quote never cuts it short.
  assert.deepEqual(both("He said 'the students' results were strong across every single cohort' [@k].").map((q) => q.text), [
    "the students' results were strong across every single cohort",
  ]);
});

test('VRFY-18: straight and typographic marks pair the way Pandoc pairs them', () => {
  const prose = 'in a long remark that goes on for quite a while without any quote marks at all';
  for (const lead of ['He called it "the best"', 'A 12" pipe was', 'He called it “the best”', 'The ‘best’ one was']) {
    assert.deepEqual(both(`${lead} ${prose} "${Q}" [@vaswani2017].`).map((q) => `${q.citekey}|${q.text}`), [`vaswani2017|${Q}`], lead);
    assert.deepEqual(
      both(`${lead} ${prose} “${Q}” [@luong2015; @vaswani2017].`).map((q) => `${q.citekey}|${q.text}`),
      [`luong2015|${Q}`, `vaswani2017|${Q}`],
      lead,
    );
  }
  // Apostrophes and a plural possessive never close a typographic single quote.
  assert.deepEqual(both('‘The students’ essays weren’t all copied from the internet’ [@k].').map((q) => q.text), [
    'The students’ essays weren’t all copied from the internet',
  ]);
  // A quote inside a quote is part of the outer one.
  assert.deepEqual(both(`"He said ‘one two three four five six’ and left the room" [@k].`).map((q) => [q.citekey, q.text]), [
    ['k', 'He said ‘one two three four five six’ and left the room'],
  ]);
  // A new “ inside an unclosed “ starts the quote again.
  assert.deepEqual(both(`“unclosed words. Then “${Q}” [@k].`).map((q) => [q.citekey, q.text]), [['k', Q]]);
  // A quote never spans a blank line.
  assert.deepEqual(keys(`He said "one two three\n\nfour five six seven" [@k].`), []);
});

test('VRFY-18: block quotes — one quote per > run, lazy lines, nested markers, a citation inside, after or before', () => {
  assert.deepEqual(both(`> ${Q}\n>\n> second paragraph of the same quote\n\n[@k]\n`).map((q) => q.text), [`${Q} second paragraph of the same quote`]);
  assert.deepEqual(both(`> ${Q}\nlazy continuation line\n\n[@k]\n`).map((q) => q.text), [`${Q} lazy continuation line`]);
  assert.deepEqual(both(`> > ${Q} [@k]\n`).map((q) => [q.citekey, q.text]), [['k', Q]]);
  assert.deepEqual(keys(`> ${Q}\n\n— @k\n`), ['k']);
  assert.deepEqual(keys(`> ${Q}\n\n-@vaswani2017 again.\n`), ['vaswani2017']);
  assert.deepEqual(keys(`As [@k] puts it:\n> ${Q}\n`), ['k']);
  // A citation standing alone after the block wins; then the lead-in; a citation
  // that opens the next sentence only when nothing else claims the block.
  assert.deepEqual(both(`As @a puts it:\n\n> ${Q}\n\n[@b, p. 3].\n`).map((q) => [q.citekey, q.locator]), [['b', 'p. 3']]);
  assert.deepEqual(keys(`As @a puts it:\n\n> ${Q}\n\n[@b] writes that more follows.\n`), ['a']);
  assert.deepEqual(keys(`Consider this.\n\n> ${Q}\n\n[@b] writes that more follows.\n`), ['b']);
  // Inline quotes inside a block quote belong to it.
  assert.deepEqual(both(`> He said "one two three four five six" and left [@k]\n`).map((q) => q.kind), ['block']);
  // Four spaces of indent is not a block quote.
  assert.deepEqual(keys(`    > ${Q}\n`), []);
});

test('VRFY-18: the quote text drops citations, emphasis and escapes, and collapses whitespace', () => {
  assert.deepEqual(both('"the *dominant* sequence\n   transduction \\"models\\" are here" [@k]').map((q) => q.text), [
    'the dominant sequence transduction "models" are here',
  ]);
  assert.deepEqual(both('"the dominant [@x] sequence transduction models are" [@k]').map((q) => q.text), ['the dominant sequence transduction models are']);
  assert.deepEqual(both('"the _dominant_ snake_case sequence transduction models" [@k]').map((q) => q.text), [
    'the dominant snake_case sequence transduction models',
  ]);
});

// ---------------------------------------------------------------------------
// The ground-truth fuzz.
// ---------------------------------------------------------------------------

/** A seeded PRNG (mulberry32): the fuzz is the same on every run and platform. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['model', 'data', 'attention', 'layer', 'result', 'network', 'signal', 'method', 'study', 'effect', 'value', 'system', 'claim', 'figure', 'sample'];

interface Expected {
  readonly text: string;
  readonly keys: Array<string | null>;
}

function draftOf(r: () => number): { md: string; expected: Expected[] } {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const words = (n: number): string => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const key = (): string => pick(['smith2020', 'lee2019', 'Vaswani2017', 'doe_2021', 'chen:2018']);
  const prose = (): string => `${pick(['We', 'They', 'Most', 'Some'])} ${words(3 + Math.floor(r() * 6))}.`;
  const quoteMarks = (): [string, string] =>
    pick([['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"], ['&ldquo;', '&rdquo;'], ['&#39;', '&#39;'], ['\\"', '\\"']] as Array<[string, string]>);
  const expected: Expected[] = [];
  const paragraphs: string[] = [];
  const blocks = 2 + Math.floor(r() * 5);
  for (let b = 0; b < blocks; b += 1) {
    const kind = r();
    if (kind < 0.15) {
      // A block quote, attributed after, inside, before, or not at all.
      const text = words(DEFAULT_QUOTE_MIN_WORDS + Math.floor(r() * 8));
      const k = key();
      const how = Math.floor(r() * 5);
      // (Paragraphs are joined by blank lines; `\n` here keeps a line in the same paragraph.)
      if (how === 4) paragraphs.push(`${pick(['- > ', '1. > ', 'Term\n:   > '])}${text} [@${k}]`);
      else if (how === 0) paragraphs.push(`> ${text}`, `[@${k}, p. ${1 + Math.floor(r() * 99)}]`);
      else if (how === 1) paragraphs.push(`> ${text.split(' ').slice(0, 3).join(' ')}\n> ${text.split(' ').slice(3).join(' ')} [@${k}]`);
      else if (how === 2) paragraphs.push(`As @${k} puts it:`, `> ${text}`);
      else paragraphs.push(`${prose()}`, `> ${text}\nlazy`, prose());
      expected.push({ text: how === 3 ? `${text} lazy` : text, keys: how === 3 ? [null] : [k] });
      continue;
    }
    if (kind < 0.22) {
      // Code the grammar proves: the quoted string inside it is not a quote.
      paragraphs.push(r() < 0.5 ? `Call \`f("${words(DEFAULT_QUOTE_MIN_WORDS + 1)}")\` to run it.` : `\`\`\`\nx = "${words(DEFAULT_QUOTE_MIN_WORDS + 2)}"\n\`\`\``);
      continue;
    }
    const sentences: string[] = [];
    const n = 1 + Math.floor(r() * 4);
    for (let s = 0; s < n; s += 1) {
      const t = r();
      const [o, c] = quoteMarks();
      if (t < 0.25) {
        sentences.push(prose());
      } else if (t < 0.4) {
        // A scare quote (too short), or an inch mark.
        sentences.push(r() < 0.3 ? `A 12" ${words(2)} fits.` : `It is ${o}${words(1 + Math.floor(r() * (DEFAULT_QUOTE_MIN_WORDS - 1)))}${c} here.`);
      } else if (t < 0.7) {
        const text = words(DEFAULT_QUOTE_MIN_WORDS + Math.floor(r() * 10));
        const a = key();
        let bKey = key();
        while (bKey === a) bKey = key();
        const form = Math.floor(r() * 8);
        const cite = [`[@${a}]`, `[@${a}, p. 4]`, `[@${a} p. 4]`, `[see @${a}]`, `[@${a}; @${bKey}]`, `[-@${a}]`, `@${a} [p. 7]`, `[@${a}, chap. 2]`][form] as string;
        sentences.push(`${pick(['Thus', 'Indeed', 'Here'])} ${o}${text}${c} ${cite}.`);
        expected.push({ text, keys: form === 4 ? [a, bKey] : [a] });
      } else if (t < 0.85) {
        const text = words(DEFAULT_QUOTE_MIN_WORDS + Math.floor(r() * 10));
        const a = key();
        const lead = pick([`As @${a} wrote, `, `[@${a}] writes that `, `@${a} [p. 2] notes, `, `As @${a} (2019, p. 4) put it, `]);
        sentences.push(`${lead}${o}${text}${c}.`);
        expected.push({ text, keys: [a] });
      } else {
        const text = words(DEFAULT_QUOTE_MIN_WORDS + Math.floor(r() * 10));
        sentences.push(`Critics say ${o}${text}${c} in passing.`);
        expected.push({ text, keys: [null] });
      }
    }
    paragraphs.push(sentences.join(' '));
  }
  return { md: `${paragraphs.join('\n\n')}\n`, expected };
}

test('VRFY-18: ground-truth fuzz — 30,000 generated drafts: every quote extracted with exactly its keys, nothing else', () => {
  const r = rng(0x5eed2020);
  let quotes = 0;
  for (let i = 0; i < 30_000; i += 1) {
    const { md, expected } = draftOf(r);
    const got = extractQuotes(md);
    // Group the entries by id (a cluster gives one entry per key).
    const byId = new Map<string, { text: string; keys: Array<string | null> }>();
    for (const q of got) {
      const e = byId.get(q.id) ?? { text: q.text, keys: [] };
      e.keys.push(q.citekey);
      byId.set(q.id, e);
    }
    const actual = [...byId.values()];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      assert.fail(`draft ${i}:\n${md}\nexpected ${JSON.stringify(expected)}\ngot      ${JSON.stringify(actual)}`);
    }
    if (i % 10 === 0) assert.deepEqual(extractQuotes(md.replace(/\n/g, '\r\n')), got, `CRLF twin of draft ${i}`);
    quotes += expected.length;
  }
  assert.ok(quotes > 50_000, `the fuzz exercised ${quotes} quotes`);
});
