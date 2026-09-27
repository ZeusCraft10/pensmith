// tests/net-mode.test.ts — RUN-01 / RUN-02 / D-17-04 / D-17-08: the network-mode
// truth table, the fixed disclosure strings, and the static guarantees that the
// mode is decided in ONE place (bin/lib/http-mock.ts) with no env bypass in
// bin/lib/http.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  networkMode,
  isOfflineMode,
  isTestContext,
  offlineBanner,
  llmStubbedBanner,
  offlineMarkerLine,
  announceModes,
  _resetAnnouncedForTest,
  OFFLINE_MARKER_PREFIX,
} from '../bin/lib/http-mock.js';

const REPO = fileURLToPath(new URL('..', import.meta.url));

const MODE_VARS = [
  'NODE_TEST_CONTEXT',
  'PENSMITH_TEST',
  'PENSMITH_NETWORK_TESTS',
  'PENSMITH_OFFLINE',
  'PENSMITH_DRY_RUN',
  'PENSMITH_NO_LLM',
] as const;

/** Run `fn` with exactly the given mode variables set (all others unset), then restore. */
function withModeEnv<T>(vars: Partial<Record<(typeof MODE_VARS)[number], string>>, fn: () => T): T {
  const saved = new Map<string, string | undefined>();
  for (const k of MODE_VARS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// RUN-01 truth table (D-17-04)
// ---------------------------------------------------------------------------

const TRUTH_TABLE: Array<{
  name: string;
  env: Partial<Record<(typeof MODE_VARS)[number], string>>;
  sourcesOffline: boolean;
  llmStubbed: boolean;
  dryRun: boolean;
  reason: string | null;
}> = [
  { name: 'a real user with no variables is LIVE', env: {}, sourcesOffline: false, llmStubbed: false, dryRun: false, reason: null },
  { name: 'node --test child (NODE_TEST_CONTEXT) is offline', env: { NODE_TEST_CONTEXT: 'child-v8' }, sourcesOffline: true, llmStubbed: false, dryRun: false, reason: 'test runner' },
  { name: 'scripts/run-tests.mjs (PENSMITH_TEST=1) is offline', env: { PENSMITH_TEST: '1' }, sourcesOffline: true, llmStubbed: false, dryRun: false, reason: 'test runner' },
  { name: 'the live test lane (test context + PENSMITH_NETWORK_TESTS=1) is live', env: { NODE_TEST_CONTEXT: 'child-v8', PENSMITH_NETWORK_TESTS: '1' }, sourcesOffline: false, llmStubbed: false, dryRun: false, reason: null },
  { name: 'PENSMITH_NETWORK_TESTS alone (no test context) changes nothing — still live', env: { PENSMITH_NETWORK_TESTS: '1' }, sourcesOffline: false, llmStubbed: false, dryRun: false, reason: null },
  { name: 'PENSMITH_NETWORK_TESTS=0 in a test context stays offline', env: { PENSMITH_TEST: '1', PENSMITH_NETWORK_TESTS: '0' }, sourcesOffline: true, llmStubbed: false, dryRun: false, reason: 'test runner' },
  { name: 'PENSMITH_OFFLINE=1 is offline', env: { PENSMITH_OFFLINE: '1' }, sourcesOffline: true, llmStubbed: false, dryRun: false, reason: 'PENSMITH_OFFLINE=1' },
  { name: 'explicit PENSMITH_OFFLINE=1 beats the live test lane', env: { PENSMITH_OFFLINE: '1', NODE_TEST_CONTEXT: 'child-v8', PENSMITH_NETWORK_TESTS: '1' }, sourcesOffline: true, llmStubbed: false, dryRun: false, reason: 'PENSMITH_OFFLINE=1' },
  { name: '--dry-run (PENSMITH_DRY_RUN=1) is offline AND stubs the LLM', env: { PENSMITH_DRY_RUN: '1' }, sourcesOffline: true, llmStubbed: true, dryRun: true, reason: '--dry-run' },
  { name: '--dry-run wins over PENSMITH_OFFLINE for the reason', env: { PENSMITH_DRY_RUN: '1', PENSMITH_OFFLINE: '1' }, sourcesOffline: true, llmStubbed: true, dryRun: true, reason: '--dry-run' },
  { name: 'PENSMITH_NO_LLM stubs the LLM WITHOUT changing the network mode (S-15)', env: { PENSMITH_NO_LLM: '1' }, sourcesOffline: false, llmStubbed: true, dryRun: false, reason: null },
  { name: 'PENSMITH_NO_LLM + PENSMITH_OFFLINE are independent', env: { PENSMITH_NO_LLM: '1', PENSMITH_OFFLINE: '1' }, sourcesOffline: true, llmStubbed: true, dryRun: false, reason: 'PENSMITH_OFFLINE=1' },
  { name: 'values other than "1" do not switch a mode on', env: { PENSMITH_OFFLINE: 'true', PENSMITH_DRY_RUN: 'yes', PENSMITH_NO_LLM: '0' }, sourcesOffline: false, llmStubbed: false, dryRun: false, reason: null },
];

for (const row of TRUTH_TABLE) {
  test(`RUN-01 truth table: ${row.name}`, () => {
    withModeEnv(row.env, () => {
      const m = networkMode();
      assert.equal(m.sourcesOffline, row.sourcesOffline, 'sourcesOffline');
      assert.equal(m.llmStubbed, row.llmStubbed, 'llmStubbed');
      assert.equal(m.dryRun, row.dryRun, 'dryRun');
      assert.equal(m.reason, row.reason, 'reason');
      assert.equal(isOfflineMode(), row.sourcesOffline, 'isOfflineMode() === networkMode().sourcesOffline');
      assert.equal(m.fixturesAvailable, true, 'a source checkout has tests/fixtures/cassettes');
    });
  });
}

test('RUN-01: isTestContext() reads NODE_TEST_CONTEXT or PENSMITH_TEST=1 only', () => {
  withModeEnv({}, () => assert.equal(isTestContext(), false));
  withModeEnv({ NODE_TEST_CONTEXT: 'child' }, () => assert.equal(isTestContext(), true));
  withModeEnv({ PENSMITH_TEST: '1' }, () => assert.equal(isTestContext(), true));
  withModeEnv({ PENSMITH_TEST: '0' }, () => assert.equal(isTestContext(), false));
});

test('RUN-01: this test process itself runs under the test runner (sources offline)', () => {
  assert.equal(isTestContext(), true, 'node --test children carry NODE_TEST_CONTEXT');
  if (process.env['PENSMITH_NETWORK_TESTS'] !== '1' && process.env['PENSMITH_OFFLINE'] !== '1') {
    assert.equal(networkMode().reason, 'test runner');
  }
});

// ---------------------------------------------------------------------------
// D-17-08 fixed disclosure strings
// ---------------------------------------------------------------------------

test('RUN-02: the OFFLINE MODE banner copy is fixed (D-17-08)', () => {
  withModeEnv({ PENSMITH_OFFLINE: '1' }, () => {
    assert.equal(
      offlineBanner(),
      'OFFLINE MODE (reason: PENSMITH_OFFLINE=1): sources, verification, detector and plagiarism results are recorded fixtures, not live',
    );
  });
  withModeEnv({ PENSMITH_TEST: '1' }, () => {
    assert.equal(
      offlineBanner(),
      'OFFLINE MODE (reason: test runner): sources, verification, detector and plagiarism results are recorded fixtures, not live',
    );
  });
  withModeEnv({ PENSMITH_DRY_RUN: '1' }, () => {
    assert.equal(
      offlineBanner(),
      'OFFLINE MODE (reason: --dry-run): sources are labelled synthetic dry-run sources; no network or model call is made',
    );
  });
  withModeEnv({}, () => assert.equal(offlineBanner(), null, 'live prints no offline banner'));
});

test('RUN-02: the LLM STUBBED banner is independent of the network mode', () => {
  withModeEnv({ PENSMITH_NO_LLM: '1' }, () => {
    assert.equal(
      llmStubbedBanner(),
      'LLM STUBBED (PENSMITH_NO_LLM=1): every model call returns a deterministic stub; no provider is contacted',
    );
    assert.equal(offlineBanner(), null, 'NO_LLM alone is not offline');
  });
  withModeEnv({}, () => assert.equal(llmStubbedBanner(), null));
});

test('RUN-02: the artifact marker line is fixed and starts with the shared prefix', () => {
  withModeEnv({ PENSMITH_OFFLINE: '1' }, () => {
    assert.equal(offlineMarkerLine(), '> OFFLINE MODE (PENSMITH_OFFLINE=1) — recorded fixtures, not live results.');
  });
  withModeEnv({ PENSMITH_TEST: '1' }, () => {
    assert.equal(offlineMarkerLine(), '> OFFLINE MODE (test runner) — recorded fixtures, not live results.');
  });
  withModeEnv({ PENSMITH_DRY_RUN: '1' }, () => {
    assert.equal(offlineMarkerLine(), '> OFFLINE MODE (--dry-run) — synthetic dry-run sources, not live results.');
    assert.ok(offlineMarkerLine()!.startsWith(OFFLINE_MARKER_PREFIX));
  });
  withModeEnv({}, () => assert.equal(offlineMarkerLine(), null, 'live artifacts carry no marker'));
});

function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    chunks.push(String(s));
    return true;
  };
  try {
    fn();
  } finally {
    (process.stderr as unknown as { write: typeof orig }).write = orig;
  }
  return chunks.join('');
}

