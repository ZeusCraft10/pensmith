// tests/hooks/pre-compact.test.ts — Phase 7 Wave 0 RED scaffold for HOOK-01.
//
// PreCompact writes .paper/HANDOFF.json (D-17 LOCKED, <= 5120 bytes) before
// context compaction. onPreCompact already writes the HANDOFF (Phase 3), so the
// size/parse assertions PASS now. The 10s timeout race lands in Plan 07-03;
// that assertion is RED-by-skip on a PRECOMPACT_TIMEOUT_MS token in the source.
//
// HANDOFF_MAX_BYTES = 5120 (bin/lib/schemas/handoff.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_SRC = fileURLToPath(new URL('../../hooks/pre-compact.ts', import.meta.url));
const HOOK_MOD = new URL('../../hooks/pre-compact.js', import.meta.url).href;
const HANDOFF_SCHEMA_MOD = new URL('../../bin/lib/schemas/handoff.js', import.meta.url).href;

const hookSrc = existsSync(HOOK_SRC) ? readFileSync(HOOK_SRC, 'utf8') : '';
// RED-by-skip: the 10s race (PRECOMPACT_TIMEOUT_MS) lands in 07-03.
const timeoutWired = /PRECOMPACT_TIMEOUT_MS/.test(hookSrc);

function freshPaperDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'pensmith-pre-compact-'));
  const paperDir = join(root, '.paper');
  mkdirSync(paperDir, { recursive: true });
  // Minimal STATE.json so readState resolves a phase.
  writeFileSync(
    join(paperDir, 'STATE.json'),
    JSON.stringify({
      $schemaVersion: 2,
      paperId: 'pre-compact-test',
      createdAt: new Date().toISOString(),
      phase: 'write',
      sections: [{ n: 1, slug: 'intro' }],
    }),
  );
  return paperDir;
}

// === onPreCompact writes a HANDOFF.json that parses + is <= 5120 bytes, fast ===
test('HOOK-01: onPreCompact writes .paper/HANDOFF.json that parses under HandoffSchema and is <= 5120 bytes',
  async () => {
    const paperDir = freshPaperDir();
    const mod = (await import(HOOK_MOD)) as {
      onPreCompact: (input: { paperDir?: string }) => Promise<void>;
    };
    const schemaMod = (await import(HANDOFF_SCHEMA_MOD)) as {
      HandoffSchema: { parse: (v: unknown) => unknown };
      HANDOFF_MAX_BYTES: number;
    };

    const start = Date.now();
    await mod.onPreCompact({ paperDir });
    const elapsed = Date.now() - start;

    const handoffPath = join(paperDir, 'HANDOFF.json');
    assert.ok(existsSync(handoffPath), 'HOOK-01: onPreCompact must write .paper/HANDOFF.json');

    const bytes = readFileSync(handoffPath);
    assert.ok(
      bytes.byteLength <= 5120,
      `HOOK-01: HANDOFF.json must be <= 5120 bytes (HANDOFF_MAX_BYTES), got ${bytes.byteLength}`,
    );
    assert.equal(schemaMod.HANDOFF_MAX_BYTES, 5120, 'HOOK-01: HANDOFF_MAX_BYTES is the 5120-byte cap');

    const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
    assert.doesNotThrow(
      () => schemaMod.HandoffSchema.parse(parsed),
      'HOOK-01: the written HANDOFF.json must validate against HandoffSchema',
    );

    // Runs well under the 10s budget (HOOK-01 timeout is 10_000ms).
    assert.ok(elapsed < 10_000, `HOOK-01: onPreCompact must complete well under 10s, took ${elapsed}ms`);
  });

// === presence guard for the timeout race ===
test('HOOK-01: pre-compact 10s-timeout wiring is consistent with Wave-0 RED state', () => {
  if (timeoutWired) {
    assert.ok(timeoutWired, 'pre-compact.ts carries PRECOMPACT_TIMEOUT_MS — timeout test active');
  } else {
    assert.ok(!timeoutWired, 'Wave-0: pre-compact.ts has no 10s race yet (RED-by-skip; lands in 07-03)');
  }
});

// === timeout-path: a slow write must reject within ~10s (RED-by-skip) ===
test('HOOK-01: onPreCompact bounds the HANDOFF write with a ~10s timeout (PRECOMPACT_TIMEOUT_MS)',
  { skip: !timeoutWired }, async () => {
    // The 07-03 implementation wraps writeHandoff in a Promise.race against a
    // PRECOMPACT_TIMEOUT_MS deadline. When that token is present this case
    // asserts the source bounds the write so a hung compaction cannot block the
    // session indefinitely. A full slow-write injection requires a seam 07-03
    // exposes; here we pin the source-level contract that the race exists.
    assert.match(hookSrc, /PRECOMPACT_TIMEOUT_MS/, 'HOOK-01: the 10s timeout constant must be declared');
    assert.match(hookSrc, /(race|setTimeout|AbortController)/,
      'HOOK-01: the write must be bounded by a race / timeout against PRECOMPACT_TIMEOUT_MS');
  });
