// tests/fixtures/pii-polish-corpus.ts — Phase 9 Wave 0 RED fixture for the
// PII-polish extensions to bin/lib/pii.ts (09-01: IP + IBAN classes + a
// NAME-suppression dictionary + a deterministic/idempotent diffPii).
//
// Mirrors tests/fixtures/pii-corpus.ts in shape (PositiveCase / NegativeCase
// records). tests/fixtures/ is excluded from tsconfig (Phase 0 D-13), but this
// file is imported by tests/pii-polish.test.ts (which IS type-checked), so it
// must type-check cleanly on its own.
//
// Coverage axes added in Phase 9:
//   - IP   : dotted-quad IPv4 literals (e.g. 192.168.1.1)
//   - IBAN : country-code + check-digit + BBAN (e.g. GB29NWBK60161331926819)
//   - NAME suppression: two-token sequences whose LAST token is a generic
//     academic/section/month word must NOT classify as NAME (RESEARCH Pitfall 6
//     — the bare two-cap-token NAME regex over-matches `Results Section`,
//     `Methods Discussion`, `January March`). Two-token positives whose last
//     token is a real surname (`Jane Smith`, `In Smith`) MUST still classify.
//   - DIFF_CASES: inputs driving the diffPii determinism + idempotence suite.
//
// PII_EGRESS_SENTINELS is the SINGLE canonical sentinel set shared with
// tests/intake-pii-egress.test.ts (Task 3): distinctive fake values that MUST
// be redacted out of any model-bound payload before it crosses the model
// boundary. Keeping them here (not duplicated in the egress test) means the
// egress contract and the corpus stay in lockstep.

export interface PiiPolishPositive {
  input: string;
  kind: 'IP' | 'IBAN' | 'NAME';
  raw: string; // exact substring the new classifier is expected to match
}

export interface PiiPolishNegative {
  input: string;
  reason: string;
}

// --- IP + IBAN positives (the two NEW classes 09-01 adds) -------------------
export const PII_POLISH_POSITIVES: PiiPolishPositive[] = [
  // IP (IPv4 dotted-quad)
  { input: 'Logged from 192.168.1.1 at noon.', kind: 'IP', raw: '192.168.1.1' },
  { input: 'gateway 10.0.0.254 unreachable', kind: 'IP', raw: '10.0.0.254' },
  { input: 'host 172.16.34.7 responded', kind: 'IP', raw: '172.16.34.7' },
  // IBAN (country code + 2 check digits + BBAN; bounded length)
  { input: 'wire to GB29NWBK60161331926819 today', kind: 'IBAN', raw: 'GB29NWBK60161331926819' },
  { input: 'IBAN: DE89370400440532013000', kind: 'IBAN', raw: 'DE89370400440532013000' },
  { input: 'account FR1420041010050500013M02606 confirmed', kind: 'IBAN', raw: 'FR1420041010050500013M02606' },
];

// --- NAME suppression: MUST NOT classify as NAME ----------------------------
// The naive two-cap-token NAME regex over-matches these. The 09-01 suppression
// dictionary (last-token-in-suppress-set ⇒ not a name) must drop them.
export const NAME_SUPPRESS_NEGATIVES: PiiPolishNegative[] = [
  { input: 'Results Section', reason: 'last token "Section" is a generic doc word — not a surname' },
  { input: 'Methods Discussion', reason: 'last token "Discussion" is a section word — not a surname' },
  { input: 'January March', reason: 'both tokens are month names — not a person' },
];

// --- NAME positives that MUST still classify --------------------------------
// Two-token sequences whose LAST token is a genuine surname stay NAME — the
// suppression dict keys on the LAST token only (RESEARCH Pitfall 6), so a
// non-suppressed last token keeps the match.
export const NAME_TWO_TOKEN_POSITIVES: PiiPolishPositive[] = [
  { input: 'Author Jane Smith wrote it', kind: 'NAME', raw: 'Jane Smith' },
  { input: 'cited in In Smith earlier', kind: 'NAME', raw: 'In Smith' },
];

// --- diffPii determinism / idempotence inputs -------------------------------
// Each string carries ≥1 redactable span across the new + existing classes so
// diffPii returns a non-empty, structurally-stable diff for the determinism +
// idempotence assertions in tests/pii-polish.test.ts.
export const DIFF_CASES: string[] = [
  'Contact help@example.com from 192.168.1.1 please.',
  'Wire GB29NWBK60161331926819 and call (555) 123-4567.',
  'SSN 123-45-6789 reported by Jane Smith on 2024-03-15.',
];

// --- canonical PII egress sentinels (shared with the egress test) -----------
// Distinctive fake values. They MUST be redacted out of any model-bound
// payload. The .test TLD + obviously-fake local parts make a leak unambiguous
// in a failing assertion.
export const PII_EGRESS_SENTINELS = {
  email: 'leak.sentinel@example.test',
  ssn: '123-45-6789',
  name: 'Jane Sentinel',
} as const;
