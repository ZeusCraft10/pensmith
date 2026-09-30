// tests/cli-verbs.test.ts
//
// TIER-04: 16 UX-02 verbs dispatchable + workflow-key-equal preflight.
//
// WR-03 + WR-06 (cross-AI review): the canonical 16-verb list lives in
// bin/lib/verbs.ts — the SINGLE source of truth imported by both
// bin/pensmith.ts (citty subCommands keys) and this test. The previous
// regex-over-source assertion is fragile: it scanned bin/pensmith.ts for
// `'verb': () =>` patterns, which could miss a verb that uses different
// quoting (e.g., backticks) or be fooled by a `verb:` substring inside a
// comment. WR-06 replaces it with a RUNTIME introspection of the exported
// `command.subCommands` object — the actual citty CommandDef the binary
// will execute. Tests now fail iff the runtime dispatcher would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { UX02_VERBS } from '../bin/lib/verbs.js';
import { command } from '../bin/pensmith.js';

// WR-03: derived from the single-source-of-truth list. Length-locked to 16
// here to make the UX-02 contract explicit at the test site.
const EXPECTED_16: readonly string[] = UX02_VERBS;

test('TIER-04: dispatcher registers exactly 16 verbs (UX-02 canonical, runtime introspection)', () => {
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
    `dispatcher verbs must equal UX-02 canonical 16 — got ${JSON.stringify(registeredVerbs)}, expected ${JSON.stringify(expectedSorted)}`,
  );
  assert.equal(
    registeredVerbs.length,
    16,
    `dispatcher must register exactly 16 verbs (D-05), got ${registeredVerbs.length}`,
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

test('TIER-04 preflight: plugin/workflows/*.md keys match dispatcher verbs', () => {
  // The workflow bodies live in the canonical plugin/ directory (PLUG-02).
  const workflowsDir = join('plugin', 'workflows');
  assert.ok(existsSync(workflowsDir), `${workflowsDir} must exist`);
  const files = readdirSync(workflowsDir).filter((f) => f.endsWith('.md'));
  const workflowVerbs = files.map((f) => f.replace(/\.md$/, '')).sort();
  const dispatcherVerbs = [...EXPECTED_16].sort();
  assert.deepEqual(
    workflowVerbs,
    dispatcherVerbs,
    `workflow files ${JSON.stringify(workflowVerbs)} must equal dispatcher verbs ${JSON.stringify(dispatcherVerbs)}`,
  );
});

// PLUG-05 / PRD §5.1: `/pensmith` is the only command the README quick start
// teaches. The 16 verbs are a power-user fallback, and the plumbing namespace
// (/pensmith:<name>) is documented outside the quick start (docs/PLUMBING.md).
test('PLUG-05: the README quick start teaches /pensmith only; the plumbing namespace is documented elsewhere', () => {
  const readme = readFileSync('README.md', 'utf8');
  const start = readme.indexOf('\n## Quick start\n');
  assert.ok(start >= 0, 'README has a "## Quick start" section');
  const end = readme.indexOf('\n## ', start + 1);
  const quickStart = readme.slice(start, end === -1 ? undefined : end);
  // The one command block the section opens with is exactly `/pensmith`.
  const firstBlock = /```[a-z]*\n([\s\S]*?)```/.exec(quickStart)?.[1] ?? '';
  assert.equal(firstBlock.trim(), '/pensmith', 'the quick start command is `/pensmith`');
  // No slash command other than the bare /pensmith anywhere in the section.
  const slashCommands = [...quickStart.matchAll(/(?:^|[\s`(])(\/pensmith[:\s][^\s`)]*)/g)].map((m) => m[1]!.trim());
  assert.deepEqual(slashCommands.filter((c) => c !== '/pensmith'), [], 'no /pensmith <verb> or /pensmith:<name> in the quick start');
  assert.ok(!quickStart.includes('PLUMBING.md'), 'the plumbing docs are not linked from the quick start');
  // …and the plumbing namespace IS documented, from outside the quick start.
  const outside = readme.slice(0, start) + readme.slice(end === -1 ? readme.length : end);
  assert.match(outside, /\(docs\/PLUMBING\.md\)/, 'the README links docs/PLUMBING.md outside the quick start');
  const plumbing = readFileSync(join('docs', 'PLUMBING.md'), 'utf8');
  for (const name of ['research', 'outline', 'plan-section', 'write-section', 'verify-section', 'compile', 'done']) {
    assert.ok(plumbing.includes(`\`/pensmith:${name}\``), `docs/PLUMBING.md documents /pensmith:${name}`);
  }
  assert.match(plumbing, /exactly 16 verbs/, 'the plumbing docs keep the 16-verb contract');
});
