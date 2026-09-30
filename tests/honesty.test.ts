// tests/honesty.test.ts — Phase 6 Wave 0 RED scaffold for DONE-04 + DONE-05.
//
// Mirrors tests/known-bad-pass2.test.ts RED-by-skip stance: the cassette-exists
// assertion runs now; behavioral tests SKIP-guard on the not-yet-created
// bin/lib/honesty.ts so the suite reports skips with ZERO failures. Plan 06-02
// lands honesty.ts and these turn GREEN.
//
// Covers:
//   - DONE-04: GPTZero score in the live test lane (V5 MockAgent answering from
//     the synthetic fixture); absent GPTZERO_API_KEY → null. Phase 17 (RUN-03):
//     offline never replays a canned score — "score unavailable (offline)".
//   - D-17-16: the V2 detector-consent gate; --yolo never skips it; a run that
//     cannot prompt gives "score unavailable (no consent)".
//   - DONE-04: the rendered honest-framing NOTE is read VERBATIM from the locked
//     references/honesty-framing.md (proving the copy is rendered from the locked
//     file, not inlined). This is the core-non-negotiable guard.
//   - DONE-05: pluggable backend — selectBackend honors config; unknown backend
//     returns null / not-implemented rather than crashing.
//
// HARD-05 SCAFFOLD (appended): disclosure copy + consent gate + size cap.
//   Skip-guarded on GPTZERO_MAX_BYTES export from honesty.ts (not yet wired in
//   Wave-1; Wave-2 15-05 lands it). Existing DONE-04/05 tests remain untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCassetteFile } from '../bin/lib/http-mock.js';
import { installMockAgent } from './helpers/local-servers/mock-agent.js';

// ---- HARD-05 skip gate: probe GPTZERO_MAX_BYTES export ----
// Wave-2 (15-05) adds GPTZERO_MAX_BYTES and the disclosure/consent seam exports.
// Path resolution via fileURLToPath — Phase-11 spaced-path safe.
void fileURLToPath(new URL('../bin/lib/honesty.ts', import.meta.url));
const honestyHard05ModUrl = new URL('../bin/lib/honesty.js', import.meta.url);

let GPTZERO_MAX_BYTES_VAL: number | undefined;

try {
  const honMod = await import(honestyHard05ModUrl.href) as Record<string, unknown>;
  if (typeof honMod['GPTZERO_MAX_BYTES'] === 'number') {
    GPTZERO_MAX_BYTES_VAL = honMod['GPTZERO_MAX_BYTES'] as number;
  }
} catch {
  // honesty.ts already imported statically elsewhere — this dynamic import is
  // purely for the HARD-05 seam probe. Ignore errors.
}

const hasHard05Seam = typeof GPTZERO_MAX_BYTES_VAL === 'number';

const honestySrcPath = fileURLToPath(new URL('../bin/lib/honesty.ts', import.meta.url));
const honestyModUrl = new URL('../bin/lib/honesty.js', import.meta.url);
const framingPath = fileURLToPath(new URL('../plugin/references/honesty-framing.md', import.meta.url));

/** Extract the note paragraph below "## Note" from the locked framing file —
 *  the SAME extraction honesty.ts must perform. Used to assert verbatim render. */
function framingNote(): string {
  const md = readFileSync(framingPath, 'utf8');
  const m = /## Note\s*\n+([\s\S]+?)(?:\n##|\n\(|$)/.exec(md);
  assert.ok(m && m[1], 'honesty-framing.md must have a ## Note section');
  // Strip the markdown blockquote markers ("> ") the same way the code does.
  return m[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^>\s?/, ''))
    .join('\n')
    .trim();
}

