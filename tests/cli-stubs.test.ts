// tests/cli-stubs.test.ts
//
// TIER-04: stub verbs exit 0 with 'not implemented yet'.
//
// Plan 03-09 Task 9.1 update: the 6 Phase-3 per-section verbs
// (new, research, outline, plan, write, verify) graduated from stub to real
// in Plans 03-06/07. They are exercised by tier-contract.test.ts now.
//
// Plan 04-05 Task 4 update: `compile` graduated from stub to real (the keystone
// pipeline — bin/cli/compile.ts delegating to bin/lib/compile.ts::runCompile),
// so it is REMOVED from the stub list and is exercised by tier-contract.test.ts.
//
// Plan 06-05 Task 2 update: `done` graduated from stub to real (the export
// pipeline — bin/cli/done.ts delegating to bin/lib/* runPass4/runPlagiarism/
// scoreHonesty/exportDraft), so it is REMOVED from the stub list and is
// exercised by tier-contract.test.ts.
//
// Plan 07-02 Task 3 update: `next` / `status` / `resume` graduated from stub to
// real (the single-command UX layer — bin/cli/next.ts + status.ts + resume.ts
// dispatching through bin/lib/router.ts::resolveNextAction + the shared
// dispatchVerb helper), so they are REMOVED from the stub list and exercised by
// flags.test.ts + pensmith-router.test.ts.
//
// This test still asserts that the remaining 4 unimplemented UX-02 verbs are
// stub-routed (TIER-04 invariant — `pensmith <unimplemented-verb>` MUST exit
// 0 with the canonical "not implemented yet" string so users see a clean
// landing page instead of a citty crash).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// 4 remaining stubs after Plan 07-02 (UX-02 minus `doctor`, minus the 6 real
// per-section verbs, minus the now-real compile/done, minus the now-real
// next/status/resume).
const STUBS = [
  'list', 'open', 'sketch', 'add',
];

// Resolve the built binary; build is a precondition (run npm run build first).
// Path locked by CONTRIBUTING.md D-24 LOCKED block + 02-07 preflight.
const BIN = 'dist/bin/pensmith.js';

test('TIER-04: build artifact exists', () => {
  assert.ok(existsSync(BIN), `expected ${BIN} — run npm run build first`);
});

for (const stub of STUBS) {
  test(`TIER-04: stub verb '${stub}' exits 0 with 'not implemented yet'`, () => {
    const out = execFileSync(process.execPath, [BIN, stub], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(out, /not implemented yet/, `stub ${stub} stdout: ${out}`);
  });
}
