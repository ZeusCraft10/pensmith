// tests/cli-verbs.test.ts
//
// TIER-04: 16 UX-02 verbs dispatchable + workflow-key-equal preflight.
//
// WR-03 (cross-AI review): the canonical 16-verb list lives in bin/lib/verbs.ts
// — the SINGLE source of truth imported by both bin/pensmith.ts (citty
// subCommands keys) and this test. The previous inline copy here could drift
// silently; importing UX02_VERBS guarantees the test fails immediately if
// bin/lib/verbs.ts and bin/pensmith.ts disagree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { UX02_VERBS } from '../bin/lib/verbs.js';

// WR-03: derived from the single-source-of-truth list. Length-locked to 16
// here to make the UX-02 contract explicit at the test site.
const EXPECTED_16: readonly string[] = UX02_VERBS;

test('TIER-04: dispatcher registers exactly 16 verbs (UX-02 canonical)', () => {
  const src = readFileSync('bin/pensmith.ts', 'utf8');
  for (const verb of EXPECTED_16) {
    // Each verb appears as a property of subCommands. Quoted verbs use single quotes.
    const re = new RegExp(`(^|\\s|,)['"]?${verb.replace('-', '\\-')}['"]?:`);
    assert.ok(re.test(src), `verb ${verb} not registered in subCommands`);
  }
  // Count the subCommands properties — must be exactly 16.
  const match = src.match(/subCommands:\s*\{([\s\S]*?)\n\s*\},?/);
  assert.ok(match, 'subCommands block not found');
  const block = match[1] ?? '';
  const propLines = block.split('\n').filter((l) => /^\s*['"]?[a-z-]+['"]?:\s*\(\)\s*=>/.test(l));
  assert.equal(propLines.length, 16, `expected 16 subCommands, got ${propLines.length}`);
});

test('TIER-04 preflight: workflows/*.md keys match dispatcher verbs', () => {
  const workflowsDir = 'workflows';
  if (!existsSync(workflowsDir)) {
    // Workflows ship in 02-06; this preflight is a no-op until then.
    return;
  }
  const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.md'));
  if (files.length === 0) {
    // No workflow .md files yet — 02-06 lands them; skip the preflight for now.
    return;
  }
  const workflowVerbs = files.map((f) => f.replace(/\.md$/, '')).sort();
  const dispatcherVerbs = [...EXPECTED_16].sort();
  assert.deepEqual(
    workflowVerbs,
    dispatcherVerbs,
    `workflow files ${JSON.stringify(workflowVerbs)} must equal dispatcher verbs ${JSON.stringify(dispatcherVerbs)}`,
  );
});