test('RUN-02: announceModes prints the banners exactly once per process, before other output', () => {
  withModeEnv({ PENSMITH_OFFLINE: '1', PENSMITH_NO_LLM: '1' }, () => {
    _resetAnnouncedForTest();
    const first = captureStderr(() => announceModes({ verb: 'status' }));
    const second = captureStderr(() => announceModes({ verb: 'status' }));
    assert.deepEqual(first.trimEnd().split('\n'), [
      'OFFLINE MODE (reason: PENSMITH_OFFLINE=1): sources, verification, detector and plagiarism results are recorded fixtures, not live',
      'LLM STUBBED (PENSMITH_NO_LLM=1): every model call returns a deterministic stub; no provider is contacted',
    ]);
    assert.equal(second, '', 'the banner is printed once per invocation');
  });
  withModeEnv({}, () => {
    _resetAnnouncedForTest();
    assert.equal(captureStderr(() => announceModes({ verb: 'research' })), '', 'a live run prints nothing');
  });
  withModeEnv({ PENSMITH_OFFLINE: '1' }, () => {
    _resetAnnouncedForTest();
    assert.equal(
      captureStderr(() => announceModes({ verb: null, argv: ['--version'] })),
      '',
      '--version / --help are citty meta, not a run',
    );
  });
  _resetAnnouncedForTest();
});

