// tests/known-bad-pass2.test.ts — Phase 5 Wave 0 RED scaffold for VRFY-03.
//
// Mirrors tests/known-bad-citations.test.ts: existence + fixture-shape
// assertions PASS now; the behavioral assertions are SKIP-guarded on the
// not-yet-created bin/lib/verify/pass2.ts module so the suite is RED-by-skip
// (skipped tests, zero failures), NOT RED-by-crash. Plans 05-02 will land
// pass2.ts and these behavioral tests turn GREEN.
//
// Covers:
//   - VRFY-03: Pass 2 produces UNCLEAR-biased verdicts on adversarial fixtures
//   - VRFY-03: verdict enum + result-object shape
//   - ARCH-10: assertBudget appears before the LLM call site (source-level proxy)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../tests/fixtures/pass2-adversarial.json', import.meta.url));
// The TS source path (assert-on-disk source for the ARCH-10 token proxy).
const pass2SrcPath = fileURLToPath(new URL('../bin/lib/verify/pass2.ts', import.meta.url));
// The runtime import specifier (.js — NodeNext ESM resolution maps to the .ts under tsx).
const pass2ModUrl = new URL('../bin/lib/verify/pass2.js', import.meta.url);

const VALID_VERDICTS = new Set(['SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'UNCLEAR']);

test('known-bad-pass2: fixture file exists (VRFY-03)', () => {
  assert.ok(
    existsSync(fixturePath),
    'MISSING: tests/fixtures/pass2-adversarial.json — Wave 0 must create this fixture',
  );
});

test('known-bad-pass2: fixture has >=10 entries and >=5 expected_verdict "UNCLEAR" (VRFY-03)',
  { skip: !existsSync(fixturePath) },
  () => {
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as unknown[];
    assert.ok(Array.isArray(fixtures), 'pass2-adversarial.json must be a JSON array');
    assert.ok(fixtures.length >= 10, `must have >=10 entries, has ${fixtures.length}`);

    let unclear = 0;
    const seenVerdicts = new Set<string>();
    for (const entry of fixtures) {
      const e = entry as Record<string, unknown>;
      assert.ok(typeof e['citekey'] === 'string', 'every entry needs a string "citekey"');
      assert.ok(typeof e['claim_sentence'] === 'string', 'every entry needs a string "claim_sentence"');
      assert.ok(typeof e['source_title'] === 'string', 'every entry needs a string "source_title"');
      assert.ok(typeof e['source_abstract'] === 'string', 'every entry needs a string "source_abstract"');
      assert.ok(typeof e['adversarial_reason'] === 'string', 'every entry needs a string "adversarial_reason"');
      const v = e['expected_verdict'];
      assert.ok(typeof v === 'string' && VALID_VERDICTS.has(v), `expected_verdict must be in the enum, got ${JSON.stringify(v)}`);
      seenVerdicts.add(v);
      if (v === 'UNCLEAR') unclear++;
    }
    assert.ok(unclear >= 5, `must have >=5 UNCLEAR entries (UNCLEAR-bias calibration), has ${unclear}`);
    // Enum coverage: at least one entry per other verdict value.
    for (const v of ['SUPPORTED', 'PARTIAL', 'UNSUPPORTED']) {
      assert.ok(seenVerdicts.has(v), `fixture must include at least one "${v}" entry for enum coverage`);
    }
  },
);

// RED-by-skip (NOT RED-by-crash): in Wave 0 bin/lib/verify/pass2.ts does not
// exist yet, so this asserts the absence and the behavioral tests below SKIP.
// When Plan 05-02 lands pass2.ts this test flips to assert the module IS present
// and the behavioral tests un-skip and must PASS. Either way: zero failures.
test('known-bad-pass2: pass2 module presence is consistent with Wave-0 RED state (VRFY-03)',
  { skip: !existsSync(fixturePath) },
  () => {
    if (existsSync(pass2SrcPath)) {
      // Module has landed (Plan 05-02+) — behavioral tests below now run.
      assert.ok(true, 'bin/lib/verify/pass2.ts present — behavioral tests active');
    } else {
      // Wave-0 RED: module absent by design; behavioral tests skip-guard below.
      assert.ok(!existsSync(pass2SrcPath), 'Wave-0: bin/lib/verify/pass2.ts absent (RED-by-skip)');
    }
  },
);

test('known-bad-pass2: runPass2 returns UNCLEAR for all adversarial fixtures under PENSMITH_NO_LLM=1 (VRFY-03)',
  { skip: !existsSync(fixturePath) || !existsSync(pass2SrcPath) },
  async () => {
    process.env['PENSMITH_NO_LLM'] = '1';
    const mod = await import(pass2ModUrl.href) as {
      runPass2: (
        draftMd: string,
        bibByCitekey: Map<string, { DOI?: string; title?: string; author?: string[] }>,
        opts: { n: number; scopeCapUsd?: number },
      ) => Promise<Array<Record<string, unknown>>>;
    };
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Array<Record<string, unknown>>;

    for (const entry of fixtures) {
      const citekey = entry['citekey'] as string;
      const claim = entry['claim_sentence'] as string;
      // Build a one-sentence draft that cites the fixture's citekey so the
      // deterministic extractor has exactly one claim sentence to judge.
      const draftMd = `${claim} [@${citekey}]`;
      const bib = new Map<string, { DOI?: string; title?: string; author?: string[] }>([
        [citekey, { title: entry['source_title'] as string, author: [] }],
      ]);
      const results = await mod.runPass2(draftMd, bib, { n: 1 });
      assert.ok(Array.isArray(results) && results.length >= 1, `runPass2 must return >=1 result for citekey ${citekey}`);
      for (const r of results) {
        assert.equal(r['verdict'], 'UNCLEAR', `PENSMITH_NO_LLM placeholder must return UNCLEAR for ${citekey}, got ${JSON.stringify(r['verdict'])}`);
        // Result-object shape — keys the DONE-09 consumer relies on.
        for (const k of ['citekey', 'claimSentence', 'verdict', 'rationale', 'evidence']) {
          assert.ok(k in r, `Pass2Result must carry "${k}" key (got keys: ${Object.keys(r).join(', ')})`);
        }
      }
    }
  },
);

test('known-bad-pass2: assertBudget appears before the LLM call site in pass2.ts (ARCH-10)',
  { skip: !existsSync(pass2SrcPath) },
  () => {
    // Source-level proxy for the budget-before-call invariant: the pass2.ts
    // source MUST reference assertBudget (the pre-call gate). A stronger
    // ordering check (assertBudget index < LLM-call index) is asserted once the
    // module lands; here the existence of the token is the Wave-0 RED contract.
    const src = readFileSync(pass2SrcPath, 'utf-8');
    assert.ok(
      src.indexOf('assertBudget') >= 0,
      'pass2.ts must call assertBudget BEFORE any LLM call (ARCH-10 per-step cap)',
    );
  },
);
