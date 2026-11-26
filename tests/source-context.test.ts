// tests/source-context.test.ts — the works a prompt is shown, read from LIBRARY.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainAbstract, renderLibraryContext, sourceContext } from '../bin/lib/source-context.js';
import type { Library } from '../bin/lib/schemas/library.js';

const custom = { identities: [], retracted: false, provenance: [], added_at: '2026-11-01T00:00:00.000Z' };

const LIBRARY: Library = {
  $schemaVersion: 2,
  bibtex_preamble: [],
  entries: [
    {
      id: 'many2020', type: 'article-journal', title: 'Many Authors',
      author: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((f) => ({ family: f, given: 'X.' })),
      issued: { 'date-parts': [[2020]] }, 'container-title': 'J. Many',
      abstract: '<jats:p>Effects were significant (p < 0.05) for scores >10 and <i>in vivo</i>, with x<0.5.</jats:p>',
      custom,
    },
    { id: 'retracted2019', type: 'book', title: 'A Retracted Book', publisher: 'A Press', custom: { ...custom, retracted: true } },
  ],
};

test('an abstract loses its registry markup and keeps every comparison and number', () => {
  assert.equal(
    plainAbstract(LIBRARY.entries[0]!.abstract!, 2000),
    'Effects were significant (p < 0.05) for scores >10 and in vivo, with x<0.5.',
  );
  assert.equal(plainAbstract('one two three four', 7), 'one two…');
});

test('an inline tag leaves no space where it was; a paragraph or title tag leaves one; entities are read', () => {
  // The drafter may quote only words the abstract, as shown, contains, so the
  // text shown must be the source's own: no space inserted before a comma.
  assert.equal(
    plainAbstract('<jats:title>Abstract</jats:title><jats:p>The <jats:italic>E. coli</jats:italic> strain grew (R<sup>2</sup> = 0.9).</jats:p><jats:p>Next.</jats:p>', 2000),
    'Abstract The E. coli strain grew (R2 = 0.9). Next.',
  );
  assert.equal(plainAbstract('Line one<br/>line two', 2000), 'Line one line two');
  assert.equal(
    plainAbstract('Costs &amp; benefits: p &lt; 0.05, x &gt; 1, &quot;quoted&quot;, &#8220;curly&#8221;, &#x2013; dash, &unknown; kept', 2000),
    'Costs & benefits: p < 0.05, x > 1, "quoted", \u201ccurly\u201d, \u2013 dash, &unknown; kept',
  );
});

test('the works are given in the order asked, each once, with the keys the library lacks named', () => {
  const { sources, missing } = sourceContext(LIBRARY, ['retracted2019', 'nope2001', 'many2020', 'retracted2019']);
  assert.deepEqual(sources.map((s) => s.citekey), ['retracted2019', 'many2020']);
  assert.deepEqual(missing, ['nope2001']);
  const [book, many] = sources;
  assert.deepEqual(book, { citekey: 'retracted2019', title: 'A Retracted Book', authors: [], venue: 'A Press', retracted: true });
  assert.deepEqual(many!.authors, ['A, X.', 'B, X.', 'C, X.', 'D, X.', 'E, X.', 'F, X.', 'et al.']);
  assert.equal(many!.year, 2020);
  assert.equal(many!.venue, 'J. Many');
  assert.ok(!('retracted' in many!), 'only a retraction is marked');
});

test('the whole library, for the outline author and the planner, is fenced and cuts each abstract shorter', () => {
  const long: Library = { ...LIBRARY, entries: [{ ...LIBRARY.entries[0]!, abstract: 'word '.repeat(400) }] };
  const text = renderLibraryContext(long);
  assert.ok(text.startsWith('<<<PENSMITH_UNTRUSTED_DATA_'));
  assert.ok(text.endsWith('>>>'));
  const json = JSON.parse(text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n'))) as Array<{ abstract: string }>;
  assert.ok(json[0]!.abstract.length <= 601, `abstract cut to 600 characters, got ${json[0]!.abstract.length}`);
  assert.equal(renderLibraryContext(null).split('\n')[1], '[]');
});
