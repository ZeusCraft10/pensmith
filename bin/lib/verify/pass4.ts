// bin/lib/verify/pass4.ts — Pass 4 (orphan claims), advisory (VRFY-06, VRFY-23, D-20-29).
//
// An orphan claim is a sentence that asserts something a reader would need a
// source for, while the sentence carries no citation. Pass 4 finds them per
// paragraph in two layers:
//
//   1. A DETERMINISTIC FLOOR (pure Node, no NLP, no LLM — PRD §14 determinism):
//      paragraphs split on blank lines (headings, fenced code, tables, rules
//      and comment lines are not prose), sentences on a `.`, `!` or `?` (and
//      any closing quote or bracket) followed by whitespace or the end — never
//      inside a citation, and a citation left alone after the full stop joins
//      its sentence. A sentence of at least CLAIM_MIN_WORDS words (citations
//      not counted) that is not a question and not a definition is a claim
//      (HIGH) when it holds ONE strong marker — a causal verb, a universal
//      quantifier, an evidential verb in any inflection, a statistic or
//      percentage, a comparative change — or TWO distinct weak markers (the
//      R6 list); one weak marker alone makes it AMBIGUOUS. A HIGH claim is an
//      orphan when the sentence itself carries no citation of any Pandoc form
//      (citation-token.ts findCitations: clusters, locators, `[-@k]`, `@{k}`,
//      narrative `@k`). The floor catches "Social media use clearly causes
//      depression in every adolescent." and "Studies show that 73% of
//      American cities …" (the audit's CORE-35 / SWP-82 sentences).
//
//   2. A PER-PARAGRAPH LLM AUDIT (the hash-pinned `orphan-label` slug): every
//      paragraph with a claim or an ambiguous sentence is sent once; the model
//      lists its claims ({sentence, needs_citation, supported_by}). It can only
//      ADD orphans: a sentence it marks needs_citation, whose supported_by
//      names no key the paragraph really cites, that is a sentence of the
//      paragraph, and that carries no citation. The deterministic count is a
//      floor no answer can lower. Under PENSMITH_NO_LLM=1 the audit is skipped
//      with zero calls; with no provider key it is skipped once; any other
//      failure is reported on stderr and leaves the floor.
//
// ADVISORY by construction: this module returns Pass4Result[] only and never
// reads or writes a blocking verdict (VRFY-07; tests/verify-advisory-isolation
// .test.ts is the structural gate). done runs it over the exact text it
// exports and feeds the confirmation summary (D-20-24).

import { complete, isFatalLlmError, MissingApiKeyError } from '../anthropic.js';
import { citationItems } from '../citation-token.js';
import { draftSentences, proseParagraphs, prose, type DraftParagraph, type DraftSentence } from './draft-text.js';
import type { OrphanLabel as OrphanAudit } from '../llm-contracts.js';
import { buildPromptRequest, requestHints, type PromptRequest } from '../prompt-request.js';

// FEED-05 (D-18-04): the paragraph is draft text — untrusted. It reaches the
// model only as a data block the ONE renderer fences (prompt-request.ts →
// untrusted-fence.ts), after every spelling of a fence marker and every
// closing block tag in it has been neutralised.

/** The longest paragraph an orphan-audit request carries (a denial-of-service and cost bound). */
export const PASS4_MAX_PARAGRAPH_CHARS = 4000;

/**
 * The orphan-audit request for one paragraph: the fixed template as the system
 * prompt (the cacheable prefix, RUN-26) and one data message with the fenced
 * `paragraph` block.
 */
export function orphanAuditRequest(paragraph: string): PromptRequest {
  return buildPromptRequest('orphan-label', { paragraph: paragraph.slice(0, PASS4_MAX_PARAGRAPH_CHARS) });
}

// ---- The floor's rule (named constants; the fixtures' expectations follow them) ----

/** A sentence shorter than this (citations not counted) is never a claim. */
export const CLAIM_MIN_WORDS = 8;

