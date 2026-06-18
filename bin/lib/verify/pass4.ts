// bin/lib/verify/pass4.ts — Pass 4 (per-paragraph orphan-claim audit), advisory (VRFY-06).
//
// Modeled structurally on TWO analogs:
//   - bin/lib/quote-extractor.ts — the deterministic, pure-Node, no-NLP/no-LLM
//     extraction shape (named threshold constants + regex iteration).
//   - bin/lib/verify/freshness.ts — the advisory side-channel shape: this module
//     runs AFTER the blocking verdict (Pass 1 + Pass 3) is frozen and NEVER feeds
//     back into `hasFail` / `status`. runPass4 returns Pass4Result[] ONLY. There
//     is NO hasFail / status reference anywhere in this file by design (VRFY-07;
//     tests/verify-advisory-isolation.test.ts is the structural gate).
//
// CORE DETERMINISM (the load-bearing correctness property, PRD §14):
//   Steps 1-2 (sentence split, claim extraction, orphan detection, orphanCount)
//   are PURE-NODE regex implementing the PINNED rule R1-R8 authored in Plan
//   05-01 Task 1 (the single source of truth from which every
//   tests/fixtures/pass4-orphan.json expected_orphan_count was mechanically
//   derived). Same input -> identical orphan set every time. NO NLP library, NO
//   Date, NO Math.random, NO locale-sensitive collation.
//
// PINNED RULE R1-R8 (copied verbatim from Plan 05-01 Task 1 — do not paraphrase):
//   R1 — Sentence split: split a paragraph on a `.`, `!`, or `?` terminator
//        followed by whitespace OR end-of-string. No NLP, no abbreviation
//        handling (residual abbreviation false-positives are an accepted advisory
//        limitation). Trim each resulting sentence.
//   R2 — In-text citation marker: a `[@citekey]` token matching CITEKEY_RE. "Has
//        a citation within proximity" = a `[@citekey]` token appears within
//        ORPHAN_PROXIMITY_CHARS=500 characters of the sentence's character span
//        inside the paragraph (paragraphs are short, so in practice this is "the
//        paragraph contains a [@citekey]").
//   R3 — Rhetorical skip: a sentence ending in `?` is NOT a claim (discarded
//        BEFORE marker counting).
//   R4 — Definition skip: a sentence matching DEFINITION_MARKERS is NOT a claim
//        (discarded BEFORE marker counting).
//   R5 — Length skip: a sentence with word count < CLAIM_MIN_WORDS=8 is NOT a
//        claim. This is a PRE-FILTER applied BEFORE R6 marker counting (same skip
//        stage as R3/R4). A sentence dropped at R5 is never marker-counted and
//        can never be a claim or orphan. Word count is the trimmed sentence split
//        on whitespace (NO stripCites — [@citekey] tokens count as words).
//   R6 — Marker counting: count DISTINCT case-insensitive surface forms matched
//        by CLAIM_MARKERS in the surviving sentence.
//   R7 — Confidence: 0 distinct markers -> NOT a claim (dropped); exactly 1 ->
//        'AMBIGUOUS'; 2+ -> 'HIGH'.
//   R8 — orphanCount (the deterministic, LLM-INDEPENDENT summary number the
//        fixtures assert): count ONLY 'HIGH'-confidence claim sentences with NO
//        in-text citation within proximity (R2). AMBIGUOUS sentences are NEVER
//        counted toward orphanCount regardless of any later LLM Step-3 label.
//
// STEP 3 (advisory edge-case labeling — the ONLY LLM seam):
//   For AMBIGUOUS sentences ONLY, the hash-pinned `orphan-label` prompt is asked
//   for a {claim, definition, UNCLEAR} label. This is purely advisory metadata
//   for the per-claim `label` field; it NEVER changes orphanCount (R8 invariant)
//   and NEVER reclassifies a HIGH claim. It is gated behind assertBudget
//   (ARCH-09/10 per-section cap) and the PENSMITH_NO_LLM guard — under
//   PENSMITH_NO_LLM=1 (or no ANTHROPIC_API_KEY) Step 3 is skipped entirely, every
//   AMBIGUOUS claim is labeled 'UNCLEAR', and ZERO network calls are made (CI path).

