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
// Phase 17 (RUN-03): offline (the test runner default) the check is "skipped
// (offline)" with 0 matches and sends nothing — it no longer replays a canned
// search page for every phrase. The live parse path runs in the live test lane
// (PENSMITH_NETWORK_TESTS=1) against the V5 MockAgent serving the synthetic
// tests/fixtures/cassettes/synthetic/duckduckgo/html-search.json page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCassetteFile } from '../bin/lib/http-mock.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';

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

interface PlagMod {
  runPlagiarism: (draftMd: string, opts?: { maxPhrases?: number }) => Promise<Array<{
    phrase: string; matches: string[]; skipped?: string;
  }>>;
  renderPlagiarismSection: (results: ReadonlyArray<{ phrase: string; matches: string[]; skipped?: 'offline' | 'dry-run' }>) => string;
}

async function captureStdout<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  // Tee, never swallow: the node:test child reports results on stdout, and a
  // swallowed report line makes earlier tests silently vanish from the run.
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return orig(s);
  };
  try {
    return { value: await fn(), out: chunks.join('') };
  } finally {
    (process.stdout as unknown as { write: typeof orig }).write = orig;
  }
}

test('RUN-03: offline, runPlagiarism is "skipped (offline)" with 0 matches — no query, no canned page',
  { skip: !existsSync(plagiarismSrcPath) },
  async () => {
    const mod = await import(plagiarismModUrl.href) as PlagMod;
    // Nonsense text that no search page could match — and the canned DDG page
    // that used to be replayed for ANY phrase is never consulted.
    const draft = 'Zorblax quintessential frumious bandersnatch gyred gimbling wabe outgrabe.';
    const { value: results, out } = await captureStdout(() => mod.runPlagiarism(draft));
    assert.ok(results.length > 0, 'the distinctive phrases are still extracted locally');
    for (const r of results) {
      assert.deepEqual(r.matches, [], 'offline: 0 matches');
      assert.equal(r.skipped, 'offline');
    }
    assert.match(out, /plagiarism check skipped \(offline\) — \d+ distinctive phrase\(s\) not queried\./);
    const md = mod.renderPlagiarismSection(results as Parameters<PlagMod['renderPlagiarismSection']>[0]);
    assert.match(md, /_\(skipped \(offline\) — not queried\)_/);
    assert.ok(!/<https?:/.test(md), 'no result URL is ever rendered for a skipped check');
  },
);

test('plagiarism (live lane): runPlagiarism parses DDG results into >=2 result URLs (DONE-02)',
  { skip: !existsSync(plagiarismSrcPath) },
  async () => {
    const mod = await import(plagiarismModUrl.href) as PlagMod;
    const cs = loadCassetteFile('duckduckgo', 'html-search');
    const html = String(cs?.[0]?.response ?? '');
    const savedLane = process.env['PENSMITH_NETWORK_TESTS'];
    process.env['PENSMITH_NETWORK_TESTS'] = '1';
    const { agent, restore } = installMockAgent();
    const queried: string[] = [];
    agent
      .get('https://html.duckduckgo.com')
      .intercept({ path: /^\/html\/\?q=/, method: 'GET' })
      .reply((req) => {
        queried.push(String(req.path));
        return { statusCode: 200, data: html, responseOptions: { headers: { 'content-type': 'text/html' } } };
      })
      .persist();
    try {
      const results = await mod.runPlagiarism('The transformer relies solely on attention mechanisms.');
      const withHits = results.filter((r) => r.matches.length > 0);
      assert.ok(withHits.length >= 1, 'a live phrase query parses its result page');
      assert.ok(withHits[0]!.matches.length >= 2, 'a matched phrase carries >=2 result URLs');
      assert.ok(results.every((r) => r.skipped === undefined), 'live results are never marked skipped');
      assert.ok(queried.length >= 1 && queried.every((p) => p.startsWith('/html/?q=')));
    } finally {
      await restore();
      if (savedLane === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
      else process.env['PENSMITH_NETWORK_TESTS'] = savedLane;
    }
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
