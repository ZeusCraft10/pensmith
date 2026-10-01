// tests/plagiarism.test.ts — the basic plagiarism check (DONE-02; Phase 21
// EXP-19, EXP-20; D-21-22).
//
// Phrases are 6–10-word windows of BODY paragraphs (never the title, a
// heading, a citation, a quoted passage, a block quote, a list item or the
// reference list), ranked by rarity against the shipped SCOWL word tiers, at
// least one per paragraph in paper order up to `plagiarism_max_phrases`; each
// is sent as a QUOTED DuckDuckGo HTML query; a result is a match only when the
// normalised phrase appears verbatim in its title or snippet; result links are
// decoded from DuckDuckGo's `/l/?uddg=` redirect.
//
// Fixtures (tests/fixtures/cassettes/synthetic/duckduckgo/):
//   - results-page.json — SYNTHETIC: a page in DuckDuckGo's HTML layout
//     (`result__a` / `result__snippet`, `/l/?uddg=` links, `<b>` highlighting,
//     a sponsored result) with topical results that hold no paper phrase
//     verbatim and one result whose snippet holds the opening of A Tale of Two
//     Cities (Dickens, 1859; public domain) word for word.
//   - challenge-page.json — the page DuckDuckGo actually answered from this
//     environment on 2026-10-01 (HTTP 202, its bot challenge), session tokens
//     scrubbed. Kept under synthetic/ because scripts/refresh-cassettes.mjs
//     did not record it (CI-07 provenance). Live DuckDuckGo answered every
//     query from this environment with that challenge, so the live-lane
//     Dickens evidence is recorded honestly as blocked in the stream summary.
// The live path runs in the test lane (PENSMITH_NETWORK_TESTS=1) against the
// V5 MockAgent; offline (the runner default) the check sends nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCassetteFile } from '../bin/lib/http-mock.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { _resetBucketsForTest } from '../bin/lib/http.js';
import {
  PHRASE_MAX_WORDS,
  PHRASE_MIN_WORDS,
  ddgQueryUrl,
  decodeDdgLink,
  isDdgChallenge,
  isVerbatimMatch,
  normalizeForMatch,
  parseDdgHtml,
  renderPlagiarismSection,
  runPlagiarism,
  selectPlagiarismPhrases,
  wordRarity,
  type PlagiarismResult,
} from '../bin/lib/plagiarism.js';

const DICKENS = 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.';

/** A compiled five-section paper as compile writes it (title, `##` headings), §4 holding the Dickens passage. */
const PAPER = [
  '# Quixotic Hydrokinetic Prospects',
  '',
  '## Zephyrine Harbour Considerations',
  '',
  'Estuary barrages store seawater behind sluice gates and release it through low-head turbines at ebb tide [@lecun2015].',
  '',
  'Sediment accumulation behind each barrage alters wading-bird feeding grounds along the mudflats [@lecun2015, p. 4].',
  '',
  '## Xanthic Lagoon Economics',
  '',
  'Offshore lagoons avoid closing an estuary entirely, yet their breakwaters demand enormous volumes of quarried rock.',
  '',
  '- a list item that mentions levelised cost comparisons for several lagoon proposals',
  '',
  '## Quokka Grid Integration',
  '',
  'Predictable tidal cycles let grid operators schedule dispatchable reserves days ahead with unusual confidence.',
  '',
  '> A block quote about storage that is never probed because block quotes are quoted text.',
  '',
  '## Vellichor Literary Interlude',
  '',
  DICKENS,
  '',
  '## Wabi Concluding Remarks',
  '',
  'As one reviewer put it, "a turbine is only as reliable as its seals and bearings over decades" and that holds for tidal plants.',
  '',
  'Policy makers should weigh ecological disruption against decades of carbon-free generation from the tides.',
  '',
  '## References',
  '',
  'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning extends representation learning across many fields. Nature.',
  '',
].join('\n');

const HEADING_WORDS = ['quixotic', 'hydrokinetic', 'zephyrine', 'considerations', 'xanthic', 'quokka', 'vellichor', 'wabi', 'concluding', 'references'];

function page(name: string): { html: string; status: number } {
  const cs = loadCassetteFile('duckduckgo', name);
  assert.ok(cs?.[0], `synthetic/duckduckgo/${name}.json exists`);
  return { html: String(cs[0].response), status: cs[0].status };
}

