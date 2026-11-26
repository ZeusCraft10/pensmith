// bin/lib/verify/pass2.ts — Pass 2 (claim support) advisory side-channel (VRFY-03).
//
// Modeled structurally on bin/lib/verify/freshness.ts: an advisory pass that
// runs AFTER the blocking verdict (Pass 1 + Pass 3) is frozen and NEVER feeds
// back into `hasFail` / `status`. This module returns Pass2Result[] ONLY — the
// orchestrator wiring (Plan 05-04) reads the results below the locked status
// line. There is NO hasFail / status reference anywhere in this file by design
// (VRFY-07; tests/verify-advisory-isolation.test.ts is the structural gate).
//
// For each cited key, in any Pandoc citation form, Pass 2:
//   1. extracts the citing sentence deterministically (citation grammar, no LLM), and
//   2. (live branch only) asks the hash-pinned `claim-support` prompt for a
//      verdict in {SUPPORTED, PARTIAL, UNSUPPORTED, UNCLEAR}.
//
// UNCLEAR-bias is the load-bearing correctness property (VRFY-03): both the
// offline placeholder AND the prompt default to UNCLEAR rather than manufacturing
// a confident SUPPORTED on thin evidence.
//
// Offline guard (Pattern 4 — analog: bin/cli/revise.ts): under PENSMITH_NO_LLM=1
// (or when ANTHROPIC_API_KEY is absent) Pass 2 returns a conservative UNCLEAR
// placeholder for every citation and issues NO network call. This is the CI path.
//
// Cost: every model call goes through complete(), which checks the paper's
// cost cap before the request and records the cost after it. The API key is
// resolved only there; it never reaches a log or the cost ledger.

import { complete } from '../anthropic.js';
import { loadPrompt, interpolate } from '../prompt-loader.js';
import { findCitations, paragraphBreaks, sentenceSpan } from '../citation-grammar.js';

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
  /** The sentence in the draft that cites the key. */
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

/**
 * Conservative offline placeholder (UNCLEAR-bias). Mirrors the revise.ts
 * Tier-2-placeholder stance: deterministic, reproducible, never confident.
 */
function pass2Placeholder(claimSentence: string, citekey: string): Pass2Result {
  return {
    citekey,
    claimSentence,
    verdict: 'UNCLEAR',
    rationale: 'Tier-2 placeholder: no LLM transport wired.',
    evidence: '',
  };
}

/**
 * The ordered, de-duplicated (citekey, claimSentence) pairs to judge: each
 * key the draft cites, in any Pandoc form, with the sentence of its first
 * citation. The sentence comes from the citation grammar, so a full stop in a
 * locator (`p. 4`) does not cut it short. Deterministic: no NLP, no LLM.
 */
function collectClaimPairs(draftMd: string): ClaimPair[] {
  const cites = findCitations(draftMd);
  const breaks = paragraphBreaks(draftMd);
  const pairs = new Map<string, string>();
  for (const c of cites) {
    for (const { key } of c.items) {
      if (pairs.has(key)) continue;
      const [start, end] = sentenceSpan(draftMd, c.start, c.end, cites, breaks);
      pairs.set(key, draftMd.slice(start, end).trim());
    }
  }
  return [...pairs].map(([citekey, claimSentence]) => ({ citekey, claimSentence }));
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
 * Parse the model's JSON response into a validated Pass2Result. Defensive:
 *   - verdict must be one of the four enum values, else UNCLEAR (UNCLEAR-bias)
 *   - rationale clamped to <=200 chars, newline/pipe-stripped
 *   - evidence must be a verbatim substring of the abstract, else '' (anti-fab)
 */
function parsePass2Response(
  raw: string,
  citekey: string,
  claimSentence: string,
  abstract: string,
): Pass2Result {
  let verdict: Pass2Verdict = 'UNCLEAR';
  let rationale = '';
  let evidence = '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const v = parsed['verdict'];
    if (v === 'SUPPORTED' || v === 'PARTIAL' || v === 'UNSUPPORTED' || v === 'UNCLEAR') {
      verdict = v;
    }
    if (typeof parsed['rationale'] === 'string') {
      rationale = clampText(parsed['rationale'], 200);
    }
    if (typeof parsed['evidence'] === 'string' && parsed['evidence'].length > 0) {
      // Anti-fabrication (T-05-02-01): evidence MUST be a substring of the abstract.
      evidence = abstract.includes(parsed['evidence']) ? parsed['evidence'] : '';
    }
  } catch {
    // Unparseable response → conservative UNCLEAR (UNCLEAR-bias).
    verdict = 'UNCLEAR';
    rationale = 'LLM response was not valid JSON; defaulting to UNCLEAR.';
  }
  return { citekey, claimSentence, verdict, rationale, evidence };
}

/**
 * Pass 2 advisory claim-support run. Returns one Pass2Result per UNIQUE
 * cited key in `draftMd`. Under PENSMITH_NO_LLM=1 (or when complete() cannot
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
  const scopeId = `${opts.n}-pass2`;
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

      // complete() is the one model-call path: the http.ts
      // chokepoint, the paper's cost cap before the call and the cost ledger
      // after it. The prompt is the user message (no system). A refusal over
      // the cap or a transport error is caught below as UNCLEAR.
      const res = await complete({
        system: '',
        messages: [{ role: 'user', content: prompt }],
        role: 'verify',
        scope: 'section',
        scopeId,
      });
      results.push(parsePass2Response(res.text, pair.citekey, pair.claimSentence, abstract));
    } catch (err) {
      // Any failure (budget, transport, parse) surfaces as a conservative
      // UNCLEAR — never thrown out of runPass2 (advisory must not crash verify).
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