import Anthropic from '@anthropic-ai/sdk';
import { assertBudget, appendCost } from '../budget.js';
import { estimateCost } from '../pricing.js';
import { loadPrompt, interpolate } from '../prompt-loader.js';
import { getProviderApiKey, loadRuntimeConfig } from '../runtime.js';

// ---- Named knob constants (PINNED rule — quote-extractor.ts constant-at-top style).

/** R5 — minimum word count for a sentence to be a candidate claim. */
const CLAIM_MIN_WORDS = 8;

/**
 * R6 — claim marker surface forms. Distinct case-insensitive matches in a
 * surviving sentence drive the R7 confidence: 1 -> AMBIGUOUS, 2+ -> HIGH.
 * Global + case-insensitive so matchAll yields every occurrence for dedup.
 */
const CLAIM_MARKERS =
  /\b(is|are|demonstrates|shows|proves|indicates|suggests|reveals|confirms|establishes|argues|claims|because|therefore|thus|hence|consequently)\b/gi;

/** R4 — definition-style sentences are NOT claims (Pitfall 6 precision guard). */
const DEFINITION_MARKERS = /\b(defined as|refers to|known as)\b/i;

/** R2 — a [@citekey] within this many chars of a claim sentence span = cited. */
const ORPHAN_PROXIMITY_CHARS = 500;

/** R1 — sentence boundary: a terminator (. ! ?) followed by whitespace. The
 *  lookbehind keeps the terminal punctuation attached to the preceding
 *  sentence so R3's trailing-`?` test and R6 word counting see it. */
const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+/;

/** R2 — canonical [@citekey] token regex (verbatim from pass1.ts / quote-extractor.ts). */
const CITEKEY_RE = /\[@([a-z][a-z0-9_-]*)\]/g;

// ---- Step-3 LLM constants (advisory edge-case labeling — AMBIGUOUS only) ----

// Per-section Pass 4 cap (ARCH-10 per-step cap). A config knob (05-RESEARCH Open
// Question 1) — no CONTEXT.md locks it, so default at Claude's discretion to
// $0.50/section, matching the Pass-2 sibling and leaving ample headroom under the
// $5 session cap even for paragraph-dense papers on claude-haiku-4.
const PASS4_SECTION_CAP_DEFAULT = 0.5;

// Conservative fixed token estimates for the pre-call budget gate. Real usage is
// recorded by appendCost AFTER the call from the SDK's usage report; these only
// need to be a safe upper-ish bound for the gate (DoS mitigation, T-05-03-04).
const EST_INPUT_TOKENS = 1200;
const EST_OUTPUT_TOKENS = 60;
const DEFAULT_MODEL = 'claude-haiku-4';

/** Step-3 advisory label vocabulary (parsed from the orphan-label response). */
type OrphanLabel = 'claim' | 'definition' | 'UNCLEAR';

// ---- Exported result interfaces (from 05-PATTERNS §pass4.ts) ----------------

export interface ExtractedClaim {
  sentence: string;
  startIndex: number;
  endIndex: number;
  /** HIGH = 2+ distinct markers; AMBIGUOUS = exactly 1 (R7). */
  claimConfidence: 'HIGH' | 'AMBIGUOUS';
}

export interface Pass4ClaimResult {
  paragraphIndex: number;
  sentence: string;
  confidence: 'HIGH' | 'AMBIGUOUS';
  isOrphan: boolean;
  label: 'claim' | 'definition' | 'UNCLEAR';
}

export interface Pass4Result {
  paragraphIndex: number;
  totalSentences: number;
  claimsDetected: number;
  /** R8 — HIGH-confidence orphans ONLY; LLM-independent and deterministic. */
  orphanCount: number;
  claims: Pass4ClaimResult[];
}