/** Strong markers: one is enough for a claim (D-20-29). */
const STRONG_MARKERS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    'causal',
    /\b(?:caus(?:e|es|ed|ing)|lead(?:s|ing)?\s+to|led\s+to|result(?:s|ed|ing)?\s+in|increas(?:e|es|ed|ing)|decreas(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|improv(?:e|es|ed|ing)|lower(?:s|ed|ing)?|rais(?:e|es|ed|ing)|driv(?:e|es|ing)|drove|prevent(?:s|ed|ing)?)\b/i,
  ],
  ['universal', /\b(?:every(?:one|body)?|all|always|never|no\s+one|nobody|none)\b/i],
  [
    'evidential',
    /\b(?:show(?:s|ed|n|ing)?|demonstrat(?:e|es|ed|ing)|find(?:s)?|found|report(?:s|ed|ing)?|indicat(?:e|es|ed|ing)|prov(?:e|es|ed|en|ing)|reveal(?:s|ed|ing)?|confirm(?:s|ed|ing)?|establish(?:es|ed|ing)?)\b/i,
  ],
  ['statistic', /\d(?:[\d.,]*\d)?\s?%|\b\d(?:[\d.,]*\d)?\s*(?:percent|per\s+cent)\b|\bper\s*cent\b|\bpercent(?:age)?s?\b|\b\d+(?:\.\d+)?\s*(?:times|-?fold)\b|\btwice\s+as\b/i],
  ['comparative', /\b(?:more|less|higher|lower|greater|fewer|larger|smaller)\s+than\b|\b(?:rose|fell|doubled|tripled|halved|quadrupled)\b/i],
];

/** Weak markers (the R6 list): two distinct ones make a claim, one an AMBIGUOUS sentence. */
const WEAK_MARKERS = /\b(is|are|demonstrates|shows|proves|indicates|suggests|reveals|confirms|establishes|argues|claims|because|therefore|thus|hence|consequently)\b/gi;

/** Definition-style sentences are not claims (R4). */
const DEFINITION_MARKERS = /\b(?:defined as|refers to|known as)\b/i;

// ---- Paragraphs and sentences: verify/draft-text.ts (shared with Pass 2 and the estimator) ----

export { proseParagraphs, draftSentences, type DraftParagraph, type DraftSentence } from './draft-text.js';

// ---- The floor ----

export interface ExtractedClaim {
  sentence: string;
  /** Offsets of the sentence in the paragraph text passed in. */
  startIndex: number;
  endIndex: number;
  /** HIGH = a strong marker or 2+ distinct weak markers; AMBIGUOUS = exactly one weak marker. */
  claimConfidence: 'HIGH' | 'AMBIGUOUS';
  /** True when the sentence itself carries a citation (any Pandoc form). */
  cited: boolean;
  /** The marker classes (and weak markers) that made it a claim. */
  markers: string[];
}

