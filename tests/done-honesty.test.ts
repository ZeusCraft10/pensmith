// tests/done-honesty.test.ts — done's whole live path in process (Phase 21
// EXP-14, EXP-16, EXP-19; D-21-18, D-21-20, D-21-22): the test lane
// (PENSMITH_NETWORK_TESTS=1) with the V5 MockAgent answering every outside
// host — Crossref and Unpaywall from the RECORDED cassettes (lookupFixture),
// GPTZero with 0.61 then 0.37, DuckDuckGo with the synthetic results page —
// and the RUN-21 mock LLM (loopback, let through the MockAgent) answering the
// humanizer for the fixture skill installed in the sandbox home.
//
// done --yolo scores the compiled draft (61 %), humanizes it, scores the
// humanized text (37 %), runs the plagiarism check (no verbatim match),
// exports, and the terminal and `.paper/VERIFICATION.md` both show
// `61% AI-generated (gptzero, <ISO time>)` and `37% …` with the framing note.

import { test } from 'node:test';
import { recordDetectorConsent } from '../bin/lib/detector-consent.js';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withPipelinePaper, THREE_SECTIONS } from './helpers/pipeline-paper.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';
import { loadCassetteFile, lookupFixture } from '../bin/lib/http-mock.js';
import { _resetBucketsForTest } from '../bin/lib/http.js';
import { honestyFramingNote } from '../bin/lib/honesty.js';

const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/.source;

/** Capture the verb's stdout lines during `fn` (tee: the runner reports on the same stream). */
async function captureStdout<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
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

test('EXP-16 / EXP-14 / EXP-19 (in process, test lane): done scores before (61%) and after (37%) the humanizer — terminal and VERIFICATION.md, with timestamps and the backend', async () => {
  await withPipelinePaper({ sections: THREE_SECTIONS }, async (p) => {
    const paper = join(p.root, '.paper');
    await p.verifyAll();
    const c = await p.cli(['compile', '--yolo', '--no-smooth']);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    p.installHumanizerSkill();
    writeFileSync(join(paper, 'config.toml'), 'schema_version = 4\n');
    // The user's consent, recorded where the detector-consent gate records it
    // (the pensmith data dir — never the paper's config.toml; review round 1).
    await recordDetectorConsent(p.root, 'gptzero', true);

    const saved: Record<string, string | undefined> = {};
    for (const k of ['PENSMITH_NETWORK_TESTS', 'GPTZERO_API_KEY', 'USERPROFILE', 'PENSMITH_OFFLINE']) saved[k] = process.env[k];
    process.env['PENSMITH_NETWORK_TESTS'] = '1';
    process.env['GPTZERO_API_KEY'] = 'test-key-done-lane';
    process.env['USERPROFILE'] = p.sb.dataDir;
    delete process.env['PENSMITH_OFFLINE'];
    _resetBucketsForTest();
    const { agent, restore } = installMockAgent();
    agent.enableNetConnect(new URL(p.sb.mock!.url).host);
    const replay = (origin: string): void => {
      agent
        .get(origin)
        .intercept({ path: /.*/, method: 'GET' })
        .reply((req) => {
          const hit = lookupFixture('GET', `${origin}${String(req.path)}`);
          if (hit === null) return { statusCode: 404, data: JSON.stringify({ message: 'no recorded answer' }), responseOptions: { headers: { 'content-type': 'application/json' } } };
          return { statusCode: hit.status, data: hit.body, responseOptions: { headers: hit.headers } };
        })
        .persist();
    };
    replay('https://api.crossref.org');
    replay('https://api.unpaywall.org');
    const scores = [0.61, 0.37];
    let detector = 0;
    agent
      .get('https://api.gptzero.me')
      .intercept({ path: '/v2/predict/text', method: 'POST' })
      .reply(() => {
        const ai = scores[Math.min(detector, scores.length - 1)] as number;
        detector += 1;
        return { statusCode: 200, data: JSON.stringify({ documents: [{ class_probabilities: { ai }, document_classification: 'MIXED' }] }), responseOptions: { headers: { 'content-type': 'application/json' } } };
      })
      .persist();
    const ddgPage = String(loadCassetteFile('duckduckgo', 'results-page')?.[0]?.response ?? '');
    let ddg = 0;
    agent
      .get('https://html.duckduckgo.com')
      .intercept({ path: /^\/html\/\?q=/, method: 'GET' })
      .reply(() => {
        ddg += 1;
        return { statusCode: 200, data: ddgPage, responseOptions: { headers: { 'content-type': 'text/html; charset=UTF-8' } } };
      })
      .persist();

    try {
      const { doneCommand } = await import('../bin/cli/done.js');
      const { value, out } = await captureStdout(() => doneCommand.run!({ args: { yolo: true, format: 'md' } } as never));
      assert.equal((value as { ok?: boolean }).ok, true, out);
      assert.equal(detector, 2, 'one detector request before and one after the humanizer');
      assert.ok(ddg >= THREE_SECTIONS.length, 'the plagiarism check queried every section');
      assert.equal(p.sb.mock!.callCount('humanizer'), THREE_SECTIONS.length);
      assert.match(out, /pensmith done: plagiarism check: \d+ distinctive phrase\(s\) searched as exact quotes; 0 found verbatim on the web/);
      const beforeLine = new RegExp(`^Pensmith honesty check \\(before humanize\\): 61% AI-generated \\(gptzero, ${ISO}\\)$`, 'm');
      const afterLine = new RegExp(`^Pensmith honesty check \\(after humanize\\):  37% AI-generated \\(gptzero, ${ISO}\\)$`, 'm');
      assert.match(out, beforeLine);
      assert.match(out, afterLine);
      assert.ok(out.includes(honestyFramingNote()));
      assert.ok(!out.includes('test-key-done-lane'), 'the key is never printed');
      const verification = readFileSync(join(paper, 'VERIFICATION.md'), 'utf8');
      assert.match(verification, beforeLine);
      assert.match(verification, afterLine);
      assert.match(verification, /^Text checked: \.paper\/FINAL\.md/m);
      assert.doesNotMatch(verification, /duckduckgo\.com\/l\/\?uddg=/);
      assert.match(readFileSync(join(paper, 'export', 'DRAFT.md'), 'utf8'), /Put simply:/, 'the export is the humanized text');
    } finally {
      await restore();
      _resetBucketsForTest();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
