// tests/markup.test.ts — plain text from registrar markup (Phase 19 review
// round 2; SRC-05, SRC-12; bin/lib/markup.ts): Crossref / OpenAlex / PubMed
// titles and venues carry inline JATS / HTML and XML entities, book
// descriptions and OpenAlex abstracts carry HTML, and arXiv titles and
// abstracts carry the submitter's TeX. None of it may reach LIBRARY.json, the
// bib or the exported reference list as markup.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainText, plainTextOpt, decodeEntities, texToText } from '../bin/lib/markup.js';
import { googleBooksToCandidate } from '../bin/lib/sources/books.js';
import { openAlexToCandidate } from '../bin/lib/sources/openalex.js';
import * as arxiv from '../bin/lib/sources/arxiv.js';
import { renderBibtex } from '../bin/lib/bibtex-write.js';
import { liveLane } from './sources/three-way.js';

test('plainText: inline JATS / HTML / MathML out, entities decoded (double-encoded too), a bare < or > kept', () => {
  assert.equal(plainText('The Genome Sequence of\n   <i>Drosophila melanogaster</i>'), 'The Genome Sequence of Drosophila melanogaster');
  assert.equal(plainText('Journal of the American Academy of Child &amp; Adolescent Psychiatry'), 'Journal of the American Academy of Child & Adolescent Psychiatry');
  assert.equal(plainText('CO<sub>2</sub> and H<sub>2</sub>O at 10<sup>6</sup> K'), 'CO2 and H2O at 106 K');
  assert.equal(plainText('<jats:italic>E. coli</jats:italic> &amp;amp; <scp>dna</scp>'), 'E. coli & dna');
  assert.equal(plainText('Line one<br>line two<br/>three'), 'Line one line two three');
  assert.equal(plainText('x < y and z > w'), 'x < y and z > w', 'not markup');
  assert.equal(plainText('&#x2013; &#8212; &unknown;'), '– — &unknown;');
  assert.equal(decodeEntities('&lt;i&gt;'), '<i>', 'decoded once');
  assert.equal(plainTextOpt('   '), undefined);
});

test('texToText: arXiv TeX accents, grouping braces, inline math, escapes and \\cite become text', () => {
  assert.equal(texToText("Contribution of Herv{\\'e} Suaudeau"), 'Contribution of Hervé Suaudeau');
  assert.equal(texToText('Contribution of Herv{é} Suaudeau'), 'Contribution of Hervé Suaudeau', 'already converted, still braced');
  assert.equal(texToText("Orl\\'{e}ans, G\\\"odel, \\c{C}a\\u{g}lar, \\ss"), 'Orléans, Gödel, Çağlar, ß');
  assert.equal(texToText('On $C^*$-algebras and $\\alpha$-stable laws'), 'On C^*-algebras and α-stable laws');
  assert.equal(texToText('50\\% of \\emph{all} cases, see \\cite{smith2020}.'), '50% of all cases, see .');
  assert.equal(texToText('A {GPU} model for {BERT}'), 'A GPU model for BERT');
});

test('books: a Google Books description is text — no <br>, <a href>, <i>', () => {
  const c = googleBooksToCandidate(
    {
      volumeInfo: {
        title: 'Research <i>Sharing</i> Strategy',
        authors: ['Ann Author'],
        publishedDate: '2019',
        description: 'First paragraph.<br> <br> See <a href="https://papers.ssrn.com/x" rel="nofollow"><i>Research Sharing Strategy Guide</i></a> &amp; more.',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780226458083' }],
      },
    },
    '9780226458083',
  );
  assert.ok(c);
  assert.equal(c!.title, 'Research Sharing Strategy');
  assert.equal(c!.abstract, 'First paragraph. See Research Sharing Strategy Guide & more.');
});

test('OpenAlex: markup in the title, the venue and the rebuilt abstract is text', () => {
  const c = openAlexToCandidate({
    id: 'https://openalex.org/W1',
    doi: 'https://doi.org/10.5555/oa-markup',
    title: 'Evolution of <i>Drosophila</i> genomes',
    publication_year: 2020,
    authorships: [{ author: { display_name: 'Ann Author' } }],
    primary_location: { source: { display_name: 'Child &amp; Adolescent Psychiatry' } },
    abstract_inverted_index: { 'We': [0], '<i>test</i>': [1], 'this.<br>': [2], 'Done.': [3] },
  } as Parameters<typeof openAlexToCandidate>[0]);
  assert.ok(c);
  assert.equal(c!.title, 'Evolution of Drosophila genomes');
  assert.equal(c!.venue, 'Child & Adolescent Psychiatry');
  assert.equal(c!.abstract, 'We test this. Done.');
});

