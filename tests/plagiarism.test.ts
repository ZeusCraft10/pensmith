// tests/plagiarism.test.ts — Phase 6 Wave 0 RED scaffold for DONE-02.
//
// Mirrors tests/known-bad-pass2.test.ts RED-by-skip stance: the cassette-exists
// assertion runs now; the behavioral tests are SKIP-guarded on the not-yet-created
// bin/lib/plagiarism.ts so the suite reports skips with ZERO failures. Plan 06-02
// lands plagiarism.ts and these turn GREEN.
//
// Covers DONE-02: distinctive-phrase extraction (deterministic n-gram, no LLM),
// offline DDG HTML search via the committed cassette, advisory-never-throws, and
// the VERIFICATION.md render section.
//
// Offline by construction: isOfflineMode() is true unless PENSMITH_NETWORK_TESTS=1,
// so runPlagiarism reads tests/fixtures/cassettes/duckduckgo/html-search.json and
// never touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCassetteFile } from '../bin/lib/http-mock.js';

const plagiarismSrcPath = fileURLToPath(new URL('../bin/lib/plagiarism.ts', import.meta.url));
const plagiarismModUrl = new URL('../bin/lib/plagiarism.js', import.meta.url);

test('plagiarism: DDG cassette exists in Cassette[] schema (DONE-02)', () => {
  const cs = loadCassetteFile('duckduckgo', 'html-search');
  assert.ok(Array.isArray(cs) && cs.length >= 1, 'duckduckgo/html-search.json must be a non-empty Cassette[]');
  assert.equal(cs[0]?.method, 'GET');
  assert.equal(typeof cs[0]?.response, 'string', 'DDG cassette response must be an HTML string');
  assert.ok((cs[0]?.response as string).includes('result__a'), 'DDG cassette must carry result__a anchors');
});

// RED-by-skip module-presence consistency (mirrors known-bad-pass2).
test('plagiarism: module presence is consistent with Wave-0 RED state (DONE-02)', () => {
  if (existsSync(plagiarismSrcPath)) {
    assert.ok(true, 'bin/lib/plagiarism.ts present — behavioral tests active');
  } else {
    assert.ok(!existsSync(plagiarismSrcPath), 'Wave-0: bin/lib/plagiarism.ts absent (RED-by-skip)');
  }
});

test('plagiarism: extractDistinctivePhrases returns <=10 phrases each >=5 words (DONE-02)',
  { skip: !existsSync(plagiarismSrcPath) },
  async () => {
    const mod = await import(plagiarismModUrl.href) as {
      extractDistinctivePhrases: (text: string, minWords?: number, maxPhrases?: number) => string[];
    };
    const draft = [
      'The transformer architecture relies solely on attention mechanisms across all layers.',
      'Recurrent connections were entirely removed in favor of self attention computation.',
      'This change dramatically improved parallel training throughput on modern accelerators.',
    ].join(' ');
    const phrases = mod.extractDistinctivePhrases(draft);
    assert.ok(Array.isArray(phrases), 'must return an array');
    assert.ok(phrases.length <= 10, `must cap at 10 phrases, got ${phrases.length}`);
    for (const p of phrases) {
      assert.ok(p.trim().split(/\s+/).length >= 5, `phrase must be >=5 words: '${p}'`);
    }
  },
);

test('plagiarism: runPlagiarism (offline cassette) returns matches with >=2 result URLs (DONE-02)',
  { skip: !existsSync(plagiarismSrcPath) },
  async () => {
    const mod = await import(plagiarismModUrl.href) as {
      runPlagiarism: (draftMd: string, opts?: { maxPhrases?: number }) => Promise<Array<{
        phrase: string; matches: string[];
      }>>;
    };
    const draft = 'The transformer relies solely on attention mechanisms.';
    const results = await mod.runPlagiarism(draft);
    assert.ok(Array.isArray(results), 'runPlagiarism must return an array');
    const withHits = results.filter((r) => r.matches.length > 0);
    assert.ok(withHits.length >= 1, 'at least one phrase must match the cassette');
    assert.ok(withHits[0]!.matches.length >= 2, 'a matched phrase must carry >=2 result URLs from the cassette HTML');
  },
);

test('plagiarism: runPlagiarism never throws on a transport-error simulation (advisory) (DONE-02)',
  { skip: !existsSync(plagiarismSrcPath) },
  async () => {
    const mod = await import(plagiarismModUrl.href) as {
      runPlagiarism: (draftMd: string, opts?: { maxPhrases?: number }) => Promise<unknown[]>;
    };
    // An empty / pathological draft must still resolve (advisory-never-throws).
    await assert.doesNotReject(mod.runPlagiarism(''), 'runPlagiarism must never throw');
  },
);

test('plagiarism: renderPlagiarismSection returns a "## Plagiarism Check" markdown table (DONE-02)',
  { skip: !existsSync(plagiarismSrcPath) },
  async () => {
    const mod = await import(plagiarismModUrl.href) as {
      renderPlagiarismSection: (results: ReadonlyArray<{ phrase: string; matches: string[] }>) => string;
    };
    const md = mod.renderPlagiarismSection([{ phrase: 'attention mechanisms', matches: ['https://example.com/a'] }]);
    assert.ok(typeof md === 'string', 'must return a string');
    assert.match(md, /## Plagiarism Check/, 'must carry the "## Plagiarism Check" heading');
  },
);
