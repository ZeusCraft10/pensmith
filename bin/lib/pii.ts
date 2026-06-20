// bin/lib/pii.ts — PII redaction primitives (ARCH-17 / D-49).
//
// This module is the redaction chokepoint that W9 session-log calls before
// every disk write. No log line escapes without going through redactPii
// (string body) and redactKeys (context object).
//
// Per D-49 the implementation is HAND-ROLLED regex over 5 classes; we do
// not pull in a regex/PII library. The regex source must remain reviewable
// in diff form — see the inline comment block above each pattern.
//
// Threat model coverage (see 01-08-PLAN.md threat_model section):
//   T-01-06 (PII to disk)       — mitigated via redactPii on every msg
//   T-01-07 (secrets in headers) — mitigated via redactKeys SENSITIVE set
//   T-01-08 (proto pollution)    — mitigated via Object.create(null) clone
//                                   container + isPlainObject proto guard
//   T-01-REDOS-01 (regex DoS)    — bounded character classes, NAME token
//                                   length cap [A-Z][a-z]{1,20}, no nested
//                                   quantifiers
//
// Pure module: NO I/O, NO fs, NO fetch, NO logging. The only import is a
// statically-bundled JSON data file (name-suppression.json) resolved at
// module load — this is NOT runtime I/O (no fs.readFile / fetch / Date.now /
// Math.random anywhere). diffPii is the new pure, deterministic export added
// in Phase 9.
//
// Phase 9 additions (09-01 / ERGO-07):
//   - IP   (dotted-quad IPv4) and IBAN-like classes, added BEFORE NAME in the
//     scan order so they win overlap resolution against the looser NAME regex.
//   - NAME_SUPPRESSION dictionary (~500 curated capitalized non-name tokens)
//     drops academic/section/month NAME false positives WITHOUT any NLP
//     dependency (Presidio/NLP deferred to v2 per PII-V2-01).
//   - diffPii(): pure positional reviewable diff derived from classifyPii.

import nameSuppression from './name-suppression.json' with { type: 'json' };

export type PiiKind = 'EMAIL' | 'PHONE' | 'SSN' | 'NAME' | 'DATE' | 'IP' | 'IBAN';

export interface PiiMatch {
  kind: PiiKind;
  span: [number, number];
  raw: string;
}

// ---------------------------------------------------------------------------
// Regex specifications (D-49 — VERBATIM from 01-08-PLAN.md <action>).
// Any change to these patterns is a spec deviation and requires a SUMMARY note.
// ---------------------------------------------------------------------------

// EMAIL — standard local-part + dotted domain. Intentionally not RFC-strict.
// "Good enough for redaction; false positives acceptable, false negatives
// are the failure mode." (D-49)
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// PHONE_US (kind: PHONE) — optional country code, optional parens around
// area code, optional separators (dash/dot/space).
const RE_PHONE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

// SSN — word-boundary anchored canonical dashed form ONLY. Per D-49 the
// spaceless 9-digit form has too high a false-positive rate to redact.
const RE_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

// IP (kind: IP) — Phase 9. Dotted-quad IPv4 literal. Fixed-shape: exactly
// four 1-3 digit groups separated by dots. Intentionally not range-validated
// (e.g. 999.999.999.999 still matches) — "false positives acceptable, false
// negatives are the failure mode" (D-49). No nested quantifiers, so the
// T-01-REDOS-01 bounded-backtracking guarantee holds.
const RE_IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

// IBAN-like (kind: IBAN) — Phase 9. Country code (2 letters) + 2 check digits
// + BBAN (4-30 alphanumerics). The {4,30} upper cap preserves the
// T-01-REDOS-01 bounded-quantifier guarantee (real IBANs are ≤34 chars; the
// 4-char floor avoids matching bare 2-letter+2-digit codes). Check-digit/MOD-97
// validation is NOT performed — this is a redaction heuristic, not a validator.
const RE_IBAN_LIKE = /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g;

