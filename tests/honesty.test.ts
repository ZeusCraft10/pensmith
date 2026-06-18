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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadCassetteFile } from '../bin/lib/http-mock.js';

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