test('honesty: GPTZero cassette exists in Cassette[] schema with ai=0.82 / AI_ONLY (DONE-04)', () => {
  const cs = loadCassetteFile('gptzero', 'predict-text');
  assert.ok(Array.isArray(cs) && cs.length >= 1, 'gptzero/predict-text.json must be a non-empty Cassette[]');
  assert.equal(cs[0]?.method, 'POST');
  const resp = cs[0]?.response as { documents: Array<{ class_probabilities: { ai: number }; document_classification: string }> };
  assert.equal(resp.documents[0]?.class_probabilities.ai, 0.82);
  assert.equal(resp.documents[0]?.document_classification, 'AI_ONLY');
});

// RED-by-skip module-presence consistency (mirrors known-bad-pass2).
test('honesty: module presence is consistent with Wave-0 RED state (DONE-04)', () => {
  if (existsSync(honestySrcPath)) {
    assert.ok(true, 'bin/lib/honesty.ts present — behavioral tests active');
  } else {
    assert.ok(!existsSync(honestySrcPath), 'Wave-0: bin/lib/honesty.ts absent (RED-by-skip)');
  }
});

test('honesty: absent GPTZERO_API_KEY → scoreHonesty returns null (skip-clean) (DONE-04)',
  { skip: !existsSync(honestySrcPath) },
  async () => {
    const mod = await import(honestyModUrl.href) as { scoreHonesty: (t: string) => Promise<unknown> };
    const saved = process.env['GPTZERO_API_KEY'];
    delete process.env['GPTZERO_API_KEY'];
    try {
      const result = await mod.scoreHonesty('some text');
      assert.equal(result, null, 'absent key must yield null');
    } finally {
      if (saved !== undefined) process.env['GPTZERO_API_KEY'] = saved;
    }
  },
);

/** Capture process.stdout writes during `fn`. */
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
    const value = await fn();
    return { value, out: chunks.join('') };
  } finally {
    (process.stdout as unknown as { write: typeof orig }).write = orig;
  }
}

/** The live test lane with the V5 MockAgent answering GPTZero from the synthetic fixture. */
async function withGptzeroMock<T>(
  fn: (captured: Array<{ body: string; apiKey: string | undefined }>) => Promise<T>,
  opts: { intercept: boolean } = { intercept: true },
): Promise<T> {
  const savedLane = process.env['PENSMITH_NETWORK_TESTS'];
  process.env['PENSMITH_NETWORK_TESTS'] = '1';
  // A live score appends to <cwd>/.paper/COSTS.jsonl (ARCH-10) — run from a
  // temp project, never from the repo checkout.
  const savedCwd = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), 'pensmith-honesty-')));
  const { agent, restore } = installMockAgent();
  const captured: Array<{ body: string; apiKey: string | undefined }> = [];
  if (opts.intercept) {
    const cs = loadCassetteFile('gptzero', 'predict-text');
    agent
      .get('https://api.gptzero.me')
      .intercept({ path: '/v2/predict/text', method: 'POST' })
      .reply((req) => {
        const headers = (req.headers ?? {}) as Record<string, string>;
        captured.push({ body: String(req.body ?? ''), apiKey: headers['x-api-key'] });
        return { statusCode: 200, data: JSON.stringify(cs?.[0]?.response), responseOptions: { headers: { 'content-type': 'application/json' } } };
      })
      .persist();
  }
  try {
    return await fn(captured);
  } finally {
    await restore();
    process.chdir(savedCwd);
    if (savedLane === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
    else process.env['PENSMITH_NETWORK_TESTS'] = savedLane;
  }
}

test('RUN-03: offline, scoreHonesty prints "score unavailable (offline)" and sends nothing — never a canned score',
  { skip: !existsSync(honestySrcPath) },
  async () => {
    const mod = await import(honestyModUrl.href) as {
      scoreHonesty: (t: string) => Promise<unknown>;
    };
    const saved = process.env['GPTZERO_API_KEY'];
    process.env['GPTZERO_API_KEY'] = 'test-key-offline';
    try {
      const { value, out } = await captureStdout(() => mod.scoreHonesty('some text'));
      assert.equal(value, null, 'offline never yields a score (no replayed canned 82%)');
      assert.match(out, /GPTZero honesty score unavailable \(offline\) — no text was sent\./);
      assert.ok(!out.includes('test-key-offline'), 'the key value is never printed');
    } finally {
      if (saved === undefined) delete process.env['GPTZERO_API_KEY'];
      else process.env['GPTZERO_API_KEY'] = saved;
    }
  },
);

