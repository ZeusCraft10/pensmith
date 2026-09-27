// bin/lib/verify/pass2.ts — Pass 2 (claim support) advisory side-channel (VRFY-03).
//
// Modeled structurally on bin/lib/verify/freshness.ts: an advisory pass that
// runs AFTER the blocking verdict (Pass 1 + Pass 3) is frozen and NEVER feeds
// back into `hasFail` / `status`. This module returns Pass2Result[] ONLY — the
// orchestrator wiring (Plan 05-04) reads the results below the locked status
// line. There is NO hasFail / status reference anywhere in this file by design
// (VRFY-07; tests/verify-advisory-isolation.test.ts is the structural gate).
//
// For each in-text [@citekey] occurrence Pass 2:
//   1. extracts the citing sentence deterministically (pure regex, no LLM), and
//   2. (live branch only) asks the hash-pinned `claim-support` prompt for a
//      verdict in {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR}.
//
// UNCLEAR-bias is the load-bearing correctness property (VRFY-03): both the
// offline placeholder AND the prompt default to UNCLEAR rather than manufacturing
// a confident SUPPORTED on thin evidence.
//
// Offline guard (Pattern 4 — analog: bin/cli/revise.ts): under PENSMITH_NO_LLM=1
// Pass 2 returns a conservative UNCLEAR placeholder for every citation and
// issues NO network call. This is the CI path.
//
// Cost: every live claim-support call goes through complete(), which checks the
// SESSION cost cap before sending (RUN-18) and records the actual cost after.
// There is no per-section Pass-2 cap any more — the session cap is the only cap
// (D-17-26). claim-support is a judgment slug (claude-haiku-4-5 by default,
// RUN-26) with a structured contract (RUN-25): complete() returns the validated
// {verdict, rationale, evidence} object. The api key is resolved ONLY inside the
// transport; the value never reaches a log or the cost ledger (T-05-02-02).

import { complete, isFatalLlmError } from '../anthropic.js';
import type { ClaimSupport } from '../llm-contracts.js';
import { loadPrompt, interpolate } from '../prompt-loader.js';

// WR-04 (HARD-04c fence-marker breakout mitigation).
//
// The fence delimiter is in public source, so untrusted text that contains the
// exact CLOSE marker could break out of the data block and inject instructions.
// Strip/neutralize any occurrence of the fence open/close substrings from
// user-supplied variables BEFORE interpolation. The prompt template bodies are
// NOT changed by this fix, so no WN-3 re-pin is needed.
const FENCE_UUID = '7f3a9c2e-4b8d-4f1a-a0e2-1c5d7b9f3e6a';
const FENCE_OPEN  = `<<<PENSMITH_UNTRUSTED_DATA_${FENCE_UUID}>>>`;
const FENCE_CLOSE = `<<<END_PENSMITH_UNTRUSTED_DATA_${FENCE_UUID}>>>`;

/**
 * Remove any occurrence of the fence open/close markers from a string that
 * is about to be interpolated into an LLM prompt. This prevents a crafted
 * source abstract or draft sentence from breaking out of the data fence.
 */
function stripFenceMarkers(s: string): string {
  return s.replaceAll(FENCE_OPEN, '[REDACTED-FENCE-MARKER]')
          .replaceAll(FENCE_CLOSE, '[REDACTED-FENCE-MARKER]');
}

export type Pass2Verdict = 'SUPPORTED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNCLEAR';

export interface Pass2Result {
  citekey: string;
  /** The sentence in the draft that carries the [@citekey] token. */
  claimSentence: string;
  verdict: Pass2Verdict;
  /** <=200 chars, table-cell-safe (no markdown/HTML/newlines). */
  rationale: string;
  /** Verbatim substring of the source abstract, or '' (anti-fabrication). */
  evidence: string;
}

/** The bib metadata shape the caller (Plan 05-04) supplies — widened to carry
 *  title / author / abstract so the live claim-support prompt has source text. */
export type Pass2BibEntry = {
  DOI?: string;
  title?: string | string[];
  author?: Array<{ family?: string; given?: string }> | string[];
  abstract?: string;
};