// NAME — two-or-three capitalized tokens (handles middle name and
// hyphenated surnames). Token length cap of 20 lowercase chars after the
// initial capital prevents pathological backtracking (T-01-REDOS-01).
const RE_NAME = /\b[A-Z][a-z]{1,20}(?:[ -][A-Z][a-z]{1,20}){1,2}\b/g;

// NAME suppression dictionary (Phase 9 / ERGO-07). ~500 curated capitalized
// tokens that the loose two-cap-token NAME regex over-matches (months,
// weekdays, section headings, sentence-leading function words, common
// academic terms). Bundled JSON, NOT a runtime dependency — read once at
// module load via a static import, which keeps this module pure. A NAME
// candidate is suppressed ONLY when EVERY token in the match is a member of
// this set (RESEARCH Pitfall 6: a multi-token name whose last token is a real
// surname — "In Smith" — survives because "Smith" is not in the set).
const NAME_SUPPRESSION: ReadonlySet<string> = new Set<string>(nameSuppression);

// DATE — union of three sub-patterns: ISO, US, EU.
const RE_DATE_ISO = /\b\d{4}-\d{2}-\d{2}\b/g;
const RE_DATE_US = /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g;
const RE_DATE_EU = /\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:19|20)\d{2}\b/g;

// Patterns × kind, in the order classifyPii will scan them. Order matters
// only for the rare exact-tie overlap case where we keep "earlier-starting";
// after sort, ties are decided by insertion order.
const PATTERNS: ReadonlyArray<{ kind: PiiKind; re: RegExp }> = [
  { kind: 'EMAIL', re: RE_EMAIL },
  { kind: 'PHONE', re: RE_PHONE },
  { kind: 'SSN', re: RE_SSN },
  // IP + IBAN inserted BEFORE NAME so they win the exact-tie overlap pass
  // against the looser NAME regex (earlier insertion = higher priority).
  { kind: 'IP', re: RE_IP },
  { kind: 'IBAN', re: RE_IBAN_LIKE },
  { kind: 'NAME', re: RE_NAME },
  { kind: 'DATE', re: RE_DATE_ISO },
  { kind: 'DATE', re: RE_DATE_US },
  { kind: 'DATE', re: RE_DATE_EU },
];

// ---------------------------------------------------------------------------
// NAME suppression helper (Phase 9 / RESEARCH Pitfall 6). The loose NAME regex
// greedily matches 2-3 capitalized tokens, so it over-grabs sentence-leading
// function words ("Author Jane Smith", "Results Section"). This helper applies
// the curated NAME_SUPPRESSION dictionary in two stages and returns the
// trimmed match — or null if the whole thing should be dropped:
//
//   1. DROP entirely if EVERY token is suppressed ("Results Section",
//      "January March").
//   2. Otherwise strip leading suppressed tokens, but ONLY while the remainder
//      still forms a valid NAME (≥2 tokens — the NAME regex never matches a
//      single token). So "Author Jane Smith" → "Jane Smith", while "In Smith"
//      keeps both tokens because stripping "In" would leave a lone "Smith".
//
// Returns { raw, startDelta } where startDelta is the byte offset to add to the
// original span start (0 when nothing was trimmed). Pure — no I/O, no mutable
// closure state.
// ---------------------------------------------------------------------------
function resolveSuppressedName(raw: string): { raw: string; startDelta: number } | null {
  const tokens = raw.split(/[ -]/);
  if (tokens.length === 0) return { raw, startDelta: 0 };

  // Stage 1: all tokens suppressed → drop.
  if (tokens.every((t) => NAME_SUPPRESSION.has(t))) return null;

  // Stage 2: strip leading suppressed tokens while ≥2 tokens remain valid.
  let start = 0;
  while (
    start < tokens.length &&
    NAME_SUPPRESSION.has(tokens[start] as string) &&
    tokens.length - start - 1 >= 2
  ) {
    start++;
  }

  if (start === 0) return { raw, startDelta: 0 };

  // Compute the byte offset of the kept span: skip `start` leading tokens plus
  // their following single separator char each. Slicing the ORIGINAL raw (vs.
  // a re-join) preserves the exact separators inside the kept span.
  let offset = 0;
  for (let i = 0; i < start; i++) {
    offset += (tokens[i] as string).length + 1; // token + one separator char
  }
  return { raw: raw.slice(offset), startDelta: offset };
}

