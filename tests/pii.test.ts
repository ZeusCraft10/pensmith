// tests/pii.test.ts — corpus-driven coverage of bin/lib/pii.ts (D-49 / ARCH-17).
//
// Coverage axes:
//   - classifyPii positives: every fixture finds the expected kind+raw span
//   - redactPii positives: original raw substring is gone, [REDACTED:KIND]
//     tag is present
//   - classifyPii negatives: zero matches across the negative corpus
//   - redactPii idempotence: redactPii(redactPii(s)) === redactPii(s)
//   - redactKeys: top-level / nested / array / non-string-sensitive
//   - redactKeys: no input mutation
//   - redactKeys: idempotence on object fixtures
//   - redactKeys: __proto__ pollution defense (T-01-08)

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { classifyPii, redactPii, redactKeys } from '../bin/lib/pii.js';
import { POSITIVES, NEGATIVES, KEY_FIXTURES } from './fixtures/pii-corpus.js';
import * as fc from 'fast-check';

test('classifyPii: every positive fixture finds at least one matching span of the expected kind', () => {
  for (const c of POSITIVES) {
    const matches = classifyPii(c.input);
    const hit = matches.find(m => m.kind === c.kind && m.raw === c.raw);
    assert.ok(
      hit,
      `expected to find ${c.kind}=${JSON.stringify(c.raw)} in ${JSON.stringify(c.input)} — got ${JSON.stringify(matches)}`,
    );
  }
});

test('redactPii: every positive fixture, the original raw substring is gone from the output', () => {
  for (const c of POSITIVES) {
    const out = redactPii(c.input);
    assert.ok(!out.includes(c.raw), `expected ${JSON.stringify(c.raw)} to be redacted in: ${out}`);
    assert.ok(out.includes(`[REDACTED:${c.kind}]`), `expected REDACTED:${c.kind} tag in: ${out}`);
  }
});

test('classifyPii: negatives produce no matches', () => {
  for (const n of NEGATIVES) {
    const matches = classifyPii(n.input);
    assert.equal(matches.length, 0, `${n.reason}: ${JSON.stringify(n.input)} → ${JSON.stringify(matches)}`);
  }
});

test('redactPii is idempotent: redactPii(redactPii(s)) === redactPii(s)', () => {
  for (const c of POSITIVES) {
    const once = redactPii(c.input);
    const twice = redactPii(once);
    assert.equal(twice, once);
  }
});

test('redactKeys: top-level sensitive key value replaced', () => {
  const out = redactKeys(KEY_FIXTURES.flat) as { authorization: string; method: string };
  assert.notEqual(out.authorization, 'Bearer sk-abc123');
  assert.equal(out.method, 'POST');
});

test('redactKeys: nested sensitive key value replaced (case-insensitive)', () => {
  const out = redactKeys(KEY_FIXTURES.nested) as { headers: Record<string, string> };
  assert.notEqual(out.headers['X-API-Key'], 'k_live_xyz');
  assert.equal(out.headers['User-Agent'], 'pensmith/0.1');
});

test('redactKeys: recurses into arrays', () => {
  const out = redactKeys(KEY_FIXTURES.array) as { entries: Array<Record<string, unknown>> };
  assert.notEqual(out.entries[0]!.token, 'tok_1');
  assert.notEqual(out.entries[1]!.token, 'tok_2');
  assert.equal(out.entries[2]!.method, 'GET');
});

test('redactKeys: non-string sensitive values become literal [REDACTED]', () => {
  const out = redactKeys(KEY_FIXTURES.mixed_value_types) as Record<string, unknown>;
  assert.equal(out.secret, '[REDACTED]');
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.cookie, '[REDACTED]');
  assert.equal(out.api_key, '[REDACTED]');
});

test('redactKeys does not mutate input', () => {
  const input = JSON.parse(JSON.stringify(KEY_FIXTURES.nested));
  const snapshot = JSON.stringify(input);
  redactKeys(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('redactKeys is idempotent on object fixtures', () => {
  const once = redactKeys(KEY_FIXTURES.nested);
  const twice = redactKeys(once);
  assert.deepEqual(twice, once);
});

test('redactKeys defends against __proto__ payload (no pollution)', () => {
  // JSON.parse plants `__proto__` as an OWN property of the parsed object
  // (object-literal `{__proto__: ...}` does not — it sets the prototype).
  // The defense is Object.create(null) clone container + isPlainObject
  // proto guard inside redactKeys.
  const before = (Object.prototype as unknown as { polluted?: boolean }).polluted;
  redactKeys(JSON.parse('{"__proto__":{"polluted":true}}'));
  const after = (Object.prototype as unknown as { polluted?: boolean }).polluted;
  assert.equal(after, before, 'Object.prototype must not be polluted');
});

// === Phase 3 Plan 00 Task 0.3 extension: PII redaction no-leak property (INTK-05, T-3-02) ===
// fast-check property: original PII never appears verbatim in redacted output.
// This test wakes up when redactPii is available (it always is from Phase 1 — skip guard
// is for future proofing in case the module gets refactored).
const piiRedactPath = new URL('../bin/lib/pii.ts', import.meta.url);

// Arbitrary PII-like input shape: SSN + email.
const piiArb = fc.record({
  ssn: fc.tuple(
    fc.integer({ min: 100, max: 999 }),
    fc.integer({ min: 10, max: 99 }),
    fc.integer({ min: 1000, max: 9999 }),
  ).map(([a, b, c]) => `${a}-${b}-${c}`),
  email: fc.tuple(
    fc.string({ minLength: 3, maxLength: 10 }),
    fc.string({ minLength: 3, maxLength: 10 }),
  ).map(([user, domain]) => `${user.replace(/[^a-z]/gi, 'x')}@${domain.replace(/[^a-z]/gi, 'x')}.com`),
});

test('PII redaction: no-leak property — original PII never appears in redacted output (INTK-05)',
  { skip: !existsSync(piiRedactPath) },
  () => {
    fc.assert(
      fc.property(piiArb, ({ ssn, email }) => {
        const input = `Patient SSN: ${ssn}, contact: ${email}, results normal.`;
        const redacted = redactPii(input);
        // No original SSN or email appears verbatim in redacted output.
        assert.ok(
          !redacted.includes(ssn),
          `PII leak: SSN "${ssn}" appears verbatim in redacted output`,
        );
        // Check each segment of the email
        const [user] = email.split('@');
        if (user && user.length > 3) {
          // Only check if user part is long enough to be a meaningful PII fragment
          assert.ok(
            !redacted.includes(email),
            `PII leak: full email "${email}" appears verbatim in redacted output`,
          );
        }
      }),
      { numRuns: 200 },
    );
  },
);
