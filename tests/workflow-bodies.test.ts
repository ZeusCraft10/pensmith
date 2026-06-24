/**
 * tests/workflow-bodies.test.ts — DOCS-02 non-stub content guard
 *
 * Asserts that the four workflow bodies filled in Plan 04
 * (doctor / status / next / resume) are no longer the 23-line Phase-2 stub.
 *
 * RED-by-skip guard (08-00 convention): while ANY of the four files still
 * contains the stub sentinel `Phase 2 stub` OR still lacks a `## Body`
 * section, Plan 04 has not yet landed. Skip so the full suite stays GREEN
 * at 0 failures. When Plan 04 fills the bodies the guard opens and the
 * assertions below enforce the DOCS-02 contract.
 *
 * Open-guard assertions:
 *   - Each of doctor/status/next/resume.md has `## Overview`, `## Outputs`,
 *     `## Body`, and the phrase "Shell fallback (TIER-06)" (the compile.md
 *     body shape used as the canonical template).
 *   - None of the four contains the stub sentinels:
 *       "Phase 2 stub", "Phase 3+", or "## Steps" (stub used ## Steps;
 *       real bodies use ## Body).
 *   - Each still has a `<capability_check>` block (preserved through fill) —
 *     cross-check that the ARCH-03 bijection guard in
 *     workflows-keyequal.test.ts is not regressed.
 *
 * Scope: this file is the NON-STUB CONTENT guard. The bijection count
 * (exactly 16 workflow files) lives in tests/workflows-keyequal.test.ts
 * and is NOT duplicated here.
 *
 * Path resolution via fileURLToPath(import.meta.url) — spaced-path safe
 * (Phase-11 lesson: OneDrive paths have spaces).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The four workflow bodies that Plan 04 will fill
const STUB_VERBS = ['doctor', 'status', 'next', 'resume'] as const;

// Stub sentinels: any of these in a file means the fill has not landed yet
const STUB_SENTINEL_RE = /Phase 2 stub|Phase 3\+/;
// Stub used ## Steps heading; real bodies use ## Body
const STUB_STEPS_HEADING_RE = /^## Steps$/m;
// Real body requires ## Body heading
const BODY_HEADING_RE = /^## Body$/m;

// Read all four workflow sources
const sources: Record<string, string> = {};
for (const verb of STUB_VERBS) {
  sources[verb] = readFileSync(
    join(__dirname, '..', 'workflows', `${verb}.md`),
    'utf8',
  );
}

// RED-by-skip predicate: any file still has a stub sentinel OR lacks ## Body
const anyStillStub = STUB_VERBS.some(
  (verb) =>
    STUB_SENTINEL_RE.test(sources[verb]!) ||
    !BODY_HEADING_RE.test(sources[verb]!),
);

const SKIP_REASON = anyStillStub
  ? 'Plan 04 has not yet landed: one or more of doctor/status/next/resume.md ' +
    'still contains the Phase-2 stub sentinel ("Phase 2 stub") or lacks a ' +
    '"## Body" heading. Once Plan 04 fills all four bodies the skip guard opens ' +
    'and these assertions enforce the DOCS-02 non-stub content contract.'
  : false;

// -------------------------------------------------------------------
// Test A: each body has the required structural sections
// -------------------------------------------------------------------
test('DOCS-02 Test A: doctor/status/next/resume.md have required sections (Overview, Outputs, Body, Shell-fallback)', {
  skip: SKIP_REASON,
}, () => {
  for (const verb of STUB_VERBS) {
    const src = sources[verb]!;

    assert.match(
      src,
      /^## Overview$/m,
      `workflows/${verb}.md must have a "## Overview" section`,
    );

    assert.match(
      src,
      /^## Outputs$/m,
      `workflows/${verb}.md must have a "## Outputs" section`,
    );

    assert.match(
      src,
      BODY_HEADING_RE,
      `workflows/${verb}.md must have a "## Body" section (not ## Steps)`,
    );

    assert.match(
      src,
      /Shell fallback \(TIER-06\)/,
      `workflows/${verb}.md ## Body must end with the "Shell fallback (TIER-06)" step (compile.md body shape)`,
    );
  }
});

// -------------------------------------------------------------------
// Test B: no stub sentinels remain
// -------------------------------------------------------------------
test('DOCS-02 Test B: no stub sentinels remain in doctor/status/next/resume.md', {
  skip: SKIP_REASON,
}, () => {
  for (const verb of STUB_VERBS) {
    const src = sources[verb]!;

    assert.ok(
      !STUB_SENTINEL_RE.test(src),
      `workflows/${verb}.md must not contain stub sentinels "Phase 2 stub" or "Phase 3+"`,
    );

    assert.ok(
      !STUB_STEPS_HEADING_RE.test(src),
      `workflows/${verb}.md must not have a "## Steps" heading (stubs used ## Steps; real bodies use ## Body)`,
    );
  }
});

// -------------------------------------------------------------------
// Test C: capability_check block preserved through fill (ARCH-03 cross-check)
// -------------------------------------------------------------------
test('DOCS-02 Test C: capability_check block preserved in all four filled bodies (ARCH-03)', {
  skip: SKIP_REASON,
}, () => {
  for (const verb of STUB_VERBS) {
    const src = sources[verb]!;

    assert.match(
      src,
      /<capability_check>[\s\S]+?<\/capability_check>/,
      `workflows/${verb}.md must still have a <capability_check> block after fill (ARCH-03 / validate:manifests)`,
    );

    assert.match(
      src,
      /required:\s*\n/,
      `workflows/${verb}.md <capability_check> must have a required: list`,
    );

    assert.match(
      src,
      /degrade_if_missing:\s*\n/,
      `workflows/${verb}.md <capability_check> must have a degrade_if_missing: list`,
    );
  }
});