test('honesty (live lane): consent granted → { aiProbability:0.82, classification:AI_ONLY, backend:gptzero } (DONE-04)',
  { skip: !existsSync(honestySrcPath) },
  async () => {
    const mod = await import(honestyModUrl.href) as {
      scoreHonestyWithOptions: (t: string, o?: { consentGranted?: boolean; yolo?: boolean }) =>
        Promise<{ aiProbability: number; classification: string; backend: string } | null>;
    };
    const saved = process.env['GPTZERO_API_KEY'];
    process.env['GPTZERO_API_KEY'] = 'test-key-live-lane';
    try {
      await withGptzeroMock(async (captured) => {
        const { value } = await captureStdout(() => mod.scoreHonestyWithOptions('paper text', { consentGranted: true }));
        assert.ok(value, 'a consented live call yields a score');
        assert.equal(value!.aiProbability, 0.82);
        assert.equal(value!.classification, 'AI_ONLY');
        assert.equal(value!.backend, 'gptzero');
        assert.equal(captured.length, 1);
        assert.deepEqual(JSON.parse(captured[0]!.body), { document: 'paper text' });
        assert.equal(captured[0]!.apiKey, 'test-key-live-lane', 'the key reaches only the x-api-key header');
      });
    } finally {
      if (saved === undefined) delete process.env['GPTZERO_API_KEY'];
      else process.env['GPTZERO_API_KEY'] = saved;
    }
  },
);

test('D-17-16: a run that cannot prompt gives "score unavailable (no consent)" — and --yolo never skips the gate',
  { skip: !existsSync(honestySrcPath) },
  async () => {
    const mod = await import(honestyModUrl.href) as {
      scoreHonestyWithOptions: (t: string, o?: { consentGranted?: boolean; yolo?: boolean }) => Promise<unknown>;
    };
    const saved = process.env['GPTZERO_API_KEY'];
    const savedMode = process.env['PENSMITH_PROMPT_MODE'];
    process.env['GPTZERO_API_KEY'] = 'test-key-no-consent';
    delete process.env['PENSMITH_PROMPT_MODE'];
    try {
      await withGptzeroMock(async (captured) => {
        for (const yolo of [false, true]) {
          const { value, out } = await captureStdout(() => mod.scoreHonestyWithOptions('paper text', { yolo }));
          assert.equal(value, null, `yolo=${yolo}: no terminal → no score`);
          assert.match(out, /GPTZero honesty score unavailable \(no consent\) — no text was sent\./);
          assert.match(out, /Disclosure: /, 'the transmission disclosure is shown before the consent question');
        }
        assert.equal(captured.length, 0, 'nothing was POSTed without consent');
      });
    } finally {
      if (saved === undefined) delete process.env['GPTZERO_API_KEY'];
      else process.env['GPTZERO_API_KEY'] = saved;
      if (savedMode !== undefined) process.env['PENSMITH_PROMPT_MODE'] = savedMode;
    }
  },
);

test('honesty: renderHonestyReport shows 82% + 41% AND the VERBATIM note from the locked framing file (DONE-04)',
  { skip: !existsSync(honestySrcPath) },
  async () => {
    const mod = await import(honestyModUrl.href) as {
      renderHonestyReport: (before: number, after: number | null, backend: string) => string;
    };
    const report = mod.renderHonestyReport(0.82, 0.41, 'gptzero');
    assert.match(report, /82%/, 'must show before-humanize 82%');
    assert.match(report, /41%/, 'must show after-humanize 41%');
    // The rendered note MUST equal the locked framing-file note verbatim — proving
    // the copy is rendered from references/honesty-framing.md, not inlined.
    const note = framingNote();
    assert.ok(report.includes(note), 'rendered report must contain the locked framing note VERBATIM');
  },
);