// ---- Deterministic helpers (pure-Node — no NLP, no LLM) ---------------------

/**
 * R5 word count on the TRIMMED RAW sentence split on whitespace. Deliberately
 * does NOT strip [@citekey] tokens (per the PINNED rule a citekey token counts
 * as one word) — this is the single source of truth for both the extractor and
 * the fixtures' R5 walks.
 */
function wordCount(sentence: string): number {
  return sentence.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * R6 — count DISTINCT case-insensitive CLAIM_MARKERS surface forms in a
 * sentence. "Distinct" = number of unique lower-cased marker matches (e.g.
 * `is` twice -> 1; `proves` + `is` -> 2). Pure regex iteration, deterministic.
 */
function countDistinctMarkers(sentence: string): number {
  const seen = new Set<string>();
  for (const m of sentence.matchAll(CLAIM_MARKERS)) {
    const surface = m[1];
    if (surface) seen.add(surface.toLowerCase());
  }
  return seen.size;
}

/**
 * Split a paragraph into trimmed sentences (R1). Pure regex boundary —
 * terminator followed by whitespace OR end-of-string — with NO NLP and NO
 * abbreviation handling. Empty fragments are dropped.
 */
function splitSentences(para: string): string[] {
  return para
    .split(SENTENCE_BOUNDARY_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Locate the trusted character span of a sentence inside the paragraph. Uses
 * indexOf from a running cursor so repeated sentences resolve to successive
 * spans (deterministic). Falls back to [0, sentence.length) if not found
 * (whitespace-normalization edge) — span is only used for R2 proximity, which
 * for short paragraphs is "paragraph contains a [@citekey]".
 */
function locateSpan(para: string, sentence: string, fromIndex: number): { start: number; end: number } {
  const start = para.indexOf(sentence, fromIndex);
  if (start === -1) return { start: 0, end: sentence.length };
  return { start, end: start + sentence.length };
}

/**
 * R2 — collect every [@citekey] token's character offset inside the paragraph.
 * Used by isOrphan for the ORPHAN_PROXIMITY_CHARS distance test.
 */
function citekeyOffsets(para: string): number[] {
  const offsets: number[] = [];
  for (const m of para.matchAll(CITEKEY_RE)) {
    if (typeof m.index === 'number') offsets.push(m.index);
  }
  return offsets;
}

/**
 * Private findCitekeys (canonical dedup-extraction regex from pass1.ts lines
 * 191-194). Exported indirectly via runPass4 (Task 2) — not part of the public
 * surface. Deterministic Set of unique citekeys in the paragraph.
 */
function findCitekeys(para: string): Set<string> {
  return new Set(
    [...para.matchAll(CITEKEY_RE)].map((m) => m[1]).filter((s): s is string => Boolean(s)),
  );
}

/**
 * R2/R8 — a HIGH-confidence claim is an orphan when NO [@citekey] token appears
 * within ORPHAN_PROXIMITY_CHARS of the claim sentence's span. AMBIGUOUS claims
 * are NEVER auto-flagged here and NEVER contribute to orphanCount (R8). The
 * optional `hasAnyCitekey` fast-path lets the caller skip the offset scan when
 * the Step-2 findCitekeys set is empty (paragraph has no citations at all).
 */
function isOrphan(offsets: number[], claim: ExtractedClaim, hasAnyCitekey = true): boolean {
  if (claim.claimConfidence !== 'HIGH') return false;
  if (!hasAnyCitekey) return true; // R2: no [@citekey] anywhere -> uncited -> orphan
  for (const off of offsets) {
    // Distance from the citekey to the nearest edge of the sentence span.
    const distance =
      off < claim.startIndex
        ? claim.startIndex - off
        : off > claim.endIndex
          ? off - claim.endIndex
          : 0;
    if (distance <= ORPHAN_PROXIMITY_CHARS) return false; // cited within proximity
  }
  return true; // no citekey within proximity -> orphan
}

// ---- Public deterministic extraction (Step 1) ------------------------------

/**
 * Deterministic per-paragraph claim extraction implementing the PINNED rule
 * R1-R7 IN ORDER. Returns ONLY sentences that survive the R3/R4/R5 skip stage
 * AND have >=1 distinct marker (R6/R7): 1 -> AMBIGUOUS, 2+ -> HIGH. Pure-Node,
 * no NLP library, no LLM, no Date/Math.random — assert.deepEqual-identical
 * across repeated calls on the same input (VRFY-06 / PRD §14 determinism).
 *
 * CRITICAL ordering: R5 (the 8-word floor) runs BEFORE R6 marker counting, so a
 * sub-8-word sentence is dropped before it can ever be classified HIGH/orphan.
 */
export function extractClaimsFromParagraph(para: string): ExtractedClaim[] {
  const out: ExtractedClaim[] = [];
  let cursor = 0;
  for (const sentence of splitSentences(para)) {
    const { start, end } = locateSpan(para, sentence, cursor);
    cursor = end;

    // --- Skip stage (R3, R4, R5 — all BEFORE R6 marker counting) ---
    if (sentence.endsWith('?')) continue; // R3 rhetorical
    if (DEFINITION_MARKERS.test(sentence)) continue; // R4 definition
    if (wordCount(sentence) < CLAIM_MIN_WORDS) continue; // R5 length floor

    // --- R6 marker counting + R7 confidence (only for survivors) ---
    const markers = countDistinctMarkers(sentence);
    if (markers === 0) continue; // R7: not a claim
    out.push({
      sentence,
      startIndex: start,
      endIndex: end,
      claimConfidence: markers >= 2 ? 'HIGH' : 'AMBIGUOUS', // R7
    });
  }
  return out;
}

// ---- Deterministic per-paragraph audit (Step 1 + Step 2, no LLM) -----------

/**
 * Run the deterministic core (Step 1 extraction + Step 2 orphan detection) for a
 * single paragraph. orphanCount counts HIGH-confidence orphans ONLY (R8) and is
 * LLM-independent. The per-claim `label` defaults conservatively: HIGH claims ->
 * 'claim'; AMBIGUOUS claims -> 'UNCLEAR' (Task 2 may refine the AMBIGUOUS label
 * via the advisory Step-3 LLM, but that NEVER changes orphanCount).
 */
function auditParagraph(para: string, paragraphIndex: number): {
  result: Pass4Result;
  ambiguous: Array<{ index: number; claim: ExtractedClaim }>;
  offsets: number[];
} {
  const totalSentences = splitSentences(para).length;
  const claims = extractClaimsFromParagraph(para);
  const offsets = citekeyOffsets(para);
  // Step-2 canonical citekey set (pass1.ts dedup pattern). Its emptiness is the
  // fast no-citation path for isOrphan (R2).
  const hasAnyCitekey = findCitekeys(para).size > 0;

  const claimResults: Pass4ClaimResult[] = [];
  const ambiguous: Array<{ index: number; claim: ExtractedClaim }> = [];
  let orphanCount = 0;

  for (const claim of claims) {
    if (claim.claimConfidence === 'HIGH') {
      const orphan = isOrphan(offsets, claim, hasAnyCitekey);
      if (orphan) orphanCount += 1; // R8 — HIGH orphans ONLY
      claimResults.push({
        paragraphIndex,
        sentence: claim.sentence,
        confidence: 'HIGH',
        isOrphan: orphan,
        label: 'claim',
      });
    } else {
      // AMBIGUOUS — never counted toward orphanCount (R8). label deferred to
      // Step 3 (Task 2); conservative default until then.
      ambiguous.push({ index: claimResults.length, claim });
      claimResults.push({
        paragraphIndex,
        sentence: claim.sentence,
        confidence: 'AMBIGUOUS',
        isOrphan: false,
        label: 'UNCLEAR',
      });
    }
  }

  return {
    result: {
      paragraphIndex,
      totalSentences,
      claimsDetected: claims.length,
      orphanCount,
      claims: claimResults,
    },
    ambiguous,
    offsets,
  };
}

/**
 * Conservative offline placeholder for the Step-3 label (UNCLEAR-bias). Mirrors
 * the revise.ts Tier-2-placeholder stance: deterministic, never confident. Used
 * under PENSMITH_NO_LLM=1 (or no key) for every AMBIGUOUS sentence with NO
 * network call.
 */
function orphanLabelPlaceholder(): OrphanLabel {
  return 'UNCLEAR';
}

/** Resolve the anthropic model id from runtime config's defaultModel, falling
 *  back to the cheapest priced model. Never reads the api key here. */
async function resolveModelId(): Promise<string> {
  try {
    const cfg = await loadRuntimeConfig({ scope: 'auto' });
    return cfg.providers?.['anthropic']?.defaultModel ?? DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

/**
 * Parse the orphan-label model response into the {claim, definition, UNCLEAR}
 * enum. Defensive: anything that is not a valid enum value -> 'UNCLEAR'
 * (UNCLEAR-bias). Never throws.
 */
function parseOrphanLabel(raw: string): OrphanLabel {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const label = parsed['label'];
    if (label === 'claim' || label === 'definition' || label === 'UNCLEAR') {
      return label;
    }
  } catch {
    // Unparseable -> conservative UNCLEAR below.
  }
  return 'UNCLEAR';
}

/**
 * Pass 4 advisory orphan audit. Splits `draftMd` into paragraphs on /\n{2,}/,
 * runs the deterministic core (Step 1 extraction + Step 2 orphan detection, R1-R8)
 * per paragraph, and returns one Pass4Result per paragraph. orphanCount is the
 * deterministic HIGH-only count (R8) — computed in Step 2 and byte-identical
 * whether or not the Step-3 LLM ran.
 *
 * Step 3 (advisory, AMBIGUOUS sentences only): under PENSMITH_NO_LLM=1 (or no
 * ANTHROPIC_API_KEY) every AMBIGUOUS claim is labeled 'UNCLEAR' with ZERO network
 * calls (CI path). Otherwise each AMBIGUOUS sentence is sent to the hash-pinned
 * `orphan-label` prompt behind an assertBudget pre-call gate; the parsed label
 * populates that record's `label` (and, when confirmed 'claim', its audit-only
 * per-claim `isOrphan`) — but NEVER changes orphanCount or reclassifies a HIGH
 * claim (R8 invariant). Advisory by construction — NEVER mutates hasFail/status.
 */
export async function runPass4(
  draftMd: string,
  opts: { n: number; scopeCapUsd?: number },
): Promise<Pass4Result[]> {
  // Presence check ONLY — never reads the key VALUE (the resolved key, when the
  // live branch is reached, comes from getProviderApiKey('anthropic')).
  const noLlm = process.env['PENSMITH_NO_LLM'] === '1' || !process.env['ANTHROPIC_API_KEY'];

  const paragraphs = draftMd.split(/\n{2,}/);
  const audits: Array<{
    result: Pass4Result;
    ambiguous: Array<{ index: number; claim: ExtractedClaim }>;
    offsets: number[];
  }> = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const para = (paragraphs[i] ?? '').trim();
    if (para.length === 0) continue;
    audits.push(auditParagraph(para, i));
  }

  const results = audits.map((a) => a.result);
  const hasAmbiguous = audits.some((a) => a.ambiguous.length > 0);

  // --- Step 3 (advisory edge-case labeling — AMBIGUOUS sentences ONLY) ---
  if (noLlm || !hasAmbiguous) {
    // Offline / no-ambiguous: every AMBIGUOUS claim keeps the conservative
    // 'UNCLEAR' placeholder already set in auditParagraph. Zero network calls.
    return results;
  }

  // Live branch (only reached with a real key + LLM enabled + >=1 AMBIGUOUS).
  // Never reached in CI: the noLlm short-circuit above is the test path.
  const cap = opts.scopeCapUsd ?? PASS4_SECTION_CAP_DEFAULT;
  const scopeId = `${opts.n}-pass4`;
  const promptTemplate = loadPrompt('orphan-label');
  const modelId = await resolveModelId();
  const apiKey = await getProviderApiKey('anthropic');
  const client = new Anthropic({ apiKey });

  for (const audit of audits) {
    const paraText = (paragraphs[audit.result.paragraphIndex] ?? '').trim();
    for (const { index, claim } of audit.ambiguous) {
      let label: OrphanLabel = orphanLabelPlaceholder();
      try {
        const prompt = interpolate(promptTemplate, {
          sentence: claim.sentence,
          paragraph_context: paraText.slice(0, 500),
        });

        // ARCH-09/10 pre-call gate: assertBudget BEFORE the model call.
        const estimatedCallCost = estimateCost({
          providerId: 'anthropic',
          modelId,
          inputTokens: EST_INPUT_TOKENS,
          outputTokens: EST_OUTPUT_TOKENS,
        });
        await assertBudget({ scope: 'section', scopeId, cap }, estimatedCallCost);

        const res = await client.messages.create({
          model: modelId,
          max_tokens: EST_OUTPUT_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        });

        const inputTokens = res.usage?.input_tokens ?? EST_INPUT_TOKENS;
        const outputTokens = res.usage?.output_tokens ?? EST_OUTPUT_TOKENS;
        await appendCost({
          ts: new Date().toISOString(),
          scope: 'section',
          scopeId,
          provider: 'anthropic',
          model: modelId,
          inputTokens,
          outputTokens,
          costUsd: estimateCost({ providerId: 'anthropic', modelId, inputTokens, outputTokens }),
        });

        const textBlock = res.content.find((b) => b.type === 'text');
        const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : '';
        label = parseOrphanLabel(rawText);
      } catch {
        // Any failure (budget, transport, parse) -> conservative UNCLEAR. Never
        // thrown out of runPass4 (advisory must not crash verify).
        label = 'UNCLEAR';
      }

      // Write ONLY the per-claim advisory label. When Step 3 confirms 'claim',
      // populate the audit-only per-claim isOrphan (uncited -> true per R2) for
      // audit completeness. This NEVER feeds orphanCount (R8 invariant — that was
      // frozen in Step 2 and counts HIGH claims only).
      const record = audit.result.claims[index];
      if (record) {
        record.label = label;
        if (label === 'claim') {
          record.isOrphan = isOrphan(audit.offsets, {
            ...claim,
            claimConfidence: 'HIGH', // proximity test only; does NOT promote to orphanCount
          });
        }
      }
    }
  }

  return results;
}

// ---- Advisory render (deterministic, no LLM) -------------------------------

/**
 * Render the `## Pass-4` advisory section for VERIFICATION.md. Deterministic,
 * no LLM. Mirrors renderFreshnessTable: a per-paragraph orphan-count table. The
 * table carries integer counts only (no LLM-generated sentence text), so there
 * is no Markdown/HTML injection surface from the table body itself
 * (LLM-output-injection mitigation, T-05-03-01/02). Empty results -> a "no
 * paragraphs to audit" section.
 */
export function renderPass4Section(results: ReadonlyArray<Pass4Result>): string {
  if (results.length === 0) {
    return '## Pass-4 (orphan claims, advisory)\n\n_(no paragraphs to audit)_\n';
  }
  const lines = [
    '## Pass-4 (orphan claims, advisory — deterministic extraction + edge-case LLM labels)',
    '',
    '| Paragraph | Sentences | Claims | Orphans |',
    '|-----------|-----------|--------|---------|',
  ];
  for (const r of results) {
    lines.push(`| ${r.paragraphIndex} | ${r.totalSentences} | ${r.claimsDetected} | ${r.orphanCount} |`);
  }
  lines.push('');
  return lines.join('\n');
}
