// tests/known-bad-pass4.test.ts — Phase 5 Wave 0 RED scaffold for VRFY-06.
//
// Mirrors tests/known-bad-citations.test.ts: existence + fixture-shape
// assertions PASS now; behavioral assertions are SKIP-guarded on the
// not-yet-created bin/lib/verify/pass4.ts module so the suite is RED-by-skip
// (skipped tests, zero failures), NOT RED-by-crash. Plan 05-03 lands pass4.ts.
//
// Covers:
//   - VRFY-06 / PRD §14: extractClaimsFromParagraph is DETERMINISTIC (same
//     input -> deep-equal output across calls).
//   - VRFY-06: orphanCount equals the value the PINNED R1-R8 rule produces for
//     each fixture entry (counts authored in tests/fixtures/pass4-orphan.json).
//   - Definition-style sentence (shape d) contributes 0 orphans (R4 skip).
//
// orphanCount is HIGH-only and LLM-INDEPENDENT: PENSMITH_NO_LLM=1 is set so the
// Step-3 edge-case LLM is skipped; AMBIGUOUS labeling never changes the count.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('../tests/fixtures/pass4-orphan.json', import.meta.url));
const pass4SrcPath = fileURLToPath(new URL('../bin/lib/verify/pass4.ts', import.meta.url));
const pass4ModUrl = new URL('../bin/lib/verify/pass4.js', import.meta.url);

interface OrphanFixture {
  paragraph: string;
  in_text_citekeys: string[];
  expected_orphan_count: number;
  description: string;
}

test('known-bad-pass4: fixture file exists (VRFY-06)', () => {
  assert.ok(
    existsSync(fixturePath),
    'MISSING: tests/fixtures/pass4-orphan.json — Wave 0 must create this fixture',
  );
});

test('known-bad-pass4: fixture is well-formed and includes the required shapes (VRFY-06)',
  { skip: !existsSync(fixturePath) },
  () => {
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as OrphanFixture[];
    assert.ok(Array.isArray(fixtures), 'pass4-orphan.json must be a JSON array');
    assert.ok(fixtures.length >= 4, `must have >=4 entries (shapes a/c/d + canonical), has ${fixtures.length}`);

    for (const e of fixtures) {
      assert.ok(typeof e.paragraph === 'string' && e.paragraph.length > 0, 'every entry needs a non-empty "paragraph"');
      assert.ok(Array.isArray(e.in_text_citekeys), 'every entry needs an "in_text_citekeys" array');
      assert.ok(Number.isInteger(e.expected_orphan_count) && e.expected_orphan_count >= 0, 'every entry needs an integer "expected_orphan_count" >= 0');
      assert.ok(typeof e.description === 'string' && e.description.length > 0, 'every entry needs a "description" walk');
    }

    // At least one zero-orphan control entry.
    assert.ok(fixtures.some((e) => e.expected_orphan_count === 0), 'fixture must include >=1 control entry with expected_orphan_count 0');
    // At least one definition-style non-claim entry (R4 skip) with count 0.
    assert.ok(
      fixtures.some((e) => /\b(defined as|refers to|known as)\b/i.test(e.paragraph) && e.expected_orphan_count === 0),
      'fixture must include a definition-style non-claim entry (R4) with expected_orphan_count 0',
    );
    // The CANONICAL Climate-change entry with expected_orphan_count 1.
    assert.ok(
      fixtures.some((e) =>
        e.paragraph.startsWith('Climate change demonstrates accelerating ice loss across both polar regions.')
        && e.expected_orphan_count === 1),
      'fixture must include the canonical Climate-change paragraph with expected_orphan_count 1',
    );
  },
);

// RED-by-skip (NOT RED-by-crash): in Wave 0 bin/lib/verify/pass4.ts does not
// exist yet, so this asserts the absence and the behavioral tests below SKIP.
// When Plan 05-03 lands pass4.ts this test flips to assert the module IS present
// and the behavioral tests un-skip and must PASS. Either way: zero failures.
test('known-bad-pass4: pass4 module presence is consistent with Wave-0 RED state (VRFY-06)',
  { skip: !existsSync(fixturePath) },
  () => {
    if (existsSync(pass4SrcPath)) {
      // Module has landed (Plan 05-03+) — behavioral tests below now run.
      assert.ok(true, 'bin/lib/verify/pass4.ts present — behavioral tests active');
    } else {
      // Wave-0 RED: module absent by design; behavioral tests skip-guard below.
      assert.ok(!existsSync(pass4SrcPath), 'Wave-0: bin/lib/verify/pass4.ts absent (RED-by-skip)');
    }
  },
);

test('known-bad-pass4: extractClaimsFromParagraph is deterministic (VRFY-06, PRD §14)',
  { skip: !existsSync(pass4SrcPath) },
  async () => {
    const mod = await import(pass4ModUrl.href) as {
      extractClaimsFromParagraph: (para: string) => unknown[];
    };
    const para = 'The analysis demonstrates that the catalyst reveals a stronger binding affinity than predicted. This consequently confirms that the effect proves reproducible across laboratories.';
    const r1 = mod.extractClaimsFromParagraph(para);
    const r2 = mod.extractClaimsFromParagraph(para);
    assert.deepEqual(r1, r2, 'extractClaimsFromParagraph must be deterministic across repeated calls (no NLP non-determinism)');
  },
);

test('known-bad-pass4: orphanCount matches the PINNED-rule fixture counts under PENSMITH_NO_LLM=1 (VRFY-06)',
  { skip: !existsSync(fixturePath) || !existsSync(pass4SrcPath) },
  async () => {
    process.env['PENSMITH_NO_LLM'] = '1';
    const mod = await import(pass4ModUrl.href) as {
      runPass4: (draftMd: string, opts: { n: number; scopeCapUsd?: number }) => Promise<Array<{ orphanCount: number }>>;
    };
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as OrphanFixture[];

    for (const entry of fixtures) {
      const results = await mod.runPass4(entry.paragraph, { n: 1 });
      const orphans = results.reduce((s, r) => s + r.orphanCount, 0);
      assert.equal(
        orphans,
        entry.expected_orphan_count,
        `orphanCount mismatch (expected ${entry.expected_orphan_count}, got ${orphans}) for: ${entry.paragraph.slice(0, 70)}`,
      );
    }
  },
);

test('known-bad-pass4: definition-style sentence yields 0 orphans (R4 non-claim, VRFY-06)',
  { skip: !existsSync(fixturePath) || !existsSync(pass4SrcPath) },
  async () => {
    process.env['PENSMITH_NO_LLM'] = '1';
    const mod = await import(pass4ModUrl.href) as {
      runPass4: (draftMd: string, opts: { n: number; scopeCapUsd?: number }) => Promise<Array<{ orphanCount: number }>>;
    };
    const fixtures = JSON.parse(readFileSync(fixturePath, 'utf-8')) as OrphanFixture[];
    const defEntry = fixtures.find((e) => /\b(defined as|refers to|known as)\b/i.test(e.paragraph));
    assert.ok(defEntry, 'fixture must contain a definition-style entry');
    const results = await mod.runPass4(defEntry.paragraph, { n: 1 });
    const orphans = results.reduce((s, r) => s + r.orphanCount, 0);
    assert.equal(orphans, 0, 'a definition-style sentence (R4) must contribute 0 orphans');
  },
);