interface ClaimPair {
  citekey: string;
  claimSentence: string;
}

const CITEKEY_RE = /\[@([a-z][a-z0-9_-]*)\]/g;

/**
 * Deterministic claim-sentence extraction. Splits `draftMd` into sentences on a
 * pure-regex boundary (terminal . / ! / ? followed by whitespace) and returns
 * the sentence(s) that contain the literal `[@<citekey>]` token. No NLP, no LLM
 * — identical input always yields identical output (PRD §14 determinism).
 */
function extractClaimSentences(draftMd: string, citekey: string): string[] {
  const token = `[@${citekey}]`;
  // Split on a sentence boundary: terminal punctuation followed by whitespace.
  // The lookbehind keeps the punctuation attached to the preceding sentence.
  const sentences = draftMd.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (sentence.length > 0 && sentence.includes(token)) {
      out.push(sentence);
    }
  }
  return out;
}

/**
 * Conservative offline placeholder (UNCLEAR-bias). Mirrors the revise.ts
 * Tier-2-placeholder stance: deterministic, reproducible, never confident.
 */
function pass2Placeholder(claimSentence: string, citekey: string): Pass2Result {
  return {
    citekey,
    claimSentence,
    verdict: 'UNCLEAR',
    rationale: 'LLM stubbed (PENSMITH_NO_LLM): no claim-support judgment was made.',
    evidence: '',
  };
}

/**
 * Build the ordered, de-duplicated list of (citekey, claimSentence) pairs to
 * judge. Each UNIQUE citekey contributes one pair using its first extracted
 * claim sentence; a citekey with no resolvable sentence still produces a pair
 * with an empty sentence so the offline placeholder path is total over the
 * draft's citations.
 */
function collectClaimPairs(draftMd: string): ClaimPair[] {
  const citekeys = [...draftMd.matchAll(CITEKEY_RE)]
    .map((m) => m[1])
    .filter((s): s is string => Boolean(s));
  const unique = [...new Set(citekeys)];
  return unique.map((citekey) => {
    const sentences = extractClaimSentences(draftMd, citekey);
    return { citekey, claimSentence: sentences[0] ?? '' };
  });
}

/** Normalize a CSL-style title (string | string[]) to a single string. */
function normalizeTitle(title: Pass2BibEntry['title']): string {
  if (Array.isArray(title)) return title.filter(Boolean).join(' ');
  return title ?? '';
}

/** Normalize a CSL-style author list to a comma-joined display string. */
function normalizeAuthors(author: Pass2BibEntry['author']): string {
  if (!author) return '';
  return author
    .map((a) => {
      if (typeof a === 'string') return a;
      const family = a.family ?? '';
      const given = a.given ?? '';
      return [given, family].filter(Boolean).join(' ').trim();
    })
    .filter(Boolean)
    .join(', ');
}

/** Clamp a free-text field to a table-cell-safe single line of <=max chars. */
function clampText(text: string, max: number): string {
  return text.replace(/[\r\n|]+/g, ' ').trim().slice(0, max);
}

/**
 * Turn the validated claim-support object into a Pass2Result. The schema
 * already pins the verdict enum; this step keeps the table-cell and
 * anti-fabrication guarantees:
 *   - rationale clamped to <=200 chars, newline/pipe-stripped
 *   - evidence must be a verbatim substring of the abstract, else '' (T-05-02-01)
 */
function toPass2Result(
  data: ClaimSupport,
  citekey: string,
  claimSentence: string,
  abstract: string,
): Pass2Result {
  const evidence = data.evidence.length > 0 && abstract.includes(data.evidence) ? data.evidence : '';
  return { citekey, claimSentence, verdict: data.verdict, rationale: clampText(data.rationale, 200), evidence };
}

/**
 * Pass 2 advisory claim-support run. Returns one Pass2Result per UNIQUE
 * [@citekey] in `draftMd`. Under PENSMITH_NO_LLM=1 (or when complete() cannot
 * resolve a provider key) every result is the conservative UNCLEAR placeholder
 * and no usable network call is made. A draft with zero citations returns [].
 * Advisory by construction — this function NEVER mutates shared blocking state.
 */
