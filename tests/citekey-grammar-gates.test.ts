// tests/citekey-grammar-gates.test.ts — Phase 19 review round 2: a citekey
// the D-14 readers cannot see never makes a quote or a key disappear from a
// blocking gate.
//
// Zotero 7's `citationKey` field and a Better BibTeX `Citation Key:` line are
// the user's own keys, and BBT's default formula is camelCase
// (`lecunDeepLearning2015`). The pipeline's bare-token readers speak the D-14
// grammar `[a-z][a-z0-9_-]*`, so:
//   - ingest keeps a Zotero / BBT key only when it is a D-14 key, else it
//     generates one (the draft then cites the library's key);
//   - Pass 3's quote extractor, done's GATE-04 key-set diff and its Pass 3
//     re-run, and compile's smoother masking read citations in the broad Pandoc
//     grammar Pass 1 reads (any case, locators, clusters): a quote attributed
//     to a key they could not parse would otherwise never reach Pass 3.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validateZoteroItem, normalizeZoteroItem } from '../bin/lib/sources/zotero-mcp.js';
import { ingestZoteroItems } from '../bin/lib/zotero-ingest.js';
import { loadLibrary } from '../bin/lib/library.js';
import { extractQuotes } from '../bin/lib/quote-extractor.js';
import { runPass3 } from '../bin/lib/verify/pass3.js';
import { runPass1 } from '../bin/lib/verify/pass1.js';
import { reCheckFinalMd } from '../bin/cli/done.js';
import { replaceCitationClusters, findCitationClusters, extractCitedKeysForVerification } from '../bin/lib/citation-token.js';

function paper(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pensmith-citekey-gates-'));
  fs.mkdirSync(path.join(root, '.paper'), { recursive: true });
  return root;
}

const LECUN = {
  key: 'LECUN015',
  itemType: 'journalArticle',
  title: 'Deep learning',
  creators: [
    { creatorType: 'author', firstName: 'Yann', lastName: 'LeCun' },
    { creatorType: 'author', firstName: 'Yoshua', lastName: 'Bengio' },
  ],
  publicationTitle: 'Nature',
  date: '2015-05-28',
  DOI: '10.1038/nature14539',
  extra: 'Citation Key: lecunDeepLearning2015',
};

const QUOTE =
  '"Deep learning allows computational models that are composed of multiple unicorn layers to learn nothing whatsoever about anything"';

test('review round 2: a camelCase Better BibTeX key or a punctuated Zotero 7 key is replaced by the generated D-14 key; a D-14 key is kept', () => {
  const norm = (data: Record<string, unknown>): string | null => {
    const v = validateZoteroItem(data);
    assert.ok(v.ok, JSON.stringify(v));
    return v.ok ? normalizeZoteroItem(v.item, 'local')?.citekey ?? null : null;
  };
  assert.equal(norm(LECUN), 'lecun2015', 'BBT camelCase');
  assert.equal(norm({ ...LECUN, extra: '', citationKey: 'smith:2020' }), 'lecun2015', 'a punctuated Zotero 7 key');
  assert.equal(norm({ ...LECUN, extra: '', citationKey: 'lecun2015deep' }), 'lecun2015deep', 'a D-14 key is the user\'s and stays');
  assert.equal(norm({ ...LECUN, extra: 'Citation Key: lecun_deep-2015' }), 'lecun_deep-2015');
});