/** The claim reading of one sentence, or null when it is not a claim (too short, a question, a definition, no marker). */
function classify(sentence: DraftSentence): Omit<ExtractedClaim, 'startIndex' | 'endIndex' | 'sentence'> | null {
  const text = prose(sentence.text);
  if (/\?["'”’»)\]]*$/.test(text)) return null; // R3 question
  if (DEFINITION_MARKERS.test(text)) return null; // R4 definition
  if (text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length < CLAIM_MIN_WORDS) return null; // R5 length
  const strong = STRONG_MARKERS.filter(([, re]) => re.test(text)).map(([name]) => name);
  const weak = [...new Set([...text.matchAll(WEAK_MARKERS)].map((m) => (m[1] as string).toLowerCase()))];
  if (strong.length === 0 && weak.length === 0) return null;
  const confidence = strong.length > 0 || weak.length >= 2 ? 'HIGH' : 'AMBIGUOUS';
  return { claimConfidence: confidence, cited: sentence.citations.length > 0, markers: [...strong, ...weak] };
}

/**
 * The claims of one paragraph under the deterministic floor, in order. Pure
 * and deterministic (same input → deep-equal output; PRD §14).
 */
export function extractClaimsFromParagraph(para: string): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  for (const s of draftSentences(para)) {
    const c = classify(s);
    if (c !== null) out.push({ sentence: s.text, startIndex: s.start, endIndex: s.end, ...c });
  }
  return out;
}

// ---- Results ----

export interface Pass4ClaimResult {
  paragraphIndex: number;
  sentence: string;
  confidence: 'HIGH' | 'AMBIGUOUS';
  /** The sentence carries a citation. */
  cited: boolean;
  isOrphan: boolean;
  /** Who flagged the orphan: the deterministic floor or the paragraph audit; null when not an orphan. */
  by: 'floor' | 'llm' | null;
}

export interface Pass4Result {
  /** 1-based, among the draft's prose paragraphs. */
  paragraphIndex: number;
  totalSentences: number;
  claimsDetected: number;
  /** The paragraph's orphans: the deterministic floor plus the orphans the audit added. */
  orphanCount: number;
  claims: Pass4ClaimResult[];
  /** The orphan sentences, in order (orphanCount of them). */
  orphans: string[];
}

interface ParagraphAudit {
  readonly paragraph: DraftParagraph;
  readonly sentences: DraftSentence[];
  readonly result: Pass4Result;
}

function auditParagraph(paragraph: DraftParagraph, sentences: DraftSentence[]): ParagraphAudit {
  const claims: Pass4ClaimResult[] = [];
  const orphans: string[] = [];
  for (const s of sentences) {
    const c = classify(s);
    if (c === null) continue;
    const orphan = c.claimConfidence === 'HIGH' && !c.cited;
    claims.push({ paragraphIndex: paragraph.index, sentence: s.text, confidence: c.claimConfidence, cited: c.cited, isOrphan: orphan, by: orphan ? 'floor' : null });
    if (orphan) orphans.push(s.text);
  }
  return {
    paragraph,
    sentences,
    result: { paragraphIndex: paragraph.index, totalSentences: sentences.length, claimsDetected: claims.length, orphanCount: orphans.length, claims, orphans },
  };
}

/** A sentence reduced for matching the audit's copy against the paragraph's: citations out, whitespace, quotes and case folded. */
function matchKey(s: string): string {
  return prose(s.normalize('NFKC'))
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\s.!?;:,"']+$/u, '')
    .toLowerCase();
}

/**
 * Apply one paragraph's audit: every claim the model marks needs_citation
 * whose supported_by names no key the paragraph cites becomes an orphan when
 * it is a sentence of the paragraph that carries no citation and is not one
 * already. Returns how many orphans it added (never fewer than zero).
 */
function applyAudit(audit: ParagraphAudit, answer: OrphanAudit): number {
  const cited = new Set(audit.sentences.flatMap((s) => s.citations.flatMap((c) => citationItems(c).map((i) => i.key))));
  const byKey = new Map(audit.sentences.map((s) => [matchKey(s.text), s] as const));
  let added = 0;
  for (const claim of answer.claims) {
    if (!claim.needs_citation) continue;
    if (claim.supported_by.some((k) => cited.has(k.replace(/^-?@/, '')))) continue;
    const key = matchKey(claim.sentence);
    let sentence = byKey.get(key);
    if (sentence === undefined && key.split(' ').length >= 3) {
      const holders = audit.sentences.filter((s) => matchKey(s.text).includes(key));
      if (holders.length === 1) sentence = holders[0];
    }
    if (sentence === undefined || sentence.citations.length > 0) continue;
    const r = audit.result;
    if (r.orphans.includes(sentence.text)) continue;
    const existing = r.claims.find((c) => c.sentence === sentence.text);
    if (existing !== undefined) {
      existing.isOrphan = true;
      existing.by = 'llm';
    } else {
      r.claims.push({ paragraphIndex: r.paragraphIndex, sentence: sentence.text, confidence: 'AMBIGUOUS', cited: false, isOrphan: true, by: 'llm' });
      r.claimsDetected += 1;
    }
    r.orphans.push(sentence.text);
    r.orphanCount += 1;
    added += 1;
  }
  // Keep the orphan list in sentence order.
  const order = new Map(audit.sentences.map((s, i) => [s.text, i] as const));
  audit.result.orphans.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return added;
}

/**
 * One stderr line when an advisory pass could not judge some claims because
 * the model call failed (RUN-12): the rows keep their conservative defaults in
 * VERIFICATION.md and verify still exits on its deterministic verdict, but the
 * failure — e.g. a model the provider does not serve, and the key that
 * selects it — is never silent.
 */
export function reportAdvisoryFailure(pass: string, count: number, err: unknown): void {
  const detail = (err instanceof Error ? err.message : String(err)).replace(/^pensmith: /, '').split('\n')[0] ?? '';
  process.stderr.write(
    `pensmith verify: WARN — ${pass}, advisory, could not judge ${count} claim(s): ${detail} ` +
      '(recorded as UNCLEAR in VERIFICATION.md)\n',
  );
}

/**
 * Pass 4 advisory orphan audit over `draftMd`: one Pass4Result per prose
 * paragraph. The deterministic floor runs first; then, unless the LLM is
 * stubbed, each paragraph with a claim or an ambiguous sentence is audited
 * once (`orphan-label`) and may add orphans. The session cost cap and an
 * invalid runtime configuration are rethrown (verify writes its deterministic
 * verdict first); every other failure leaves the floor and is reported.
 */
export async function runPass4(draftMd: string, opts: { n: number | string }): Promise<Pass4Result[]> {
  const sentences = draftSentences(draftMd);
  const audits = proseParagraphs(draftMd).map((p) => auditParagraph(p, sentences.filter((s) => s.paragraph === p.index)));
  const results = audits.map((a) => a.result);
  if (process.env['PENSMITH_NO_LLM'] === '1') return results;

  let failed = 0;
  let firstError: unknown;
  for (const audit of audits) {
    if (audit.result.claimsDetected === 0) continue;
    try {
      // WR-04 / FEED-05: the renderer fences the paragraph (orphanAuditRequest).
      const request = orphanAuditRequest(audit.paragraph.text);
      const res = await complete<OrphanAudit>({
        slug: 'orphan-label',
        section: opts.n,
        system: request.system,
        messages: request.messages,
        stubHint: requestHints(request),
      });
      applyAudit(audit, res.data as OrphanAudit);
    } catch (err) {
      // No provider key: the audit is skipped for every paragraph (the floor stands; D-V1-04).
      if (err instanceof MissingApiKeyError) break;
      if (isFatalLlmError(err)) throw err;
      failed += 1;
      firstError ??= err;
    }
  }
  if (failed > 0) reportAdvisoryFailure('Pass 4 (orphan audit)', failed, firstError);
  return results;
}

// ---- Render (deterministic, no LLM) ----

/**
 * A sentence as a table cell: one line, no pipes, no HTML tag (`<` and `>`
 * become `‹` and `›`: draft text never renders as markup in VERIFICATION.md,
 * T-05-03-01), at most `max` characters.
 */
function cell(text: string, max: number): string {
  const t = text.replace(/[\r\n|]+/g, ' ').replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The longest orphan sentence shown in the Pass-4 table. */
export const PASS4_SENTENCE_CHARS = 140;

/**
 * Render the `## Pass-4` advisory section: one row per prose paragraph with
 * its counts and its orphan sentences (each clamped, table-safe; an orphan
 * the paragraph audit added is marked "(audit)"). Deterministic, no LLM.
 */
export function renderPass4Section(results: ReadonlyArray<Pass4Result>): string {
  if (results.length === 0) {
    return '## Pass-4 (orphan claims, advisory)\n\n_(no paragraphs to audit)_\n';
  }
  const total = results.reduce((a, r) => a + r.orphanCount, 0);
  const lines = [
    '## Pass-4 (orphan claims, advisory — deterministic floor + per-paragraph audit)',
    '',
    `Orphan claims: ${total} (a claim sentence that carries no citation).`,
    '',
    '| Paragraph | Sentences | Claims | Orphans | Orphan sentences |',
    '|-----------|-----------|--------|---------|------------------|',
  ];
  for (const r of results) {
    const sentences = r.orphans.map((s) => {
      const byLlm = r.claims.some((c) => c.sentence === s && c.by === 'llm');
      return `"${cell(s, PASS4_SENTENCE_CHARS)}"${byLlm ? ' (audit)' : ''}`;
    });
    lines.push(`| ${r.paragraphIndex} | ${r.totalSentences} | ${r.claimsDetected} | ${r.orphanCount} | ${sentences.length > 0 ? sentences.join(' · ') : '—'} |`);
  }
  lines.push('');
  return lines.join('\n');
}