export async function runPass2(
  draftMd: string,
  bibByCitekey: Map<string, Pass2BibEntry>,
  opts: { n: number },
): Promise<Pass2Result[]> {
  // Provider-agnostic offline gate: only PENSMITH_NO_LLM short-circuits to the
  // placeholder. complete() owns provider + key resolution; if no provider key
  // is configured it throws and the per-call catch below yields UNCLEAR. (The
  // old `|| !ANTHROPIC_API_KEY` wrongly skipped valid non-Anthropic configs.)
  const noLlm = process.env['PENSMITH_NO_LLM'] === '1';
  const pairs = collectClaimPairs(draftMd);
  if (pairs.length === 0) return [];

  if (noLlm) {
    return pairs.map((p) => pass2Placeholder(p.claimSentence, p.citekey));
  }

  // ---- Live claim-support branch (only reached with a real key + LLM enabled).
  // Never reached in CI: the noLlm short-circuit above is the test path.
  const promptTemplate = loadPrompt('claim-support');

  const results: Pass2Result[] = [];
  for (const pair of pairs) {
    const bibEntry = bibByCitekey.get(pair.citekey);
    const abstract = bibEntry?.abstract ?? '';
    try {
      // WR-04: sanitize untrusted variables (claim_sentence comes from draft
      // text; source_abstract comes from CrossRef API) before interpolation
      // so neither can embed the fence close marker and break out of the
      // data block. Trusted metadata fields (citekey, title, authors) are
      // sanitized as well for defense-in-depth.
      const prompt = interpolate(promptTemplate, {
        citekey: stripFenceMarkers(pair.citekey),
        claim_sentence: stripFenceMarkers(pair.claimSentence),
        source_abstract: stripFenceMarkers(abstract),
        source_title: stripFenceMarkers(normalizeTitle(bibEntry?.title)),
        source_authors: stripFenceMarkers(normalizeAuthors(bibEntry?.author)),
      });

      // Route through the transport chokepoint (complete() → http.ts, D-06):
      // the session cost-cap check before sending, retry/backoff, and the
      // actual-usage cost record after. The prompt is the user message (no system).
      const res = await complete<ClaimSupport>({
        slug: 'claim-support',
        section: opts.n,
        system: '',
        messages: [{ role: 'user', content: prompt }],
      });
      results.push(toPass2Result(res.data as ClaimSupport, pair.citekey, pair.claimSentence, abstract));
    } catch (err) {
      // The session cost cap, a missing key and invalid configuration are never
      // advisory — they stop verify (RUN-18). Any other failure (provider error,
      // refusal, truncation, a reply that never matched the schema) surfaces as
      // a conservative UNCLEAR — advisory must not crash verify.
      if (isFatalLlmError(err)) throw err;
      results.push({
        citekey: pair.citekey,
        claimSentence: pair.claimSentence,
        verdict: 'UNCLEAR',
        rationale: clampText(`LLM error: ${String(err)}`, 200),
        evidence: '',
      });
    }
  }
  return results;
}

/**
 * Render the `## Pass-2` advisory section for VERIFICATION.md. Deterministic,
 * no LLM. Mirrors renderFreshnessTable. Emits table-cell-safe text only (no
 * HTML; claim sentence truncated to ~60 chars) — LLM-output-injection
 * mitigation (T-05-02-03). Empty results → a "no citations" section.
 */
export function renderPass2Section(results: ReadonlyArray<Pass2Result>): string {
  if (results.length === 0) {
    return '## Pass-2 (claim support, advisory)\n\n_(no citations to judge)_\n';
  }
  const lines = [
    '## Pass-2 (claim support, advisory — LLM-judged)',
    '',
    '| Citekey | Claim Sentence | Verdict | Rationale |',
    '|---------|---------------|---------|-----------|',
  ];
  for (const r of results) {
    const sentence = clampText(r.claimSentence, 60);
    const rationale = clampText(r.rationale, 200);
    lines.push(`| ${r.citekey} | ${sentence} | **${r.verdict}** | ${rationale} |`);
  }
  lines.push('');
  return lines.join('\n');
}