/** The test lane with DuckDuckGo answered by the MockAgent: every query gets `name`'s page; the requested paths are captured. */
async function withDdg<T>(name: string, fn: (paths: string[]) => Promise<T>): Promise<T> {
  const { html, status } = page(name);
  const saved = process.env['PENSMITH_NETWORK_TESTS'];
  const savedOffline = process.env['PENSMITH_OFFLINE'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  delete process.env['PENSMITH_OFFLINE'];
  _resetBucketsForTest();
  const { agent, restore } = installMockAgent();
  const paths: string[] = [];
  agent
    .get('https://html.duckduckgo.com')
    .intercept({ path: /^\/html\/\?q=/, method: 'GET' })
    .reply((req) => {
      paths.push(String(req.path));
      return { statusCode: status, data: html, responseOptions: { headers: { 'content-type': 'text/html; charset=UTF-8' } } };
    })
    .persist();
  try {
    return await fn(paths);
  } finally {
    await restore();
    _resetBucketsForTest();
    if (saved === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = saved;
    if (savedOffline !== undefined) process.env['PENSMITH_OFFLINE'] = savedOffline;
  }
}

const SECTION_IDS = ['1', '2', '3', '3a', '4'];

test('EXP-19: every section contributes a phrase, in paper order, each 6–10 words of body prose — never the title, a heading, a citation, a quote, a list item or the references', () => {
  const phrases = selectPlagiarismPhrases(PAPER, { sectionIds: SECTION_IDS });
  assert.deepEqual([...new Set(phrases.map((p) => p.location.section))], SECTION_IDS, 'every section, in paper order');
  for (const p of phrases) {
    const words = p.phrase.split(' ');
    assert.ok(words.length >= PHRASE_MIN_WORDS && words.length <= PHRASE_MAX_WORDS, p.phrase);
    for (const h of HEADING_WORDS) assert.ok(!words.map((w) => w.toLowerCase()).includes(h), `no title/heading word in "${p.phrase}"`);
    assert.doesNotMatch(p.phrase, /lecun|@|levelised|block quote|seals and bearings|Bengio/i, `body prose only: "${p.phrase}"`);
  }
  // Each body paragraph is probed before any paragraph gets a second phrase.
  const firsts = new Set(phrases.map((p) => `${p.location.section}/${p.location.paragraph}`));
  assert.deepEqual([...firsts], ['1/1', '1/2', '2/1', '3/1', '3a/1', '4/1', '4/2']);
  // Deterministic.
  assert.deepEqual(selectPlagiarismPhrases(PAPER, { sectionIds: SECTION_IDS }), phrases);
});

test('EXP-19: the budget (plagiarism_max_phrases) caps the phrases; rarer words rank higher', () => {
  assert.equal(selectPlagiarismPhrases(PAPER, { maxPhrases: 3 }).length, 3);
  assert.deepEqual(selectPlagiarismPhrases(PAPER, { maxPhrases: 0 }), []);
  assert.ok(wordRarity('the') < wordRarity('sluice'), 'a common word weighs less than a rare one');
  assert.ok(wordRarity('the') < wordRarity('barrages'));
});

test('EXP-19: every query is the phrase in double quotes, URL-encoded, at html.duckduckgo.com', () => {
  for (const { phrase } of selectPlagiarismPhrases(PAPER)) {
    const u = new URL(ddgQueryUrl(phrase));
    assert.equal(u.origin, 'https://html.duckduckgo.com');
    assert.equal(u.searchParams.get('q'), `"${phrase}"`);
  }
});

test('EXP-20: result links are decoded from /l/?uddg= (after &amp; unescaping) to https destinations', () => {
  assert.equal(
    decodeDdgLink('//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.gutenberg.org%2Ffiles%2F98%2F98-h%2F98-h.htm&amp;rut=abc'),
    'https://www.gutenberg.org/files/98/98-h/98-h.htm',
  );
  assert.equal(decodeDdgLink('https://example.org/direct'), 'https://example.org/direct');
  assert.equal(decodeDdgLink('javascript:alert(1)'), null);
  assert.equal(decodeDdgLink('//duckduckgo.com/l/?rut=abc'), null);
  const results = parseDdgHtml(page('results-page').html);
  assert.equal(results.length, 4, 'the organic results; the sponsored one is skipped');
  for (const r of results) {
    assert.match(r.url, /^https:\/\//);
    assert.doesNotMatch(r.url, /duckduckgo\.com/);
    assert.doesNotMatch(`${r.title ?? ''} ${r.snippet ?? ''}`, /<\/?b>/, 'tags stripped');
  }
});

test('EXP-19: a match is the normalised phrase verbatim in a title or snippet — topical results are not matches', () => {
  const results = parseDdgHtml(page('results-page').html);
  const invented = 'Quarried rock volumes dominate breakwater budgets for offshore lagoons';
  assert.equal(results.filter((r) => isVerbatimMatch(invented, r)).length, 0, 'an invented sentence matches nothing on a topical page');
  const verbatim = 'it was the worst of times, it was the age';
  assert.deepEqual(results.filter((r) => isVerbatimMatch(verbatim, r)).map((r) => r.url), ['https://www.gutenberg.org/files/98/98-h/98-h.htm']);
  assert.equal(normalizeForMatch('It’s — “THE” best'), normalizeForMatch("it's - \"the\" best"));
  assert.equal(isVerbatimMatch('best of times it was the', { url: 'https://x.example', snippet: 'the bestof times it was the' }), false, 'whole words only');
});

test('EXP-19 (test lane): a five-section paper sends one quoted query per phrase and finds the Dickens passage in §3a — and only it', async () => {
  await withDdg('results-page', async (paths) => {
    const results = await runPlagiarism(PAPER, { sectionIds: SECTION_IDS });
    assert.equal(paths.length, results.length, 'one query per phrase');
    for (const p of paths) {
      const q = new URL(p, 'https://html.duckduckgo.com').searchParams.get('q') ?? '';
      assert.ok(q.startsWith('"') && q.endsWith('"'), `quoted: ${q}`);
    }
    // The budget (30) outlasts the seven paragraphs, so the Dickens paragraph
    // is probed with several windows: every one of them matches, nothing else does.
    const hits = results.filter((r) => r.matches.length > 0);
    assert.ok(hits.length >= 1, JSON.stringify(results, null, 2));
    for (const h of hits) {
      assert.equal(`${h.location?.section}/${h.location?.paragraph}`, '3a/1', `only the copied passage matches: "${h.phrase}"`);
      assert.deepEqual(h.matches, ['https://www.gutenberg.org/files/98/98-h/98-h.htm']);
    }
    assert.ok(results.filter((r) => r.location?.section !== '3a').every((r) => r.matches.length === 0 && r.error === undefined));
    const md = renderPlagiarismSection(results);
    assert.match(md, /\| §3a paragraph 1 \| .+ \| <https:\/\/www\.gutenberg\.org\/files\/98\/98-h\/98-h\.htm> \|/);
    assert.doesNotMatch(md, /duckduckgo\.com\/l\/\?uddg=/, 'the record never holds a DuckDuckGo redirect');
  });
});

test('EXP-19 (test lane): DuckDuckGo\'s bot challenge is reported per phrase — never read as "no match"', async () => {
  assert.equal(isDdgChallenge(page('challenge-page').html), true);
  assert.equal(isDdgChallenge(page('results-page').html), false);
  await withDdg('challenge-page', async () => {
    const results = await runPlagiarism(PAPER, { sectionIds: SECTION_IDS, maxPhrases: 2 });
    assert.equal(results.length, 2);
    for (const r of results) {
      assert.deepEqual(r.matches, []);
      assert.match(r.error ?? '', /DuckDuckGo refused the query \(its bot challenge\)/);
    }
    assert.match(renderPlagiarismSection(results), /DuckDuckGo refused the query/);
  });
});

test('RUN-03: offline the check sends nothing and says "skipped (offline)" for every phrase', async () => {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return orig(s);
  };
  let results: PlagiarismResult[];
  try {
    results = await runPlagiarism(PAPER, { sectionIds: SECTION_IDS });
  } finally {
    (process.stdout as unknown as { write: typeof orig }).write = orig;
  }
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.deepEqual(r.matches, []);
    assert.equal(r.skipped, 'offline');
  }
  assert.match(chunks.join(''), /plagiarism check skipped \(offline\) — \d+ distinctive phrase\(s\) not queried\./);
  assert.doesNotMatch(renderPlagiarismSection(results), /<https?:/);
});

test('EXP-20: a skipped check is one line in the record, naming why', () => {
  for (const why of ['--no-plagiarism-check', 'config', 'offline', 'dry-run']) {
    const md = renderPlagiarismSection([], { skipped: why });
    assert.match(md, /^## Plagiarism Check/);
    assert.ok(md.endsWith(`plagiarism check skipped (${why})`));
    assert.match(md, /basic check, not a substitute for an institutional plagiarism service/);
  }
});

test('DONE-02: advisory — a pathological draft never throws', async () => {
  await assert.doesNotReject(runPlagiarism(''));
  await assert.doesNotReject(runPlagiarism('# Only a title\n\n## Only a heading\n'));
});
