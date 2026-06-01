// tests/cli-aliases.test.ts — REVIEWS CONVERGENCE (Codex HIGH #9, OpenCode
// MEDIUM #5, CYCLE-2 M-1) `new` ↔ `intake` filename/dispatcher reconciliation.
//
// Plan 03-07 Task 7.2 lands the verb under the canonical filename
// `bin/cli/intake.ts` (matches workflows/intake.md and the canonical verb
// name in the workflow body). The dispatcher key stays as `new` (UX02_VERBS
// canonical — README quick-start uses `pensmith new`), pointing to
// `./cli/intake.js`.
//
// Invariants asserted here:
//   1. The intake module file exists under the canonical filename.
//   2. The dispatcher exposes a `new` subCommand (UX02_VERBS-locked).
//   3. The `new` loader resolves to a citty CommandDef whose meta.name
//      is `new` (the verb name the user types, not the filename).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { command } from '../bin/pensmith.js';

test('cli-aliases: bin/cli/intake.ts exists at canonical filename (CYCLE-2 M-1)', () => {
  assert.ok(
    existsSync(new URL('../bin/cli/intake.ts', import.meta.url)),
    'MISSING: bin/cli/intake.ts — Plan 03-07 Task 7.2 must land the canonical filename',
  );
});

test('cli-aliases: dispatcher registers `new` subcommand (UX-02 canonical key)', () => {
  const subCommands = command.subCommands as Record<string, unknown>;
  assert.ok(
    typeof subCommands['new'] === 'function',
    'dispatcher must register `new` as a real loader function (UX02_VERBS, REAL_VERB_LOADERS)',
  );
});

test('cli-aliases: `new` loader resolves to a CommandDef whose meta.name === "new"', async () => {
  const subCommands = command.subCommands as Record<string, () => Promise<unknown>>;
  const loader = subCommands['new'];
  assert.ok(typeof loader === 'function', '`new` must be a loader function');
  const def = (await loader()) as { meta?: { name?: string } };
  assert.equal(
    def?.meta?.name,
    'new',
    '`new` loader must resolve to a CommandDef whose meta.name === "new" (user-facing verb name, NOT the filename)',
  );
});

test('cli-aliases: `new` loader and direct intake import resolve to the same CommandDef', async () => {
  const subCommands = command.subCommands as Record<string, () => Promise<unknown>>;
  const fromDispatcher = await subCommands['new']!();
  const fromDirectImport = (await import('../bin/cli/intake.js')).intakeCommand;
  // Identity check: dispatcher's `new` loader and a direct import of
  // intakeCommand must return the SAME object reference. That guarantees
  // `pensmith new <args>` and a direct call into intakeCommand produce
  // byte-equivalent behavior — there is exactly one drafter implementation.
  assert.strictEqual(
    fromDispatcher,
    fromDirectImport,
    'dispatcher `new` and direct `intakeCommand` import must be the same CommandDef reference (single source of truth)',
  );
});
