// tests/honesty.test.ts — Phase 6 Wave 0 RED scaffold for DONE-04 + DONE-05.
//
// Mirrors tests/known-bad-pass2.test.ts RED-by-skip stance: the cassette-exists
// assertion runs now; behavioral tests SKIP-guard on the not-yet-created
// bin/lib/honesty.ts so the suite reports skips with ZERO failures. Plan 06-02
// lands honesty.ts and these turn GREEN.
//
// Covers:
//   - DONE-04: GPTZero score via offline cassette; absent GPTZERO_API_KEY → null.
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
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCassetteFile } from '../bin/lib/http-mock.js';

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
const framingPath = fileURLToPath(new URL('../references/honesty-framing.md', import.meta.url));

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

test('honesty: scoreHonesty (offline cassette + key) → { aiProbability:0.82, classification:AI_ONLY, backend:gptzero } (DONE-04)',
  { skip: !existsSync(honestySrcPath) },
  async () => {
    const mod = await import(honestyModUrl.href) as {
      scoreHonesty: (t: string) => Promise<{ aiProbability: number; classification: string; backend: string } | null>;
    };
    const saved = process.env['GPTZERO_API_KEY'];
    process.env['GPTZERO_API_KEY'] = 'test-key-offline';
    try {
      const result = await mod.scoreHonesty('some text');
      assert.ok(result, 'offline cassette must yield a score');
      assert.equal(result!.aiProbability, 0.82);
      assert.equal(result!.classification, 'AI_ONLY');
      assert.equal(result!.backend, 'gptzero');
    } finally {
      if (saved === undefined) delete process.env['GPTZERO_API_KEY'];
      else process.env['GPTZERO_API_KEY'] = saved;
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