test('arXiv (live-lane shape): a TeX title, an accented author and math in the abstract reach the bib as text, never \\textbraceleft{}', async () => {
  const feed = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '<entry>',
    '<id>http://arxiv.org/abs/1901.07308v1</id>',
    '<published>2019-01-21T10:00:00Z</published>',
    "<title>Contribution of Herv{\\'e} Suaudeau to $C^*$-algebra lexicography</title>",
    '<summary>We show that $\\alpha$-stable laws hold in 50\\% of cases \\cite{x}.</summary>',
    "<author><name>Herv{\\'e} Suaudeau</name></author>",
    '<arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">TALN 2017, Orl{\\\'e}ans, France</arxiv:journal_ref>',
    '</entry>',
    '</feed>',
  ].join('\n');
  await liveLane(async (agent) => {
    agent
      .get('https://export.arxiv.org')
      .intercept({ path: (p: string) => p.startsWith('/api/query?id_list=1901.07308'), method: 'GET' })
      .reply(200, feed, { headers: { 'content-type': 'application/atom+xml' } });
    const r = await arxiv.lookupById('1901.07308');
    assert.equal(r.kind, 'found');
    if (r.kind !== 'found') return;
    assert.equal(r.candidate.title, 'Contribution of Hervé Suaudeau to C^*-algebra lexicography');
    assert.equal(r.candidate.abstract, 'We show that α-stable laws hold in 50% of cases .');
    assert.equal(r.candidate.authors.length, 1);
    assert.match(r.candidate.authors[0]!.normalize('NFC'), /Hervé/);
    assert.doesNotMatch(r.candidate.authors[0]!, /[{}\\]/, 'no TeX left in the name');
    const bib = renderBibtex([{ ...r.candidate, citekey: 'suaudeau2019' }] as Parameters<typeof renderBibtex>[0]);
    assert.doesNotMatch(bib, /\\textbraceleft|\\textdollar|\\textbackslash/);
    assert.match(bib, /Hervé/);
  });
});

test('review round 3: an entity or TeX command named like an Object.prototype member stays text — never a JavaScript function\'s source', async () => {
  assert.equal(plainText('Rates &constructor; &toString; &valueOf; of change'), 'Rates &constructor; &toString; &valueOf; of change');
  assert.equal(decodeEntities('&hasOwnProperty; &amp;'), '&hasOwnProperty; &');
  assert.equal(texToText('On $\\constructor$ and \\toString spaces'), 'On constructor and toString spaces');
  assert.doesNotMatch(texToText('\\valueOf{x} $\\isPrototypeOf$'), /native code|function/);
  const { citationStyleKey } = await import('../bin/lib/schemas/config.js');
  assert.equal(citationStyleKey('constructor'), null);
  assert.equal(citationStyleKey('toString'), null);
  assert.equal(citationStyleKey('APA'), 'apa');
  const { crossrefCslType } = await import('../bin/lib/sources/crossref.js');
  assert.equal(crossrefCslType('constructor'), 'other');
  assert.equal(crossrefCslType('journal-article'), 'article-journal');
  const { lookupTable } = await import('../bin/lib/lookup-table.js');
  const t = lookupTable({ a: 1 });
  assert.equal(t['constructor'], undefined);
  assert.equal(t['__proto__'], undefined);
  assert.equal(t['a'], 1);
  assert.ok(Object.isFrozen(t));
});

test('review round 3: a double-encoded Crossref abstract (`&amp;#8217;`, `&lt;p dir="ltr"&gt;&lt;b&gt;`) becomes plain text; a real `<` survives', async () => {
  const { stripJats } = await import('../bin/lib/sources/crossref.js');
  // As Crossref serves 10.5194/epsc2020-257 (`Mercury&amp;#8217;s`) and the other shapes seen in a live research run.
  assert.equal(
    stripJats('<jats:p>Effects on Mercury&amp;#8217;s system and simulations&amp;#160;of the interaction; &amp;#8220;quoted&amp;#8221;.</jats:p>'),
    'Effects on Mercury’s system and simulations of the interaction; “quoted”.',
  );
  assert.equal(
    stripJats('<jats:p>&lt;p dir="ltr"&gt;&lt;b&gt;Introduction&lt;/b&gt;: Depression and anxiety are common.&lt;/p&gt;&lt;p dir="ltr"&gt;&lt;b&gt;Methods&lt;/b&gt;: We surveyed.&lt;/p&gt;</jats:p>'),
    'Introduction: Depression and anxiety are common. Methods: We surveyed.',
  );
  assert.equal(stripJats('<jats:p>We find |S 0 /C 3 | &amp;lt; 1 for x &lt; y and z &gt; w.</jats:p>'), 'We find |S 0 /C 3 | < 1 for x < y and z > w.');
  assert.equal(stripJats('<jats:title>Abstract</jats:title><jats:p>Plain <jats:italic>E. coli</jats:italic> text.</jats:p>'), 'Plain E. coli text.');
});
