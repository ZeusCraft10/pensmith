// tests/cli-verbs.test.ts
//
// TIER-04: 16 UX-02 verbs dispatchable + workflow-key-equal preflight.
//
// WR-03 + WR-06 (cross-AI review): the canonical verb list lives in
// bin/lib/verbs.ts — the SINGLE source of truth imported by both
// bin/pensmith.ts (citty subCommands keys) and this test. The previous
// regex-over-source assertion is fragile: it scanned bin/pensmith.ts for
// `'verb': () =>` patterns, which could miss a verb that uses different
// quoting (e.g., backticks) or be fooled by a `verb:` substring inside a
// comment. WR-06 replaces it with a RUNTIME introspection of the exported
// `command.subCommands` object — the actual citty CommandDef the binary
// will execute. Tests now fail iff the runtime dispatcher would.
//
// Phase 4 Plan 04-04: `revise` added to UX02_VERBS (WRTE-02). Verb count
// is now 17 (updated from original 16).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { UX02_VERBS } from '../bin/lib/verbs.js';
import { command } from '../bin/pensmith.js';

// WR-03: derived from the single-source-of-truth list. Phase 4 Plan 04-04
// added `revise` (WRTE-02), bringing the count from 16 → 17.
const EXPECTED_16: readonly string[] = UX02_VERBS;
// Phase 4 count (17 verbs including `revise` from Plan 04-04).
const EXPECTED_VERB_COUNT = UX02_VERBS.length;

test('TIER-04: dispatcher registers exactly the UX-02 canonical verb set (runtime introspection)', () => {
  // WR-06: introspect the actual citty CommandDef instead of regex-scanning
  // the source. command.subCommands is the Resolvable<SubCommandsDef> citty
  // will dispatch from — its keys are the verbs the user can actually invoke.
  const subCommands = command.subCommands;
  assert.ok(
    subCommands && typeof subCommands === 'object' && !Array.isArray(subCommands),
    `command.subCommands must be a Record, got ${typeof subCommands}`,
  );
  const registeredVerbs = Object.keys(subCommands as Record<string, unknown>).sort();
  const expectedSorted = [...EXPECTED_16].sort();
  assert.deepEqual(
    registeredVerbs,
    expectedSorted,
    `dispatcher verbs must equal UX-02 canonical list — got ${JSON.stringify(registeredVerbs)}, expected ${JSON.stringify(expectedSorted)}`,
  );
  assert.equal(
    registeredVerbs.length,
    EXPECTED_VERB_COUNT,
    `dispatcher must register exactly ${EXPECTED_VERB_COUNT} verbs (UX-02 canonical), got ${registeredVerbs.length}`,
  );
  // Each value must be a loader function — citty's subCommands entries are
  // Resolvable<CommandDef>, i.e. CommandDef | (() => CommandDef | Promise<CommandDef>).
  // bin/pensmith.ts uses the function form for all 16 (lazy-load).
  const subCommandsMap = subCommands as Record<string, unknown>;
  for (const verb of registeredVerbs) {
    const entry: unknown = subCommandsMap[verb];
    assert.equal(
      typeof entry,
      'function',
      `subCommands[${verb}] must be a loader function (lazy import); got ${typeof entry}`,
    );
  }
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
