// tests/pii-polish.test.ts — Phase 9 Wave 0 RED-by-skip suite for the PII-polish
// extensions to bin/lib/pii.ts (09-01).
//
// Mirrors tests/pii.test.ts structure (corpus loop + idempotence + fast-check
// property). RED-by-skip via SOURCE-GREP (mirrors the [07-01]/[08-00] precedent —
// existsSync can't detect "module exists but the new IP/IBAN classes + diffPii
// are not yet wired"): READY = bin/lib/pii.ts source references `diffPii` AND a
// new IP/IBAN regex (`RE_IP`). Until 09-01 wires them, every test SKIPS so
// `npm test` stays GREEN.
//
// Contracts pinned (so 09-01 satisfies them):
//   (a) classifyPii finds the IP + IBAN positives.
//   (b) NAME suppression: NAME_SUPPRESS_NEGATIVES yield NO NAME match; the
//       two-token positives DO (suppression keys on the LAST token only).
//   (c) diffPii determinism: diffPii(x) deep-equals diffPii(x).
//   (d) diffPii idempotence: re-redacting already-redacted text yields an
//       EMPTY diff (no spans left to redact).
//   (e) diffPii purity: each diff entry is { span, kind, raw, tag } with
//       tag === `[REDACTED:${kind}]` — no Date.now/Math.random leakage.
//   (f) fast-check property: redactPii output never contains a raw IP literal.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as fc from 'fast-check';
import { classifyPii, redactPii } from '../bin/lib/pii.js';
import {
  PII_POLISH_POSITIVES,
  NAME_SUPPRESS_NEGATIVES,
  NAME_TWO_TOKEN_POSITIVES,
  DIFF_CASES,
} from './fixtures/pii-polish-corpus.js';

// Runtime URL.href specifier for the polish surface so `tsc --noEmit` stays
// clean while diffPii is not yet exported. The local interface declares only
// the shape this suite asserts.
const PII_MOD = new URL('../bin/lib/pii.js', import.meta.url);

interface DiffPiiEntry {
  span: [number, number];
  kind: string;
  raw: string;
  tag: string;
}
interface PiiPolishMod {
  diffPii: (text: string) => DiffPiiEntry[];
}

// SOURCE-GREP skip-predicate: pii.ts must reference BOTH `diffPii` (the new
// deterministic diff) AND `RE_IP` (the new IP class) before the suite wakes up.
function piiPolishReady(): boolean {
  const src = readFileSync(fileURLToPath(PII_MOD.href.replace(/\.js$/, '.ts')), 'utf8');
  return /diffPii/.test(src) && /RE_IP/.test(src);
}

const READY = piiPolishReady();

test('classifyPii: IP + IBAN positives each find a matching span of the expected kind', { skip: !READY }, () => {
  for (const c of PII_POLISH_POSITIVES) {
    const matches = classifyPii(c.input);
    const hit = matches.find((m) => (m.kind as string) === c.kind && m.raw === c.raw);
    assert.ok(
      hit,
      `expected ${c.kind}=${JSON.stringify(c.raw)} in ${JSON.stringify(c.input)} — got ${JSON.stringify(matches)}`,
    );
  }
});

test('NAME suppression: suppress-negatives produce NO NAME match', { skip: !READY }, () => {
  for (const n of NAME_SUPPRESS_NEGATIVES) {
    const matches = classifyPii(n.input);
    const nameHit = matches.find((m) => (m.kind as string) === 'NAME');
    assert.ok(!nameHit, `${n.reason}: ${JSON.stringify(n.input)} → unexpected NAME ${JSON.stringify(nameHit)}`);
  }
});

test('NAME suppression: two-token positives (real surname last) DO classify as NAME', { skip: !READY }, () => {
  for (const c of NAME_TWO_TOKEN_POSITIVES) {
    const matches = classifyPii(c.input);
    const hit = matches.find((m) => (m.kind as string) === 'NAME' && m.raw === c.raw);
    assert.ok(hit, `expected NAME=${JSON.stringify(c.raw)} in ${JSON.stringify(c.input)} — got ${JSON.stringify(matches)}`);
  }
});

test('diffPii is deterministic: diffPii(x) deep-equals diffPii(x)', { skip: !READY }, async () => {
  const { diffPii } = (await import(PII_MOD.href)) as PiiPolishMod;
  for (const x of DIFF_CASES) {
    assert.deepEqual(diffPii(x), diffPii(x), `diffPii not deterministic for ${JSON.stringify(x)}`);
  }
});

test('diffPii is idempotent: redacted text has an EMPTY diff (no spans left)', { skip: !READY }, async () => {
  const { diffPii } = (await import(PII_MOD.href)) as PiiPolishMod;
  for (const x of DIFF_CASES) {
    const redacted = redactPii(x);
    const secondPass = diffPii(redacted);
    assert.equal(secondPass.length, 0, `expected empty diff on already-redacted ${JSON.stringify(redacted)}, got ${JSON.stringify(secondPass)}`);
  }
});

test('diffPii is pure: each entry is { span, kind, raw, tag } with tag === [REDACTED:KIND]', { skip: !READY }, async () => {
  const { diffPii } = (await import(PII_MOD.href)) as PiiPolishMod;
  for (const x of DIFF_CASES) {
    const diff = diffPii(x);
    assert.ok(diff.length > 0, `expected ≥1 diff span for ${JSON.stringify(x)}`);
    for (const e of diff) {
      assert.ok(Array.isArray(e.span) && e.span.length === 2, `span must be [number,number]: ${JSON.stringify(e)}`);
      assert.equal(typeof e.kind, 'string', `kind must be a string: ${JSON.stringify(e)}`);
      assert.equal(typeof e.raw, 'string', `raw must be a string: ${JSON.stringify(e)}`);
      assert.equal(e.tag, `[REDACTED:${e.kind}]`, `tag must be [REDACTED:${e.kind}]: ${JSON.stringify(e)}`);
    }
  }
});

// fast-check property: redactPii output never contains a raw IPv4 literal.
const ipArb = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

test('redactPii: no-leak property — original IPv4 never appears in redacted output', { skip: !READY }, () => {
  fc.assert(
    fc.property(ipArb, (ip) => {
      const input = `client connected from ${ip} successfully.`;
      const redacted = redactPii(input);
      assert.ok(!redacted.includes(ip), `IP leak: "${ip}" survived in redacted output: ${redacted}`);
    }),
    { numRuns: 200 },
  );
});
