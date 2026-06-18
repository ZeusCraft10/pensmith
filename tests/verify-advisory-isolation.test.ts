// tests/verify-advisory-isolation.test.ts — Phase 5 advisory non-regression.
//
// Two committed guards over bin/cli/verify.ts:
//
//   (A) ADVISORY ISOLATION (VRFY-07 / T-05-03): Pass 2 and Pass 4 are advisory
//       and must NEVER set the blocking `hasFail` / `status` from a pass2/pass4
//       expression. This passes now (verify.ts has no pass2/pass4 yet) and stays
//       GREEN after Plan 05-05 wires runPass2/runPass4 below the frozen status
//       line. The deterministic Pass 1 + Pass 3 remain the ONLY blocking gate.
//
//   (B) D-13 0-HIT REGRESSION (T-05-04): the LIVE D-13 chokepoint is a WHOLE-FILE
//       literal-symbol count of `loadPrompt` against bin/cli/verify.ts == 0,
//       COMMENTS INCLUDED. Plan 03-07 enforced this only via an ad-hoc grep; this
//       test makes it durable. The new claim-support / orphan-label slugs are
//       permitted purely by EXPECTED_PROMPT_HASHES registration — Pass 2/4 load
//       their own prompts from their own modules (pass2.ts / pass4.ts), so
//       verify.ts is NEVER edited and this count must remain 0. The hyphenated
//       `prompt-loader` token is NOT gated (it legitimately appears in the
//       verify.ts comment); only the symbol `loadPrompt` must be absent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const verifyPath = fileURLToPath(new URL('../bin/cli/verify.ts', import.meta.url));

test('advisory-isolation (A): bin/cli/verify.ts never sets hasFail/status from a pass2/pass4 expression (VRFY-07)', () => {
  const src = readFileSync(verifyPath, 'utf-8');

  // The blocking machinery must still exist (sanity: we are guarding the right file).
  assert.ok(src.includes('hasFail'), 'verify.ts must still compute the blocking hasFail flag');

  // No assignment of hasFail / status from a pass2/pass4 expression.
  assert.ok(!/hasFail\s*=.*pass[24]/.test(src), 'hasFail must NOT be assigned from a pass2/pass4 expression (advisory-only)');
  assert.ok(!/status\s*=.*pass[24]/.test(src), 'status must NOT be assigned from a pass2/pass4 expression (advisory-only)');

  // Forward-looking guard (stays meaningful after Plan 05-05 wires the advisory
  // calls): if runPass2 / runPass4 ever appear, they must NEVER share a line with
  // `hasFail =` or `status =`. This keeps the advisory calls structurally below the
  // frozen status computation.
  for (const line of src.split('\n')) {
    const mentionsPass = line.includes('runPass2') || line.includes('runPass4');
    if (!mentionsPass) continue;
    assert.ok(!/hasFail\s*=/.test(line), `runPass2/runPass4 must not appear on the same line as "hasFail =": ${line.trim()}`);
    assert.ok(!/status\s*=/.test(line), `runPass2/runPass4 must not appear on the same line as "status =": ${line.trim()}`);
  }
});

test('advisory-isolation (B): bin/cli/verify.ts has ZERO loadPrompt symbols whole-file, comments included (D-13, T-05-04)', () => {
  const src = readFileSync(verifyPath, 'utf-8');
  const count = (src.match(/loadPrompt/g) ?? []).length;
  assert.equal(
    count,
    0,
    `D-13 LIVE chokepoint: bin/cli/verify.ts must contain ZERO "loadPrompt" symbols (whole-file, comments included); found ${count}. ` +
    'Pass 2/4 load their prompts from their own modules (pass2.ts/pass4.ts), so verify.ts must never reference loadPrompt.',
  );
});