// ---------------------------------------------------------------------------
// classifyPii — returns spans in source order, no overlaps.
// Overlap rule: longer raw wins; on tie, earlier start wins.
// ---------------------------------------------------------------------------

export function classifyPii(text: string): PiiMatch[] {
  if (typeof text !== 'string' || text.length === 0) return [];

  const candidates: PiiMatch[] = [];
  for (const { kind, re } of PATTERNS) {
    // matchAll with /g returns iterator of RegExpMatchArray; m.index is set.
    for (const m of text.matchAll(re)) {
      const start = m.index ?? -1;
      if (start < 0) continue;
      let raw = m[0];
      let matchStart = start;
      // NAME suppression (Phase 9): drop / trim NAME candidates against the
      // curated non-name dictionary. Only NAME is filtered — IP/IBAN/EMAIL/
      // PHONE/SSN/DATE are never suppressed. resolveSuppressedName returns
      // null (drop entirely) or a possibly-trimmed match with a span delta.
      if (kind === 'NAME') {
        const resolved = resolveSuppressedName(raw);
        if (resolved === null) continue;
        raw = resolved.raw;
        matchStart += resolved.startDelta;
      }
      candidates.push({ kind, span: [matchStart, matchStart + raw.length], raw });
    }
  }

  // Sort by start ascending; on tie, longer first (so the longer wins the
  // overlap pass below).
  candidates.sort((a, b) => {
    if (a.span[0] !== b.span[0]) return a.span[0] - b.span[0];
    return b.raw.length - a.raw.length;
  });

  // Resolve overlaps: walk left-to-right, drop any candidate whose span
  // overlaps an already-accepted span. Because we sorted longer-first on
  // tied starts, the longer candidate is accepted first and the shorter
  // tied candidate is dropped. For non-tied starts, an earlier-starting
  // candidate that is shorter than a later-starting longer one is replaced
  // only when the later candidate extends further — handled by a swap.
  const accepted: PiiMatch[] = [];
  for (const cand of candidates) {
    const last = accepted.length > 0 ? accepted[accepted.length - 1] : undefined;
    if (!last) {
      accepted.push(cand);
      continue;
    }
    const overlaps = cand.span[0] < last.span[1];
    if (!overlaps) {
      accepted.push(cand);
      continue;
    }
    // Overlap. Keep the longer raw; on tie, keep the earlier-starting one
    // (which is `last`, since sort placed earlier starts first).
    if (cand.raw.length > last.raw.length) {
      accepted[accepted.length - 1] = cand;
    }
    // else: drop cand
  }

  return accepted;
}

// ---------------------------------------------------------------------------
// redactPii — splice spans right-to-left so offsets remain valid.
// ---------------------------------------------------------------------------