test('review round 2: ingest writes only D-14 keys to LIBRARY.json and CITATIONS.bib', async () => {
  const root = paper();
  const r = await ingestZoteroItems(root, [LECUN]);
  assert.deepEqual(r.added, ['lecun2015']);
  assert.deepEqual((await loadLibrary(root)).entries.map((e) => e.citekey), ['lecun2015']);
  const bib = fs.readFileSync(path.join(root, '.paper', 'CITATIONS.bib'), 'utf8');
  assert.match(bib, /@article\{lecun2015,/);
  assert.doesNotMatch(bib, /lecunDeepLearning2015/);
});

test('review round 2: a quote cited with a mixed-case key, a locator or a cluster reaches Pass 3 (never silently unchecked)', async () => {
  const draft = [
    '# Background',
    '',
    `They write ${QUOTE} [@lecunDeepLearning2015].`,
    '',
    `Again, ${QUOTE.replace('unicorn', 'dragon')} [@Smith:2020, p. 5].`,
    '',
    `Also ${QUOTE.replace('unicorn', 'griffin')} [see @lecun2015; @other2020].`,
    '',
  ].join('\n');
  const quotes = extractQuotes(draft);
  assert.deepEqual(
    quotes.map((q) => q.citekey),
    ['lecunDeepLearning2015', 'Smith:2020', 'lecun2015'],
    'each quote is attributed to the first key of the citation right after it',
  );
  // Pass 3 checks every one of them (offline here: the text is unavailable, but none is dropped).
  const pass3 = await runPass3(draft, new Map());
  assert.equal(pass3.length, 3);
  assert.ok(pass3.every((r) => r.verdict !== 'OK'), 'nothing passes without text');
  // Pass 1 reads the same keys; a key the library does not have is FABRICATED (blocking).
  const root = paper();
  await ingestZoteroItems(root, [LECUN]);
  const pass1 = await runPass1(draft, path.join(root, '.paper', 'CITATIONS.bib'), { root });
  const byKey = new Map(pass1.map((r) => [r.citekey, r.verdict]));
  assert.equal(byKey.get('lecunDeepLearning2015'), 'FABRICATED');
  assert.equal(byKey.get('Smith:2020'), 'FABRICATED');
});

test('review round 2: done\'s GATE-04 key-set diff sees mixed-case keys — dropping, adding or re-casing one blocks export', async () => {
  const root = paper();
  const bib = path.join(root, '.paper', 'CITATIONS.bib');
  fs.writeFileSync(bib, '');
  const draft = `A claim [@lecunDeepLearning2015, p. 3]. Another [@smith2020].\n`;
  assert.deepEqual(extractCitedKeysForVerification(draft), ['lecunDeepLearning2015', 'smith2020']);
  const dropped = await reCheckFinalMd('A claim. Another [@smith2020].\n', draft, bib, root);
  assert.equal(dropped.passed, false);
  assert.match(dropped.reason, /dropped: \[lecunDeepLearning2015\]/);
  const recased = await reCheckFinalMd('A claim [@LecunDeepLearning2015, p. 3]. Another [@smith2020].\n', draft, bib, root);
  assert.equal(recased.passed, false);
  assert.match(recased.reason, /added: \[LecunDeepLearning2015\]; dropped: \[lecunDeepLearning2015\]/);
  const same = await reCheckFinalMd('Reworded claim [@lecunDeepLearning2015, p. 3]. Another [@smith2020].\n', draft, bib, root);
  assert.equal(same.passed, true, same.reason);
});

test('review round 2: compile\'s smoother masking covers every citation cluster (mixed case, locators, clusters) and restores it verbatim', () => {
  const text = 'One [@lecunDeepLearning2015, p. 3], two [@smith2020], three [see @a2020; @B2021], and an email a@b.co stays.';
  const seen: string[] = [];
  const masked = replaceCitationClusters(text, (c) => {
    seen.push(c.text);
    return `{{cite_${seen.length - 1}}}`;
  });
  assert.deepEqual(seen, ['[@lecunDeepLearning2015, p. 3]', '[@smith2020]', '[see @a2020; @B2021]']);
  assert.equal(masked, 'One {{cite_0}}, two {{cite_1}}, three {{cite_2}}, and an email a@b.co stays.');
  assert.equal(masked.replace(/\{\{cite_(\d)\}\}/g, (_m, i: string) => seen[Number(i)]!), text);
  assert.deepEqual(findCitationClusters(text).map((c) => c.keys), [['lecunDeepLearning2015'], ['smith2020'], ['a2020', 'B2021']]);
});