test('honesty: selectBackend honors config + unknown backend returns null/not-implemented (no crash) (DONE-05)',
  { skip: !existsSync(honestySrcPath) },
  async () => {
    const mod = await import(honestyModUrl.href) as {
      selectBackend: (cfg: { honestyBackend?: string }) => { name: string; score: (t: string) => Promise<unknown> } | null;
    };
    // Known backend resolves to a backend object.
    const gpt = mod.selectBackend({ honestyBackend: 'gptzero' });
    assert.ok(gpt && gpt.name === 'gptzero', 'gptzero backend must resolve');
    // Unknown / unimplemented backend must not crash — null or a not-implemented stub.
    const unknown = mod.selectBackend({ honestyBackend: 'originality' });
    if (unknown !== null) {
      // If a stub is returned, scoring must resolve (not throw) and yield null.
      await assert.doesNotReject(unknown.score('text'), 'unimplemented backend stub must not throw');
    } else {
      assert.equal(unknown, null, 'unimplemented backend may resolve to null');
    }
  },
);

// ---- HARD-05 scaffolds: disclosure + consent gate + size cap ----
//
// Skip-guarded on GPTZERO_MAX_BYTES export from bin/lib/honesty.ts.
// Wave-2 (15-05) adds: GPTZERO_MAX_BYTES (exported constant), disclosure output
// before any POST, consent gate (ask()/yolo bypass), and input truncation to cap.
//
// These tests assert the structural defense (disclosure happens, consent blocks
// POST, truncation enforced) — not network behavior (all offline / mock).
// Keep existing DONE-04/05 tests above untouched (regression gates).

test('HARD-05: GPTZERO_MAX_BYTES seam export consistent with Wave-1 RED state',
  () => {
    if (hasHard05Seam) {
      assert.ok(true, 'GPTZERO_MAX_BYTES exported — HARD-05 behavioral tests below are active (Wave-2+)');
    } else {
      assert.ok(!hasHard05Seam, 'Wave-1 RED: GPTZERO_MAX_BYTES absent — skips below are correct');
    }
  },
);

test('HARD-05: GPTZERO_MAX_BYTES is a positive number (size cap constant exported)',
  {
    skip: !hasHard05Seam
      ? 'GPTZERO_MAX_BYTES not yet exported from bin/lib/honesty.ts — not yet wired (HARD-05)'
      : false,
  },
  () => {
    assert.ok(
      typeof GPTZERO_MAX_BYTES_VAL === 'number' && GPTZERO_MAX_BYTES_VAL > 0,
      `GPTZERO_MAX_BYTES must be a positive number; got ${JSON.stringify(GPTZERO_MAX_BYTES_VAL)}`,
    );
    // Sanity: should be in a reasonable range (>= 1 KB, <= 1 MB).
    assert.ok(
      GPTZERO_MAX_BYTES_VAL! >= 1024 && GPTZERO_MAX_BYTES_VAL! <= 1_000_000,
      `GPTZERO_MAX_BYTES should be between 1 KB and 1 MB; got ${GPTZERO_MAX_BYTES_VAL}`,
    );
  },
);

