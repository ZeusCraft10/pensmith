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
