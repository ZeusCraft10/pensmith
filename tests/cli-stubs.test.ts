// tests/cli-stubs.test.ts
//
// TIER-04: 15 stub verbs exit 0 with 'not implemented yet'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// 15 stubs (UX-02 minus `doctor` which is the only real verb in Phase 2).
const STUBS = [
  'new', 'next', 'status', 'research', 'outline', 'plan', 'write',
  'verify', 'compile', 'done', 'resume', 'list', 'open', 'sketch', 'add',
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
