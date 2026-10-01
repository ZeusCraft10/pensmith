// bin/lib/claim-consistency.ts — the cross-section contradiction check
// (Phase 21, EXP-11; D-21-15, the D-12 amendment that adds the
// `claim-consistency` prompt slug).
//
// compile asks one question the surface scan (consistency-scan.ts: proper-noun
// forms, abbreviations) cannot answer: does the paper say "X causes Y" in one
// section and "there is no relationship between X and Y" in another? Advisory
// only — nothing here blocks compile or export; the result goes to
// COMPILE-REPORT.md `## Contradictions` and done's confirmation.
//
//   1. collectClaims: each section's claim sentences — the planned claims of
//      its PLAN.md `## Claims` and the draft sentences Pass 4's marker lexicon
//      reads as claims (verify/pass4.ts extractClaimsFromParagraph).
//   2. consistencyCandidates: every pair of claims from two DIFFERENT sections
//      that shares at least two content terms, ranked — heuristic flags first,
//      then by shared terms — and capped at `[compile] contradiction_pairs`
//      (default 20, RUN-26) for the one model call.
//   3. contradictionHeuristic: the deterministic floor that always runs (and is
//      all there is offline, under PENSMITH_NO_LLM or --dry-run): a pair that
//      shares most of its content terms (subject and predicate) but where one
//      sentence is negated and the other is not ("causes" / "no relationship"),
//      or where the two state opposite directions of change.
//   4. consistencyRequest / applyConsistencyReply: the `claim-consistency`
//      request (the pairs fenced: the sentences come from drafts, FEED-05) and
//      the counting rule — `Contradictions flagged: N (target 0)` counts the
//      model's CONTRADICTS plus the heuristic flags the model did not judge; a
//      heuristic pair the model judged CONSISTENT is listed as cleared, with its
//      rationale.
// The Tier-1 consistency tools (PLUG-07) use the same candidates, request
// shape, schema (llm-contracts.ts ClaimConsistencySchema) and counting.
// Pure: no I/O, no model call (bin/cli/compile.ts makes the call).

import { replaceCitations } from './citation-token.js';
import { extractClaimsFromParagraph, proseParagraphs } from './verify/pass4.js';
import { parsePlanClaims } from './plan-render.js';
import { buildPromptRequest, type PromptRequest } from './prompt-request.js';
import { DEFAULT_CONTRADICTION_PAIRS } from './schemas/config.js';

export { DEFAULT_CONTRADICTION_PAIRS };

/** One section as the check reads it. */
export interface ClaimSource {
  /** `1`, `1a`. */
  readonly section: string;
  readonly slug: string;
  readonly title: string;
  /** The PLAN.md body (its `## Claims` list is read); '' when there is none. */
  readonly planBody: string;
  /** The section's draft text. */
  readonly draft: string;
}

/** A claim sentence of one section. */
export interface ClaimSentence {
  readonly section: string;
  readonly slug: string;
  readonly title: string;
  /** The sentence as written (citations included). */
  readonly text: string;
  /** Where it came from: the PLAN.md claim list or the draft. */
  readonly origin: 'plan' | 'draft';
}

/** Why the deterministic floor flagged a pair. */
export interface HeuristicFlag {
  readonly kind: 'negation' | 'direction';
  readonly detail: string;
}

/** One cross-section pair of claims. */
export interface ConsistencyPair {
  /** `p1`, `p2`, … in rank order. */
  readonly id: string;
  readonly a: ClaimSentence;
  readonly b: ClaimSentence;
  /** The content terms both sentences use. */
  readonly shared: readonly string[];
  readonly heuristic: HeuristicFlag | null;
}

/** The model's answer for one pair. */
export interface ConsistencyVerdict {
  readonly id: string;
  readonly verdict: 'CONTRADICTS' | 'CONSISTENT' | 'UNCLEAR';
  readonly rationale: string;
}

