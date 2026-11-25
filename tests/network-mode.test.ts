// tests/network-mode.test.ts — the three network modes and what each one may do.
//
//   live     (no env vars)              → real HTTP through bin/lib/http.ts
//   cassette (PENSMITH_TEST_CASSETTES=1) → committed cassettes, matched by request
//   offline  (PENSMITH_OFFLINE=1)        → every request refused, callers say
//                                          "skipped (offline)" / UNRESOLVED
//
// The regression this guards: production used to replay test cassettes unless a
// test-lane variable was set, so research returned fixture papers for any topic
// and an unknown DOI "resolved" to an unrelated record.
//
// Requests are observed with a counting MockAgent installed as the global undici
// dispatcher. It has net connect disabled, so nothing here can reach the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inspect } from 'node:util';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from 'undici';
import { fetch as httpFetch, _resetBucketsForTest } from '../bin/lib/http.js';
import {
  networkMode,
  isOfflineMode,
  isCassetteMode,
  OfflineEgressError,
} from '../bin/lib/network-mode.js';

const MODE_VARS = ['PENSMITH_OFFLINE', 'PENSMITH_TEST_CASSETTES', 'PENSMITH_NETWORK_TESTS'] as const;

class CountingAgent extends MockAgent {
  readonly requests: string[] = [];
  override dispatch(opts: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    this.requests.push(`${opts.method} ${String(opts.origin)}${opts.path}`);
    return super.dispatch(opts, handler);
  }
}

