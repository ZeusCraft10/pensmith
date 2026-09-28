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
//   and NEVER reclassifies a HIGH claim. Each call goes through complete(), which
//   checks the SESSION cost cap before sending (RUN-18; there is no per-section
//   Pass-4 cap any more) — under PENSMITH_NO_LLM=1 Step 3 is skipped entirely,
//   every AMBIGUOUS claim is labeled 'UNCLEAR', and ZERO network calls are made
//   (CI path). orphan-label is a judgment slug with a structured contract
//   (RUN-25, RUN-26): complete() returns the validated {label} object.

import { complete, isFatalLlmError, MissingApiKeyError } from '../anthropic.js';
import type { OrphanLabel as OrphanLabelData } from '../llm-contracts.js';
import { loadPrompt, interpolate } from '../prompt-loader.js';

// WR-04 (HARD-04c fence-marker breakout mitigation).
//
// The fence delimiter is in public source, so untrusted text that contains the
// exact CLOSE marker could break out of the data block and inject instructions.
// Strip/neutralize any occurrence of the fence open/close substrings from
// user-supplied variables BEFORE interpolation. The prompt template bodies are
// NOT changed by this fix, so no WN-3 re-pin is needed.
const FENCE_UUID  = '7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a';
const FENCE_OPEN  = `<<<PENSMITH_UNTRUSTED_DATA_${FENCE_UUID}>>>`;
const FENCE_CLOSE = `<<<END_PENSMITH_UNTRUSTED_DATA_${FENCE_UUID}>>>`;

/**
 * Remove any occurrence of the fence open/close markers from a string that
 * is about to be interpolated into an LLM prompt. This prevents a crafted
 * draft sentence or paragraph context from breaking out of the data fence.
 */
function stripFenceMarkers(s: string): string {
  return s.replaceAll(FENCE_OPEN, '[REDACTED-FENCE-MARKER]')
          .replaceAll(FENCE_CLOSE, '[REDACTED-FENCE-MARKER]');
}

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

// ---- Step-3 LLM labeling (advisory edge-case labeling — AMBIGUOUS only) ----

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
  opts: { n: number },
): Promise<Pass4Result[]> {
  // Presence check ONLY — never reads the key VALUE (the resolved key, when the
  // live branch is reached, comes from getProviderApiKey('anthropic')).
  // Provider-agnostic offline gate (mirrors pass2): only PENSMITH_NO_LLM
  // short-circuits; complete() owns provider + key resolution and the per-call
  // catch yields UNCLEAR if no key resolves. (`|| !ANTHROPIC_API_KEY` wrongly
  // skipped valid non-Anthropic configs.)
  const noLlm = process.env['PENSMITH_NO_LLM'] === '1';

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
  const promptTemplate = loadPrompt('orphan-label');

  // Set once no provider key is configured: the remaining AMBIGUOUS claims keep
  // the conservative UNCLEAR label with no further call (advisory; verify still
  // writes its deterministic verdict — D-V1-04).
  let noKey = false;
  for (const audit of audits) {
    const paraText = (paragraphs[audit.result.paragraphIndex] ?? '').trim();
    for (const { index, claim } of audit.ambiguous) {
      let label: OrphanLabel = orphanLabelPlaceholder();
      if (noKey) continue;
      try {
        // WR-04: sanitize untrusted variables (sentence comes from draft text;
        // paragraph_context is a slice of the same draft) before interpolation
        // so neither can embed the fence close marker and break out of the
        // data block.
        const prompt = interpolate(promptTemplate, {
          sentence: stripFenceMarkers(claim.sentence),
          paragraph_context: stripFenceMarkers(paraText.slice(0, 500)),
        });

        // Route through the transport chokepoint (complete() → http.ts, D-06):
        // the session cost-cap check before sending, retry/backoff, and the
        // actual-usage cost record after.
        const res = await complete<OrphanLabelData>({
          slug: 'orphan-label',
          section: opts.n,
          system: '',
          messages: [{ role: 'user', content: prompt }],
        });
        label = (res.data as OrphanLabelData).label;
      } catch (err) {
        // No provider key: skip the rest (never fatal, see noKey above).
        if (err instanceof MissingApiKeyError) {
          noKey = true;
          continue;
        }
        // The session cost cap and invalid configuration stop verify (RUN-18;
        // verify writes its deterministic verdict first). Any other failure ->
        // conservative UNCLEAR (advisory must not crash verify).
        if (isFatalLlmError(err)) throw err;
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
