// tests/plagiarism-coverage.test.ts — a check that could not run never reads as clean.
//
// The plagiarism probe ignored the HTTP status, so DuckDuckGo's bot check
// (HTTP 202 with an "anomaly" challenge page) parsed to zero results and was
// reported as "(no matches)"; so were a cassette miss and a transport error.
// Its queries were unquoted bags of words with every word of two letters or
// fewer dropped, so nothing was searched verbatim, and its ten overlapping
// windows covered only the opening of the paper. Now each phrase is sent as
// an exact quoted phrase, verbatim, one per paragraph spread across the paper;
// a search that did not get a real answer is "not checked"; DuckDuckGo's
// redirect links are decoded; and the report states its coverage.
//
// The searches are answered from
// tests/fixtures/cassettes/duckduckgo/synthetic-plagiarism-coverage.json.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectGateIssues } from '../bin/cli/done.js';
import { extractDistinctivePhrases, renderPlagiarismSection, runPlagiarism } from '../bin/lib/plagiarism.js';

const BLOCKED_202 = 'Estuary sediment budgets shift sharply after barrage construction begins.';
const BLOCKED_PAGE = 'Mangrove root systems trap fine silt during spring tides.';
const HIT = 'Tidal lagoons store water behind a sea wall for later release.';
const NO_RESULTS = 'Seagrass meadows recover slowly once turbidity rises above a threshold.';
const UNRECORDED = 'Saltmarsh accretion rates outpace sea level rise in sheltered bays.';

test('a phrase is searched verbatim: short words stay in it', () => {
  assert.deepEqual(extractDistinctivePhrases(HIT), ['Tidal lagoons store water behind a sea wall']);
});

test('DuckDuckGo\'s bot check (HTTP 202, or a challenge page) is "not checked", never "no matches"', async () => {
  const results = await runPlagiarism(`${BLOCKED_202}\n\n${BLOCKED_PAGE}`);
  assert.equal(results.length, 2);
  for (const r of results) {
    assert.deepEqual(r.matches, []);
    assert.equal(r.skipped, 'blocked', JSON.stringify(r));
  }
  const md = renderPlagiarismSection(results);
  assert.doesNotMatch(md, /_\(no matches\)_/);
  assert.match(md, /not checked/i);
  assert.match(md, /incomplete/i);
});

test('a search with no answer (no recording, a transport error) is "not checked"', async () => {
  const [r] = await runPlagiarism(UNRECORDED);
  assert.ok(r);
  assert.equal(r.skipped, 'no-answer');
  assert.match(renderPlagiarismSection([r]), /not checked/i);
});

test('a real answer: hits are decoded from DuckDuckGo\'s redirect links; "No results." is a checked phrase with no match', async () => {
  const results = await runPlagiarism(`${HIT}\n\n${NO_RESULTS}`);
  assert.deepEqual(results.map((r) => r.matches), [['https://example.org/tidal-lagoons?page=2'], []]);
  assert.deepEqual(results.map((r) => r.skipped), [undefined, undefined]);
  const md = renderPlagiarismSection(results);
  assert.match(md, /_\(no matches\)_/);
  assert.match(md, /2 of 2 phrases? (were )?checked/i);
  assert.doesNotMatch(md, /incomplete/i);
});

test('phrases are spread across the whole paper, one per paragraph, not taken from its opening', () => {
  const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph number ${i + 1} discusses estuarine morphology and sediment transport processes.`);
  const phrases = extractDistinctivePhrases(paragraphs.join('\n\n'));
  assert.equal(phrases.length, 10);
  assert.match(phrases[0]!, /^Paragraph number 1 /);
  assert.match(phrases[phrases.length - 1]!, /^Paragraph number 20 /, 'the last paragraph is probed too');
  assert.equal(new Set(phrases).size, 10, 'each phrase from a different paragraph');
});

test('the export confirmation counts an incomplete plagiarism check as an issue to review', () => {
  const issues = collectGateIssues({
    pass2Results: [],
    pass4Results: [],
    plagiarismResults: [{ phrase: 'a phrase never searched', matches: [], skipped: 'blocked' }],
  });
  assert.equal(issues.hasIssues, true);
  assert.equal(issues.plagiarismUnchecked, 1);
});