export function redactPii(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  const spans = classifyPii(text);
  if (spans.length === 0) return text;

  let out = text;
  // Walk REVERSE — splicing the rightmost span first keeps every leftward
  // span's [start,end] indices valid relative to `out`.
  for (let i = spans.length - 1; i >= 0; i--) {
    const s = spans[i];
    if (!s) continue;
    const tag = `[REDACTED:${s.kind}]`;
    out = out.slice(0, s.span[0]) + tag + out.slice(s.span[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// diffPii — pure, deterministic, reviewable diff (Phase 9 / ERGO-07, SC-3).
//
// Derives one PiiDiff per classified span from classifyPii(original) — which is
// already deterministic and overlap-resolved — and tags each with the SAME
// `[REDACTED:${kind}]` literal redactPii would splice in. The optional
// `redacted` arg is accepted only for API symmetry with redactPii callers; the
// diff is computed from `original` alone. We deliberately do NOT diff the two
// strings character-by-character: under tied spans that would be ambiguous and
// thus non-deterministic. Spans inherit classifyPii's start-ascending order.
//
// Idempotence: feeding already-redacted text yields an empty diff, because the
// `[REDACTED:KIND]` tags contain no classifiable PII (the redaction tag is not
// itself an EMAIL/PHONE/SSN/NAME/DATE/IP/IBAN). Pure — purely positional math,
// no Date.now / Math.random / randomUUID / I/O.
// ---------------------------------------------------------------------------

export interface PiiDiff {
  span: [number, number];
  kind: PiiKind;
  raw: string;
  tag: string;
}

export function diffPii(original: string, _redacted?: string): PiiDiff[] {
  void _redacted; // accepted for API symmetry; diff is derived from `original`.
  return classifyPii(original).map((m) => ({
    span: m.span,
    kind: m.kind,
    raw: m.raw,
    tag: `[REDACTED:${m.kind}]`,
  }));
}

// ---------------------------------------------------------------------------
// redactKeys — recursive deep-clone with sensitive-key value replacement.
// ---------------------------------------------------------------------------

// 15 keys, lowercase, exact-token match (case-insensitive via toLowerCase
// on the property name). Any change is a spec deviation — see SUMMARY.
const SENSITIVE: ReadonlySet<string> = new Set([
  'authorization',
  'x-api-key',
  'api_key',
  'apikey',
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'client_secret',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'ssn',
  'ssn_last4',
]);

// Plain-object guard: refuses class instances, Map, Set, Date, Buffer,
// Error, etc. Their prototype is not Object.prototype (or null for
// Object.create(null)) — we treat them as opaque scalars.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// Pure deep-clone that uses Object.create(null) containers for plain
// objects. This means __proto__ keys (when planted as own properties via
// JSON.parse) become inert data on a null-prototype object — they never
// reach Object.prototype.
function deepClone(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(deepClone);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(v)) {
      out[k] = deepClone(v[k]);
    }
    return out;
  }
  // Scalars and opaque objects (class instances, Map, Set, Date, Buffer,
  // Error...) returned by reference. They are NOT traversed and NOT
  // mutated; any sensitive-key path that points at one will be replaced
  // wholesale with '[REDACTED]' in the walk pass below.
  return v;
}

// Walk the cloned tree and replace sensitive-key values. Mutates the clone
// in place (which is safe — caller never sees the clone container).
function walkAndRedact(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) walkAndRedact(item);
    return;
  }
  if (!isPlainObject(node)) return;

  for (const key of Object.keys(node)) {
    const lower = key.toLowerCase();
    const val = node[key];
    if (SENSITIVE.has(lower)) {
      // Replace value. Per spec:
      //   - string with classifiable PII → keep redactPii(value)
      //   - string without PII          → literal '[REDACTED]'
      //   - non-string (anything else)   → literal '[REDACTED]'
      // Either branch erases the original raw secret.
      if (typeof val === 'string') {
        const redacted = redactPii(val);
        node[key] = redacted !== val ? redacted : '[REDACTED]';
      } else {
        node[key] = '[REDACTED]';
      }
      // Do NOT recurse into a redacted subtree.
      continue;
    }
    // Non-sensitive key — recurse into structures, leave scalars alone.
    if (Array.isArray(val) || isPlainObject(val)) {
      walkAndRedact(val);
    }
  }
}

export function redactKeys<T>(obj: T): T {
  // Clone first so the input object is never mutated. The clone uses
  // null-prototype containers for proto-pollution defense.
  const cloned = deepClone(obj);
  walkAndRedact(cloned);
  return cloned as T;
}