/** What the check found, for COMPILE-REPORT.md and done's confirmation. */
export interface ContradictionReport {
  /** The pairs counted as contradictions: the model's CONTRADICTS, then the heuristic flags the model did not judge. */
  readonly flagged: ReadonlyArray<{ readonly pair: ConsistencyPair; readonly by: 'model' | 'heuristic'; readonly rationale: string }>;
  /** Heuristic flags the model judged CONSISTENT (not counted). */
  readonly cleared: ReadonlyArray<{ readonly pair: ConsistencyPair; readonly rationale: string }>;
  /** Heuristic flags the model judged UNCLEAR (not counted: the model judged them). */
  readonly undecided: ReadonlyArray<{ readonly pair: ConsistencyPair; readonly rationale: string }>;
  /** Cross-section claim pairs that share content terms. */
  readonly candidates: number;
  /** Pairs the model judged. */
  readonly judged: number;
  /** `[compile] contradiction_pairs`. */
  readonly cap: number;
  /** Why the model check did not run ('' when it ran), e.g. `skipped (no LLM)`. */
  readonly skipped: string;
}

/** Each sentence is cut to this many characters before it is sent. */
export const CLAIM_SENTENCE_MAX_CHARS = 600;
/** A pair must share at least this many content terms to be a candidate. */
export const MIN_SHARED_TERMS = 2;

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/** Function words, hedges and the claim markers themselves: never a shared "content" term. */
const STOPWORDS: ReadonlySet<string> = new Set(`
a an and are as at be been being but by can could did do does done for from had has have having he her his how however i if in into is it its
may might more most much must not no nor of on once only or other our out over own same she should so some such than that the their them then
there these they this those through to too under until up very was we were what when where which while who whom why will with would yet you your
also although among because between both each either even every few further here many neither never none often per rather since still thus
therefore whether within without across after again against all almost along already always another any around before being below beyond
cannot during less like least many maybe others otherwise perhaps quite seem seems shown show shows study studies paper section research
evidence finding findings found suggest suggests suggested indicate indicates indicated report reports reported argue argues argued claim
claims claimed relationship relation link linked association associated effect effects impact impacts role result results resulted
`.split(/\s+/).filter(Boolean));

/** Light stemming: a plural `s` (never `ss`) and a possessive. */
function stem(w: string): string {
  let t = w.replace(/'s$/, '');
  if (t.length > 4 && t.endsWith('ies')) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) t = t.slice(0, -1);
  return t;
}

/** The content terms of a sentence: citations removed, lowercase words of 3+ letters, no stopword, stemmed. */
export function contentTerms(sentence: string): string[] {
  const words = replaceCitations(sentence, () => ' ')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter((w) => w.length >= 3 && /\p{L}/u.test(w) && !STOPWORDS.has(w));
  return [...new Set(words.map(stem))];
}

// ---------------------------------------------------------------------------
// The deterministic floor
// ---------------------------------------------------------------------------

/** A negation cue: the sentence denies what it states. */
const NEGATION_RE =
  /\b(?:no|not|never|none|neither|nor|without|cannot|unrelated|independent\s+of|absence\s+of|lack(?:s|ed)?\s+(?:of\s+)?|fail(?:s|ed)?\s+to)\b|n't\b/i;