test('RUN-05: announceModes never refuses in a source checkout (fixtures are available)', () => {
  withModeEnv({ PENSMITH_OFFLINE: '1' }, () => {
    _resetAnnouncedForTest();
    captureStderr(() => assert.doesNotThrow(() => announceModes({ verb: 'verify' })));
  });
  _resetAnnouncedForTest();
});

// ---------------------------------------------------------------------------
// Static guarantees (chokepoint rows network-tests-seam + the no-env-bypass grep)
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

test('RUN-01: PENSMITH_NETWORK_TESTS is read ONLY by bin/lib/http-mock.ts across bin/, mcp/ and hooks/', () => {
  const hits: string[] = [];
  for (const root of ['bin', 'mcp', 'hooks']) {
    for (const f of walk(join(REPO, root))) {
      if (readFileSync(f, 'utf8').includes('PENSMITH_NETWORK_TESTS')) {
        hits.push(relative(REPO, f).split(sep).join('/'));
      }
    }
  }
  assert.deepEqual(hits, ['bin/lib/http-mock.ts']);
});

test('RUN-04: bin/lib/http.ts has no environment bypass (the mode lives in http-mock.ts)', () => {
  const src = readFileSync(join(REPO, 'bin', 'lib', 'http.ts'), 'utf8');
  const envReads = [...src.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([^'"]+)['"]\s*\])/g)].map(
    (m) => m[1] ?? m[2],
  );
  assert.deepEqual(
    [...new Set(envReads)],
    ['PENSMITH_CONTACT_EMAIL'],
    'http.ts may read only the contact email (User-Agent); every mode decision goes through networkMode()',
  );
  for (const name of ['NODE_TEST_CONTEXT', 'PENSMITH_TEST', 'PENSMITH_OFFLINE', 'PENSMITH_DRY_RUN', 'PENSMITH_NO_LLM', 'PENSMITH_NETWORK_TESTS', 'PENSMITH_RECORD_CASSETTES']) {
    assert.ok(!src.includes(name), `http.ts must not mention ${name}`);
  }
  assert.ok(!/process\.env\s*\[(?!\s*['"])/.test(src), 'no computed process.env[...] read in http.ts');
});

/** Every string literal / template chunk in a TS source (comments excluded). */
function stringLiterals(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

test('RUN-05: bin/lib/http-mock.ts is the only runtime module that builds a tests/ path', () => {
  const offenders: string[] = [];
  for (const root of ['bin', 'mcp', 'hooks']) {
    for (const f of walk(join(REPO, root))) {
      if (!/\.(ts|mts|cts)$/.test(f)) continue;
      const rel = relative(REPO, f).split(sep).join('/');
      if (rel === 'bin/lib/http-mock.ts') continue;
      // A string literal that IS a tests/ path (segment 'tests', 'tests/…', '../tests/…').
      if (stringLiterals(f).some((t) => /^(?:\.\.?[\\/])*tests(?:[\\/]|$)/.test(t))) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, []);
});
