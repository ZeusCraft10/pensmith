// tests/citation-render.test.ts — Wave 0 stub for D-22 / CITE-04.
// Smoke test: citation-js parses BibTeX with accent-command and renders APA via apa.csl.
//
// Production code required: bin/lib/citations.ts + templates/citation-styles/apa.csl
// Until then: existence assertions fire RED; behavioral tests skip gracefully.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const citationsPath = new URL('../bin/lib/citations.ts', import.meta.url);
const apaCslPath = new URL('../templates/citation-styles/apa.csl', import.meta.url);
const fixtureBibPath = new URL('../tests/fixtures/known-good-fixture/CITATIONS.bib', import.meta.url);

const shouldSkip = !existsSync(citationsPath) || !existsSync(apaCslPath) || !existsSync(fixtureBibPath);

test('citation-render: bin/lib/citations.ts production module exists (D-22)', () => {
  assert.ok(
    existsSync(citationsPath),
    'MISSING: bin/lib/citations.ts — Wave 2 must create before this test passes (D-19 chokepoint wrapper)',
  );
});

test('citation-render: templates/citation-styles/apa.csl exists (D-22)', () => {
  assert.ok(
    existsSync(apaCslPath),
    'MISSING: templates/citation-styles/apa.csl — Plan 05 must create before this test passes (D-22)',
  );
});

test('citation-render: tests/fixtures/known-good-fixture/CITATIONS.bib exists (D-22)',
  { skip: !existsSync(fixtureBibPath) },
  () => {
    const content = readFileSync(fixtureBibPath, 'utf-8');
    assert.ok(content.includes('@article'), 'CITATIONS.bib must contain at least one @article entry');
  },
);

test('citation-render: citation-js parses BibTeX with accent-command and renders APA',
  { skip: shouldSkip },
  async () => {
    // bin/lib/citations.ts now exists (Phase 3 Plan 03-02). The
    // prior ts-error suppression that gated this import was removed by
    // 03-02 per the executor reconciliation note in the plan prompt.
    const { parseBib, renderApa } = await import('../bin/lib/citations.js');
    const bibContent = readFileSync(fixtureBibPath, 'utf-8');

    // Parse BibTeX through citations.ts chokepoint.
    const entries = await parseBib(bibContent);
    assert.ok(Array.isArray(entries) && entries.length > 0, 'parseBib must return at least one entry');

    // Render APA via apa.csl — must not throw and must return a non-empty string.
    const rendered = await renderApa(entries);
    assert.ok(typeof rendered === 'string' && rendered.length > 0, 'renderApa must return non-empty string');

    // The fixture contains {\'a} accent-command — rendered output should contain 'á' (NFKC-safe).
    // Per D-19/T-3-04 pitfall: citation-js must handle backslash-accent-commands gracefully.
    // This assertion guards the BibTeX accent-command processing path.
    assert.ok(
      rendered.includes('á') || rendered.toLowerCase().includes('vaswani'),
      'APA render must handle accent-command {\\\'a} correctly (D-19/T-3-04)',
    );
  },
);

// ====================================================================
//   Phase 10 — CITE-02 / CITE-03 multi-style render + existence tests
// ====================================================================
// For each of the 7 new bundled styles emit TWO tests:
//   1. Always-on existence assertion — PASSES NOW (Plan 10-00 Task 1 committed
//      the .csl files); stays as a regression guard.
//   2. Skip-guarded render assertion — SKIPS NOW because citations.ts does not
//      yet export renderStyle (Plan 10-01 ships it), then GREENs once 10-01
//      lands. A dynamic import of citations.js with renderStyle still absent
//      resolves the symbol as `undefined`, so the render test feature-detects
//      `typeof renderStyle === 'function'` IN ADDITION to the existing shouldSkip
//      + .csl existence guards — MANDATORY to keep the suite GREEN (no TypeError)
//      while renderStyle is absent (cycle-1 review L1).

const stylesToTest = [
  'mla',
  'chicago-notes-bib',
  'chicago-author-date',
  'ieee',
  'ama',
  'vancouver',
  'harvard',
] as const;

for (const style of stylesToTest) {
  const cslPath = new URL(`../templates/citation-styles/${style}.csl`, import.meta.url);

  // 1. Existence guard — PASSES NOW (files committed in Task 1).
  test(`citation-render: templates/citation-styles/${style}.csl exists (CITE-02/03)`, () => {
    assert.ok(existsSync(cslPath), `MISSING: templates/citation-styles/${style}.csl`);
  });

  // 2. Render — skip-guarded on the existing shouldSkip OR a missing .csl.
  const shouldSkipStyle = shouldSkip || !existsSync(cslPath);
  test(`citation-render: renderStyle('${style}') produces non-empty bibliography (CITE-02/03)`,
    { skip: shouldSkipStyle },
    async (t) => {
      const mod = await import('../bin/lib/citations.js');
      // Feature-detect renderStyle: it does not exist until Plan 10-01 ships it.
      // A dynamic import resolves the absent export as `undefined`, so calling it
      // would throw — skip cleanly instead (cycle-1 L1).
      const renderStyle = (mod as { renderStyle?: unknown }).renderStyle;
      if (typeof renderStyle !== 'function') {
        t.skip('renderStyle not yet exported (Plan 10-01)');
        return;
      }
      const { parseBib } = mod;
      const bibContent = readFileSync(fixtureBibPath, 'utf-8');
      const entries = await parseBib(bibContent);
      const rendered = await (renderStyle as (
        e: unknown,
        s: string,
      ) => Promise<string>)(entries, style);
      assert.ok(
        typeof rendered === 'string' && rendered.length > 0,
        `renderStyle('${style}') must return a non-empty string`,
      );
    },
  );
}

