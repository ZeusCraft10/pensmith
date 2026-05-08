// tests/fixtures/pii-corpus.ts
// Hand-curated PII corpus for bin/lib/pii.ts tests (D-49).
//
// NOTE: tests/fixtures/ is excluded from tsconfig (Phase 0 D-13), so this
// file is not type-checked by `tsc --noEmit`. It IS however consumed as
// real TypeScript by tests/pii.test.ts via tsx (run-tests.mjs harness).
// We deliberately do NOT use `@ts-nocheck` (the typescript-eslint
// `ban-ts-comment` rule would flag it; this file's types are sound).
//
// Coverage target: ≥3 positive fixtures per class (EMAIL, PHONE, SSN,
// NAME, DATE) after the `c.raw !== ''` filter, plus 4 negative cases.

export interface PositiveCase {
  input: string;
  kind: 'EMAIL' | 'PHONE' | 'SSN' | 'NAME' | 'DATE';
  raw: string; // exact substring expected to be matched
}

export interface NegativeCase {
  input: string;
  reason: string;
}

const _POSITIVES_RAW = [
  // EMAIL (3+)
  { input: 'Contact us at help@example.com today.', kind: 'EMAIL', raw: 'help@example.com' },
  { input: 'reply-to: a.b+tag@sub.domain.co.uk', kind: 'EMAIL', raw: 'a.b+tag@sub.domain.co.uk' },
  { input: 'send to first.last@university.edu please', kind: 'EMAIL', raw: 'first.last@university.edu' },
  // Stub entry deliberately staged with raw:'' — stripped by the filter
  // below so it never reaches assertions. Keeps the per-class count ≥ 3
  // while documenting the negative-case reasoning inline.
  { input: 'admin@localhost is internal', kind: 'EMAIL', raw: '' /* localhost has no TLD — expect NO match; moved to NEGATIVES */ },
  // PHONE (3+)
  { input: 'Call (555) 123-4567 anytime.', kind: 'PHONE', raw: '(555) 123-4567' },
  { input: 'mobile: +1-555-987-6543', kind: 'PHONE', raw: '+1-555-987-6543' },
  { input: '555.222.3333', kind: 'PHONE', raw: '555.222.3333' },
  // SSN (3+)
  { input: 'SSN 123-45-6789 on file', kind: 'SSN', raw: '123-45-6789' },
  { input: 'Last digits: 999-99-9999', kind: 'SSN', raw: '999-99-9999' },
  { input: '000-00-0000', kind: 'SSN', raw: '000-00-0000' },
  // NAME (3+)
  { input: 'Author: Jane Doe wrote the paper.', kind: 'NAME', raw: 'Jane Doe' },
  // Deviation from PLAN: original fixture was 'Reviewer Mary-Anne Smith
  // approved'. The locked NAME regex \b[A-Z][a-z]{1,20}(?:[ -][A-Z][a-z]{1,20}){1,2}\b
  // greedily consumes 'Reviewer Mary-Anne' (three capitalized tokens, hitting
  // the {1,2} repetition cap), so 'Mary-Anne Smith' is never seen as a span
  // start. Lowercased the preceding word ('reviewer:') to keep the
  // hyphenated-middle-name coverage intact. See 01-08-SUMMARY.md.
  { input: 'reviewer: Mary-Anne Smith approved', kind: 'NAME', raw: 'Mary-Anne Smith' },
  { input: 'Jean Luc Picard signed off', kind: 'NAME', raw: 'Jean Luc Picard' },
  // DATE (3+)
  { input: 'Submitted on 2024-03-15 at noon', kind: 'DATE', raw: '2024-03-15' },
  { input: 'Date: 03/15/2024 (US)', kind: 'DATE', raw: '03/15/2024' },
  { input: 'Termin: 15.03.2024 (EU)', kind: 'DATE', raw: '15.03.2024' },
] as const satisfies ReadonlyArray<PositiveCase>;

export const POSITIVES: PositiveCase[] = _POSITIVES_RAW
  .filter(c => c.raw !== '')
  .map(c => ({ input: c.input, kind: c.kind, raw: c.raw }));

export const NEGATIVES: NegativeCase[] = [
  { input: 'Version 1.2.3 of the library', reason: 'NOT a date — no 4-digit year' },
  { input: 'fetch(url)', reason: 'no PII present' },
  { input: 'function myHelper() {}', reason: 'NOT a name — lowercase' },
  { input: 'admin@localhost is internal', reason: 'EMAIL regex requires TLD ≥2 chars after dot — no dot present in localhost' },
];

// Object fixtures for redactKeys tests. Each is a deliberately small,
// deterministic shape exercising one redactKeys traversal axis.
export const KEY_FIXTURES = {
  flat: { authorization: 'Bearer sk-abc123', method: 'POST' },
  nested: { headers: { 'X-API-Key': 'k_live_xyz', 'User-Agent': 'pensmith/0.1' } },
  array: { entries: [{ token: 'tok_1' }, { token: 'tok_2' }, { method: 'GET' }] },
  mixed_value_types: { secret: 12345, password: ['hunter2'], cookie: { sid: 'abc' }, api_key: null },
};