/** Run `fn` with the given mode vars (all others cleared) and a counting agent. */
async function inMode<T>(
  vars: Partial<Record<(typeof MODE_VARS)[number], string>>,
  fn: (agent: CountingAgent) => Promise<T>,
  extraEnv: Record<string, string | undefined> = {},
): Promise<T> {
  const saved = new Map<string, string | undefined>();
  const keys = [...MODE_VARS, ...Object.keys(extraEnv)];
  for (const k of keys) saved.set(k, process.env[k]);
  for (const k of MODE_VARS) {
    const v = vars[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const agent = new CountingAgent();
  agent.disableNetConnect();
  const prevDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(agent);
  _resetBucketsForTest();
  try {
    return await fn(agent);
  } finally {
    setGlobalDispatcher(prevDispatcher);
    await agent.close();
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function captureStream(stream: 'stdout' | 'stderr'): { text: () => string; restore: () => void } {
  const target = process[stream];
  const original = target.write.bind(target);
  let buf = '';
  target.write = ((chunk: string | Uint8Array): boolean => {
    buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof target.write;
  return { text: () => buf, restore: () => { target.write = original; } };
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const NOVEL_TOPIC = 'coastal flood insurance markets reprice climate exposure';

// ---------------------------------------------------------------------------
// Mode selection
// ---------------------------------------------------------------------------

test('network mode: with no env vars set the mode is live and isOfflineMode() is false', async () => {
  await inMode({}, async () => {
    assert.equal(networkMode(), 'live');
    assert.equal(isOfflineMode(), false);
    assert.equal(isCassetteMode(), false);
  });
});

test('network mode: PENSMITH_NETWORK_TESTS alone does not select cassettes or offline', async () => {
  await inMode({ PENSMITH_NETWORK_TESTS: '' }, async () => {
    assert.equal(networkMode(), 'live');
  });
  await inMode({ PENSMITH_NETWORK_TESTS: '1' }, async () => {
    assert.equal(networkMode(), 'live');
  });
});

test('network mode: PENSMITH_TEST_CASSETTES=1 selects replay; PENSMITH_OFFLINE=1 wins over it', async () => {
  await inMode({ PENSMITH_TEST_CASSETTES: '1' }, async () => {
    assert.equal(networkMode(), 'cassette');
    assert.equal(isCassetteMode(), true);
    assert.equal(isOfflineMode(), false);
  });
  await inMode({ PENSMITH_TEST_CASSETTES: '1', PENSMITH_OFFLINE: '1' }, async () => {
    assert.equal(networkMode(), 'offline');
    assert.equal(isOfflineMode(), true);
  });
});

// ---------------------------------------------------------------------------
// Live mode goes to the network, never to the committed cassettes
// ---------------------------------------------------------------------------

test('live mode: an OpenAlex search for a novel topic is a real request, not fixture papers', async () => {
  await inMode({}, async (agent) => {
    const topic = `${NOVEL_TOPIC} ${Date.now()}`;
    agent
      .get('https://api.openalex.org')
      // MockAgent sorts query parameters before matching.
      .intercept({ path: (p: string) => p.startsWith('/works?') && p.includes('search=coastal'), method: 'GET' })
      .reply(200, {
        results: [{
          id: 'https://openalex.org/W9999999999',
          doi: 'https://doi.org/10.5555/live-probe',
          title: 'Live Probe Title',
          publication_year: 2024,
          authorships: [{ author: { display_name: 'Ada Live' } }],
        }],
      }, { headers: { 'content-type': 'application/json' } });
    const openalex = await import('../bin/lib/sources/openalex.js');
    const results = await openalex.search(topic);
    assert.equal(agent.requests.length, 1, `expected one live request, saw ${JSON.stringify(agent.requests)}`);
    assert.match(agent.requests[0] ?? '', /api\.openalex\.org\/works\?search=coastal/);
    assert.deepEqual(results.map((r) => r.title), ['Live Probe Title']);
  });
});

// ---------------------------------------------------------------------------
// Cassette mode: a miss is a miss — never another record
// ---------------------------------------------------------------------------

test('cassette mode: unknown identifiers return null from every adapter (no substituted record)', async () => {
  await inMode({ PENSMITH_TEST_CASSETTES: '1' }, async (agent) => {
    const { sources } = await import('../bin/lib/sources/index.js');
    assert.equal(await sources.crossref.fetchById('10.9999/pensmith-unknown-doi'), null, 'crossref');
    assert.equal(await sources.openalex.fetchById('W0000000001'), null, 'openalex');
    assert.equal(await sources.arxiv.fetchById('0000.00001'), null, 'arxiv');
    assert.equal(await sources.pubmed.fetchById('99999999'), null, 'pubmed');
    assert.equal(await sources.semanticscholar.fetchById('ffffffffffffffffffffffffffffffffffffffff'), null, 'semanticscholar');
    assert.equal(await sources.unpaywall.fetchById('10.9999/pensmith-unknown-doi'), null, 'unpaywall');
    assert.deepEqual(agent.requests, [], 'cassette replay must never reach the network');
  });
});

test('cassette mode: a recorded DOI replays its own record', async () => {
  await inMode({ PENSMITH_TEST_CASSETTES: '1' }, async (agent) => {
    const { sources } = await import('../bin/lib/sources/index.js');
    const hit = await sources.crossref.fetchById('10.1038/nphys1170');
    assert.ok(hit, 'the add-doi cassette records this DOI');
    assert.equal(hit.doi?.toLowerCase(), '10.1038/nphys1170');
    assert.match(hit.title, /Quantum coherence/);
    assert.deepEqual(agent.requests, []);
  });
});

test('cassette mode: a novel search topic returns no records from any adapter', async () => {
  await inMode({ PENSMITH_TEST_CASSETTES: '1' }, async (agent) => {
    const { sources } = await import('../bin/lib/sources/index.js');
    for (const name of ['crossref', 'openalex', 'arxiv', 'pubmed', 'semanticscholar'] as const) {
      const results = await sources[name].search(NOVEL_TOPIC);
      assert.deepEqual(results, [], `${name}.search(novel topic) must not return fixture papers`);
    }
    assert.deepEqual(agent.requests, []);
  });
});

test('cassette mode: plagiarism phrases with no recorded query get no hits', async () => {
  await inMode({ PENSMITH_TEST_CASSETTES: '1' }, async (agent) => {
    const { runPlagiarism } = await import('../bin/lib/plagiarism.js');
    const results = await runPlagiarism(
      'Coastal flood insurance markets reprice climate exposure annually across regions.',
    );
    assert.ok(results.length > 0, 'the draft yields distinctive phrases');
    for (const r of results) {
      assert.deepEqual(r.matches, [], `phrase "${r.phrase}" must not inherit another query's hits`);
    }
    assert.deepEqual(agent.requests, []);
  });
});

// ---------------------------------------------------------------------------
// Offline mode: zero requests, honest "skipped (offline)" / UNRESOLVED
// ---------------------------------------------------------------------------

test('offline mode: http.fetch refuses with a typed error and dispatches nothing', async () => {
  await inMode({ PENSMITH_OFFLINE: '1' }, async (agent) => {
    agent.get('https://api.crossref.org').intercept({ path: /.*/, method: 'GET' }).reply(200, {});
    await assert.rejects(
      httpFetch('https://api.crossref.org/works/10.1038/nphys1170', { source: 'crossref' }),
      (err: unknown) => {
        assert.ok(err instanceof OfflineEgressError, `expected OfflineEgressError, got ${String(err)}`);
        assert.equal((err as OfflineEgressError).code, 'PENSMITH_OFFLINE');
        return true;
      },
    );
    assert.deepEqual(agent.requests, []);
  });
});

test('offline mode: the refusal never carries the refused URL, whose query may hold a contact email', async () => {
  // Unpaywall asks for ?email=<PENSMITH_CONTACT_EMAIL>. An uncaught refusal is
  // printed by util.inspect (citty's runMain) and may be serialized to a log,
  // so the error names the origin only and keeps no `url` property.
  await inMode({ PENSMITH_OFFLINE: '1' }, async (agent) => {
    const url = 'https://api.unpaywall.org/v2/10.1/x?email=me%40uni.edu';
    const err: unknown = await httpFetch(url, { source: 'unpaywall' }).then(
      () => assert.fail('an offline fetch must be refused'),
      (e: unknown) => e,
    );
    assert.ok(err instanceof OfflineEgressError, `expected OfflineEgressError, got ${String(err)}`);
    assert.ok(!Object.hasOwn(err, 'url'), `the error keeps the refused URL: ${JSON.stringify(Object.keys(err))}`);
    for (const [how, text] of [['util.inspect', inspect(err)], ['JSON.stringify', JSON.stringify(err)]] as const) {
      assert.ok(!text.includes('email='), `${how}(err) echoes the query string: ${text}`);
      assert.ok(!text.includes('uni.edu'), `${how}(err) echoes the contact address: ${text}`);
    }
    assert.match(err.message, /refused request to https:\/\/api\.unpaywall\.org/);
    assert.deepEqual(agent.requests, []);
  });
});

test('offline mode: research makes zero requests and reports skipped (offline)', async () => {
  await inMode({ PENSMITH_OFFLINE: '1' }, async (agent) => {
    const { runResearchOrchestrator } = await import('../bin/lib/research-orchestrator.js');
    const err = captureStream('stderr');
    let candidates: unknown[];
    try {
      candidates = await runResearchOrchestrator({
        assignment: 'Review attention mechanisms.',
        topic: 'attention mechanisms',
        discipline: 'cs',
      });
    } finally {
      err.restore();
    }
    assert.deepEqual(candidates, []);
    assert.match(err.text(), /skipped \(offline\)/);
    assert.deepEqual(agent.requests, []);
  }, { PENSMITH_NO_LLM: '1' });
});

test('offline mode: Pass 1 yields UNRESOLVED, never OK or FABRICATED, with zero requests', async () => {
  await inMode({ PENSMITH_OFFLINE: '1' }, async (agent) => {
    const dir = tmpDir('pensmith-offline-p1-');
    const bibPath = path.join(dir, 'CITATIONS.bib');
    fs.writeFileSync(
      bibPath,
      '@article{engel2007,\n  title = {Evidence for wavelike energy transfer through quantum coherence in photosynthetic systems},\n' +
        '  author = {Engel, Gregory S.},\n  doi = {10.1038/nature05678},\n  year = {2007}\n}\n',
    );
    const { runPass1 } = await import('../bin/lib/verify/pass1.js');
    const results = await runPass1('Coherence persists in photosynthetic complexes [@engel2007].\n', bibPath);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.verdict, 'UNRESOLVED', `got ${JSON.stringify(results[0])}`);
    assert.match(results[0]?.reason ?? '', /offline/);
    assert.deepEqual(agent.requests, []);
  });
});

test('offline mode: Pass 1 says UNRESOLVED for an entry with no DOI; only an invented citekey is FABRICATED', async () => {
  // A book or an arXiv preprint may carry no DOI. Offline nothing was looked up,
  // so calling it FABRICATED would accuse a real source. A citekey missing from
  // the bibliography is a local fact and stays FABRICATED.
  await inMode({ PENSMITH_OFFLINE: '1' }, async (agent) => {
    const dir = tmpDir('pensmith-offline-p1-nodoi-');
    const bibPath = path.join(dir, 'CITATIONS.bib');
    fs.writeFileSync(
      bibPath,
      '@book{kuhn1962,\n  title = {The Structure of Scientific Revolutions},\n' +
        '  author = {Kuhn, Thomas S.},\n  publisher = {University of Chicago Press},\n  year = {1962}\n}\n',
    );
    const { runPass1 } = await import('../bin/lib/verify/pass1.js');
    const results = await runPass1('Paradigms shift [@kuhn1962]; see also [@invented2020].\n', bibPath);
    const byKey = new Map(results.map((r) => [r.citekey, r]));
    assert.equal(byKey.get('kuhn1962')?.verdict, 'UNRESOLVED', `got ${JSON.stringify(byKey.get('kuhn1962'))}`);
    assert.match(byKey.get('kuhn1962')?.reason ?? '', /offline/);
    assert.doesNotMatch(byKey.get('kuhn1962')?.reason ?? '', /undefined/);
    assert.equal(byKey.get('invented2020')?.verdict, 'FABRICATED');
    assert.deepEqual(agent.requests, []);
  });
});

test('offline mode: Pass 3 and the freshness probe make zero requests and say skipped (offline)', async () => {
  await inMode({ PENSMITH_OFFLINE: '1' }, async (agent) => {
    const { runPass3 } = await import('../bin/lib/verify/pass3.js');
    const quote = 'the excitation energy moves coherently through the complex rather than hopping incoherently between sites';
    const results = await runPass3(
      `As reported, "${quote}" [@engel2007].\n`,
      new Map([['engel2007', { DOI: '10.1038/nature05678' }]]),
    );
    assert.equal(results.length, 1, 'the quote is extracted');
    assert.notEqual(results[0]?.verdict, 'OK');
    assert.match(results[0]?.reason ?? '', /skipped \(offline\)/);

    const { probeFreshness, renderFreshnessTable } = await import('../bin/lib/verify/freshness.js');
    const fresh = await probeFreshness('engel2007', '10.1038/nature05678');
    assert.deepEqual(fresh.warnings, []);
    assert.equal(fresh.skipped, 'offline');
    assert.match(renderFreshnessTable([fresh]), /skipped \(offline\)/);
    assert.deepEqual(agent.requests, []);
  });
});

test('offline mode: the GPTZero score is skipped, never a canned number', async () => {
  await inMode({ PENSMITH_OFFLINE: '1' }, async (agent) => {
    const { scoreHonesty } = await import('../bin/lib/honesty.js');
    const out = captureStream('stdout');
    let score: unknown;
    try {
      score = await scoreHonesty('Some paper text that would be scored.');
    } finally {
      out.restore();
    }
    assert.equal(score, null);
    assert.match(out.text(), /skipped \(offline\)/);
    assert.deepEqual(agent.requests, []);
  }, { GPTZERO_API_KEY: 'test-key-not-real' });
});

test('live mode without consent: GPTZero never returns the committed canned score', async () => {
  // The test process is non-TTY, so the consent gate declines before any POST.
  await inMode({}, async (agent) => {
    const { scoreHonesty } = await import('../bin/lib/honesty.js');
    const out = captureStream('stdout');
    let score: unknown;
    try {
      score = await scoreHonesty('Some paper text that would be scored.');
    } finally {
      out.restore();
    }
    assert.equal(score, null, 'no consent → no score (and never the cassette 82%)');
    assert.deepEqual(agent.requests, []);
  }, { GPTZERO_API_KEY: 'test-key-not-real' });
});

test('offline mode: the plagiarism check reports skipped (offline), never canned hits', async () => {
  await inMode({ PENSMITH_OFFLINE: '1' }, async (agent) => {
    const { runPlagiarism, renderPlagiarismSection } = await import('../bin/lib/plagiarism.js');
    const results = await runPlagiarism('The transformer relies solely on attention mechanisms across encoder layers.');
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.deepEqual(r.matches, []);
      assert.equal(r.skipped, 'offline');
    }
    assert.match(renderPlagiarismSection(results), /skipped \(offline\)/);
    assert.deepEqual(agent.requests, []);
  });
});

// ---------------------------------------------------------------------------
// UNRESOLVED blocks like the other integrity verdicts
// ---------------------------------------------------------------------------

test('verdict rows: UNRESOLVED is a blocking verdict for compile and export', async () => {
  const { parseVerdictRows, renderPass1VerdictRow } = await import('../bin/lib/verify/verdict-rows.js');
  const row = renderPass1VerdictRow('engel2007', 'UNRESOLVED', 0, 0, 'registry not queried (offline)');
  assert.deepEqual(parseVerdictRows(`Status: failed\n\n${row}\n`), ['engel2007']);
});

test('offline mode: the done report says the honesty check was skipped because of offline mode', async () => {
  const { renderHonestySkipped } = await import('../bin/lib/honesty.js');
  await inMode({ PENSMITH_OFFLINE: '1' }, async () => {
    assert.match(renderHonestySkipped(), /skipped \(offline\)/);
  });
  await inMode({}, async () => {
    assert.doesNotMatch(renderHonestySkipped(), /offline/);
  });
});