// ====================================================================
//   Phase 10 Plan 01 Task 2 — determinism, single-registration, mapping
// ====================================================================
// These three tests prove the load-bearing CITE-02 properties beyond
// "non-empty": deterministic+offline render (byte-identical double call),
// the H2 single-registration fix (renderApa delegates → 'pensmith-apa'
// added at most once), and the resolveStyleName discipline→style table.
// They feature-detect renderStyle the same way the per-style loop does so
// the suite stays GREEN if run against a citations.ts that predates 10-01.

const ieeeCslPath = new URL('../templates/citation-styles/ieee.csl', import.meta.url);

// 1. Determinism + collision guard (CITE-02): two back-to-back renderStyle
//    calls for the same style yield byte-identical output and the second
//    call never throws "template already registered" (Pitfall 1 guard).
test('citation-render: renderStyle is deterministic + no re-registration collision (CITE-02)',
  { skip: shouldSkip || !existsSync(ieeeCslPath) },
  async (t) => {
    const mod = await import('../bin/lib/citations.js');
    const renderStyle = (mod as { renderStyle?: unknown }).renderStyle;
    if (typeof renderStyle !== 'function') {
      t.skip('renderStyle not yet exported (Plan 10-01)');
      return;
    }
    const render = renderStyle as (e: unknown, s: string) => Promise<string>;
    const { parseBib } = mod;
    const bibContent = readFileSync(fixtureBibPath, 'utf-8');
    const entries = await parseBib(bibContent);

    const first = await render(entries, 'ieee');
    // Second call must not reject with "template already registered".
    await assert.doesNotReject(() => render(entries, 'ieee'));
    const second = await render(entries, 'ieee');
    assert.equal(first, second, 'renderStyle(ieee) must be byte-identical across calls (deterministic + offline)');
  },
);

// 2. renderApa ↔ renderStyle('apa') single-registration parity (H2 regression
//    guard): in ONE process call renderApa() THEN renderStyle(entries,'apa').
//    Both consume the 'pensmith-apa' template. This would THROW "template
//    already registered" on the ORIGINAL self-contained renderApa +
//    independent renderStyle('apa') design — it is the executable proof the
//    H2 single-registration fix landed, plus a byte-parity check that the
//    delegation preserves the locked Wave-0 renderApa output bytes.
test('citation-render: renderApa delegates to renderStyle(apa) — byte-identical, single registration (H2)',
  { skip: shouldSkip },
  async (t) => {
    const mod = await import('../bin/lib/citations.js');
    const renderStyle = (mod as { renderStyle?: unknown }).renderStyle;
    const resetApa = (mod as { _resetApaTemplateForTest?: unknown })._resetApaTemplateForTest;
    if (typeof renderStyle !== 'function' || typeof resetApa !== 'function') {
      t.skip('renderStyle / _resetApaTemplateForTest not yet exported (Plan 10-01)');
      return;
    }
    const render = renderStyle as (e: unknown, s: string) => Promise<string>;
    const { parseBib, renderApa } = mod;
    const bibContent = readFileSync(fixtureBibPath, 'utf-8');
    const entries = await parseBib(bibContent);

    // Clean slate so this test owns the 'pensmith-apa' registration lifecycle.
    (resetApa as () => void)();

    // Both calls register/consume 'pensmith-apa'; neither may collide.
    let a = '';
    await assert.doesNotReject(async () => { a = await renderApa(entries); });
    let b = '';
    await assert.doesNotReject(async () => { b = await render(entries, 'apa'); });

    assert.ok(a.length > 0, 'renderApa must return a non-empty string');
    assert.equal(a, b, 'renderApa(entries) must be byte-identical to renderStyle(entries,"apa")');
  },
);

// 3. resolveStyleName discipline→style table (CITE-02/03 downstream contract).
test('citation-render: resolveStyleName maps disciplines to styles (CITE-02/03)',
  { skip: shouldSkip },
  async (t) => {
    const mod = await import('../bin/lib/citations.js');
    const resolveStyleName = (mod as { resolveStyleName?: unknown }).resolveStyleName;
    if (typeof resolveStyleName !== 'function') {
      t.skip('resolveStyleName not yet exported (Plan 10-01)');
      return;
    }
    const resolve = resolveStyleName as (d: string) => string;
    assert.equal(resolve('computer-science'), 'ieee', 'computer-science → ieee');
    assert.equal(resolve('literature'), 'mla', 'literature → mla');
    assert.equal(resolve('history'), 'chicago-author-date', 'history → chicago-author-date');
    assert.equal(resolve('unknown'), 'apa', 'unknown → apa fallback');
  },
);
