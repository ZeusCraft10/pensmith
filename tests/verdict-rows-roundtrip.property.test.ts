// tests/verdict-rows-roundtrip.property.test.ts — VRFY-24 (D-20-20): the row
// writer (verification-md.ts renderGateRow / renderVerificationMd) and the
// readers (parseVerificationMd, verdict-rows.ts parseBlockingVerdictRows)
// round-trip EVERY citekey the library accepts (schemas/library.ts
// CITEKEY_GRAMMAR: dotted, colon, slash, `#$%&+?<>~` and Unicode keys) and
// every verdict of the vocabulary, whatever a quoted snippet holds — so a
// blocking row is never read as absent, and never under another key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { CITEKEY_GRAMMAR } from '../bin/lib/schemas/library.js';
import { PASS1_VERDICTS, PASS3_VERDICTS, DRAFT_VERDICTS, BLOCKING_VERDICTS, quoteId } from '../bin/lib/verify/verdicts.js';
import { renderVerificationMd, parseVerificationMd, summaryMismatches } from '../bin/lib/verify/verification-md.js';
import { parseBlockingVerdictRows, renderPass3VerdictRow } from '../bin/lib/verify/verdict-rows.js';
import type { GateRow } from '../bin/lib/verify/gate.js';

const FIRST = [...'abcxyzABCXYZ0123456789_', 'é', 'ü', 'ß', 'ж', '中', 'α'];
const MIDDLE = [...FIRST, ...':.#$%&+?<>~/-'];

const citekey = fc
  .tuple(fc.constantFrom(...FIRST), fc.array(fc.constantFrom(...MIDDLE), { maxLength: 12 }), fc.constantFrom(...FIRST))
  .map(([a, mid, z]) => `${a}${mid.join('')}${z}`)
  .filter((k) => CITEKEY_GRAMMAR.test(k));

/** Free text a registrar record or a quoted snippet could hold (asterisks, quotes, parens, colons included). */
const freeText = fc.oneof(
  fc.array(fc.constantFrom(...'abc XYZ 0-9 "quoted" (paren): **bold** — …'.split('')), { maxLength: 60 }).map((a) => a.join('')),
  // An adversarial fragment shaped like a row's own delimiter and verdict.
  fc.constant('x"): **FABRICATED** — lev=1.000 — y'),
);

const pass1Row = fc.record({ key: citekey, verdict: fc.constantFrom(...PASS1_VERDICTS), reason: freeText }).map(
  (r): GateRow => ({ kind: 'pass1', key: r.key, verdict: r.verdict, titleJW: 0.5, authorJW: Number.NaN, reason: r.reason || 'x' }),
);
const pass3Row = fc.record({ key: citekey, verdict: fc.constantFrom(...PASS3_VERDICTS), snippet: freeText, reason: freeText, accepted: fc.boolean() }).map(
  (r): Omit<Extract<GateRow, { kind: 'pass3' }>, 'id'> => ({
    kind: 'pass3',
    key: r.key,
    quoteSha256: 'f'.repeat(64),
    snippet: r.snippet,
    verdict: r.verdict,
    levRatio: 0.25,
    reason: r.reason || 'x',
    ...(r.accepted && r.verdict === 'UNVERIFIABLE-QUOTE' ? { accepted: { at: '2026-09-30T10:00:00.000Z', via: 'prompt' as const } } : {}),
  }),
);
const draftRow = fc.record({ verdict: fc.constantFrom(...DRAFT_VERDICTS), reason: freeText }).map((r): GateRow => ({ kind: 'draft', verdict: r.verdict, reason: r.reason || 'x' }));

test('VRFY-24 property: every CITEKEY_GRAMMAR key and every verdict round-trips through the VERIFICATION.md writer and both readers', () => {
  fc.assert(
    fc.property(fc.array(pass1Row, { maxLength: 6 }), fc.array(pass3Row, { maxLength: 6 }), fc.array(draftRow, { maxLength: 2 }), fc.boolean(), (p1, p3raw, draft, crlf) => {
      const p3: GateRow[] = p3raw.map((r, i) => ({ ...r, id: quoteId(i) }));
      const rows = [...p1, ...p3, ...draft];
      let md = renderVerificationMd({ sectionId: '1', slug: 'intro', offlineMarker: null, status: 'failed', draftHash: 'a'.repeat(64), rows });
      if (crlf) md = md.replace(/\n/g, '\r\n');
      const parsed = parseVerificationMd(md);
      assert.deepEqual(parsed.pass1.map((r) => [r.key, r.verdict]), p1.map((r) => [r.kind === 'draft' ? 'draft' : r.key, r.verdict]));
      assert.deepEqual(
        parsed.pass3.map((r) => [r.key, r.quoteId, r.verdict, r.accepted]),
        p3.map((r) => [r.kind === 'draft' ? 'draft' : r.key, r.kind === 'pass3' ? r.id : null, r.verdict, r.kind === 'pass3' && r.accepted !== undefined]),
      );
      assert.deepEqual(parsed.draft.map((r) => r.verdict), draft.map((r) => r.verdict));
      assert.deepEqual(summaryMismatches(md), []);
      // The section-agnostic reader (the router's) names every blocking row by its key.
      const blocking = parseBlockingVerdictRows(md);
      const expected = rows
        .filter((r) => BLOCKING_VERDICTS.has(r.verdict) && !(r.kind === 'pass3' && r.accepted !== undefined))
        .map((r) => [r.kind === 'draft' ? 'draft' : r.key, r.verdict]);
      assert.deepEqual(blocking.map((r) => [r.citekey, r.verdict]), expected);
    }),
    { numRuns: 400 },
  );
});

test('VRFY-24 property: the pre-Phase-20 Pass-3 row (no quote id) still reads under every key shape', () => {
  fc.assert(
    fc.property(citekey, fc.constantFrom('NOT_FOUND', 'UNVERIFIABLE-QUOTE', 'UNATTRIBUTED'), freeText, (key, verdict, snippet) => {
      const line = renderPass3VerdictRow(key, snippet.replace(/\*/g, '\\*'), verdict, 0.1, 'reason');
      assert.deepEqual(parseBlockingVerdictRows(line).map((r) => [r.citekey, r.verdict]), [[key, verdict]]);
    }),
    { numRuns: 300 },
  );
});