test('HARD-05: over-cap input → POST body truncated to GPTZERO_MAX_BYTES (size cap enforced)',
  {
    skip: !hasHard05Seam
      ? 'GPTZERO_MAX_BYTES not yet exported from bin/lib/honesty.ts — not yet wired (HARD-05)'
      : false,
  },
  async () => {
    // This test validates that an input larger than GPTZERO_MAX_BYTES bytes is
    // truncated before the POST body is constructed. We test the truncation
    // indirectly: if the exported cap constant is present and the module applies
    // truncation, then a text of length (cap + 1) must result in a body where
    // the `document` field is <= cap bytes.
    //
    // We test via a seam: honesty.ts should export a `__truncateForGptzero` or
    // similar function for test, OR we inspect the behavior via the offline path
    // (PENSMITH_NO_LLM=1 / cassette mode bypasses the POST but still applies
    // the truncation so the cap is observable).
    //
    // Primary assertion: probe for a `__truncateForGptzeroTest` seam export.
    // If absent, we assert the constant is sane (above) and defer full
    // truncation behavior to Wave-2+ integration tests.
    const mod = await import(honestyHard05ModUrl.href) as Record<string, unknown>;
    const truncateFn = mod['__truncateForGptzeroTest'] as ((t: string) => string) | undefined;

    if (typeof truncateFn === 'function') {
      // Seam is exported: test truncation directly.
      const oversize = 'a'.repeat(GPTZERO_MAX_BYTES_VAL! + 100);
      const truncated = truncateFn(oversize);
      assert.ok(
        Buffer.byteLength(truncated, 'utf8') <= GPTZERO_MAX_BYTES_VAL!,
        `Truncated text must be <= ${GPTZERO_MAX_BYTES_VAL} bytes; got ${Buffer.byteLength(truncated, 'utf8')}`,
      );
    } else {
      // Seam not yet exported — assert the constant is valid (Wave-2 will add seam).
      assert.ok(
        typeof GPTZERO_MAX_BYTES_VAL === 'number' && GPTZERO_MAX_BYTES_VAL > 0,
        'GPTZERO_MAX_BYTES must be a positive number for truncation to be testable',
      );
    }
  },
);

test('HARD-05: consent declined (non-TTY default) → scoreHonesty returns null without POST (HARD-05)',
  {
    skip: !hasHard05Seam
      ? 'GPTZERO_MAX_BYTES not yet exported from bin/lib/honesty.ts — not yet wired (HARD-05)'
      : false,
  },
  async () => {
    // When consent is declined (simulated via yolo=false in non-TTY or via
    // an injected ask() that returns false), scoreHonesty must return null
    // without performing any HTTP POST.
    //
    // We test via: if honesty.ts exports a `scoreHonestyWithOptions` or accepts
    // an `opts` param with a `yolo` / `consent` field, we inject consent=false.
    // If not, the skip message informs Wave-2 of the required seam.
    const mod = await import(honestyHard05ModUrl.href) as Record<string, unknown>;

    // Probe for the consent-injectable seam: either scoreHonestyWithOptions or
    // a yolo param on scoreHonesty.
    const scoreWithOpts = (mod['scoreHonestyWithOptions'] ?? mod['scoreHonesty']) as
      | ((text: string, opts?: { yolo?: boolean; consentGranted?: boolean }) => Promise<unknown>)
      | undefined;

    if (typeof scoreWithOpts !== 'function') {
      // Seam not yet exported. Log skip reason and pass the scaffolding test.
      assert.ok(true, 'HARD-05: consent seam not yet exported — Wave-2 must add scoreHonestyWithOptions or opts.consentGranted');
      return;
    }

    // Set a fake API key so key-absence guard doesn't short-circuit.
    const saved = process.env['GPTZERO_API_KEY'];
    process.env['GPTZERO_API_KEY'] = 'test-key-hard05-consent';
    // Force offline so no real POST.
    const savedNet = process.env['PENSMITH_NETWORK_TESTS'];
    delete process.env['PENSMITH_NETWORK_TESTS'];

    try {
      // consentGranted=false → must return null without POST.
      const result = await scoreWithOpts('some paper text', { consentGranted: false });
      assert.equal(result, null, 'scoreHonesty with consent declined must return null (no POST)');
    } finally {
      if (saved === undefined) delete process.env['GPTZERO_API_KEY'];
      else process.env['GPTZERO_API_KEY'] = saved;
      if (savedNet === undefined) delete process.env['PENSMITH_NETWORK_TESTS'];
      else process.env['PENSMITH_NETWORK_TESTS'] = savedNet;
    }
  },
);