/** Opposite directions of change: [one side, the other side]. */
const DIRECTIONS: ReadonlyArray<readonly [RegExp, RegExp, string]> = [
  [/\b(?:increas(?:e|es|ed|ing)|ris(?:e|es|ing)|rose|grow(?:s|ing|n)?|grew|rais(?:e|es|ed|ing)|boost(?:s|ed|ing)?)\b/i, /\b(?:decreas(?:e|es|ed|ing)|fall(?:s|ing)?|fell|declin(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|lower(?:s|ed|ing)?|shrink(?:s|ing)?|shrank|drop(?:s|ped|ping)?)\b/i, 'increase vs decrease'],
  [/\b(?:improv(?:e|es|ed|ing)|strengthen(?:s|ed|ing)?|benefit(?:s|ed|ing)?)\b/i, /\b(?:worsen(?:s|ed|ing)?|weaken(?:s|ed|ing)?|harm(?:s|ed|ing)?|impair(?:s|ed|ing)?)\b/i, 'improves vs worsens'],
  [/\bpositive(?:ly)?\b/i, /\bnegative(?:ly)?\b/i, 'positive vs negative'],
  [/\bhigher\b/i, /\blower\b/i, 'higher vs lower'],
];

/** The two sentences as prose (citations removed). */
function prose(s: string): string {
  return replaceCitations(s, () => ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The deterministic negation / quantifier-polarity / direction check of one
 * pair (the offline floor). It flags a pair only when the two sentences share
 * at least MIN_SHARED_TERMS content terms covering at least half the shorter
 * sentence's terms (the same subject and predicate), and then: exactly one of
 * them is negated ("X causes Y" / "no relationship between X and Y", "all" /
 * "none"), or both state opposite directions of change of the same thing.
 * Null when it does not flag the pair.
 */
export function contradictionHeuristic(a: string, b: string): HeuristicFlag | null {
  const ta = contentTerms(a);
  const tb = new Set(contentTerms(b));
  const shared = ta.filter((t) => tb.has(t));
  const smaller = Math.min(ta.length, tb.size);
  if (smaller === 0) return null;
  const ratio = shared.length / smaller;
  // The same subject and predicate: three shared terms covering half the
  // shorter sentence, or two covering nearly all of it.
  if (!((shared.length >= 3 && ratio >= 0.5) || (shared.length >= MIN_SHARED_TERMS && ratio >= 0.8))) return null;
  const pa = prose(a);
  const pb = prose(b);
  const negA = NEGATION_RE.test(pa);
  const negB = NEGATION_RE.test(pb);
  if (negA !== negB) {
    return { kind: 'negation', detail: `one sentence denies what the other asserts about ${shared.slice(0, 4).join(', ')}` };
  }
  for (const [up, down, label] of DIRECTIONS) {
    if ((up.test(pa) && down.test(pb) && !down.test(pa) && !up.test(pb)) || (down.test(pa) && up.test(pb) && !up.test(pa) && !down.test(pb))) {
      return { kind: 'direction', detail: `${label} of ${shared.slice(0, 4).join(', ')}` };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Claims and candidates
// ---------------------------------------------------------------------------

/** One line, at most CLAIM_SENTENCE_MAX_CHARS. */
function oneLine(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= CLAIM_SENTENCE_MAX_CHARS ? t : `${t.slice(0, CLAIM_SENTENCE_MAX_CHARS - 1)}…`;
}

/** How much of the shorter term list the other one holds (1 when it holds all of it). */
function overlap(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const smaller = Math.min(sa.size, sb.size);
  return smaller === 0 ? 1 : inter / smaller;
}

/**
 * Every claim sentence of every section: the draft's claim sentences (Pass
 * 4's lexicon), then the planned claims (PLAN.md `## Claims`) the draft does
 * not already state — a planned claim whose content terms nearly all appear in
 * one of the section's draft claims (at least 80% of the shorter one's terms)
 * is the same claim, and is left out so one contradiction is never counted
 * twice. Never throws.
 */
export function collectClaims(sections: readonly ClaimSource[]): ClaimSentence[] {
  const out: ClaimSentence[] = [];
  for (const s of sections) {
    const mine: Array<{ terms: string[] }> = [];
    const add = (text: string, origin: 'plan' | 'draft'): void => {
      const line = oneLine(text);
      if (prose(line).length === 0) return;
      const terms = contentTerms(line);
      if (mine.some((m) => overlap(m.terms, terms) >= 0.8)) return;
      mine.push({ terms });
      out.push({ section: s.section, slug: s.slug, title: s.title, text: line, origin });
    };
    for (const p of proseParagraphs(s.draft)) {
      for (const c of extractClaimsFromParagraph(p.text)) add(c.sentence, 'draft');
    }
    try {
      for (const c of parsePlanClaims(s.planBody)) add(c.claim, 'plan');
    } catch {
      // a PLAN.md body that does not parse contributes no planned claim
    }
  }
  return out;
}

/**
 * The cross-section pairs that share at least MIN_SHARED_TERMS content terms,
 * ranked: heuristic flags first, then by the number of shared terms, then by
 * section order. `pairs` is every candidate with its rank id; `sent` the first
 * `maxPairs` of them (what one claim-consistency call judges). Never throws.
 */
export function consistencyCandidates(
  claims: readonly ClaimSentence[],
  opts: { readonly maxPairs?: number } = {},
): { readonly pairs: readonly ConsistencyPair[]; readonly sent: readonly ConsistencyPair[] } {
  const max = Math.max(0, Math.floor(opts.maxPairs ?? DEFAULT_CONTRADICTION_PAIRS));
  const terms = claims.map((c) => contentTerms(c.text));
  const raw: Array<Omit<ConsistencyPair, 'id'> & { order: number }> = [];
  let order = 0;
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i] as ClaimSentence;
      const b = claims[j] as ClaimSentence;
      if (a.section === b.section) continue;
      const tb = new Set(terms[j]);
      const shared = (terms[i] ?? []).filter((t) => tb.has(t));
      if (shared.length < MIN_SHARED_TERMS) continue;
      raw.push({ a, b, shared, heuristic: contradictionHeuristic(a.text, b.text), order });
      order += 1;
    }
  }
  raw.sort((x, y) => Number(y.heuristic !== null) - Number(x.heuristic !== null) || y.shared.length - x.shared.length || x.order - y.order);
  const pairs: ConsistencyPair[] = raw.map((r, k) => ({ id: `p${k + 1}`, a: r.a, b: r.b, shared: r.shared, heuristic: r.heuristic }));
  return { pairs, sent: pairs.slice(0, max) };
}

/**
 * The claim-consistency request for `pairs` (the fixed template as the system
 * prompt; the pairs as one fenced JSON block, built field by field).
 */
export function consistencyRequest(pairs: readonly ConsistencyPair[]): PromptRequest {
  return buildPromptRequest('claim-consistency', {
    pairs: pairs.map((p) => ({
      id: p.id,
      section_a: { id: p.a.section, title: p.a.title },
      sentence_a: p.a.text,
      section_b: { id: p.b.section, title: p.b.title },
      sentence_b: p.b.text,
      shared_terms: [...p.shared],
    })),
  });
}

/**
 * Apply the model's verdicts (null: the model check did not run, with
 * `skipped` saying why) to the candidates (D-21-15 counting rules):
 *   - a sent pair the model judged CONTRADICTS is flagged (by the model);
 *   - a heuristic flag the model did not judge (not sent, no verdict for its
 *     id, or no model call) is flagged (by the heuristic);
 *   - a heuristic flag judged CONSISTENT is cleared (listed, not counted);
 *   - a heuristic flag judged UNCLEAR was judged: listed, not counted.
 * Unknown ids and repeated ids (after the first) are ignored. Never throws.
 */
export function applyConsistencyReply(input: {
  readonly pairs: readonly ConsistencyPair[];
  readonly sent: readonly ConsistencyPair[];
  readonly verdicts: readonly ConsistencyVerdict[] | null;
  readonly cap: number;
  readonly skipped?: string;
}): ContradictionReport {
  const sentIds = new Set(input.sent.map((p) => p.id));
  const byId = new Map<string, ConsistencyVerdict>();
  for (const v of input.verdicts ?? []) if (sentIds.has(v.id) && !byId.has(v.id)) byId.set(v.id, v);
  const model: Array<{ pair: ConsistencyPair; by: 'model' | 'heuristic'; rationale: string }> = [];
  const heuristic: Array<{ pair: ConsistencyPair; by: 'model' | 'heuristic'; rationale: string }> = [];
  const cleared: Array<{ pair: ConsistencyPair; rationale: string }> = [];
  const undecided: Array<{ pair: ConsistencyPair; rationale: string }> = [];
  for (const pair of input.pairs) {
    const v = byId.get(pair.id);
    if (v?.verdict === 'CONTRADICTS') {
      model.push({ pair, by: 'model', rationale: v.rationale });
      continue;
    }
    if (pair.heuristic === null) continue;
    if (v === undefined) heuristic.push({ pair, by: 'heuristic', rationale: pair.heuristic.detail });
    else if (v.verdict === 'CONSISTENT') cleared.push({ pair, rationale: v.rationale });
    else undecided.push({ pair, rationale: v.rationale });
  }
  return {
    flagged: [...model, ...heuristic],
    cleared,
    undecided,
    candidates: input.pairs.length,
    judged: input.verdicts === null ? 0 : input.sent.length,
    cap: input.cap,
    skipped: input.skipped ?? '',
  };
}
